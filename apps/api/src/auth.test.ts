import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';

describe('Autenticación, JWT y Contexto Organizacional Dual (RBAC)', () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);

  const testUser = {
    email: `ganadero_${Date.now()}@test.com`,
    password: 'PasswordSuperSegura2026!',
    nombre: 'Carlos Ganadero',
    telefono: '999888777',
    organizacion_nombre: 'Hacienda El Rocío',
    rol_inicial: 'VENDEDOR' as const
  };

  let tokenVendedor: string;
  let userId: string;
  let orgVendedorId: string;
  let orgCompradorId: string;

  before(async () => {
    await runInitialMigration();
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  test('1. Registro exitoso de usuario y contexto activo inicial (POST /api/v1/auth/register)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: testUser
    });

    assert.strictEqual(res.statusCode, 201, `Esperado 201, recibido ${res.statusCode}: ${res.body}`);
    const body = res.json();

    assert.ok(body.access_token, 'Debe incluir un access_token JWT');
    assert.strictEqual(body.token_type, 'Bearer');
    assert.strictEqual(body.expires_in, 900, 'Expiración debe ser de 900 segundos (15 min)');
    assert.strictEqual(body.user.email, testUser.email.toLowerCase());
    assert.strictEqual(body.user.nombre, testUser.nombre);
    assert.ok(body.user.id);
    assert.strictEqual(body.active_context.rol, 'VENDEDOR');
    assert.strictEqual(body.active_context.razon_social, testUser.organizacion_nombre);

    userId = body.user.id;
    orgVendedorId = body.active_context.organizacion_id;
    tokenVendedor = body.access_token;
  });

  test('2. Intento de registro con email duplicado debe retornar 409 Conflict', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: testUser
    });

    assert.strictEqual(res.statusCode, 409);
    const body = res.json();
    assert.match(body.message, /ya se encuentra registrado/i);
  });

  test('3. Login con credenciales válidas e inválidas (POST /api/v1/auth/login)', async () => {
    // 3.1 Credenciales válidas
    const validRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: testUser.email,
        password: testUser.password
      }
    });

    assert.strictEqual(validRes.statusCode, 200);
    const validBody = validRes.json();
    assert.ok(validBody.access_token);
    assert.strictEqual(validBody.active_context.rol, 'VENDEDOR');
    assert.strictEqual(validBody.active_context.organizacion_id, orgVendedorId);

    // 3.2 Contraseña incorrecta
    const invalidPassRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: testUser.email,
        password: 'PasswordIncorrecta999!'
      }
    });

    assert.strictEqual(invalidPassRes.statusCode, 401);
    assert.match(invalidPassRes.json().message, /inválidas/i);

    // 3.3 Email no existente
    const notFoundRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'no_existe_ganadero@test.com',
        password: 'CualquierPassword123!'
      }
    });

    assert.strictEqual(notFoundRes.statusCode, 401);
  });

  test('4. Alternancia de rol (COMPRADOR / VENDEDOR) garantizando un único contexto activo', async () => {
    // 4.1 Crear una segunda organización (ej. Camal / Comprador) y vincular al usuario como COMPRADOR
    const dynamicRuc = '20' + Math.floor(100000000 + Math.random() * 900000000).toString();
    const orgRes = await pool.query<{ id: string }>(
      `