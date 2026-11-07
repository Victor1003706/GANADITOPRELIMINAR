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

    // Destino: Frigorífico Callao (-12.056, -77.140)
    const est2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/establecimientos',
      headers: { authorization: `Bearer ${solicitanteToken}` },
      payload: {
        nombre_comercial: 'Camal Frigorífico del Callao',
        tipo: 'CAMAL',
        direccion_texto: 'Av. Néstor Gambetta 1200, Callao',
        ubigeo: '070101',
        latitud: -12.056,
        longitud: -77.140
      }
    });
    assert.strictEqual(est2Res.statusCode, 201);
    establoDestinoId = est2Res.json().id;

    // 6. Registrar unidades homologadas para Transportista 1 y 2
    const u1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/logistica/unidades',
      headers: { authorization: `Bearer ${transportista1Token}` },
      payload: {
        placa: `TH1-${Date.now().toString().slice(-4)}`,
        tipo_unidad: 'CAMION_JAULA_SIMPLE',
        capacidad_toneladas: 25.0,
        capacidad_cabezas: 30,
        tiene_termoregistrador: false
      }
    });
    assert.strictEqual(u1Res.statusCode, 201);
    unidad1Id = u1Res.json().id;

    const u2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/logistica/unidades',
      headers: { authorization: `Bearer ${transportista2Token}` },
      payload: {
        placa: `EGN-${Date.now().toString().slice(-4)}`,
        tipo_unidad: 'CAMION_JAULA_DOBLE_PISO',
        capacidad_toneladas: 40.0,
        capacidad_cabezas: 60,
        tiene_termoregistrador: false
      }
    });
    assert.strictEqual(u2Res.statusCode, 201);
    unidad2Id = u2Res.json().id;
  });

  after(async () => {
    // Sin esta limpieza cada corrida dejaba 2 establecimientos cerca de Lima; con más de
    // 100 acumulados, la búsqueda radial de mapa.test.ts (limit=100) perdía a Lurín.
    const ids = [establoOrigenId, establoDestinoId].filter(Boolean);
    if (ids.length) {
      await pool.query(
        `DELETE FROM fletes_solicitudes
         WHERE origen_establecimiento_id = ANY($1::uuid[]) OR destino_establecimiento_id = ANY($1::uuid[])`,
        [ids]
      );
      await pool.query('DELETE FROM establecimientos WHERE id = ANY($1::uuid[])', [ids]);
    }
    await app.close();
    await closePool();
  });

  test('1. Función pura calcularCotizacionFlete: calcula tarifa base, factor km-TM y comisiones', () => {
    const distancia = 38.5;
    const peso = 20.0;
    const cotizacion = calcularCotizacionFlete(distancia, peso, 'CAMION_JAULA_SIMPLE', 150, 0.35);

    // bruto = 150 + (38.5 * 20 * 0.35) = 150 + 269.50 = 419.50
    assert.strictEqual(cotizacion.costo_flete_bruto, 419.5);
    // fee = 419.5 * 0.05 = 20.975 -> 20.98
    assert.strictEqual(cotizacion.comision_referral_fee, 20.98);
    // total = 419.5 + 20.98 = 440.48
    assert.strictEqual(cotizacion.total_flete, 440.48);
  });

  test('1b. Privacidad (Ley 29733): cotizar exige sesión y mide un establo AJENO desde su punto en la rejilla', async () => {
    const anonimo = await app.inject({
      method: 'POST', url: '/api/v1/logistica/cotizar',
      payload: { origen_establecimiento_id: establoOrigenId, destino_establecimiento_id: establoDestinoId, peso_toneladas: 1, tipo_unidad: 'CAMION_JAULA_SIMPLE' }
    });
    assert.strictEqual(anonimo.statusCode, 401, 'antes era anónima y permitía triangular');

    // Otra organización (el cliente regular) cotiza hacia el ESTABLO del solicitante: la
    // distancia debe ser la del punto aproximado, no la exacta.
    const desdeAjeno = await app.inject({
      method: 'POST', url: '/api/v1/logistica/cotizar',
      headers: { authorization: `Bearer ${clienteRegularToken}` },
      payload: { origen_establecimiento_id: establoOrigenId, destino_establecimiento_id: establoDestinoId, peso_toneladas: 1, tipo_unidad: 'CAMION_JAULA_SIMPLE' }
    });
    assert.strictEqual(desdeAjeno.statusCode, 200, desdeAjeno.body);
    const esperada = await pool.query<{ exacta: number; aprox: number }>(
      `SELECT ST_Distance(o.coordenadas, d.coordenadas) / 1000.0 AS exacta,
              ST_Distance(ST_SnapToGrid(o.coordenadas::geometry, 0.01)::geography, d.coordenadas) / 1000.0 AS aprox
       FROM establecimientos o, establecimientos d WHERE o.id = $1 AND d.id = $2`,
      [establoOrigenId, establoDestinoId]
    );
    const { exacta, aprox } = esperada.rows[0]!;
    assert.ok(Math.abs(Number(exacta) - Number(aprox)) > 0.05, 'precondición: el fixture no está sobre la rejilla');
    assert.strictEqual(desdeAjeno.json().distancia_km, Number(Number(aprox).toFixed(2)));

    // El dueño sí obtiene la distancia exacta.
    const propio = await app.inject({
      method: 'POST', url: '/api/v1/logistica/cotizar',
      headers: { authorization: `Bearer ${solicitanteToken}` },
      payload: { origen_establecimiento_id: establoOrigenId, destino_establecimiento_id: establoDestinoId, peso_toneladas: 1, tipo_unidad: 'CAMION_JAULA_SIMPLE' }
    });
    assert.strictEqual(propio.json().distancia_km, Number(Number(exacta).toFixed(2)));
  });

  test('1c. Fletes: no se crean entre establecimientos ajenos ni con una orden ajena; las lecturas son solo para participantes', async () => {
    const ajenos = await app.inject({
      method: 'POST', url: '/api/v1/logistica/solicitudes',
      headers: { authorization: `Bearer ${clienteRegularToken}` },
      payload: { origen_establecimiento_id: establoOrigenId, destino_establecimiento_id: establoDestinoId, tipo_carga: 'GANADO_EN_PIE', tipo_unidad: 'CAMION_JAULA_SIMPLE', peso_toneladas: 5 }
    });
    assert.strictEqual(ajenos.statusCode, 403, ajenos.body);

    const ordenAjena = await app.inject({
      method: 'POST', url: '/api/v1/logistica/solicitudes',
      headers: { authorization: `Bearer ${solicitanteToken}` },
      payload: { orden_compra_id: crypto.randomUUID(), origen_establecimiento_id: establoOrigenId, destino_establecimiento_id: establoDestinoId, tipo_carga: 'GANADO_EN_PIE', tipo_unidad: 'CAMION_JAULA_SIMPLE', peso_toneladas: 5 }
    });
    assert.strictEqual(ordenAjena.statusCode, 404);
    assert.match(ordenAjena.json().message, /no encontrada/);

    const propia = await app.inject({
      method: 'POST', url: '/api/v1/logistica/solicitudes',
      headers: { authorization: `Bearer ${solicitanteToken}` },
      payload: { origen_establecimiento_id: establoOrigenId, destino_establecimiento_id: establoDestinoId, tipo_carga: 'GANADO_EN_PIE', tipo_unidad: 'CAMION_JAULA_SIMPLE', peso_toneladas: 5 }
    });
    assert.strictEqual(propia.statusCode, 201, propia.body);
    const id = propia.json().id;

    // Un comprador sin relación no la ve (ni en el listado ni por id).
    const lista = await app.inject({ method: 'GET', url: '/api/v1/logistica/solicitudes', headers: { authorization: `Bearer ${clienteRegularToken}` } });
    assert.strictEqual(lista.statusCode, 200);
    assert.ok(!lista.json().solicitudes.some((f: any) => f.id === id));
    const detalle = await app.inject({ method: 'GET', url: `/api/v1/logistica/solicitudes/${id}`, headers: { authorization: `Bearer ${clienteRegularToken}` } });
    assert.strictEqual(detalle.statusCode, 404);

    // Un TRANSPORTISTA en su contexto activo sí la ve mientras busca carga.
    const paraTransportista = await app.inject({ method: 'GET', url: '/api/v1/logistica/solicitudes', headers: { authorization: `Bearer ${transportista1Token}` } });
    assert.ok(paraTransportista.json().solicitudes.some((f: any) => f.id === id));
    await pool.query('DELETE FROM fletes_solicitudes WHERE id = $1', [id]);
  });

  test('2. POST /api/v1/logistica/cotizar: cálculo geodésico exacto en PostGIS y cotización con referral fee', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/logistica/cotizar',
      headers: { authorization: `Bearer ${solicitanteToken}` },
      payload: {
        origen_establecimiento_id: establoOrigenId,
        destino_establecimiento_id: establoDestinoId,
        peso_toneladas: 18.0,
        tipo_unidad: 'CAMION_JAULA_SIMPLE'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();

    // La distancia geodésica PostGIS entre Lurín (-12.274, -76.871) y Callao (-12.056, -77.140) es ~37 - 40 km
    assert.ok(data.distancia_km >= 35 && data.distancia_km <= 45, `Distancia esperada ~38km, obtenido: ${data.distancia_km}`);
    assert.strictEqual(data.peso_toneladas, 18.0);
    assert.strictEqual(data.tipo_unidad, 'CAMION_JAULA_SIMPLE');
    assert.ok(data.costo_flete_bruto > 150, 'El flete bruto debe superar la tarifa base');
    assert.strictEqual(
      data.comision_referral_fee,
      Number((data.costo_flete_bruto * 0.05).toFixed(2))
    );
    assert.strictEqual(
      data.total_flete,
      Number((data.costo_flete_bruto + data.comision_referral_fee).toFixed(2))
    );
  });

  test('3. POST /api/v1/logistica/solicitudes: creación exitosa en estado PENDIENTE_ASIGNACION', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/logistica/solicitudes',
      headers: { authorization: `Bearer ${solicitanteToken}` },
      payload: {
        origen_establecimiento_id: establoOrigenId,
        destino_establecimiento_id: establoDestinoId,
        tipo_carga: 'GANADO_EN_PIE',
        tipo_unidad: 'CAMION_JAULA_SIMPLE',
        peso_toneladas: 15.0
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const data = res.json();

    assert.ok(data.id, 'Debe generar un UUID para la solicitud de flete');
    assert.strictEqual(data.estado, 'PENDIENTE_ASIGNACION');
    assert.strictEqual(data.tipo_carga, 'GANADO_EN_PIE');
    assert.strictEqual(data.peso_toneladas, 15.0);
    assert.ok(data.distancia_km > 0);
    assert.ok(data.total_flete > 0);
    assert.strictEqual(data.transportista_id, null);
    assert.strictEqual(data.unidad_id, null);
  });

  test('4. POST /api/v1/logistica/solicitudes/:id/tomar-flete: rechaza a usuarios sin rol TRANSPORTISTA con 403', async () => {
    // Crear solicitud
    const sRes = await app.inject({
      method: 'POST',
      url: '/api/v1/logistica/solicitudes',
      headers: { authorization: `Bearer ${solicitanteToken}` },
      payload: {
        origen_establecimiento_id: establoOrigenId,
        destino_establecimiento_id: establoDestinoId,
        tipo_carga: 'GANADO_EN_PIE',
        tipo_unidad: 'CAMION_JAULA_SIMPLE',
        peso_toneladas: 10.0
      }
    });
    const fleteId = sRes.json().id;

    // Intentar tomar flete con token de COMPRADOR (clienteRegularToken)
    const takeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/logistica/solicitudes/${fleteId}/tomar-flete`,
      headers: { authorization: `Bearer ${clienteRegularToken}` },
      payload: { unidad_id: unidad1Id }
    });

    assert.strictEqual(takeRes.statusCode, 403);
    assert.match(takeRes.json().message, /Solo usuarios con rol TRANSPORTISTA/);
  });

  test('5. Concurrencia atómica (SELECT ... FOR UPDATE): dos transportistas compiten por el mismo flete; solo 1 gana y el otro recibe 409', async () => {
    // 1. Crear nueva solicitud de flete
    const sRes = await app.inject({
      method: 'POST',
      url: '/api/v1/logistica/solicitudes',
      headers: { authorization: `Bearer ${solicitanteToken}` },
      payload: {
        origen_establecimiento_id: establoOrigenId,
        destino_establecimiento_id: establoDestinoId,
        tipo_carga: 'GANADO_EN_PIE',
        tipo_unidad: 'CAMION_JAULA_SIMPLE',
        peso_toneladas: 12.0
      }
    });
    assert.strictEqual(sRes.statusCode, 201);
    const fleteId = sRes.json().id;

    // 2. Ejecutar asignación simultánea con Promise.all
    const [resT1, resT2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/logistica/solicitudes/${fleteId}/tomar-flete`,
        headers: { authorization: `Bearer ${transportista1Token}` },
        payload: { unidad_id: unidad1Id }
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/logistica/solicitudes/${fleteId}/tomar-flete`,
        headers: { authorization: `Bearer ${transportista2Token}` },
        payload: { unidad_id: unidad2Id }
      })
    ]);

    const statusCodes = [resT1.statusCode, resT2.statusCode].sort();
    assert.deepStrictEqual(
      statusCodes,
      [200, 409],
      `Uno debe retornar 200 y el perdedor de la carrera debe retornar 409 Conflict. Obtenido: ${statusCodes.join(', ')}`
    );

    // Identificar el ganador
    const ganadorRes = resT1.statusCode === 200 ? resT1.json() : resT2.json();
    const perdedorRes = resT1.statusCode === 409 ? resT1.json() : resT2.json();

    assert.strictEqual(ganadorRes.estado, 'ASIGNADO');
    assert.ok(ganadorRes.transportista_id);
    assert.ok(ganadorRes.unidad_id);
    assert.match(perdedorRes.message, /no está disponible para asignación/);

    // 3. Verificar evento Outbox 'FLETE_ASIGNADO'
    const outboxRes = await pool.query(
      `SELECT * FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'FLETE_ASIGNADO';`,
      [fleteId]
    );
    assert.strictEqual(outboxRes.rows.length, 1, 'Debe existir exactamente 1 evento FLETE_ASIGNADO en Outbox');
    assert.strictEqual(outboxRes.rows[0].status, 'PENDIENTE');
  });

  test('6. Transiciones de estado del viaje (ASIGNADO -> EN_TRANSITO -> ENTREGADO) y emisión de FLETE_COMPLETADO en Outbox', async () => {
    // 1. Crear y asignar flete a Transportista 1
    const sRes = await app.inject({
      method: 'POST',
      url: '/api/v1/logistica/solicitudes',
      headers: { authorization: `Bearer ${solicitanteToken}` },
      payload: {
        origen_establecimiento_id: establoOrigenId,
        destino_establecimiento_id: establoDestinoId,
        tipo_carga: 'GANADO_EN_PIE',
        tipo_unidad: 'CAMION_JAULA_SIMPLE',
        peso_toneladas: 14.0
      }
    });
    const fleteId = sRes.json().id;

    const takeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/logistica/solicitudes/${fleteId}/tomar-flete`,
      headers: { authorization: `Bearer ${transportista1Token}` },
      payload: { unidad_id: unidad1Id }
    });
    assert.strictEqual(takeRes.statusCode, 200);

    // 2. Intentar saltar directo a ENTREGADO sin pasar por EN_TRANSITO -> 400
    const invalidJumpRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/logistica/solicitudes/${fleteId}/estado`,
      headers: { authorization: `Bearer ${transportista1Token}` },
      payload: { estado: 'ENTREGADO' }
    });
    assert.strictEqual(invalidJumpRes.statusCode, 400);

    // 3. Pasar a EN_TRANSITO -> 200
    const enTransitoRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/logistica/solicitudes/${fleteId}/estado`,
      headers: { authorization: `Bearer ${transportista1Token}` },
      payload: { estado: 'EN_TRANSITO' }
    });
    assert.strictEqual(enTransitoRes.statusCode, 200);
    assert.strictEqual(enTransitoRes.json().estado, 'EN_TRANSITO');

    // 4. Pasar a ENTREGADO -> 200
    const entregadoRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/logistica/solicitudes/${fleteId}/estado`,
      headers: { authorization: `Bearer ${transportista1Token}` },
      payload: { estado: 'ENTREGADO' }
    });
    assert.strictEqual(entregadoRes.statusCode, 200);
    assert.strictEqual(entregadoRes.json().estado, 'ENTREGADO');

    // 5. Verificar evento Outbox 'FLETE_COMPLETADO'
    const outboxCompleted = await pool.query(
      `SELECT * FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'FLETE_COMPLETADO';`,
      [fleteId]
    );
    assert.strictEqual(outboxCompleted.rows.length, 1, 'Debe haberse insertado el evento FLETE_COMPLETADO en Outbox');
    assert.strictEqual(outboxCompleted.rows[0].status, 'PENDIENTE');
    const payload = outboxCompleted.rows[0].payload;
    assert.strictEqual(payload.solicitud_id, fleteId);
    assert.strictEqual(payload.estado, 'ENTREGADO');
  });

  test('7. Consultas auxiliares: GET /solicitudes/:id y GET /unidades', async () => {
    // 1. Consultar unidades del transportista 1
    const unidadesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/logistica/unidades',
      headers: { authorization: `Bearer ${transportista1Token}` }
    });
    assert.strictEqual(unidadesRes.statusCode, 200);
    const { unidades } = unidadesRes.json();
    assert.ok(Array.isArray(unidades));
    assert.ok(unidades.some((u: any) => u.id === unidad1Id));

    // 2. Intentar tomar flete usando la unidad de otro transportista -> 403
    const sRes = await app.inject({
      method: 'POST',
      url: '/api/v1/logistica/solicitudes',
      headers: { authorization: `Bearer ${solicitanteToken}` },
      payload: {
        origen_establecimiento_id: establoOrigenId,
        destino_establecimiento_id: establoDestinoId,
        tipo_carga: 'INSUMOS_GRANOS',
        tipo_unidad: 'CAMION_JAULA_SIMPLE',
        peso_toneladas: 8.0
      }
    });
    const fleteId = sRes.json().id;

    const crossTakeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/logistica/solicitudes/${fleteId}/tomar-flete`,
      headers: { authorization: `Bearer ${transportista1Token}` },
      payload: { unidad_id: unidad2Id } // unidad2 pertenece a transportista 2
    });
    assert.strictEqual(crossTakeRes.statusCode, 403);
    assert.match(crossTakeRes.json().message, /no pertenece al transportista autenticado/);

    // 3. Consultar la solicitud creada por ID
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/logistica/solicitudes/${fleteId}`,
      headers: { authorization: `Bearer ${solicitanteToken}` }
    });
    assert.strictEqual(getRes.statusCode, 200);
    assert.strictEqual(getRes.json().id, fleteId);
  });
});
