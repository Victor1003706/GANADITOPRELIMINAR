import type pg from 'pg';
import {
  calcularLiquidacionVendedor,
  type DespacharOrdenInput,
  type DespacharOrdenResponse,
  type ConfirmarRecepcionInput,
  type ConfirmarRecepcionResponse
} from '@ganadito/contracts';

export class EntregaError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'EntregaError';
  }
}

export class OrdenesEntregaService {
  constructor(private pool: pg.Pool) {}

  /**
   * Confirma el despacho físico del lote vendido hacia custodia/transporte.
   * Transiciona la orden de compra de 'PAGADO' a 'EN_CUSTODIA'.
   */
  async despacharOrden(
    userId: string,
    activeOrgId: string | undefined,
    ordenId: string,
    input?: DespacharOrdenInput
  ): Promise<DespacharOrdenResponse> {
    if (!ordenId || !ordenId.trim()) {
      throw new EntregaError('ID de orden de compra inválido.', 400);
    }

    const trimmedId = ordenId.trim();

    // 1. Obtener la orden de compra
    const ordenRes = await this.pool.query<{
      id: string;
      vendedor_id: string | null;
      organizacion_vendedora_id: string;
      comprador_id: string;
      estado: string;
    }>(
      `SELECT id, vendedor_id, organizacion_vendedora_id, comprador_id, estado
       FROM ordenes_compra
       WHERE id = $1`,
      [trimmedId]
    );

    if (ordenRes.rows.length === 0) {
      throw new EntregaError('Orden de compra no encontrada.', 404);
    }

    const orden = ordenRes.rows[0]!;

    // 2. Validar que quien despacha sea el vendedor o pertenezca a la organización vendedora
    const esVendedor =
      orden.vendedor_id === userId ||
      (activeOrgId && orden.organizacion_vendedora_id === activeOrgId);

    if (!esVendedor) {
      throw new EntregaError('Solo el vendedor asignado puede despachar la orden de compra.', 403);
    }

    // 3. Validar estado de la orden (debe estar en 'PAGADO')
    if (orden.estado !== 'PAGADO') {
      throw new EntregaError(
        `La orden no puede ser despachada porque su estado actual es ${orden.estado} (se requiere PAGADO).`,
        409
      );
    }

    // 4. Actualizar estado a 'EN_CUSTODIA' y emitir evento en outbox_events
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const updateRes = await client.query<{ updated_at: string }>(
        `UPDATE ordenes_compra
         SET estado = 'EN_CUSTODIA',
             updated_at = NOW()
         WHERE id = $1 AND estado = 'PAGADO'
         RETURNING updated_at`,
        [orden.id]
      );

      if (updateRes.rows.length === 0) {
        throw new EntregaError('Conflicto de concurrencia al despachar la orden.', 409);
      }

      const outboxPayload = {
        orden_id: orden.id,
        estado: 'EN_CUSTODIA',
        despachado_por: userId,
        organizacion_vendedora_id: orden.organizacion_vendedora_id,
        guia_remision: input?.guia_remision ?? null,
        transportista_nombre: input?.transportista_nombre ?? null,
        transportista_placa: input?.transportista_placa ?? null,
        timestamp: new Date().toISOString()
      };

      await client.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status)
         VALUES ('ORDEN_COMPRA', $1, 'ORDEN_DESPACHADA', $2, 'PENDIENTE')`,
        [orden.id, JSON.stringify(outboxPayload)]
      );

      await client.query('COMMIT');

      return {
        orden_id: orden.id,
        estado: 'EN_CUSTODIA',
        mensaje: 'Orden despachada exitosamente a custodia.',
        despachado_at: updateRes.rows[0]!.updated_at
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Confirma la recepción física conforme del ganado por parte del comprador,
   * liberando los fondos en custodia y generando la liquidación neta al vendedor (99%).
   * Se ejecuta de forma transaccional e idempotente en PostgreSQL.
   */
  async confirmarRecepcion(
    userId: string,
    activeOrgId: string | undefined,
    ordenId: string,
    input?: ConfirmarRecepcionInput
  ): Promise<ConfirmarRecepcionResponse> {
    if (!ordenId || !ordenId.trim()) {
      throw new EntregaError('ID de orden de compra inválido.', 400);
    }

    const trimmedId = ordenId.trim();
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // a) Bloquear la orden de compra con FOR UPDATE
      const ordenRes = await client.query<{
        id: string;
        lote_id: string;
        comprador_id: string;
        organizacion_compradora_id: string | null;
        vendedor_id: string | null;
        organizacion_vendedora_id: string;
        monto_adjudicado: string | number;
        total_a_pagar: string | number;
        estado: string;
      }>(
        `SELECT id, lote_id, comprador_id, organizacion_compradora_id, vendedor_id,
                organizacion_vendedora_id, monto_adjudicado, total_a_pagar, estado
         FROM ordenes_compra
         WHERE id = $1
         FOR UPDATE`,
        [trimmedId]
      );

      if (ordenRes.rows.length === 0) {
        throw new EntregaError('Orden de compra no encontrada.', 404);
      }

      const orden = ordenRes.rows[0]!;

      // Validar que quien confirma sea el comprador legítimo
      const esComprador =
        orden.comprador_id === userId ||
        (activeOrgId && orden.organizacion_compradora_id === activeOrgId);

      if (!esComprador) {
        throw new EntregaError('Solo el comprador puede confirmar la recepción y liquidar la orden.', 403);
      }

      // Idempotencia: si la orden ya está liquidada, rechazar con error controlado
      if (orden.estado === 'LIQUIDADO') {
        throw new EntregaError('La orden de compra ya fue liquidada previamente.', 409);
      }

      // Validar que la orden esté en custodia antes de liberarla
      if (orden.estado !== 'EN_CUSTODIA') {
        throw new EntregaError(
          `La orden no puede ser confirmada porque su estado actual es ${orden.estado} (se requiere EN_CUSTODIA).`,
          409
        );
      }

      // b) Actualizar estado de orden a 'LIQUIDADO'
      await client.query(
        `UPDATE ordenes_compra
         SET estado = 'LIQUIDADO',
             updated_at = NOW()
         WHERE id = $1`,
        [orden.id]
      );

      // c) Obtener datos de la organización vendedora (incluyendo cuenta CCI)
      const orgVendedoraRes = await client.query<{
        id: string;
        razon_social: string;
        ruc: string;
        cuenta_bancaria_cci: string | null;
      }>(
        `SELECT id, razon_social, ruc, cuenta_bancaria_cci
         FROM organizaciones
         WHERE id = $1`,
        [orden.organizacion_vendedora_id]
      );

      const orgVendedora = orgVendedoraRes.rows[0];
      const cuentaCCI = orgVendedora?.cuenta_bancaria_cci ?? null;

      // Obtener vendedor_id usuario si no estaba registrado en la orden
      let vendedorUserId = orden.vendedor_id;
      if (!vendedorUserId) {
        const userOrgRes = await client.query<{ user_id: string }>(
          `SELECT user_id
           FROM user_organizaciones_roles
           WHERE organizacion_id = $1
           ORDER BY created_at ASC
           LIMIT 1`,
          [orden.organizacion_vendedora_id]
        );
        vendedorUserId = userOrgRes.rows[0]?.user_id ?? null;
      }

      if (!vendedorUserId) {
        throw new EntregaError('No se pudo identificar al usuario vendedor receptor de la liquidación.', 500);
      }

      // d) Calcular liquidación neta (monto adjudicado menos comisión del 1%)
      const montoAdjudicadoNum = Number(orden.monto_adjudicado);
      const { montoBruto, comisionRetenida, montoNetoPagar } =
        calcularLiquidacionVendedor(montoAdjudicadoNum);

      // Insertar en 'liquidaciones_vendedores'
      const liqRes = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO liquidaciones_vendedores (
           orden_id,
           vendedor_id,
           organizacion_vendedora_id,
           monto_bruto,
           comision_retenida,
           monto_neto_pagar,
           cuenta_bancaria_cci,
           estado
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDIENTE_DISPERSION')
         RETURNING id, created_at`,
        [
          orden.id,
          vendedorUserId,
          orden.organizacion_vendedora_id,
          montoBruto,
          comisionRetenida,
          montoNetoPagar,
          cuentaCCI
        ]
      );

      const liquidacion = liqRes.rows[0]!;

      // e) Insertar evento 'ORDEN_LIQUIDADA' en outbox_events
      const outboxPayload = {
        orden_id: orden.id,
        liquidacion_id: liquidacion.id,
        vendedor_id: vendedorUserId,
        organizacion_vendedora_id: orden.organizacion_vendedora_id,
        monto_bruto: montoBruto,
        comision_retenida: comisionRetenida,
        monto_neto_pagar: montoNetoPagar,
        // La CCI del vendedor no viaja en el evento: se consulta solo en la dispersión.
        estado: 'LIQUIDADO',
        observaciones: input?.observaciones ?? null,
        timestamp: new Date().toISOString()
      };

      await client.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status)
         VALUES ('ORDEN_COMPRA', $1, 'ORDEN_LIQUIDADA', $2, 'PENDIENTE')`,
        [orden.id, JSON.stringify(outboxPayload)]
      );

      await client.query('COMMIT');

      return {
        orden_id: orden.id,
        estado: 'LIQUIDADO',
        liquidacion: {
          id: liquidacion.id,
          monto_bruto: montoBruto,
          comision_retenida: comisionRetenida,
          monto_neto_pagar: montoNetoPagar,
          estado: 'PENDIENTE_DISPERSION'
        },
        // Sin promesa de custodia (AGENTS §2): no hay escrow documentado.
        mensaje: 'Recepción confirmada. La liquidación al vendedor queda pendiente de dispersión.',
        liquidado_at: liquidacion.created_at
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
