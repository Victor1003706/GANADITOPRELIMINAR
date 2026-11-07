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
      `INSERT INTO organizaciones (razon_social, ruc, estado)
       VALUES ($1, $2, 'ACTIVA')
       RETURNING id`,
      [`Frigorífico Industrial Lima SAC ${Date.now()}`, dynamicRuc]
    );
    orgCompradorId = orgRes.rows[0]!.id;

    await authService.addMembership(userId, orgCompradorId, 'COMPRADOR', false);

    // 4.2 Conmutar contexto activo a COMPRADOR
    const switchRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/organizations/switch-context',
      headers: {
        authorization: `Bearer ${tokenVendedor}`
      },
      payload: {
        organizacion_id: orgCompradorId,
        rol: 'COMPRADOR'
      }
    });

    assert.strictEqual(switchRes.statusCode, 200, `Error al conmutar: ${switchRes.body}`);
    const switchBody = switchRes.json();
    assert.ok(switchBody.access_token);
    assert.strictEqual(switchBody.active_context.organizacion_id, orgCompradorId);
    assert.strictEqual(switchBody.active_context.rol, 'COMPRADOR');

    // 4.3 Comprobar en PostgreSQL que EXACTAMENTE una fila tiene is_active_context = TRUE
    const activeCountRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count
       FROM user_organizaciones_roles
       WHERE user_id = $1 AND is_active_context = TRUE`,
      [userId]
    );
    assert.strictEqual(activeCountRes.rows[0]!.count, '1', 'Debe haber exactamente un contexto activo en PostgreSQL');

    // Comprobar que la activa es Frigorífico Lima como COMPRADOR
    const currentActiveRes = await pool.query<{ organizacion_id: string; rol: string }>(
      `SELECT organizacion_id, rol
       FROM user_organizaciones_roles
       WHERE user_id = $1 AND is_active_context = TRUE`,
      [userId]
    );
    assert.strictEqual(currentActiveRes.rows[0]!.organizacion_id, orgCompradorId);
    assert.strictEqual(currentActiveRes.rows[0]!.rol, 'COMPRADOR');

    // 4.4 Conmutar de vuelta a VENDEDOR
    const switchBackRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/organizations/switch-context',
      headers: {
        authorization: `Bearer ${switchBody.access_token}`
      },
      payload: {
        organizacion_id: orgVendedorId,
        rol: 'VENDEDOR'
      }
    });

    assert.strictEqual(switchBackRes.statusCode, 200);
    assert.strictEqual(switchBackRes.json().active_context.rol, 'VENDEDOR');

    // Validar de nuevo unicidad de contexto activo
    const recheckActiveRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count
       FROM user_organizaciones_roles
       WHERE user_id = $1 AND is_active_context = TRUE`,
      [userId]
    );
    assert.strictEqual(recheckActiveRes.rows[0]!.count, '1');
  });

  test('5. Rechazo HTTP 401/403 en endpoints protegidos', async () => {
    // 5.1 Sin token -> 401 Unauthorized
    const noTokenRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me'
    });
    assert.strictEqual(noTokenRes.statusCode, 401);

    // 5.2 Token inválido o malformado -> 401 Unauthorized
    const invalidTokenRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: 'Bearer token_completamente_invalido_xyz'
      }
    });
    assert.strictEqual(invalidTokenRes.statusCode, 401);

    // 5.3 Intentar conmutar a una organización no vinculada -> 403 Forbidden
    const unlinkedOrgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizaciones (razon_social, estado)
       VALUES ('Organización Ajena S.A.', 'ACTIVA')
       RETURNING id`
    );
    const ajenaOrgId = unlinkedOrgRes.rows[0]!.id;

    // Obtener token fresco
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: testUser.email,
        password: testUser.password
      }
    });
    const freshToken = loginRes.json().access_token;

    const forbiddenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/organizations/switch-context',
      headers: {
        authorization: `Bearer ${freshToken}`
      },
      payload: {
        organizacion_id: ajenaOrgId,
        rol: 'ADMIN'
      }
    });
    assert.strictEqual(forbiddenRes.statusCode, 403);
    assert.match(forbiddenRes.json().message, /no posee el rol o membresía/i);
  });

  test('6. Consulta de perfil y membresías (GET /api/v1/auth/me)', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: testUser.email,
        password: testUser.password
      }
    });
    const token = loginRes.json().access_token;

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    assert.strictEqual(meRes.statusCode, 200);
    const body = meRes.json();
    assert.strictEqual(body.user.email, testUser.email.toLowerCase());
    assert.ok(body.activeContext);
    assert.strictEqual(body.memberships.length, 2, 'El usuario debe registrar 2 membresías activables');
  });

  test('7. Blindaje de autoregistro: sólo se admiten roles comerciales COMPRADOR y VENDEDOR', async () => {
    // 7.1 Intento de autoregistro con rol ADMIN -> 400 Bad Request
    const adminRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `fake_admin_${Date.now()}@test.com`,
        password: 'PasswordSegura2026!',
        nombre: 'Intento Admin',
        rol_inicial: 'ADMIN'
      }
    });
    assert.strictEqual(adminRes.statusCode, 400);
    const adminBody = adminRes.json();
    assert.strictEqual(adminBody.error, 'AuthError');
    assert.match(adminBody.message, /Rol no permitido para autoregistro/i);

    // 7.2 Intento de autoregistro con rol AUDITOR -> 400 Bad Request
    const auditorRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `fake_auditor_${Date.now()}@test.com`,
        password: 'PasswordSegura2026!',
        nombre: 'Intento Auditor',
        rol_inicial: 'AUDITOR'
      }
    });
    assert.strictEqual(auditorRes.statusCode, 400);
    const auditorBody = auditorRes.json();
    assert.strictEqual(auditorBody.error, 'AuthError');
    assert.match(auditorBody.message, /Rol no permitido para autoregistro/i);

    // 7.3 Intento de autoregistro con rol inválido o arbitrario -> 400 Bad Request
    const invalidRoleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `fake_superuser_${Date.now()}@test.com`,
        password: 'PasswordSegura2026!',
        nombre: 'Intento Superuser',
        rol_inicial: 'SUPERUSER'
      }
    });
    assert.strictEqual(invalidRoleRes.statusCode, 400);
    const invalidRoleBody = invalidRoleRes.json();
    assert.strictEqual(invalidRoleBody.error, 'AuthError');
    assert.match(invalidRoleBody.message, /Rol no permitido para autoregistro/i);

    // 7.4 Registro válido explícito como COMPRADOR -> 201 Created
    const buyerEmail = `comprador_valido_${Date.now()}@test.com`;
    const buyerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: buyerEmail,
        password: 'PasswordSegura2026!',
        nombre: 'Comprador Valido',
        rol_inicial: 'COMPRADOR'
      }
    });
    assert.strictEqual(buyerRes.statusCode, 201);
    const buyerBody = buyerRes.json();
    assert.strictEqual(buyerBody.active_context.rol, 'COMPRADOR');
    assert.strictEqual(buyerBody.user.email, buyerEmail);

    // 7.5 Registro válido explícito como VENDEDOR -> 201 Created
    const sellerEmail = `vendedor_valido_${Date.now()}@test.com`;
    const sellerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: sellerEmail,
        password: 'PasswordSegura2026!',
        nombre: 'Vendedor Valido',
        rol_inicial: 'VENDEDOR'
      }
    });
    assert.strictEqual(sellerRes.statusCode, 201);
    const sellerBody = sellerRes.json();
    assert.strictEqual(sellerBody.active_context.rol, 'VENDEDOR');
    assert.strictEqual(sellerBody.user.email, sellerEmail);
  });
});
