import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp, resolveJwtSecret } from './app.js';
import { resolvePagosConfig } from './pagos/pagos.service.js';
import { getPool, closePool, runMigrations } from './db.js';
import { getRedisPublisher, getRedisSubscriber, closeRedis } from './redis.js';
import { SubastaWsHub } from './subastas/subastas.ws.js';
import { OutboxWorker } from './outbox/outbox.worker.js';
import { SubastasCloserWorker } from './subastas/subastas-closer.worker.js';

export interface ServerHandle {
  app: FastifyInstance;
  address: string;
  shutdown: (reason?: string) => Promise<void>;
}

export interface StartServerOptions {
  port?: number;
  host?: string;
  /** Aplica migraciones pendientes antes de escuchar. Por defecto: sí fuera de producción. */
  runMigrations?: boolean;
  /** Arranca el worker de outbox y el de cierre de subastas. Por defecto: sí. */
  startWorkers?: boolean;
  logger?: boolean;
  /** Solo pruebas: sustituye al ejecutor de migraciones. */
  migrationRunner?: typeof runMigrations;
}

/**
 * Valida la configuración obligatoria SIN tocar la base de datos. Debe ejecutarse antes
 * de migrar: con un secreto inválido en producción no se debe alterar el esquema y luego
 * fallar a medio arranque.
 */
export function validarConfiguracionArranque(): void {
  resolveJwtSecret();
  resolvePagosConfig();
}

function envFlag(name: string): boolean | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  return v === 'true' || v === '1';
}

/**
 * Arranca la API en este orden: 1) valida configuración (sin tocar la BD), 2) comprueba
 * PostgreSQL, 3) aplica migraciones si corresponde, 4) levanta workers y escucha.
 */
export async function startServer(options: StartServerOptions = {}): Promise<ServerHandle> {
  const port = options.port ?? Number(process.env.API_PORT ?? 4000);
  const host = options.host ?? process.env.API_HOST ?? '0.0.0.0';
  const shouldMigrate =
    options.runMigrations ?? envFlag('RUN_MIGRATIONS_ON_START') ?? process.env.NODE_ENV !== 'production';
  const shouldStartWorkers = options.startWorkers ?? envFlag('START_WORKERS') ?? true;

  validarConfiguracionArranque();

  const pool = getPool();

  // Fallar en el arranque si PostgreSQL no responde (no hay modo degradado sin BD).
  await pool.query('SELECT 1');

  if (shouldMigrate) {
    const res = await (options.migrationRunner ?? runMigrations)();
    if (res.applied.length > 0) {
      console.log(`[server] Migraciones aplicadas: ${res.applied.join(', ')}`);
    }
  }

  const wsHub = new SubastaWsHub(getRedisSubscriber());
  const app = buildApp({ pool, wsHub, logger: options.logger ?? true });

  const outboxWorker = shouldStartWorkers
    ? new OutboxWorker({ pool, publisher: getRedisPublisher(), logger: true })
    : null;
  const closerWorker = shouldStartWorkers
    ? new SubastasCloserWorker({ pool, logger: true })
    : null;

  const address = await app.listen({ port, host });
  outboxWorker?.start();
  closerWorker?.start();

  let closing: Promise<void> | null = null;
  const shutdown = (reason = 'shutdown'): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      app.log.info(`[server] Apagado ordenado (${reason})`);
      // 1) dejar de tomar trabajo nuevo, 2) cerrar HTTP/WS, 3) liberar recursos.
      // Cada worker espera su ciclo en curso como máximo 5 s; el tope global sigue siendo 10 s.
      await Promise.allSettled([outboxWorker?.stop(5000), closerWorker?.stop(5000)]);
      await app.close();
      await Promise.allSettled([closeRedis(), closePool()]);
    })();
    return closing;
  };

  return { app, address, shutdown };
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const SHUTDOWN_TIMEOUT_MS = 10_000;

  startServer()
    .then((handle) =