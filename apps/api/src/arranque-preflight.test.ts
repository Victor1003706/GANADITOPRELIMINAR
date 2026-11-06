import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { Redis } from 'ioredis';

test('startServer rechaza configuración inválida antes de crear dependencias', async (t) => {
  const infrastructureCalls: string[] = [];
  const Pool = pg.Pool;
  const block = (operation: string): never => {
    infrastructureCalls.push(operation);
    throw new Error(`Infraestructura bloqueada en preflight: ${operation}`);
  };

  // db.ts captura Pool al importar: instrumentarlo antes de importar el arranque real.
  // El constructor se bloquea incluso antes de leer opciones o abrir una conexión.
  pg.Pool = new Proxy(Pool, { construct: () => block('pg.Pool') });
  t.mock.method(Pool.prototype, 'query', () => block('pg.Pool.query'));
  t.mock.method(Pool.prototype, 'connect', () => block('pg.Pool.connect/migraciones'));
  t.mock.method(Redis.prototype, 'connect', () => block('Redis.connect'));

  const baseline = {
    NODE_ENV: 'production',
    JWT_SECRET: 'jwt-de-prueba-aislada-con-32-caracteres',
    PAYMENTS_ENABLED: 'false',
    WEBHOOK_SECRET: undefined,
    PAYMENTS_CHECKOUT_BASE_URL: undefined
  };
  const previousEnv = new Map(Object.keys(baseline).map((key) => [key, process.env[key]]));
  type StartupEnv = Partial<Record<keyof typeof baseline, string | undefined>>;
  const cases: { name: string; env: StartupEnv; error: RegExp }[] = [
    {
      name: 'JWT ausente en producción',
      env: { JWT_SECRET: undefined },
      error: /JWT_SECRET es obligatorio en producción/
    },
    {
      name: 'JWT corto en producción',
      env: { JWT_SECRET: 'corto' },
      error: /JWT_SECRET es obligatorio en producción/
    },
    {
      name: 'pagos habilitados sin secreto de webhook',
      env: { PAYMENTS_ENABLED: 'true' },
      error: /PAYMENTS_ENABLED=true requiere WEBHOOK_SECRET/
    },
    {
      name: 'pagos habilitados con secreto de webhook corto',
      env: { PAYMENTS_ENABLED: 'true', WEBHOOK_SECRET: 'corto' },
      error: /PAYMENTS_ENABLED=true requiere WEBHOOK_SECRET/
    },
    {
      name: 'pagos habilitados sin URL de checkout',
      env: {
        PAYMENTS_ENABLED: 'true',
        WEBHOOK_SECRET: 'webhook-de-prueba-aislada-con-32-caracteres'
      },
      error: /PAYMENTS_ENABLED=true requiere PAYMENTS_CHECKOUT_BASE_URL/
    },
    {
      name: 'pagos habilitados con URL de checkout inválida',
      env: {
        PAYMENTS_ENABLED: 'true',
        WEBHOOK_SECRET: 'webhook-de-prueba-aislada-con-32-caracteres',
        PAYMENTS_CHECKOUT_BASE_URL: 'no-es-una-url'
      },
      error: /PAYMENTS_CHECKOUT_BASE_URL no es una URL válida/
    }
  ];

  try {
    const { startServer } = await import('./server.js');
    for (const { name, env, error } of cases) {
      await t.test(name, async () => {
        infrastructureCalls.length = 0;
        for (const [key, value] of Object.entries({ ...baseline, ...env })) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }

        await assert.rejects(
          () => startServer({ runMigrations: true, startWorkers: true, logger: false }),
          error
        );
        assert.deepStrictEqual(infrastructureCalls, [], 'El preflight no toca PostgreSQL ni Redis');
      });
    }
  } finally {
    pg.Pool = Pool;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
