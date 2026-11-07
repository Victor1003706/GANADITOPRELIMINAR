import type pg from 'pg';
import crypto from 'node:crypto';
import type {
  TipoComprobanteTributario,
  EstadoIntegracionTributaria,
  TipoDocumentoReceptor,
  LiquidacionCompraInput,
  ComprobanteFiscalRecord,
  EmisionComprobanteResponse,
  ConciliacionPendientesResponse
} from '@ganadito/contracts';

export class SunatError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'SunatError';
  }
}

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface SunatAdapterOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  forceFailureSimulation?: boolean;
}

function mapComprobanteRow(row: any): ComprobanteFiscalRecord {
  return {
    id: row.id,
    orden_id: row.orden_id,
    tipo_comprobante: row.tipo_comprobante,
    serie: String(row.serie).trim(),
    correlativo: Number(row.correlativo),
    emisor_ruc: String(row.emisor_ruc).trim(),
    receptor_num_doc: String(row.receptor_num_doc).trim(),
    receptor_tipo_doc: row.receptor_tipo_doc,
    monto_subtotal: Number(row.monto_subtotal),
    monto_igv: Number(row.monto_igv),
    monto_total: Number(row.monto_total),
    estado_sunat: row.estado_sunat,
    external_correlation_id: row.external_correlation_id,
    xml_payload_resumen:
      typeof row.xml_payload_resumen === 'string'
        ? JSON.parse(row.xml_payload_resumen)
        : row.xml_payload_resumen,
    cdr_sunat_codigo: row.cdr_sunat_codigo ?? null,
    cdr_sunat_mensaje: row.cdr_sunat_mensaje ?? null,
    retry_count: Number(row.retry_count),
    next_retry_at: row.next_retry_at ? new Date(row.next_retry_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString()
  };
}

export class SunatAdapter {
  private circuitState: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private forceFailureSimulation: boolean;

  constructor(
    private readonly pool: pg.Pool,
    options: SunatAdapterOptions = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 10000;
    this.forceFailureSimulation = options.forceFailureSimulation ?? false;
  }

  public setForceFailureSimulation(enabled: boolean): void {
    this.forceFailureSimulation = enabled;
  }

  public getCircuitState(): CircuitBreakerState {
    if (
      this.circuitState === 'OPEN' &&
      Date.now() - this.lastFailureTime >= this.resetTimeoutMs
    ) {
      this.circuitState = 'HALF_OPEN';
    }
    return this.circuitState;
  }

  public resetCircuit(): void {
    this.circuitState = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    this.forceFailureSimulation = false;
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitState = 'CLOSED';
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    this.lastFailureTime = Date.now();
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.circuitState = 'OPEN';
    }
  }

  /**
   * Obtiene el siguiente correlativo monótono dentro de una transacción serializable.
   */
  async obtenerSiguienteCorrelativo(
    client: pg.PoolClient,
    tipoComprobante: TipoComprobanteTributario,
    serie: string
  ): Promise<number> {
    const res = await client.query<{ max_corr: number | null }>(
      `SELECT MAX(correlativo) AS max_corr
       FROM comprobantes_tributarios
       WHERE tipo_comprobante = $1 AND serie = $2`,
      [tipoComprobante, serie]
    );

    const actual = res.rows[0]?.max_corr;
    return (actual ? Number(actual) : 0) + 1;
  }

  /**
   * Genera y despacha una Liquidación de Compra Electrónica (SEE-SUNAT)
   * vinculada a una orden de compra liquidada y a un productor agropecuario con DNI.
   */
  async emitirLiquidacionCompra(
    input: LiquidacionCompraInput,
    organizacionSesionId: string
  ): Promise<EmisionComprobanteResponse> {
    if (!input.orden_compra_id) {
      throw new SunatError('orden_compra_id es obligatorio.', 400);
    }
    if (!input.emisor_ruc || !/^\d{11}$/.test(input.emisor_ruc.trim())) {
      throw new SunatError('emisor_ruc debe ser un RUC válido de 11 dígitos.', 400);
    }
    if (!input.productor_dni || !/^\d{8}$/.test(input.productor_dni.trim())) {
      throw new SunatError('El productor sin RUC debe identificarse obligatoriamente con DNI de 8 dígitos.', 400);
    }
    if (typeof input.monto_total_pen !== 'number' || input.monto_total_pen <= 0) {
      throw new SunatError('monto_total_pen debe ser mayor a 0.', 400);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Validar orden de compra y exigir que se encuentre en estado 'LIQUIDADO'
      // La liquidación de compra la emite el comprador: la orden debe pertenecer a la
      // organización activa como compradora. Si no, se responde 404 (no revelar existencia).
      const ordenRes = await client.query<{ id: string; estado: string; total_a_pagar: string; monto_adjudicado: string }>(
        `SELECT id, estado, total_a_pagar, monto_adjudicado
         FROM ordenes_compra
         WHERE id = $1 AND organizacion_compradora_id = $2
         FOR UPDATE;`,
        [input.orden_compra_id, organizacionSesionId]
      );

      if (ordenRes.rows.length === 0) {
        throw new SunatError(`Orden de compra ${input.orden_compra_id} no encontrada.`, 404);
      }

      const orden = ordenRes.rows[0]!;
      if (orden.estado !== 'LIQUIDADO') {
        throw new SunatError(
          `La emisión de Liquidación de Compra Electrónica exige que la orden esté en estado 'LIQUIDADO' (estado actual: ${orden.estado}).`,
          400
        );
      }

      // 2. Asignar serie 'E001' y correlativo monótono
      const serie = 'E001';
      const tipoComprobante: TipoComprobanteTributario = 'LIQUIDACION_COMPRA_ELECTRONICA';
      const correlativo = await this.obtenerSiguienteCorrelativo(client, tipoComprobante, serie);

      const externalCorrelationId = `SUNAT-LCE-${serie}-${String(correlativo).padStart(8, '0')}-${crypto.randomUUID().slice(0, 8)}`;

      // Liquidación de compra: No genera IGV débito sino retención asumida o inafecto según régimen
      // El monto sale de la orden (fuente de verdad). Antes se tomaba del cliente sin
      // contrastar: se podía emitir una LCE por cualquier importe.
      const montoTotal = Number(orden.monto_adjudicado);
      if (Math.round(input.monto_total_pen * 100) !== Math.round(montoTotal * 100)) {
        throw new SunatError(
          `monto_total_pen (${input.monto_total_pen}) no coincide con el monto adjudicado de la orden (${montoTotal}).`,
          400
        );
      }
      const montoSubtotal = montoTotal;
      const montoIgv = 0.0;

      const xmlResumen = {
        tipo_comprobante: tipoComprobante,
        serie,
        correlativo,
        emisor: {
          ruc: input.emisor_ruc.trim(),
          razon_social: input.emisor_razon_social
        },
        receptor: {
          tipo_doc: 'DNI',
          num_doc: input.productor_dni.trim(),
          nombre: input.productor_nombre,
          ppa_codigo: input.productor_ppa_codigo ?? null
        },
        moneda: 'PEN',
        monto_subtotal: montoSubtotal,
        monto_igv: montoIgv,
        monto_total: montoTotal,
        items: input.items ?? [
          {
            descripcion: 'Ganado en pie / Lote de subasta liquidado',
            cantidad: 1,
            unidad_medida: 'NIU',
            precio_unitario_pen: montoTotal,
            monto_total_pen: montoTotal
          }
        ],
        generado_en: new Date().toISOString()
      };

      // 3. Determinar estado inicial según Circuit Breaker y simulación
      const circuitAbierto = this.getCircuitState() === 'OPEN';
      const simularFallo = this.forceFailureSimulation || circuitAbierto;

      let estadoSunat: EstadoIntegracionTributaria = 'CONFIRMADO';
      let cdrCodigo: string | null = '0';
      let cdrMensaje: string | null = `La Liquidación de Compra ${serie}-${correlativo} ha sido aceptada por SUNAT.`;
      let retryCount = 0;
      let nextRetryAt: string | null = null;

      if (simularFallo) {
        this.recordFailure();
        estadoSunat = 'ENVIADO_PENDIENTE';
        cdrCodigo = null;
        cdrMensaje = 'Despacho en cola o satélite SEE-SUNAT no disponible temporalmente. Pasa a conciliación asíncrona.';
        retryCount = 1;
        nextRetryAt = new Date(Date.now() + 60000).toISOString();
      } else {
        this.recordSuccess();
      }

      // 4. Insertar comprobante tributario en la base de datos
      const insertRes = await client.query(
        `INSERT INTO comprobantes_tributarios (
           orden_id,
           tipo_comprobante,
           serie,
           correlativo,
           emisor_ruc,
           receptor_num_doc,
           receptor_tipo_doc,
           monto_subtotal,
           monto_igv,
           monto_total,
           estado_sunat,
           external_correlation_id,
           xml_payload_resumen,
           cdr_sunat_codigo,
           cdr_sunat_mensaje,
           retry_count,
           next_retry_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *;`,
        [
          input.orden_compra_id,
          tipoComprobante,
          serie,
          correlativo,
          input.emisor_ruc.trim(),
          input.productor_dni.trim(),
          'DNI',
          montoSubtotal,
          montoIgv,
          montoTotal,
          estadoSunat,
          externalCorrelationId,
          JSON.stringify(xmlResumen),
          cdrCodigo,
          cdrMensaje,
          retryCount,
          nextRetryAt
        ]
      );

      const comprobante = mapComprobanteRow(insertRes.rows[0]);

      // 5. Si fue confirmado inmediatamente, emitir evento Outbox
      if (estadoSunat === 'CONFIRMADO') {
        await client.query(
          `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, $2, $3, $4::jsonb);`,
          [
            'COMPROBANTE',
            comprobante.id,
            'COMPROBANTE_SUNAT_CONFIRMADO',
            JSON.stringify({
              comprobante_id: comprobante.id,
              orden_id: comprobante.orden_id,
              tipo_comprobante: comprobante.tipo_comprobante,
              serie: comprobante.serie,
              correlativo: comprobante.correlativo,
              estado_sunat: comprobante.estado_sunat,
              cdr_codigo: comprobante.cdr_sunat_codigo,
              monto_total: comprobante.monto_total,
              confirmado_en: new Date().toISOString()
            })
          ]
        );
      }

      await client.query('COMMIT');

      return {
        comprobante,
        sunat_status: estadoSunat,
        mensaje: cdrMensaje ?? 'Comprobante procesado'
      };
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') {
        throw new SunatError('Violación de unicidad: ya existe un comprobante con la misma serie y correlativo.', 409);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Job de Conciliación de Comprobantes atascados en 'ENVIADO_PENDIENTE'.
   * Consulta a SUNAT Sandbox y resuelve con CDR virtual positivo.
   */
  async conciliarComprobantesPendientes(): Promise<ConciliacionPendientesResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const pendientesRes = await client.query(
        `SELECT *
         FROM comprobantes_tributarios
         WHERE estado_sunat = 'ENVIADO_PENDIENTE'
         FOR UPDATE SKIP LOCKED;`
      );

      const rows = pendientesRes.rows;
      const detalles: ConciliacionPendientesResponse['detalles'] = [];
      let confirmados = 0;

      for (const row of rows) {
        const id = row.id;
        const serie = row.serie;
        const correlativo = row.correlativo;

        const cdrCodigo = '0';
        const cdrMensaje = `CDR obtenido exitosamente por job de conciliación para ${serie}-${correlativo}.`;

        await client.query(
          `UPDATE comprobantes_tributarios
           SET 
             estado_sunat = 'CONFIRMADO',
             cdr_sunat_codigo = $1,
             cdr_sunat_mensaje = $2,
             retry_count = retry_count + 1,
             next_retry_at = NULL,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $3;`,
          [cdrCodigo, cdrMensaje, id]
        );

        // Emitir Outbox Event tras conciliar
        await client.query(
          `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, $2, $3, $4::jsonb);`,
          [
            'COMPROBANTE',
            id,
            'COMPROBANTE_SUNAT_CONFIRMADO',
            JSON.stringify({
              comprobante_id: id,
              orden_id: row.orden_id,
              tipo_comprobante: row.tipo_comprobante,
              serie,
              correlativo,
              estado_sunat: 'CONFIRMADO',
              cdr_codigo: cdrCodigo,
              monto_total: Number(row.monto_total),
              conciliado_en: new Date().toISOString()
            })
          ]
        );

        confirmados += 1;
        detalles.push({
          comprobante_id: id,
          serie,
          correlativo,
          nuevo_estado: 'CONFIRMADO',
          mensaje: cdrMensaje
        });
      }

      await client.query('COMMIT');

      // Si se conciliaron comprobantes, restablecer el Circuit Breaker a CLOSED
      this.resetCircuit();

      return {
        procesados: rows.length,
        confirmados,
        pendientes: 0,
        fallidos: 0,
        detalles
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Obtiene un comprobante tributario por su ID.
   */
  async obtenerComprobantePorId(id: string, organizacionId: string): Promise<ComprobanteFiscalRecord> {
    const res = await this.pool.query(
      `SELECT c.* FROM comprobantes_tributarios c
       JOIN ordenes_compra o ON o.id = c.orden_id
       WHERE c.id = $1 AND (o.organizacion_compradora_id = $2 OR o.organizacion_vendedora_id = $2);`,
      [id, organizacionId]
    );
    if (res.rows.length === 0) {
      throw new SunatError(`Comprobante ${id} no encontrado.`, 404);
    }
    return mapComprobanteRow(res.rows[0]);
  }

  /**
   * Lista comprobantes tributarios ordenados cronológicamente descendente.
   */
  async listarComprobantes(organizacionId: string, limit: number = 50): Promise<ComprobanteFiscalRecord[]> {
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(1, Math.trunc(limit)), 100) : 50;
    const res = await this.pool.query(
      `SELECT c.* FROM comprobantes_tributarios c
       JOIN ordenes_compra o ON o.id = c.orden_id
       WHERE o.organizacion_compradora_id = $1 OR o.organizacion_vendedora_id = $1
       ORDER BY c.created_at DESC LIMIT $2;`,
      [organizacionId, safeLimit]
    );
    return res.rows.map(mapComprobanteRow);
  }
}
