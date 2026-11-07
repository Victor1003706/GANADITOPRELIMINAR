import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';

describe('Módulo de Mapa Geoespacial (PostGIS) y Pizarra Spot', () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);

  let authToken: string;
  let organizacionId: string;
  let userId: string;
  let establoLimaId: string;
  let establoCallaoId: string;
  let establoPiuraId: string;

  // Coordenadas de prueba en Perú (WGS84)
  // Plaza Mayor de Lima (Centro de referencia)
  const LIMA_CENTRO = { lat: -12.046374, lon: -77.042793 };

  // Callao (Puerto / Terminal pesquero y ganadero) ~10.6 km de Lima Centro
  const CALLAO_ESTABLO = { lat: -12.056, lon: -77.140 };

  // Lurín (Establo al sur de Lima) ~32 km de Lima Centro
  const LURIN_ESTABLO = { lat: -12.274, lon: -76.871 };

  // Piura (Norte del Perú) ~850 km de Lima Centro
  const PIURA_CAMAL = { lat: -5.19449, lon: -80.63282 };

  before(async () => {
    await runInitialMigration();
    await app.ready();

    // Crear usuario y organización titular para las pruebas
    const userRes = await authService.register({
      email: `geoganadero_${Date.now()}@test.com`,
      password: 'PasswordGeo2026!',
      nombre: 'Pedro Ganadero Geo',
      organizacion_nombre: 'Ganadería Los Andes SAC',
      rol_inicial: 'VENDEDOR'
    });

    userId = userRes.user.id;
    organizacionId = userRes.activeContext.organizacion_id;

    // Obtener token JWT firmado para la sesión activa
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: userRes.user.email,
        password: 'PasswordGeo2026!'
      }
    });
    authToken = loginRes.json().access_token;
  });

  after(async () => {
    // Borrar lo creado: si se acumula, la búsqueda radial (limit=100) deja fuera los
    // establecimientos de esta ejecución y la prueba 3 falla en bases locales reutilizadas.
    const ids = [establoLimaId, establoCallaoId, establoPiuraId].filter(Boolean);
    if (ids.length > 0) {
      await pool.query('DELETE FROM cotizaciones_spot WHERE establecimiento_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM establecimientos WHERE id = ANY($1::uuid[])', [ids]);
    }
    await app.close();
    await closePool();
  });

  test('1. Rechazo HTTP 401 si se intenta registrar un establecimiento sin token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/establecimientos',
      payload: {
        nombre_comercial: 'Establo No Autorizado',
        tipo: 'ESTABLO',
        latitud: CALLAO_ESTABLO.lat,
        longitud: CALLAO_ESTABLO.lon,
        direccion_texto: 'Av. Gambetta 123',
        ubigeo: '070101'
      }
    });

    assert.strictEqual(res.statusCode, 401, 'Debe requerir autenticación');
  });

  test('2. Inserción de establecimientos con coordenadas reales en Perú (Lima, Callao, Piura)', async () => {
    // 2.1 Establo Callao (~10.6 km del centro)
    const callaoRes = await app.inject({
      method: 'POST',
      url: '/api/v1/establecimientos',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        nombre_comercial: 'Centro de Beneficio y Engorde Callao',
        tipo: 'CENTRO_BENEFICIO',
        latitud: CALLAO_ESTABLO.lat,
        longitud: CALLAO_ESTABLO.lon,
        direccion_texto: 'Av. Néstor Gambetta Km 5, Callao',
        ubigeo: '070101'
      }
    });

    assert.strictEqual(callaoRes.statusCode, 201);
    const callaoBody = callaoRes.json();
    assert.ok(callaoBody.id);
    assert.strictEqual(callaoBody.tipo, 'CENTRO_BENEFICIO');
    assert.strictEqual(callaoBody.latitud, CALLAO_ESTABLO.lat);
    assert.strictEqual(callaoBody.longitud, CALLAO_ESTABLO.lon);
    establoCallaoId = callaoBody.id;

    // 2.