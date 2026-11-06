import { assertIsolatedRealEnvironment } from './environment.mjs';

// This must run before any backend import, database access or migration. Deliberately
// do not load a developer's .env file; CI injects every value for ephemeral services.
try { assertIsolatedRealEnvironment(process.env); }
catch (error) {
  console.error(error.message);
  process.exit(1);
}

try {
  const { startServer } = await import('../../../apps/api/src/server.ts');
  const handle = await startServer({
    host: '127.0.0.1', port: 4181, logger: false
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      const timeout = setTimeout(() => process.exit(1), 10_000);
      timeout.unref();
      handle.shutdown(signal).then(() => process.exit(0), () => process.exit(1));
    });
  }
} catch {
  // Connection/configuration exceptions may contain credentials. Never print them.
  console.error('[real E2E] La API aislada no pudo iniciar. Revisa sus servicios y configuración de CI.');
  process.exit(1);
}
