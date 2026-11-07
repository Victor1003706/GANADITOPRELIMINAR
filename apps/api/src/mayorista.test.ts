import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import { crearUsuarioConRol } from './test-helpers.js';
import type {
  PoolConProgreso,
  UnirsePoolResponse,
  CerrarPoolsExpiradosResponse
} from '@ganadito/contracts';

describe('Motor de Compras Mayoristas, Demand Pooling B2B y Ofertas Flash', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);

  let vendedorToken: string;
  let vendedorUserId: string;
  let vendedorOrgId: string;

  let comprador1Token: string;
  let comprador1UserId: string;
  let comprador1OrgId: string;

  let comprador2Token: string;
  let comprador2UserId: string;
  let comprador2OrgId: string;

  let poolFlashId: string;

  before(async () => {
    await runInitialMigration();
    await app.ready();

    // 1. Registrar vendedor / proveedor mayorista
    const vRes = await authService.register({
      email: `vendedor_mayorista_${Date.now()}@test.com`,
      password: 'PasswordMayorista2026!',
      nombre: 'Agroinsumos del Centro SAC',
      organizacion_nombre: `Agroinsumos SAC ${Date.now()}`,
      rol_inicial: 'VENDEDOR'
    });
    vendedorUserId = vRes.user.id;
    vendedorOrgId = vRes.activeContext.organizacion_id;

    const vLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: vRes.user.email, password: 'PasswordMayorista2026!' }
    });
    vendedorToken = vLogin.json().access_token;

    // 2. Registrar Comprador 1
    const c1Res = await authService.register({
      email: `comprador1_mayorista_${Date.now()}@test.com`,
      password: 'PasswordMayorista2026!',
      nombre: 'Engorde San Martin SAC',
      organizacion_nombre: `San Martin Engorde ${Date.now()}`,
      rol_inicial: 'COMPRADOR'
    });
    comprador1UserId = c1Res.user.id;
    comprador1OrgId = c1Res.activeContext.organizacion_id;

    const c1Login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: c1Res.user.email, password: 'PasswordMayorista2026!' }
    });
    comprador1Token = c1Login.json().access_token;

    // 3. Registrar Comprador 2 (Organización distinta)
    const c2Res = await authService.register({
      email: `comprador2_mayorista_${Date.now()}@test.com`,
      password: 'PasswordMayorista2026!',
      nombre: 'Ganadera del Sur SRL',
      organizacion_nombre: `Ganadera del Sur SRL ${Date.now()}`,
      rol_inicial: 'COMPRADOR'
    });
    comprador2UserId = c2Res.user.id;
    comprador2OrgId = c2Res.activeContext.organizacion_id;

    const c2Login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: c2Res.user.email, password: 'PasswordMayorista2026!' }
    });
    comprador2Token = c2Login.json().access_token;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  test('1. Creación exitosa de campaña mayorista u oferta flash con cuenta regresiva', async () => {
    const fechaLimite = new Date(Date.now() + 86400000).toISOString(); // 24 horas

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/mayorista/pools',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        tipo_producto: 'GRANO_FORRAJE',
        titulo: 'Maíz Amarillo Duro Nacional Grano Selecto',
        descripcion: 'Consolidación de carga a granel para engorde intensivo en Lima y Cañete',
        precio_unitario_mayorista: 0.95,
        meta_volumen: 10000,
        unidad_medida: 'KG',
        fecha_limite: fechaLimite,
        es_oferta_flash: true
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const poolData = res.json();
    poolFlashId = poolData.id;

    assert.ok(poolFlashId);
    assert.strictEqu