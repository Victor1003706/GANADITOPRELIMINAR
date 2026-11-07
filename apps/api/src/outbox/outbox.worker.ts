import type pg from 'pg';
import { proyectarEventoPublico } from './eventos-publicos.js';
import type { OutboxEventRecord, OutboxBatchResult, RedisPublisherLike } from './outbox.types.js';

export interface OutboxWorkerOptions {
  pool: pg.Pool;
  publisher: RedisPublisherLike;
  workerId?: string;
  pollIntervalMs?: number;
  batchSize?: number;
  logger?: boolean;
}

/**
 * Procesa un lote atómico de eventos outbox utilizando SKIP LOCKED, leases y fencing tokens.
 * Garantiza entrega At-Least-Once hacia Redis Pub/Sub y protección contra workers zombies.
 */
export async function procesarLoteOutbox(
  pool: pg.Pool,
  redisPublisher: RedisPublisherLike,
  workerId: string,
  batchSize = 50
): Promise<OutboxBatchResult> {
  const result: OutboxBatchResult = {
    totalLeidos: 0,
    procesados: 0,
    fallidos: 0,
    dlq: 0,
    fenced: 0
  };

  // 1. Adquisición atómica con SKIP LOCKED, lease de 30s e incremento de fencing_token
  const acquireQuery = `
    UPDATE outbox_events
    SET status = 'PROCESANDO',
        lease_worker_id = $1,
        lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '30 seconds',
        fencing_token = fencing_token + 1
    WHERE id IN (
        SELECT id FROM outbox_events
        WHERE (status = 'PENDIENTE' AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP))
           OR (status = 'PROCESANDO' AND lease_expires_at < CURRENT_TIMESTAMP)
        ORDER BY created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
    ) RETURNING *;
  `;

  const queryRes = await pool.query<OutboxEventRecord>(acquireQuery, [workerId, batchSize]);
  const eventos = queryRes.rows;
  result.totalLeidos = eventos.length;

  if (eventos.length === 0) {
    return result;
  }

  // 2. Procesar cada evento adquirido individualmente
  for (const evento of eventos) {
    try {
      // Publicar solo la proyección pública del evento (contrato v1: {event_type, lote_id, data}).
      // Los eventos internos (p. ej. ORDEN_PAGADA) se marcan procesados sin salir a la sala.
      const publico = proyectarEventoPublico(
        evento.aggregate_type,
        evento.aggregate_id,
        evento.event_type,
        evento.payload
      );
      if (publico) {
        await redisPublisher.publish(publico.canal, JSON.stringify(publico.mensaje));
      }

      // 3. Confirmar procesamiento exitoso verificando fencing_token (protección contra lease robado)
      const updateRes = await pool.query(
        `UPDATE outbox_events
         SET status = 'PROCESADO',
             lease_worker_id = NULL,
             lease_expires_at = NULL
         WHERE id = $1 AND fencing_token = $2`,
        [evento.id, evento.fencing_token]
      );

      if (updateRes.rowCount && updateRes.rowCount > 0) {
        result.procesados++;
      } else {
        // Otro worker robó el lease por expiración de tiempo (zombie fenced out)
        result.fenced++;
      }
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const nuevoRetryCount = Number(evento.retry_count ?? 0) + 1;
      const maxRetries = Number(evento.max_retries ?? 5);

      if (nuevoRetryCount >= maxRetries) {
        // Transición a DLQ tras superar reintentos máximos
        const dlqRes = await pool.query(
          `UPDATE outbox_events
           SET status = 'DLQ',
               retry_count = $1,
               lease_worker_id = NULL,
               lease_expires_at = NULL,
               last_error = $2
           WHERE id = $3 AND fencing_token = $4`,
          [nuevoRetryCount, errorMsg, evento.id, evento.fencing_token]
        );

        if (dlqRes.rowCount && dlqRes.rowCount > 0) {
          result.dlq++;
        } else {
          result.fenced++;
        }
      } else {
        // Retroceso exponencial: Math.min(300, Math.pow(2, retry_count) * 2) segundos
        const backoffSegundos = Math.min(300, Math.pow(2, nuevoRetryCount) * 2);

        const retryRes = await pool.query(
          `UPDATE outbox_events
           SET status = 'PENDIENTE',
               retry_count = $1,
               next_retry_at = CURRENT_TIMESTAMP + ($2 || ' seconds')::interval,
               lease_worker_id = NULL,
               lease_expires_at = NULL,
               last_error = $3
           WHERE id = $4 AND fencing_token = $5`,
          [nuevoRetryCount, `${backoffSegundos}`, errorMsg, evento.id, evento.fencing_token]
        );

        if (retryRes.rowCount && retryRes.rowCount > 0) {
          result.fallidos++;
        } else {
          result.fenced++;
        }
      }
    }
  }

  return result;
}

/**
 * Runner autónomo en segundo plano para el procesador transaccional de outbox.
 */
export class OutboxWorker {
  private active = false;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  public readonly workerId: string;
  private readonly pool: pg.Pool;
  private readonly publisher: RedisPublisherLike;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly logger: boolean;

  constructor(options: OutboxWorkerOptions) {
    this.pool = options.pool;
    this.publisher = options.publisher;
    this.workerId =
      options.workerId ??
      `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 50;
    this.logger = options.logger ?? false;
  }

  /**
   * Ejecuta una ronda inmediata de procesamiento.
   */
  async tick(): Promise<OutboxBatchResult> {
    return procesarLoteOutbox(
      this.pool,
      this.publisher,
      this.workerId,
      this.batchSize
    );
  }

  /**
   * Inicia el bucle continuo de sondeo en segundo plano.
   */
  start(): void {
    if (this.active) return;
    this.active = true;

    // Primer sondeo inmediato
    setImmediate(() => {
      void this.poll();
    });
  }

  private async poll(): Promise<void> {
    if (!this.active) return;
    if (this.inFlight) {
      this.scheduleNext();
      return;
    }

    this.inFlight = true;
    try {
      const res = await this.tick();
      if (this.logger && res.totalLeidos > 0) {
        console.log(
          `[OutboxWorker ${this.workerId}] Procesados: ${res.procesados}, Fallidos: ${res.fallidos}, DLQ: ${res.dlq}, Fenced: ${res.fenced}`
        );
      }
    } catch (err) {
      if (this.logger) {
        console.error(`[OutboxWorker ${this.workerId}] Error al procesar lote:`, err);
      }
    } finally {
      this.inFlight = false;
      if (this.active) {
        this.scheduleNext();
      }
    }
  }

  private scheduleNext(): void {
    if (!this.active) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.active) {
        void this.poll();
      }
    }, this.pollIntervalMs);
  }

  /**
   * Detiene el runner ordenadamente.
   */
  /**
   * Detiene el bucle y espera el ciclo en curso como máximo `timeoutMs`.
   * Devuelve `true` si el ciclo terminó a tiempo y `false` si se abandonó.
   * Abandonarlo es seguro: lo que no se confirmó en PostgreSQL se reintenta
   * en el siguiente arranque (no hay estado transaccional en memoria).
   */
  async stop(timeoutMs = 5000): Promise<boolean> {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const limite = Date.now() + Math.max(0, timeoutMs);
    while (this.inFlight && Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (this.inFlight && this.logger) {
      console.warn(`[%s] stop(): el ciclo en curso no terminó en ${timeoutMs} ms; se abandona.`, 'OutboxWorker');
    }
    return !this.inFlight;
  }

  get isRunning(): boolean {
    return this.active;
  }
}
