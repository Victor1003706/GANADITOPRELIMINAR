import type pg from 'pg';
import { calcularLiquidacionSubasta } from '@ganadito/contracts';

export interface DetalleCierreLote {
  loteId: string;
  codigoLote: string;
  estadoFinal: 'ADJUDICADO' | 'DESIERTO';
  ordenCompraId?: string;
  compradorId?: string;
  montoAdjudicado?: number;
  comisionPlataforma?: number;
  totalAPagar?: number;
}

export interface ResultadoCierreBatch {
  totalEvaluados: number;
  adjudicados: number;
  desiertos: number;
  ordenesGeneradas: number;
  detalles: DetalleCierreLote[];
}

export class SubastasCloserService {
  constructor(private pool: pg.Pool) {}

  /**
   * Adquiere de forma concurrente y atómica los lotes expirados (fecha_cierre <= NOW)
   * que permanecen en estado 'ACTIVO', cerrándolos como 'ADJUDICADO' o 'DESIERTO'
   * según cuenten o no con postor ganador.
   *
   * Invariante transaccional:
   * Cada lote se evalúa y confirma en su propia transacción atómica (BEGIN ... COMMIT)
   * con 'FOR UPDATE SKIP LOCKED' para evitar condiciones de carrera o bloqueos entre réplicas.
   */
  async cerrarLotesExpirados(batchSize = 100): Promise<ResultadoCierreBatch> {
    const resultado: ResultadoCierreBatch = {
      totalEvaluados: 0,
      adjudicados: 0,
      desiertos: 0,
      ordenesGeneradas: 0,
      detalles: []
    };

    // 1. Identificar candidatos iniciales que ya vencieron
    const candidatesRes = await this.pool.query<{ id: string }>(
      `SELECT id
       FROM lotes_subasta
       WHERE estado = 'ACTIVO' AND fecha_cierre <= CURRENT_TIMESTAMP
       ORDER BY fecha_cierre ASC
       LIMIT $1`,
      [batchSize]
    );

    if (candidatesRes.rows.length === 0) {
      return resultado;
    }

    resultado.totalEvaluados = candidatesRes.rows.length;

    // 2. Procesar cada lote candidato en su propia transacción atómica aislada
    for (const candidate of candidatesRes.rows) {
      const client = await this.pool.connect();

      try {
        await client.query('BEGIN');

        // Adquisición segura con bloqueo pesimista y SKIP LOCKED
        const loteRes = await client.query<{
          id: string;
          codigo_lote: string;
          vendedor_id: string;
          estado: string;
          precio_base: string | number;
          precio_actual: string | number;
          postor_ganador_id: string | null;
          organizacion_ganadora_id: string | null;
          creado_por_user_id: string | null;
          fecha_cierre: string;
          version: number;
        }>(
          `SELECT id, codigo_lote, vendedor_id, estado, precio_base, precio_actual, postor_ganador_id,
                  organizacion_ganadora_id, creado_por_user_id, fecha_cierre, version
           FROM lotes_subasta
           WHERE id = $1 AND estado = 'ACTIVO' AND fecha_cierre <= CURRENT_TIMESTAMP
           FOR UPDATE SKIP LOCKED`,
          [candidate.id]
        );

        // Si otro worker ya adquirió el lote o su estado cambió, liberar y continuar
        if (loteRes.rows.length === 0) {
          await client.query('ROLLBACK');
          continue;
        }

        const lote = loteRes.rows[0]!;

        // Caso A: Subasta sin pujas (sin postor ganador) -> Transiciona a 'DESIERTO'
        if (!lote.postor_ganador_id) {
          await client.query(
            `UPDATE lotes_subasta
             SET estado = 'DESIERTO',
                 updated_at = NOW()
             WHERE id = $1`,
            [lote.id]
          );

          const outboxPayload = {
            lote_id: lote.id,
            codigo_lote: lote.codigo_lote,
            motivo: 'SIN_OFERTAS',
            precio_base: Number(lote.precio_base),
            fecha_cierre: lote.fecha_cierre
          };

          await client.query(
            `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status)
             VALUES ('LOTE_SUBASTA', $1, 'SUBASTA_DESIERTA', $2, 'PENDIENTE')`,
            [lote.id, JSON.stringify(outboxPayload)]
          );

          await client.query('COMM