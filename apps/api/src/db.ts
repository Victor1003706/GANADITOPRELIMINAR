import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

export interface DatabaseConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

/**
 * Obtiene la configuración de conexión leyendo variables de entorno.
 */
export function getDatabaseConfig(): DatabaseConfig {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    return {
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    };
  }

  // En producción no hay credenciales por defecto: con valores conocidos se conectaría a
  // una base mal configurada en vez de fallar en el arranque.
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_PASSWORD) {
    throw new Error('En producción se requiere DATABASE_URL o DATABASE_PASSWORD.');
  }
  return {
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 5432),
    database: process.env.DATABASE_NAME ?? 'ganadito_dev',
    user: process.env.DATABASE_USER ?? 'postgres',
    password: process.env.DATABASE_PASSWORD ?? 'postgres_local_password',
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  };
}

/**
 * Singleton de conexión Pool a PostgreSQL.
 */
export function getPool(configOverride?: DatabaseConfig): pg.Pool {
  if (!poolInstance) {
    const config = configOverride ?? getDatabaseConfig();
    poolInstance = new Pool(config);

    poolInstance.on('error', (err: Error) => {
      // Manejo preventivo de desconexiones o errores de red en el pool
      console.error('Error imprevisto en el cliente PostgreSQL del pool:', err);
    });
  }

  return poolInstance;
}

/**
 * Cierra ordenadamente el pool de conexiones (útil en tests o apagado graceful).
 */
export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

const MIGRATIONS_LOCK_KEY = 461_700_001; // clave fija de pg_advisory_lock para migraciones

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

function resolveMigrationsDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateDirs = [
    path.resolve(currentDir, '../../../infrastructure/database/migrations'),
    path.resolve(process.cwd(), 'infrastructure/database/migrations'),
    path.resolve(process.cwd(), '../../infrastructure/database/migrations')
  ];
  const dir = candidateDirs.find((candidate) => fs.existsSync(candidate));
  if (!dir) {
    throw new Error('No se encontró el directorio de migraciones en las rutas esperadas.');
  }
  return dir;
}

/**
 * Aplica las migraciones pendientes en orden, cada una en su propia transacción,
 * registrándolas en `schema_migrations` (nombre + SHA-256).
 *
 * - Una migración ya aplicada no se vuelve a ejecutar.
 * - Si el contenido de una migración aplicada cambió, falla: las migraciones aplicadas
 *   no se modifican (crear una nueva).
 * - Un advisory lock serializa procesos concurrentes (varias réplicas o suites de test).
 * - Bases existentes sin tabla de control: las migraciones actuales usan IF NOT EXISTS,
 *   así que la primera ejecución las reaplica sin efecto y las registra.
 */
export async function runMigrations(migrationsDir?: string): Promise<MigrationResult> {
  const dir = migrationsDir ?? resolveMigrationsDir();
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();
  const result: MigrationResult = { applied: [], skipped: [] };

  const client = await getPool().connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATIONS_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

    const appliedRes = await client.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migrations'
    );
    const applied = new Map(appliedRes.rows.map((r) => [r.filename, r.checksum]));

    for (const file of files) {
      const ddl = fs.readFileSync(path.join(dir, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(ddl).digest('hex');
      const previous = applied.get(file);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `La migración ${file} ya aplicada fue modificada (checksum distinto). Cree una migración nueva.`
          );
        }
        result.skipped.push(file);
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(ddl);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
          file,
          checksum
        ]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Fallo al aplicar ${file}: ${(error as Error).message}`);
      }
    }

    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATIONS_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/**
 * Compatibilidad: con `sqlPathOverride` ejecuta un único archivo SQL (uso en tests);
 * sin argumentos aplica las migraciones pendientes con control de versión.
 */
export async function runInitialMigration(sqlPathOverride?: string): Promise<void> {
  if (!sqlPathOverride) {
    await runMigrations();
    return;
  }

  const client = await getPool().connect();
  try {
    const ddl = fs.readFileSync(sqlPathOverride, 'utf8');
    await client.query('BEGIN');
    await client.query(ddl);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
