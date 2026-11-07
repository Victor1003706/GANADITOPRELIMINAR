import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type pg from 'pg';
import { getPool, runMigrations } from './db.js';
import { buildApp, resolveJwtSecret } from './app.js';
import { SubastasCloserWorker } from './subastas/subastas-closer.worker.js';

describe('N01: arranque, health real, migraciones versionadas y workers', { concurrency: 1 }, () => {
  const pool = getPool();

  after(async () => {
    // closePool lo hace el test de servidor (shutdown); aquí solo limpiamos registros temporales.
    await pool.query(`DELETE FROM schema_migrations WHERE filename LIKE '9999_tmp_%'`).catch(() => {});
  });

  test('1. runMigrations es idempotente: la segunda ejecución no aplica nada', async () => {
    await runMigrations();
    const segunda = await runMigrations();
    assert.deepStrictEqual(segunda.applied, []);
    assert.ok(segunda.skipped.length >= 9, 'Las migraciones existentes quedan registradas');
  });

  test('2. Modificar una migración ya aplicada hace fallar runMigrations', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ganadito-mig-'));
    const file = `9999_tmp_${Date.now()}.sql`;
    try {
      fs.writeFileSync(path.join(dir, file), 'SELECT 1;');
      const r1 = await runMigrations(dir);
      assert.deepStrictEqual(r1.applied, [file]);

      fs.writeFileSync(path.join(dir, file), 'SELECT 2;');
      await assert.rejects(() => runMigrations(dir), /fue modificada/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('3. /health consulta PostgreSQL: 200 con BD y 503 si la BD falla', async () => {
    const app = buildApp({ pool });
    await app.ready();
    const ok = await app.inject({ method: 'GET', url: '/health' });
    assert.strictEqual(ok.statusCode, 200);
    assert.strictEqual(ok.json().db, 'ok');
    await app.close();

    const poolRoto = { query: async () => { throw new Error('ECONNREFUSED'); } } as unknown as pg.Pool;
    const appRota = buildApp({ pool: poolRoto });
    await appRota.ready();
    const ko = await appRota.inject({ method: 'GET', url: '/health' });
    assert.strictEqual(ko.statusCode, 503);
    assert.deepStrictEqual([ko.json().status, ko.json().db], ['degraded', 'error']);
    await appRota.close();
  });

  test('4. JWT_SECRET: obligatorio en producción y con mínimo de 32 caracteres', () => {
    const prev = { env: process.env.NODE_ENV, secret: process.env.JWT_SECRET };
    try {
      delete process.env.JWT_SECRET;
      process.env.NODE_ENV = 'production';
      assert.throws(() => resolveJwtSecret(), /obligatorio en producción/);
      assert.throws(() => resolveJwtSecret('corto'), /obligatorio en producción/);
      assert.strictEqual(resolveJwtSecret('x'.repeat(32)), 'x'.repeat(32));

      process.env.NODE_ENV = 'test';
      assert.throws(() => resolveJwtSecret('corto'), /al menos 32/);
      assert.ok(resolveJwtSecret().length >= 32, 'Fuera de producción usa el secreto de desarrollo');
    } finally {
      if (prev.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev.env;
      if (prev.secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prev.secret;
    }
  });

  test('4b. Con configuración inválida en producción NO se migra (se valida antes de tocar la BD)', async () => {
    const { startServer } = await import('./server.js');
    const prev = { env: process.env.NODE_ENV, secret: process.env.JWT_SECRET };
    let migro = false;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;
      await assert.rejects(
        () =>
          startServer({
            port: 0,
            host: '127.0.0.1',
            runMigrations: true,
            startWorkers: false,
            logger: false,
            migrationRunner: async () => {
              migro = true;
            