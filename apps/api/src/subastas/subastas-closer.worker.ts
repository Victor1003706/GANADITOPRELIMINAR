import type pg from 'pg';
import { SubastasCloserService, type ResultadoCierreBatch } from './subastas-closer.service.js';

export interface SubastasCloserWorkerOptions {
  pool: pg.Pool;
  intervalMs?: number;
  batchSize?: number;
  logger?: boolean;
}

/**
 * Worker en segundo plano encargado de cerrar automáticamente las subastas expiradas cada 5 segundos.
 * Controla el ciclo con protección inFlight contra solapamientos y apagado ordenado.
 */
export class SubastasCloserWorker {
  private active = false;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private readonly closerService: SubastasCloserService;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly logger: boolean;

  constructor(options: SubastasCloserWorkerOptions) {
    this.closerService = new SubastasCloserService(options.pool);
    this.intervalMs = options.intervalMs ?? 5000;
    this.batchSize = options.batchSize ?? 20;
    this.logger = options.logger ?? false;
  }

  /**
   * Ejecuta un ciclo inmediato de liquidación de lotes expirados.
   */
  async tick(): Promise<ResultadoCierreBatch> {
    return this.closerService.cerrarLotesExpirados(this.batchSize);
  }

  /**
   * Inicia el ciclo periódico de fondo (cada 5s por defecto).
   */
  start(): void {
    if (this.active) return;
    this.active = true;
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
      if (this.logger && (res.adjudicados > 0 || res.desiertos > 0)) {
        console.log(
          `[SubastasCloserWorker] Evaluados: ${res.totalEvaluados}, Adjudicados: ${res.adjudicados}, Desiertos: ${res.desiertos}, Órdenes: ${res.ordenesGeneradas}`
        );
      }
    } catch (err) {
      if (this.logger) {
        console.error('[SubastasCloserWorker] Error durante ciclo de liquidación:', err);
      }
    } finally {
      this.inFlight = false;
      if (this.active) {
        this.scheduleNext();
      }
    }
  }

  // Antes llamaba a start(), que salía de inmediato por `active === true`: el worker
  // sólo ejecutaba un ciclo y los lotes vencidos después nunca se cerraban.
  private scheduleNext(): void {
    if (!this.active) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, this.intervalMs);
  }

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
      console.warn(`[%s] stop(): el ciclo en curso no terminó en ${timeoutMs} ms; se abandona.`, 'SubastasCloserWorker');
    }
    return !this.inFlight;
  }

  get isRunning(): boolean {
    return this.active;
  }
}
