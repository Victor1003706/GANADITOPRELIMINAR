import crypto from 'node:crypto';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import { calcularCotizacionFlete } from '@ganadito/contracts';

describe('Pasarela Logística Integrada (Ganadito Cargo & Express API)', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);

  let solicitanteToken: string;
  let transportista1Token: string;
  let transportista2Token: string;
  let clienteRegularToken: string;

  let establoOrigenId: string;
  let establoDestinoId: string;

  let unidad1Id: string;
  let unidad2Id: string;

  before(async () => {
    await runInitialMigration();
    await app.ready();

    // Limpiar tablas para evitar interferencias
    await pool.query('DELETE FROM fletes_solicitudes;');
    await pool.query('DELETE FROM transportistas_unidades;');

    // 1. Usuario Solicitante (Vendedor / Ganadero)
    const sRes = await authService.register({
      email: `solicitante_flete_${Date.now()}@test.com`,
      password: 'PasswordLogistica2026!',
      nombre: 'Ganadera del Centro SAC',
      organizacion_nombre: `Ganadera Central ${Date.now()}`,
      rol_inicial: 'VENDEDOR'
    });
    const sLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: sRes.user.email, password: 'PasswordLogistica2026!' }
    });
    solicitanteToken = sLogin.json().access_token;

    // 2. Transportista 1
    const t1Res = await authService.register({
      email: `transportista1_${Date.now()}@test.com`,
      password: 'PasswordLogistica2026!',
      nombre: 'Transportes Huascarán SAC',
      organizacion_nombre: `Huascarán Cargo ${Date.now()}`,
      rol_inicial: 'TRANSPORTISTA'
    }, { allowInternalRoles: true });
    const t1Login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: t1Res.user.email, password: 'PasswordLogistica2026!' }
    });
    transportista1Token = t1Login.json().access_token;

    // 3. Transportista 2
    const t2Res = await authService.register({
      email: `transportista2_${Date.now()}@test.com`,
      password: 'PasswordLogistica2026!',
      nombre: 'Expreso Ganadero del Norte EIRL',
      organizacion_nombre: `Expreso Ganadero ${Date.now()}`,
      rol_inicial: 'TRANSPORTISTA'
    }, { allowInternalRoles: true });
    const t2Login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: t2Res.user.email, password: 'PasswordLogistica2026!' }
    });
    transportista2Token = t2Login.json().access_token;

    // 4. Usuario Comprador Regular (Sin rol TRANSPORTISTA)
    const cRes = await authService.register({
      email: `comprador_regular_${Date.now()}@test.com`,
      password: 'PasswordLogistica2026!',
      nombre: 'Carnicería San Martín',
      organizacion_nombre: `San Martín Carnes ${Date.now()}`,
      rol_inicial: 'COMPRADOR'
    });
    const cLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: cRes.user.email, password: 'PasswordLogistica2026!' }
    });
    clienteRegularToken = cLogin.json().access_token;

    // 5. Crear dos establecimientos en PostGIS para las rutas
    // Origen: Establo Lurín (-12.274, -76.871)
    const est1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/establecimientos',
      headers: { authorization: `Bearer ${solicitanteToken}` },
      payload: {
        nombre_comercial: 'Establo Santa Fe de Lurín',
        tipo: 'ESTABLO',
        direccion_texto: 'Valle de Lurín Km 32',
        ubigeo: '150119',
        latitud: -12.274,
        longitud: -76.871
      }
    });
    assert.strictEqual(est1Res.statusCode, 201);
    establoOrigenId = est1Res.json().id;

   