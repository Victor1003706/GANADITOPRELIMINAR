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

    // 2.2 Establo Lurín (~32 km del centro)
    const lurinRes = await app.inject({
      method: 'POST',
      url: '/api/v1/establecimientos',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        nombre_comercial: 'Establo Lechero del Valle de Lurín',
        tipo: 'ESTABLO',
        latitud: LURIN_ESTABLO.lat,
        longitud: LURIN_ESTABLO.lon,
        direccion_texto: 'Valle de Lurín Sector 3',
        ubigeo: '150119'
      }
    });

    assert.strictEqual(lurinRes.statusCode, 201);
    establoLimaId = lurinRes.json().id;

    // 2.3 Camal Municipal de Piura (~850 km del centro de Lima)
    const piuraRes = await app.inject({
      method: 'POST',
      url: '/api/v1/establecimientos',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        nombre_comercial: 'Frigorífico Regional de Piura',
        tipo: 'CAMAL',
        latitud: PIURA_CAMAL.lat,
        longitud: PIURA_CAMAL.lon,
        direccion_texto: 'Zona Industrial de Piura Mz C',
        ubigeo: '200101'
      }
    });

    assert.strictEqual(piuraRes.statusCode, 201);
    establoPiuraId = piuraRes.json().id;
  });

  test('3. Búsqueda radial confirmando que ST_DWithin filtra correctamente según el radio', async () => {
    // 3.1 Radio 5 km desde Lima Centro: Callao (~10.6 km) y Lurín (~32 km) deben quedar fuera
    const radio5Res = await app.inject({
      method: 'GET',
      url: `/api/v1/establecimientos/cercanos?lat=${LIMA_CENTRO.lat}&lon=${LIMA_CENTRO.lon}&radio_km=5&limit=100`
    });

    assert.strictEqual(radio5Res.statusCode, 200);
    const radio5Body = radio5Res.json();
    const idsRadio5 = radio5Body.establecimientos.map((e: any) => e.id);
    assert.ok(!idsRadio5.includes(establoCallaoId), 'Establo Callao (10.6 km) debe quedar fuera de radio 5 km');
    assert.ok(!idsRadio5.includes(establoLimaId), 'Establo Lurín (32 km) debe quedar fuera de radio 5 km');
    assert.ok(!idsRadio5.includes(establoPiuraId), 'Piura (850 km) debe quedar fuera');

    // 3.2 Radio 15 km desde Lima Centro: Callao (~10.6 km) debe entrar, pero Lurín (~32 km) debe quedar fuera
    const radio15Res = await app.inject({
      method: 'GET',
      url: `/api/v1/establecimientos/cercanos?lat=${LIMA_CENTRO.lat}&lon=${LIMA_CENTRO.lon}&radio_km=15&limit=100`
    });

    assert.strictEqual(radio15Res.statusCode, 200);
    const radio15Body = radio15Res.json();
    const idsRadio15 = radio15Body.establecimientos.map((e: any) => e.id);
    assert.ok(idsRadio15.includes(establoCallaoId), 'Establo Callao debe ser incluido en radio de 15 km');
    assert.ok(!idsRadio15.includes(establoLimaId), 'Establo Lurín (32 km) debe quedar fuera en radio de 15 km');
    assert.ok(!idsRadio15.includes(establoPiuraId), 'Piura debe quedar fuera');

    // 3.3 Radio 50 km: Callao y Lurín entran, Piura queda fuera
    const radio50Res = await app.inject({
      method: 'GET',
      url: `/api/v1/establecimientos/cercanos?lat=${LIMA_CENTRO.lat}&lon=${LIMA_CENTRO.lon}&radio_km=50&limit=100`
    });

    assert.strictEqual(radio50Res.statusCode, 200);
    const radio50Body = radio50Res.json();
    const idsRadio50 = radio50Body.establecimientos.map((e: any) => e.id);
    assert.ok(idsRadio50.includes(establoCallaoId));
    assert.ok(idsRadio50.includes(establoLimaId));
    assert.ok(!idsRadio50.includes(establoPiuraId), 'Piura (850 km) debe quedar fuera en radio 50 km');
  });

  test('4. Cálculo correcto de distancia en kilómetros mediante ST_Distance', async () => {
    // Buscar en radio amplio (1000 km) para inspeccionar distancias calculadas
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/establecimientos/cercanos?lat=${LIMA_CENTRO.lat}&lon=${LIMA_CENTRO.lon}&radio_km=1000&limit=100`
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json();

    const callao = body.establecimientos.find((e: any) => e.id === establoCallaoId);
    assert.ok(callao);
    // Callao está entre 10 km y 12 km de Lima Centro
    assert.ok(
      callao.distancia_km >= 10 && callao.distancia_km <= 12,
      `Distancia a Callao debe ser ~10-12 km (obtenido: ${callao.distancia_km} km)`
    );

    let lurin = body.establecimientos.find((e: any) => e.id === establoLimaId);
    if (!lurin) {
      const lurinLookup = await app.inject({
        method: 'GET',
        url: `/api/v1/establecimientos/cercanos?lat=${LIMA_CENTRO.lat}&lon=${LIMA_CENTRO.lon}&radio_km=50&tipo=ESTABLO&limit=100`
      });
      lurin = lurinLookup.json().establecimientos.find((e: any) => e.id === establoLimaId);
    }
    assert.ok(lurin);
    // Lurín está entre 28 km y 35 km
    assert.ok(
      lurin.distancia_km >= 28 && lurin.distancia_km <= 35,
      `Distancia a Lurín debe ser ~30-33 km (obtenido: ${lurin.distancia_km} km)`
    );

    let piura = body.establecimientos.find((e: any) => e.id === establoPiuraId);
    if (!piura) {
      const piuraLookup = await app.inject({
        method: 'GET',
        url: `/api/v1/establecimientos/cercanos?lat=${LIMA_CENTRO.lat}&lon=${LIMA_CENTRO.lon}&radio_km=1000&tipo=CAMAL&limit=50`
      });
      piura = piuraLookup.json().establecimientos.find((e: any) => e.id === establoPiuraId);
    }
    assert.ok(piura);
    // Piura está a más de 800 km y menos de 950 km
    assert.ok(
      piura.distancia_km >= 800 && piura.distancia_km <= 950,
      `Distancia a Piura debe ser ~850 km (obtenido: ${piura.distancia_km} km)`
    );
  });

  test('5. Registro y consulta de cotizaciones spot vigentes vs expiradas', async () => {
    // 5.1 Rechazo HTTP 401 si no hay token para publicar precio spot
    const noAuthRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cotizaciones',
      payload: {
        establecimiento_id: establoCallaoId,
        producto: 'GANADO_EN_PIE',
        categoria: 'TORETE',
        calidad: 'EXTRA',
        unidad_medida: 'KG_VIVO',
        precio_unitario: 8.5,
        vigencia_hasta: new Date(Date.now() + 86400000).toISOString()
      }
    });
    assert.strictEqual(noAuthRes.statusCode, 401);

    // 5.2 Registrar cotización VIGENTE (vigente por 24 horas)
    const fechaManana = new Date(Date.now() + 86400000).toISOString();
    const vigenteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cotizaciones',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        establecimiento_id: establoCallaoId,
        producto: 'GANADO_EN_PIE',
        categoria: 'TORETE',
        calidad: 'EXTRA',
        unidad_medida: 'KG_VIVO',
        precio_unitario: 8.75,
        vigencia_hasta: fechaManana
      }
    });

    assert.strictEqual(vigenteRes.statusCode, 201);
    const vigenteId = vigenteRes.json().id;
    assert.strictEqual(vigenteRes.json().precio_unitario, 8.75);

    // 5.3 Registrar cotización EXPIRADA en PostgreSQL directamente
    // (Simulando una oferta registrada hace 3 días y que venció ayer)
    const fechaPasadaInicio = new Date(Date.now() - 3 * 86400000).toISOString();
    const fechaPasadaVencimiento = new Date(Date.now() - 1 * 86400000).toISOString();

    const expiradaDbRes = await pool.query<{ id: string }>(
      `INSERT INTO cotizaciones_spot (
         establecimiento_id,
         producto,
         categoria,
         calidad,
         unidad_medida,
         precio_unitario,
         procedencia_ubigeo,
         fecha_registro,
         vigencia_hasta
       )
       VALUES ($1, 'GANADO_EN_PIE', 'TORETE', 'PRIMERA', 'KG_VIVO', 7.90, '070101', $2, $3)
       RETURNING id`,
      [establoCallaoId, fechaPasadaInicio, fechaPasadaVencimiento]
    );
    const expiradaId = expiradaDbRes.rows[0]!.id;

    // 5.4 Consultar Pizarra Spot (GET /api/v1/cotizaciones/pizarra)
    const pizarraRes = await app.inject({
      method: 'GET',
      url: '/api/v1/cotizaciones/pizarra?producto=GANADO_EN_PIE'
    });

    assert.strictEqual(pizarraRes.statusCode, 200);
    const pizarraBody = pizarraRes.json();

    const idsPizarra = pizarraBody.cotizaciones.map((c: any) => c.id);
    assert.ok(idsPizarra.includes(vigenteId), 'La cotización vigente DEBE aparecer en la pizarra');
    assert.ok(!idsPizarra.includes(expiradaId), 'La cotización expirada DEBE quedar excluida de la pizarra');

    // Comprobar datos enriquecidos del establecimiento
    const itemVigente = pizarraBody.cotizaciones.find((c: any) => c.id === vigenteId);
    assert.strictEqual(itemVigente.establecimiento_nombre, 'Centro de Beneficio y Engorde Callao');
    assert.strictEqual(itemVigente.precio_unitario, 8.75);
    assert.strictEqual(itemVigente.moneda, 'PEN');
  });
});
