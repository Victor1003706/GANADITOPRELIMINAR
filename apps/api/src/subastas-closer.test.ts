import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { crearUsuarioConRol } from './test-helpers.js';
import { AuthService } from './auth/auth.service.js';
import { SubastasCloserService } from './subastas/subastas-closer.service.js';
import { SubastasCloserWorker } from './subastas/subastas-closer.worker.js';

describe('Liquidación de Subastas y Órdenes de Compra Comercial (SubastasCloserService)', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);
  const closerService = new SubastasCloserService(pool);

  let vendedorToken: string;
  let vendedorOrgId: string;
  let vendedorUserId: string;

  let comprador1Token: string;
  let comprador1UserId: string;
  let comprador1OrgId: string;

  let comprador2Token: string;
  let comprador2UserId: string;

  before(async () => {
    await runInitialMigration();
    await app.ready();

    // 1. Crear Vendedor
    const vRes = await authService.register({
      email: `vendedor_closer_${Date.now()}@test.com`,
      password: 'PasswordCloser2026!',
      nombre: 'Ganadero Vendedor Closer',
      organizacion_nombre: `Ganadería San Rafael SAC ${Date.now()}`,
      rol_inicial: 'VENDEDOR'
    });
    vendedorUserId = vRes.user.id;
    vendedorOrgId = vRes.activeContext.organizacion_id;

    const vLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: vRes.user.email, password: 'PasswordCloser2026!' }
    });
    vendedorToken = vLogin.json().access_token;

    // 2. Crear Comprador 1
    const c1Res = await authService.register({
      email: `comprador1_closer_${Date.now()}@test.com`,
      password: 'PasswordCloser2026!',
      nombre: 'Carnicería La Fama EIRL',
      organizacion_nombre: `Carnes La Fama ${Date.now()}`,
      rol_inicial: 'COMPRADOR'
    });
    comprador1UserId = c1Res.user.id;
    comprador1OrgId = c1Res.activeContext.organizacion_id;

    const c1Login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: c1Res.user.email, password: 'PasswordCloser2026!' }
    });
    comprador1Token = c1Login.json().access_token;

    // 3. Crear Comprador 2
    const c2Res = await authService.register({
      email: `comprador2_closer_${Date.now()}@test.com`,
      password: 'PasswordCloser2026!',
      nombre: 'Frigorífico Central SAC',
      organizacion_nombre: `Frigorífico Central ${Date.now()}`,
      rol_inicial: 'COMPRADOR'
    });
    comprador2UserId = c2Res.user.id;

    const c2Login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: c2Res.user.email, password: 'PasswordCloser2026!' }
    });
    comprador2Token = c2Login.json().access_token;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  test('1. Lote con pujas expirado pasa a ADJUDICADO y genera ordenes_compra con comisión del 1%', async () => {
    // 1.1 Crear lote de subasta
    const fechaCierreFutura = new Date(Date.now() + 600000).toISOString();
    const loteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        titulo: 'Lote Toros Simmental Expirado Test',
        precio_base: 3000,
        incremento_minimo: 100,
        fecha_cierre: fechaCierreFutura
      }
    });
    assert.strictEqual(loteRes.statusCode, 201);
    const loteId = loteRes.json().id;

    // 1.2 Emitir puja ganadora de 3500 por Comprador 1
    const pujaRes = await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteId}/pujas`,
      headers: {
        authorization: `Bearer ${comprador1Token}`,
        'idempotency-key': `bid-closer-1-${Date.now()}`
      },
      payload: { monto: 3500 }
  