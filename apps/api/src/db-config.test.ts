import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDatabaseConfig } from './db.js';

test('configuración PostgreSQL de producción exige URL externa con TLS', () => {
  const names = ['NODE_ENV', 'DATABASE_URL', 'DATABASE_PASSWORD', 'DATABASE_POOL_MAX'] as const;
  const before = new Map(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_PASSWORD;
    delete process.env.DATABASE_URL;
    assert.throws(() => getDatabaseConfig(), /se requiere DATABASE_URL/);

    process.env.DATABASE_URL = 'postgresql://runtime:secret@db.example.test/ganadito';
    assert.throws(() => getDatabaseConfig(), /debe exigir TLS/);

    process.env.DATABASE_URL = 'postgresql://runtime:secret@db.example.test/ganadito?sslmode=require';
    process.env.DATABASE_POOL_MAX = '8';
    const config = getDatabaseConfig();
    assert.equal(config.connectionString, process.env.DATABASE_URL);
    assert.equal(config.max, 8);

    process.env.DATABASE_POOL_MAX = '0';
    assert.throws(() => getDatabaseConfig(), /DATABASE_POOL_MAX/);
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
