import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { LimitadorTasa, REGLAS } from './rate-limit.js';

describe('Límite de tasa', { concurrency: 1 }, () => {
  test('ventana fija: deja pasar el máximo, rechaza el siguiente y se reinicia al vencer', () => {
    let t = 0;
    const l = new LimitadorTasa(() => t);
    const regla = { nombre: 'x', maximo: 3, ventanaMs: 1000, clave: () => 'k' };
    assert.deepEqual([1, 2, 3, 4].map(() => l.consumir(regla, 'k').permitido), [true, true, true, false]);
    assert.strictEqual(l.consumir(regla, 'otra').permitido, true, 'cada clave cuenta aparte');
    t = 1000;
    assert.strictEqual(l.consumir(regla, 'k').permitido, true);
    l.cerrar();
  });

  const pool = getPool();
  const app = buildApp({ pool, limitarTasa: true });
  before(async () => { await runInitialMigration(); await app.ready(); });
  after(async () => { await app.close(); await closePool(); });

  test('login: tras 10 intentos con el mismo email responde 429 con Retry-After', async () => {
    const email = `rate_${crypto.randomUUID().slice(0, 8)}@test.com`;
    const estados: number[] = [];
    for (let i = 0; i < REGLAS.loginEmail.maximo + 1; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'incorrecta' } });
      estados.push(r.statusCode);
      if (r.statusCode === 429) {
        assert.ok(Number(r.headers['retry-after']) > 0);
        assert.strictEqual(r.json().code, 'DEMASIADAS_SOLICITUDES');
      }
    }
    assert.deepEqual(estados.slice(0, REGLAS.loginEmail.maximo), Array(REGLAS.loginEmail.maximo).fill(401));
    assert.strictEqual(estados.at(-1), 429);
  });

  test('sin el interruptor (runner de pruebas) no se limita', async () => {
    const libre = buildApp({ pool });
    await libre.ready();
    const email = `rate_libre_${crypto.randomUUID().slice(0, 8)}@test.com`;
    for (let i = 0; i < REGLAS.loginEmail.maximo + 2; i++) {
      const r = await libre.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'x' } });
      assert.strictEqual(r.statusCode, 401);
    }
    await libre.close();
  });
});
