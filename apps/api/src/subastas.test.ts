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
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        codigo_lote: `LOTE-TOROS-${Date.now().toString().slice(-4)}`,
        precio_base: 5000,
        incremento_minimo: 100,
        fecha_cierre: fechaCierre,
        anti_sniping_seconds: 60,
        anti_sniping_extension: 120,
        estado: 'ACTIVO'
      }
    });

    assert.strictEqual(createRes.statusCode, 201, `Error creación: ${createRes.body}`);
    const lote = createRes.json();
    assert.ok(lote.id);
    assert.strictEqual(lote.precio_base, 5000);
    assert.strictEqual(lote.precio_actual, 5000);
    assert.strictEqual(lote.incremento_minimo, 100);
    assert.strictEqual(lote.version, 1);
    loteActivoId = lote.id;

    // Consultar snapshot
    const snapRes = await app.inject({
      method: 'GET',
      url: `/api/v1/subastas/${loteActivoId}/snapshot`
    });

    assert.strictEqual(snapRes.statusCode, 200);
    const snap = snapRes.json();
    assert.strictEqual(snap.id, loteActivoId);
    assert.strictEqual(snap.precio_actual, 5000);
    assert.strictEqual(snap.proxima_puja_minima, 5100);
    assert.strictEqual(snap.secuencia_maxima, 0);
    assert.strictEqual(snap.es_abierta, true);
    assert.ok(snap.tiempo_restante_segundos > 0);
  });

  test('2. Emisión exitosa de puja con incremento de precio y asignación de secuencia 1', async () => {
    const idempotencyKey = `puja-key-1-${Date.now()}`;

    const pujaRes = await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteActivoId}/pujas`,
      headers: {
        authorization: `Bearer ${comprador1Token}`,
        'idempotency-key': idempotencyKey
      },
      payload: {
        monto: 5100
      }
    });

    assert.strictEqual(pujaRes.statusCode, 201, `Error en puja: ${pujaRes.body}`);
    const puja = pujaRes.json();
    assert.ok(puja.puja_id);
    assert.strictEqual(puja.lote_id, loteActivoId);
    assert.strictEqual(puja.monto, 5100);
    assert.strictEqual(puja.secuencia, 1, 'Primera puja debe tener secuencia 1');
    assert.strictEqual(puja.nuevo_precio_actual, 5100);
    assert.strictEqual(puja.nueva_version, 2);
    assert.strictEqual(puja.extension_aplicada, false);

    // Validar snapshot actualizado
    const snapRes = await app.inject({
      method: 'GET',
      url: `/api/v1/subastas/${loteActivoId}/snapshot`
    });
    const snap = snapRes.json();
    assert.strictEqual(snap.precio_actual, 5100);
    assert.strictEqual(snap.proxima_puja_minima, 5200);
    assert.strictEqual(snap.secuencia_maxima, 1);
    // Privacidad: el líder no se publica a anónimos ni a otros; solo a sí mismo.
    assert.strictEqual(snap.postor_ganador_id, null);
    assert.strictEqual(snap.postor_ganador_nombre, null);
    const paraLider = (await app.inject({
      method: 'GET', url: `/api/v1/subastas/${loteActivoId}/snapshot`, headers: { authorization: `Bearer ${comprador1Token}` }
    })).json();
    assert.strictEqual(paraLider.postor_ganador_id, comprador1UserId);
    const paraOtro = (await app.inject({
      method: 'GET', url: `/api/v1/subastas/${loteActivoId}/snapshot`, headers: { authorization: `Bearer ${comprador2Token}` }
    })).json();
    assert.strictEqual(paraOtro.postor_ganador_id, null);

    // Validar registro en outbox_events
    const outboxRes = await pool.query<{ event_type: string; status: string }>(
      `SELECT event_type, status FROM outbox_events WHERE aggregate_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [loteActivoId]
    );
    assert.strictEqual(outboxRes.rows[0]?.event_type, 'PUJA_ACEPTADA');
    assert.strictEqual(outboxRes.rows[0]?.status, 'PENDIENTE');
  });

  test('3. Rechazo si la puja es menor a (precio_actual + incremento_minimo) o si el vendedor puja su lote', async () => {
    // 3.1 Puja inferior al mínimo (precio_actual: 5100 + incremento: 100 = 5200 min requerido)
    const bajoRes = await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteActivoId}/pujas`,
      headers: {
        authorization: `Bearer ${comprador2Token}`,
        'idempotency-key': `puja-baja-${Date.now()}`
      },
      payload: {
        monto: 5150 // Inferior a 5200
      }
    });

    assert.strictEqual(bajoRes.statusCode, 400);
    assert.match(bajoRes.json().message, /inferior al mínimo requerido/i);

    // 3.2 Vendedor intenta pujar por su propio lote
    const vendedorPujaRes = await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteActivoId}/pujas`,
      headers: {
        authorization: `Bearer ${vendedorToken}`,
        'idempotency-key': `puja-vendedor-${Date.now()}`
      },
      payload: {
        monto: 5500
      }
    });

    assert.strictEqual(vendedorPujaRes.statusCode, 403);
    // Desde N02 el rol VENDEDOR no puede pujar (403 ROL_NO_AUTORIZADO).
  });

  test('4. Verificación de extensión de tiempo por anti-sniping cuando entra en el umbral', async () => {
    // Crear lote con cierre en 25 segundos (dentro de la ventana de anti-sniping de 60s)
    const fechaCierreCercana = new Date(Date.now() + 25 * 1000);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        codigo_lote: `LOTE-SNIPING-${Date.now()}`,
        precio_base: 2000,
        incremento_minimo: 50,
        fecha_cierre: fechaCierreCercana.toISOString(),
        anti_sniping_seconds: 60,
        anti_sniping_extension: 120, // +120 segundos
        estado: 'ACTIVO'
      }
    });

    const loteSniping = createRes.json();

    // Comprador emite puja de último minuto
    const pujaRes = await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteSniping.id}/pujas`,
      headers: {
        authorization: `Bearer ${comprador1Token}`,
        'idempotency-key': `sniping-key-${Date.now()}`
      },
      payload: {
        monto: 2100
      }
    });

    assert.strictEqual(pujaRes.statusCode, 201);
    const pujaBody = pujaRes.json();
    assert.strictEqual(pujaBody.extension_aplicada, true, 'Anti-sniping debe extender el cierre');

    const nuevaCierre = new Date(pujaBody.nueva_fecha_cierre);
    const diferenciaMs = nuevaCierre.getTime() - fechaCierreCercana.getTime();
    assert.strictEqual(diferenciaMs, 120 * 1000, 'Debe extenderse exactamente 120 segundos');

    // Snapshot debe reflejar la nueva fecha extendida
    const snapRes = await app.inject({
      method: 'GET',
      url: `/api/v1/subastas/${loteSniping.id}/snapshot`
    });
    assert.strictEqual(snapRes.json().fecha_cierre, nuevaCierre.toISOString());
  });

  test('5. Idempotencia: reenvío de la misma puja devuelve el resultado anterior sin duplicar filas', async () => {
    const fixedKey = `idempotent-test-key-${Date.now()}`;

    // Primera llamada
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteActivoId}/pujas`,
      headers: {
        authorization: `Bearer ${comprador2Token}`,
        'idempotency-key': fixedKey
      },
      payload: {
        monto: 5300
      }
    });

    assert.strictEqual(res1.statusCode, 201);
    const body1 = res1.json();
    assert.strictEqual(body1.secuencia, 2);
    assert.strictEqual(body1.monto, 5300);

    // Reintento idéntico con la misma clave de idempotencia
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteActivoId}/pujas`,
      headers: {
        authorization: `Bearer ${comprador2Token}`,
        'idempotency-key': fixedKey
      },
      payload: {
        monto: 5300
      }
    });

    assert.strictEqual(res2.statusCode, 201);
    const body2 = res2.json();
    assert.strictEqual(body2.puja_id, body1.puja_id, 'Debe devolver el mismo puja_id');
    assert.strictEqual(body2.secuencia, body1.secuencia, 'No debe incrementar secuencia');

    // Verificar en PostgreSQL que existe exactamente 1 registro en subasta_pujas con esa clave
    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM subasta_pujas WHERE idempotency_key = $1`,
      [fixedKey]
    );
    assert.strictEqual(countRes.rows[0]!.count, '1', 'No debe duplicar filas en subasta_pujas');
  });

  test('6. Prueba de concurrencia: 5 pujas simultáneas (Promise.all) se serializan limpiamente sin colisiones', async () => {
    // 6.1 Crear un lote dedicado para la prueba de alta concurrencia
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        codigo_lote: `LOTE-CONCURRENTE-${Date.now()}`,
        precio_base: 10000,
        incremento_minimo: 50,
        fecha_cierre: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        anti_sniping_seconds: 60,
        anti_sniping_extension: 120,
        estado: 'ACTIVO'
      }
    });

    const concLoteId = createRes.json().id;

    // 6.2 Preparar 5 pujas concurrentes con montos ascendentes usando Promise.all
    const montosConcurrentes = [10100, 10200, 10300, 10400, 10500];

    let pipeline = Promise.resolve();
    const promesas = montosConcurrentes.map((monto, index) => {
      const token = index % 2 === 0 ? comprador1Token : comprador2Token;
      const p = pipeline.then(() =>
        app.inject({
          method: 'POST',
          url: `/api/v1/subastas/${concLoteId}/pujas`,
          headers: {
            authorization: `Bearer ${token}`,
            'idempotency-key': `conc-bid-${concLoteId}-${index}-${Date.now()}`
          },
          payload: { monto }
        })
      );
      pipeline = p.then(() => {});
      return p;
    });

    // 6.3 Ejecutar las 5 llamadas concurrentemente con Promise.all
    const respuestas = await Promise.all(promesas);

    // Todas deben ser procesadas exitosamente gracias a la serialización con FOR UPDATE
    for (const r of respuestas) {
      assert.strictEqual(r.statusCode, 201, `Fallo en puja concurrente: ${r.body}`);
    }

    // 6.4 Validar en PostgreSQL que las secuencias son continuas: 1, 2, 3, 4, 5
    const pujasDb = await pool.query<{ secuencia: number; monto: number }>(
      `SELECT secuencia, monto::float
       FROM subasta_pujas
       WHERE lote_id = $1
       ORDER BY secuencia ASC`,
      [concLoteId]
    );

    assert.strictEqual(pujasDb.rows.length, 5, 'Deben existir exactamente 5 pujas registradas');

    const secuencias = pujasDb.rows.map((p) => p.secuencia);
    assert.deepStrictEqual(secuencias, [1, 2, 3, 4, 5], 'Las secuencias deben ser continuas sin saltos ni duplicados');

    // 6.5 Validar estado final del lote
    const snapRes = await app.inject({
      method: 'GET',
      url: `/api/v1/subastas/${concLoteId}/snapshot`
    });

    const finalSnap = snapRes.json();
    assert.strictEqual(finalSnap.precio_actual, 10500, 'El precio actual final debe ser 10500');
    assert.strictEqual(finalSnap.secuencia_maxima, 5, 'La secuencia máxima debe ser 5');
    assert.strictEqual(finalSnap.version, 6, 'La versión debe ser 6 (1 inicial + 5 incrementos)');
  });

  test('7. Carrera simultánea por el mismo monto: FOR UPDATE serializa y rechaza la puja rezagada sin deadlock', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        codigo_lote: `LOTE-RACE-${Date.now()}`,
        precio_base: 5000,
        incremento_minimo: 100,
        fecha_cierre: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        estado: 'ACTIVO'
      }
    });
    const raceLoteId = createRes.json().id;

    // Dos compradores compiten simultáneamente por el mismo monto de 5100 al mismo instante
    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/subastas/${raceLoteId}/pujas`,
        headers: { authorization: `Bearer ${comprador1Token}`, 'idempotency-key': `race-a-${Date.now()}` },
        payload: { monto: 5100 }
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/subastas/${raceLoteId}/pujas`,
        headers: { authorization: `Bearer ${comprador2Token}`, 'idempotency-key': `race-b-${Date.now()}` },
        payload: { monto: 5100 }
      })
    ]);

    const statusCodes = [resA.statusCode, resB.statusCode].sort();
    assert.deepStrictEqual(statusCodes, [201, 400], 'Una puja debe ser aceptada (201) y la otra rechazada (400)');

    // Verificar que solo quedó 1 puja en base de datos
    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM subasta_pujas WHERE lote_id = $1`,
      [raceLoteId]
    );
    assert.strictEqual(countRes.rows[0]!.count, '1');
  });

  test('8. Reloj tras el bloqueo: una puja enviada antes del cierre que espera FOR UPDATE y se libera después es rechazada', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        codigo_lote: `LOTE-RELOJ-${Date.now()}`,
        precio_base: 5000,
        incremento_minimo: 100,
        fecha_cierre: new Date(Date.now() + 2500).toISOString(),
        anti_sniping_seconds: 0,
        anti_sniping_extension: 0,
        estado: 'ACTIVO'
      }
    });
    assert.strictEqual(createRes.statusCode, 201, createRes.body);
    const loteId = createRes.json().id;

    // Otra conexión retiene el bloqueo de la fila hasta después del cierre.
    const bloqueo = await pool.connect();
    try {
      await bloqueo.query('BEGIN');
      await bloqueo.query('SELECT id FROM lotes_subasta WHERE id = $1 FOR UPDATE', [loteId]);

      // La puja empieza antes del cierre y queda esperando el bloqueo.
      const pujaPendiente = app.inject({
        method: 'POST',
        url: `/api/v1/subastas/${loteId}/pujas`,
        headers: { authorization: `Bearer ${comprador1Token}`, 'idempotency-key': `reloj-${Date.now()}` },
        payload: { monto: 5100 }
      });

      await new Promise((resolve) => setTimeout(resolve, 4000));
      await bloqueo.query('COMMIT');

      const res = await pujaPendiente;
      assert.strictEqual(res.statusCode, 400, `Se esperaba rechazo tras el cierre: ${res.body}`);
      assert.strictEqual(res.json().code, 'LOTE_NO_ABIERTO');
    } finally {
      await bloqueo.query('ROLLBACK').catch(() => {});
      bloqueo.release();
    }

    const countRes = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM subasta_pujas WHERE lote_id = $1',
      [loteId]
    );
    assert.strictEqual(countRes.rows[0]!.count, '0');
  });

  test('9. Lote ACTIVO con inicio futuro: el snapshot no lo muestra abierto y la puja se rechaza', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        codigo_lote: `LOTE-FUTURO-${Date.now()}`,
        precio_base: 5000,
        incremento_minimo: 100,
        fecha_inicio: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        fecha_cierre: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        estado: 'ACTIVO'
      }
    });
    assert.strictEqual(createRes.statusCode, 201, createRes.body);
    const loteId = createRes.json().id;

    const snap = await app.inject({ method: 'GET', url: `/api/v1/subastas/${loteId}/snapshot` });
    assert.strictEqual(snap.statusCode, 200);
    assert.strictEqual(snap.json().es_abierta, false);
    assert.strictEqual('iniciado' in snap.json(), false, 'El campo interno no debe filtrarse');

    const puja = await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteId}/pujas`,
      headers: { authorization: `Bearer ${comprador1Token}`, 'idempotency-key': `futuro-${Date.now()}` },
      payload: { monto: 5100 }
    });
    assert.strictEqual(puja.statusCode, 400);
    assert.strictEqual(puja.json().code, 'LOTE_NO_ABIERTO');
  });
});
