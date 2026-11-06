import type pg from 'pg';
import type { HealthCheckResponse } from '@ganadito/contracts';

const VERSION = '0.1.0';

/**
 * Estado estático del proceso (sin dependencias). Se mantiene por compatibilidad.
 */
export function getHealthStatus(): HealthCheckResponse {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: VERSION,
    environment: process.env.NODE_ENV ?? 'development'
  };
}

export interface HealthReport extends Omit<HealthCheckResponse, 'status'> {
  status: 'ok' | 'degraded';
  db: 'ok' | 'error';
}

/**
 * Health real: ejecuta `SELECT 1` contra PostgreSQL con un tiempo máximo.
 */
export async function checkHealth(pool: pg.Pool, timeoutMs = 2000): Promise<HealthReport> {
  let db: 'ok' | 'error' = 'ok';
  let timer: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('health timeout')), timeoutMs);
      })
    ]);
  } catch {
    db = 'error';
  } finally {
    if (timer) clearTimeout(timer);
  }

  return {
    status: db === 'ok' ? 'ok' : 'degraded',
    db,
    timestamp: new Date().toISOString(),
    version: VERSION,
    environment: process.env.NODE_ENV ?? 'development'
  };
}
