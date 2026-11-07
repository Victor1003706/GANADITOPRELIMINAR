import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import { SubastasCloserService } from './subastas/subastas-closer.service.js';

describe('Ciclo de Despacho, Confirmación de Entrega y Liquidación Neta al Vendedor', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);
  const closerService = new SubastasCloserService(pool);

  let vendedorToken: string;
  let vendedorUserId: string;
  let vendedorOrgId: string;

  let compradorToken: string;
  let compradorUserId: string;

  let terceroToken: string;

  let ordenPAGADAId: string;
  const cciPrueba = '00219400000000000001';
  const montoAdjudicado = 5500.0;

  before(async () => {
    await runInitialMigration();
    await app.ready();

    // 1. Crear Vendedor con cuenta CCI configurada en su organización
    const vRes = await authService.register({
      email: `vendedor_entrega_${Date.now()}@test.com`,
      password: 'PasswordEntrega2026!',
      nombre: 'Ganadería Santa Mónica SAC',
      organizacion_nombre: `Santa Mónica SAC ${Date.now()}`,
      rol_inicial: 'VENDEDOR'
    });
    vendedorUserId = vRes.user.id;
    vendedorOrgId = vRes.activeContext.organizacion_id;

    // Asignar CCI a la organización vendedora
    await pool.query(
      `UPDATE organizaciones SET cuenta_bancaria_cci = $1 WHERE id = $2`,
      [cciPrueba, vendedorOrgId]
    );

    const vLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: vRes.user.email, password: 'PasswordEntrega2026!' }
    });
    vendedorToken = vLogin.json().access_token;

    // 2. Crear Comprador
    const cRes = await authService.register({
      email: `comprador_entrega_${Date.now()}@test.com`,
      password: 'PasswordEntrega2026!',
      nombre: 'Inversiones Pecuarias del Valle SAC',
      organizacion_nombre: `Pecuarias del Valle ${Date.now()}`,
      rol_inicial: 'COMPRADOR'
    });
    compradorUserId = cRes.user.id;

    const cLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: cRes.user.email, password: 'PasswordEntrega2026!' }
    });
    compradorToken = cLogin.json().access_token;

    // 3. Crear Tercero (no autorizado para esta orden)
    const tRes = await authService.register({
      email: `tercero_entrega_${Date.now()}@test.com`,
      password: 'PasswordEntrega2026!',
      nombre: 'Usuario Ajeno SAC',
      organizacion_nombre: `Ajeno SAC ${Date.now()}`,
      rol_inicial: 'COMPRADOR'
    });

    const tLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: tRes.user.email, password: 'PasswordEntrega2026!' }
    });
    terceroToken = tLogin.json().access_token;

    // 4. Crear lote de subasta, emitir puja y liquidar para obtener orden en estado PAGADO
    const loteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        titulo: 'Lote Toros Brahman Entrega Test',
        precio_base: 5000,
        incremento_minimo: 100,
        fecha_cierre: new Date(Date.now() + 600000).toISOString()
      }
    });
    const loteId = loteRes.json().id;

    // Puja ganadora de 5500
    const pujaRes = await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteId}/pujas`,
      headers: {
        authorization: `Bearer ${compradorToken}`,
        'idempotency-key': `bid-entrega-${Date.now()}`
      },
      payload: { monto: montoAdjudicado }
    });
    assert.strictEqual(pujaRes.statusCode, 201);

    // Expirar fecha de cierre y generar orden_compra
    await pool.query(
      `UPDATE lotes_subasta SET fecha_cierre = NOW() - INTERVAL '5 seconds