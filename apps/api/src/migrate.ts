import { closePool, runMigrations } from './db.js';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_MIGRATION_URL) {
    throw new Error('Define DATABASE_MIGRATION_URL en el job seguro de migraciones.');
  }
  try {
    const result = await runMigrations();
    console.info(JSON.stringify({
      event: 'database_migrations_complete',
      applied: result.applied,
      skipped: result.skipped
    }));
  } finally {
    await closePool();
  }
}

main().catch((error: unknown) => {
  console.error('No se pudieron aplicar las migraciones:', error instanceof Error ? error.message : 'error desconocido');
  process.exitCode = 1;
});
