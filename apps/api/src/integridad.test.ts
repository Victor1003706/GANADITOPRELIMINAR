import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { calcularLiquidacionSubasta, calcularLiquidacionVendedor } from '@ganadito/contracts';
import { getPool, closePool, runInitialMigration, getDatabaseConfig } from './db.js';
import { getRedisConfig } from './redis.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import { MONTO_MAXIMO_PEN } from './subastas/subastas.service.js';
import { resolverPasswordSeed } from './seed/seed.js';

describe('Integridad: céntimos, topes, ids, autocalce y guardias', { concurrency: 1 }, () => {
  test('comisión en céntimos enteros con half-up (antes 14.5 daba 0.14)', () => {
    for (const [monto, comision] of [[14.5, 0.15], [102.5, 1.03], [401.5, 4.02], [5500, 55], [0.49, 0]] as const) {
      const s = calcularLiquidacionSubasta(monto);
      assert.strictEqual(s.comisionPlataforma, comision, String(monto));
      assert.strictEqual(Math.round(s.totalAPagar * 100), Math.round(monto * 100) + Math.round(comision * 100));
      const v = calcularLiquidacionVendedor(monto);
      assert.strictEqual(v.comisionRetenida, comision);
      assert.strictEqual(Math.round(v.montoNetoPagar * 100), Math.round(monto * 100) - Math.round(comision * 100));
    }
  });

  test('guardias de producción: sin credenciales de BD/Redis no arranca', () => {
    const prev = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL; delete process.env.DATABASE_PASSWORD;
      delete process.env.REDIS_URL; delete process.env.REDIS_PASSWORD;
      assert.throws(() => getDatabaseConfig(), /DATABASE_URL o DATABASE_PASSWORD/);
      assert.throws(() => getRedisConfig(), /REDIS_URL o REDIS_PASSWORD/);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
      Object.assign(process.env, prev);
    }
  });

  test('seed: fuera de local exige SEED_PASSWORD propia', () => {
    assert.strictEqual(resolverPasswordSeed({}), 'ganadito2026');
    assert.throws(() => resolverPasswordSeed({ SEED_ALLOWED_HOSTS: 'staging.db' }), /SEED_PASSWORD/);
    assert.throws(() => resolverPasswordSeed({ SEED_ALLOWED_HOSTS: 'staging.db', SEED_PASSWORD: 'corta' }), /SEED_PASSWORD/);
    assert.strictEqual(resolverPasswordSeed({ SEED_ALLOWED_HOSTS: 'staging.db', SEED_PASSWORD: 'una-clave-larga-1' }), 'una-clave-larga-1');
  });
});

describe('Integridad HTTP', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);
  let vendedor = '';
  let comprador = '';
  const lotes: string[] = [];

  async function token(rol: 'VENDEDOR' | 'COMPRADOR') {
    const email = `integ_${rol}_${crypto.randomUUID().slice(0, 8)}@test.com`;
    await authService.register({ email, password: 'PasswordInteg2026!', nombre: rol, organizacion_nombre: `Org ${rol} ${email}`, rol_inicial: rol });
    return (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'PasswordInteg2026!' } })).json().access_token as string;
  }

  before(async () => {
    await runInitialMigration();
    await app.ready();
    vendedor = await token('VENDEDOR');
    comprador = await token('COMPRADOR');
  });
  after(async () => {
    if (lotes.length) await pool.query('DELETE FROM lotes_subasta WHERE id = ANY($1::uuid[])', [lotes]);
    await app.close();
    await closePool();
  });

  test('un :id que no es UUID es 404 en todas las rutas (antes 22P02 -> 500)', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/subastas/no-es-uuid/snapshot'],
      ['POST', '/api/v1/subastas/no-es-uuid/pujas'],
      ['GET', '/api/v1/ordenes/no-es-uuid'],
      ['GET', '/api/v1/trazabilidad/bovinos/no-es-uuid/pasaporte'],
      ['GET', '/api/v1/mayorista/pools/no-es-uuid']
    ] as const) {
      const r = await app.inject({ method, url, headers: 