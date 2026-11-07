import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';

describe('Motor Transaccional de Subastas en Vivo (PostgreSQL, Concurrencia y Anti-sniping)', () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);

  let vendedorToken: string;
  let vendedorOrgId: string;
  let vendedorUserId: string;

  let comprador1Token: string;
  let comprador1UserId: string;
  let comprador1OrgId: string;

  let comprador2Token: string;
  let comprador2UserId: string;

  let loteActivoId: string;

  before(async () => {
    await runInitialMigration();
    await app.ready();

    // 1. Crear Vendedor
    const vRes = await authService.register({
      email: `vendedor_subasta_${Date.now()}@test.com`,
      password: 'PasswordSubasta2026!',
      nombre: 'Ganadero Vendedor',
      organizacion_nombre: 'Establo Ganadero Los Rosales SAC',
      rol_inicial: 'VENDEDOR'
    });
    vendedorUserId = vRes.user.id;
    vendedorOrgId = vRes.activeContext.organizacion_id;

    const vLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: vRes.user.email, password: 'PasswordSubasta2026!' }
    });
    vendedorToken = vLogin.json().access_token;

    // 2. Crear Comprador 1
    const c1Res = await authService.register({
      email: `comprador1_${Date.now()}@test.com`,
      password: 'PasswordSubasta2026!',
      nombre: 'Comprador Carnes del Sur',
      organizacion_nombre: 'Distribuidora Carnes del Sur EIRL',
      rol_inicial: 'COMPRADOR'
    });
    comprador1UserId = c1Res.user.id;
    comprador1OrgId = c1Res.activeContext.organizacion_id;

    const c1Login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: c1Res.user.email, password: 'PasswordSubasta2026!' }
    });
    comprador1Token = c1Login.json().access_token;

    // 3. Crear Comprador 2
    const c2Res = await authService.register({
      email: `comprador2_${Date.now()}@test.com`,
      password: 'PasswordSubasta2026!',
      nombre: 'Inversiones Pecuarias SAC',
      organizacion_nombre: 'Inversiones Pecuarias SAC',
      rol_inicial: 'COMPRADOR'
    });
    comprador2UserId = c2Res.user.id;

    const c2Login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: c2Res.user.email, password: 'PasswordSubasta2026!' }
    });
    comprador2Token = c2Login.json().access_token;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  test('0. Un lote en BORRADOR no es público: snapshot 404 para anónimos y otras organizaciones', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/v1/subastas', headers: { authorization: `Bearer ${vendedorToken}` },
      payload: { codigo_lote: `BORR-${Date.now()}`, precio_base: 1000, incremento_minimo: 50, estado: 'BORRADOR',
        fecha_cierre: new Date(Date.now() + 3600000).toISOString() }
    });
    assert.strictEqual(r.statusCode, 201, r.body);
    const url = `/api/v1/subastas/${r.json().id}/snapshot`;
    assert.strictEqual((await app.inject({ method: 'GET', url })).statusCode, 404);
    assert.strictEqual((await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${comprador1Token}` } })).statusCode, 404);
    assert.strictEqual((await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${vendedorToken}` } })).statusCode, 200);
  });

  test('1. Creación de lote y consulta de snapshot (POST /api/v1/subastas & GET /api/v1/subastas/:id/snapshot)', async () => {
    const fechaCierre = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // +30 minutos

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authoriz