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

          await client.query('COMMIT');

          resultado.desiertos++;
          resultado.detalles.push({
            loteId: lote.id,
            codigoLote: lote.codigo_lote,
            estadoFinal: 'DESIERTO'
          });
          continue;
        }

        // Caso B: Subasta con postor ganador -> Transiciona a 'ADJUDICADO' y genera Orden de Compra
        // a) Actualizar estado del lote
        await client.query(
          `UPDATE lotes_subasta
           SET estado = 'ADJUDICADO',
               updated_at = NOW()
           WHERE id = $1`,
          [lote.id]
        );

        // b) Calcular liquidación comercial (1% comisión plataforma)
        const montoAdjudicado = Number(lote.precio_actual);
        const { comisionPlataforma, totalAPagar } = calcularLiquidacionSubasta(montoAdjudicado);

        // Obtener organización activa del comprador si existe
        const buyerOrgRes = await client.query<{ organizacion_id: string }>(
          `SELECT organizacion_id
           FROM user_organizaciones_roles
           WHERE user_id = $1
           ORDER BY is_active_context DESC, created_at ASC
           LIMIT 1`,
          [lote.postor_ganador_id]
        );
        // La organización compradora es la que estaba activa al pujar (organizacion_ganadora_id).
        // El contexto activo actual solo se usa para lotes anteriores a la migración 0011.
        const orgCompradoraId =
          lote.organizacion_ganadora_id ?? buyerOrgRes.rows[0]?.organizacion_id ?? null;

        // Obtener usuario representante de la organización vendedora
        const sellerUserRes = await client.query<{ user_id: string }>(
          `SELECT user_id
           FROM user_organizaciones_roles
           WHERE organizacion_id = $1
           ORDER BY created_at ASC
           LIMIT 1`,
          [lote.vendedor_id]
        );
        const vendedorUserId = lote.creado_por_user_id ?? sellerUserRes.rows[0]?.user_id ?? null;

        // c) Insertar fila en 'ordenes_compra'
        const ordenRes = await client.query<{ id: string }>(
          `INSERT INTO ordenes_compra (
             lote_id,
             comprador_id,
             organizacion_compradora_id,
             vendedor_id,
             organizacion_vendedora_id,
             monto_adjudicado,
             comision_plataforma,
             total_a_pagar,
             estado
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDIENTE_PAGO')
           RETURNING id`,
          [
            lote.id,
            lote.postor_ganador_id,
            orgCompradoraId,
            vendedorUserId,
            lote.vendedor_id,
            montoAdjudicado,
            comisionPlataforma,
            totalAPagar
          ]
        );

        const ordenId = ordenRes.rows[0]!.id;

        // d) Inserta evento 'SUBASTA_ADJUDICADA' en outbox_events
        const outboxPayload = {
          lote_id: lote.id,
          codigo_lote: lote.codigo_lote,
          orden_id: ordenId,
          comprador_id: lote.postor_ganador_id,
          organizacion_compradora_id: orgCompradoraId,
          organizacion_vendedora_id: lote.vendedor_id,
          monto_adjudicado: montoAdjudicado,
          comision_plataforma: comisionPlataforma,
          total_a_pagar: totalAPagar,
          estado: 'PENDIENTE_PAGO'
        };

        await client.query(
          `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status)
           VALUES ('LOTE_SUBASTA', $1, 'SUBASTA_ADJUDICADA', $2, 'PENDIENTE')`,
          [lote.id, JSON.stringify(outboxPayload)]
        );

        await client.query('COMMIT');

        resultado.adjudicados++;
        resultado.ordenesGeneradas++;
        resultado.detalles.push({
          loteId: lote.id,
          codigoLote: lote.codigo_lote,
          estadoFinal: 'ADJUDICADO',
          ordenCompraId: ordenId,
          compradorId: lote.postor_ganador_id,
          montoAdjudicado,
          comisionPlataforma,
          totalAPagar
        });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        // Registramos el fallo para este lote sin interrumpir el resto del lote
        console.error(`Error al liquidar lote ${candidate.id}:`, err);
      } finally {
        client.release();
      }
    }

    return resultado;
  }
}
