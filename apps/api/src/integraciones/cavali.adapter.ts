import type pg from 'pg';
import crypto from 'node:crypto';
import type {
  SolicitudFactoringInput,
  FactoringCavaliRecord,
  FactoringCavaliResponse
} from '@ganadito/contracts';

export class CavaliError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'CavaliError';
  }
}

function mapCavaliRow(row: any): FactoringCavaliRecord {
  const montoFactura = Number(row.monto_factura);
  const porcentaje = Number(row.porcentaje_adelanto);
  const tasa = Number(row.tasa_descuento_mensual);

  const adelantoBruto = montoFactura * (porcentaje / 100);
  const costoFinanciero = adelantoBruto * (tasa / 100);
  const adelantoNeto = Number((adelantoBruto - costoFinanciero).toFixed(2));

  return {
    id: row.id,
    orden_id: row.orden_id,
    comprobante_id: row.comprobante_id,
    organizacion_id: row.organizacion_id,
    monto_factura: montoFactura,
    porcentaje_adelanto: porcentaje,
    tasa_descuento_mensual: tasa,
    monto_adelanto_neto: adelantoNeto,
    estado: row.estado,
    cavali_tracking_id: row.cavali_tracking_id ?? null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString()
  };
}

export class CavaliAdapter {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Registra una solicitud de factoring electrónico en CAVALI Factoring Stub.
   * Calcula el importe financiado neto y anota en cuenta con un tracking ID único.
   */
  async solicitarFactoring(
    input: SolicitudFactoringInput,
    organizacionSessionId?: string
  ): Promise<FactoringCavaliResponse> {
    if (!input.orden_id) {
      throw new CavaliError('orden_id es obligatorio.', 400);
    }
    if (!input.comprobante_id) {
      throw new CavaliError('comprobante_id es obligatorio.', 400);
    }

    const porcentajeAdelanto = input.porcentaje_adelanto ?? 80.0;
    const tasaDescuento = input.tasa_descuento_mensual ?? 1.2;

    if (porcentajeAdelanto <= 0 || porcentajeAdelanto > 100) {
      throw new CavaliError('porcentaje_adelanto debe estar comprendido entre 0 y 100%.', 400);
    }
    if (tasaDescuento < 0 || tasaDescuento > 50) {
      throw new CavaliError('tasa_descuento_mensual inválida.', 400);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Validar que la orden exista y obtener su organización vendedora/acreedora
      if (!organizacionSessionId) {
        throw new CavaliError('Debe seleccionar una organización activa.', 403);
      }

      // Solo una de las partes de la orden puede solicitar factoring sobre ella.
      const ordenRes = await client.query<{
        id: string;
        organizacion_vendedora_id: string;
        estado: string;
      }>(
        `SELECT id, organizacion_vendedora_id, estado
         FROM ordenes_compra
         WHERE id = $1 AND (organizacion_compradora_id = $2 OR organizacion_vendedora_id = $2);`,
        [input.orden_id, organizacionSessionId]
      );

      if (ordenRes.rows.length === 0) {
        throw new CavaliError(`Orden de compra ${input.orden_id} no encontrada.`, 404);
      }

      const orden = ordenRes.rows[0]!;
      // La organización la determina la sesión; `input.organizacion_id` del cliente se ignora.
      const orgId = organizacionSessionId;
      void orden;

      // 2. Validar comprobante tributario
      const compRes = await client.query<{
        id: string;
        orden_id: string;
        monto_total: string;
        estado_sunat: string;
        serie: string;
        correlativo: number;
      }>(
        `SELECT id, orden_id, monto_total, estado_sunat, serie, correlativo
         FROM comprobantes_tributarios
         WHERE id = $1
         FOR UPDATE;`,
        [input.comprobante_id]
      );

      if (compRes.rows.length === 0) {
        throw new CavaliError(`Comprobante fiscal ${input.comprobante_id} no encontrado.`, 404);
      }

      const comprobante = compRes.rows[0]!;
      if (comprobante.orden_id !== orden.id) {
        throw new CavaliError('El comprobante fiscal no corresponde a la orden de compra indicada.', 400);
      }

      if (comprobante.estado_sunat !== 'CONFIRMADO') {
        throw new CavaliError(
          `Solo se pueden ceder a factoring comprobantes con estado CONFIRMADO por SUNAT (estado actual: ${comprobante.estado_sunat}).`,
          400
        );
      }

      // 3. Cálculos financieros de factoring
      const montoFactura = Number(comprobante.monto_total);
      const adelantoBruto = montoFactura * (porcentajeAdelanto / 100);
      const costoFinanciero = adelantoBruto * (tasaDescuento / 100);
      const montoAdelantoNeto = Number((adelantoBruto - costoFinanciero).toFixed(2));

      // 4. Generación de cavali_tracking_id único
      const cavaliTrackingId = `CAVALI-FT-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      // 5. Inserción del registro de factoring
      const insertRes = await client.query(
        `INSERT INTO factoring_cavali_solicitudes (
           orden_id,
           comprobante_id,
           organizacion_id,
           monto_factura,
           porcentaje_adelanto,
           tasa_descuento_mensual,
           estado,
           cavali_tracking_id
         ) VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMADO', $7)
         RETURNING *;`,
        [
          orden.id,
          comprobante.id,
          orgId,
          montoFactura,
          porcentajeAdelanto,
          tasaDescuento,
          cavaliTrackingId
        ]
      );

      const record = mapCavaliRow(insertRes.rows[0]);

      // 6. Registro de evento Outbox
      await client.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, $2, $3, $4::jsonb);`,
        [
          'FACTORING',
          record.id,
          'FACTORING_CAVALI_REGISTRADO',
          JSON.stringify({
            factoring_id: record.id,
            orden_id: record.orden_id,
            comprobante_id: record.comprobante_id,
            cavali_tracking_id: cavaliTrackingId,
            monto_factura: montoFactura,
            monto_adelanto_neto: montoAdelantoNeto,
            registrado_en: new Date().toISOString()
          })
        ]
      );

      await client.query('COMMIT');

      return {
        solicitud: record,
        monto_adelanto_calculado: montoAdelantoNeto,
        mensaje: `Factura negociable anotada en cuenta exitosamente en CAVALI. Tracking: ${cavaliTrackingId}`
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Consulta una solicitud de factoring por ID.
   */
  async obtenerFactoringPorId(id: string, organizacionId: string): Promise<FactoringCavaliRecord> {
    const res = await this.pool.query(
      'SELECT * FROM factoring_cavali_solicitudes WHERE id = $1 AND organizacion_id = $2;',
      [id, organizacionId]
    );
    if (res.rows.length === 0) {
      throw new CavaliError(`Solicitud de factoring ${id} no encontrada.`, 404);
    }
    return mapCavaliRow(res.rows[0]);
  }

  /**
   * Lista solicitudes de factoring ordenadas cronológicamente descendente.
   */
  async listarFactorings(organizacionId: string, limit: number = 50): Promise<FactoringCavaliRecord[]> {
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(1, Math.trunc(limit)), 100) : 50;
    const res = await this.pool.query(
      'SELECT * FROM factoring_cavali_solicitudes WHERE organizacion_id = $1 ORDER BY created_at DESC LIMIT $2;',
      [organizacionId, safeLimit]
    );
    return res.rows.map(mapCavaliRow);
  }
}
