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
   * Se ejecuta de forma transaccional e idempotente en Postgre