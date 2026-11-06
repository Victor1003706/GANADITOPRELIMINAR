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
    });
    assert.strictEqual(pujaRes.statusCode, 201);

    // 1.3 Forzar en base de datos la expiración de fecha_cierre (hace 10 segundos)
    await pool.query(
      `UPDATE lotes_subasta SET fecha_cierre = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
      [loteId]
    );

    // 1.4 Ejecutar el servicio de cierre
    const res = await closerService.cerrarLotesExpirados();
    assert.ok(res.adjudicados >= 1, 'Debe haberse adjudicado al menos 1 lote');

    // 1.5 Verificar que el lote esté en estado 'ADJUDICADO'
    const loteCheck = await pool.query<{ estado: string }>(
      `SELECT estado FROM lotes_subasta WHERE id = $1`,
      [loteId]
    );
    assert.strictEqual(loteCheck.rows[0]?.estado, 'ADJUDICADO');

    // 1.6 Verificar generación estricta de ordenes_compra
    const ordenRes = await pool.query<{
      id: string;
      lote_id: string;
      comprador_id: string;
      organizacion_compradora_id: string;
      vendedor_id: string;
      organizacion_vendedora_id: string;
      monto_adjudicado: string | number;
      comision_plataforma: string | number;
      total_a_pagar: string | number;
      estado: string;
    }>(
      `SELECT * FROM ordenes_compra WHERE lote_id = $1`,
      [loteId]
    );

    assert.strictEqual(ordenRes.rows.length, 1, 'Debe existir exactamente 1 orden de compra');
    const orden = ordenRes.rows[0]!;

    assert.strictEqual(orden.comprador_id, comprador1UserId);
    assert.strictEqual(orden.organizacion_compradora_id, comprador1OrgId);
    assert.strictEqual(orden.organizacion_vendedora_id, vendedorOrgId);
    assert.strictEqual(Number(orden.monto_adjudicado), 3500.0);
    // Comisión del 1%: 35.00
    assert.strictEqual(Number(orden.comision_plataforma), 35.0);
    // Total a pagar: 3535.00
    assert.strictEqual(Number(orden.total_a_pagar), 3535.0);
    assert.strictEqual(orden.estado, 'PENDIENTE_PAGO');

    // 1.7 Verificar evento en outbox_events
    const outboxRes = await pool.query<{ event_type: string; payload: any }>(
      `SELECT event_type, payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'SUBASTA_ADJUDICADA'`,
      [loteId]
    );
    assert.strictEqual(outboxRes.rows.length, 1);
    assert.strictEqual(outboxRes.rows[0]!.event_type, 'SUBASTA_ADJUDICADA');
    assert.strictEqual(outboxRes.rows[0]!.payload.orden_id, orden.id);
  });

  test('2. Lote sin pujas expirado pasa a DESIERTO sin generar ordenes_compra', async () => {
    // 2.1 Crear lote de subasta sin pujas
    const fechaCierreFutura = new Date(Date.now() + 600000).toISOString();
    const loteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        titulo: 'Lote Vacas Gyr Desierto Test',
        precio_base: 4000,
        incremento_minimo: 150,
        fecha_cierre: fechaCierreFutura
      }
    });
    assert.strictEqual(loteRes.statusCode, 201);
    const loteId = loteRes.json().id;

    // 2.2 Forzar expiración sin emitir ninguna oferta
    await pool.query(
      `UPDATE lotes_subasta SET fecha_cierre = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
      [loteId]
    );

    // 2.3 Ejecutar el servicio de cierre
    const res = await closerService.cerrarLotesExpirados();
    assert.ok(res.desiertos >= 1, 'Debe haberse declarado desierto al menos 1 lote');

    // 2.4 Verificar que el lote esté en estado 'DESIERTO'
    const loteCheck = await pool.query<{ estado: string }>(
      `SELECT estado FROM lotes_subasta WHERE id = $1`,
      [loteId]
    );
    assert.strictEqual(loteCheck.rows[0]?.estado, 'DESIERTO');

    // 2.5 Verificar que NO se haya generado orden de compra
    const ordenRes = await pool.query(
      `SELECT * FROM ordenes_compra WHERE lote_id = $1`,
      [loteId]
    );
    assert.strictEqual(ordenRes.rows.length, 0, 'No debe existir orden de compra para un lote desierto');

    // 2.6 Verificar evento SUBASTA_DESIERTA en outbox_events
    const outboxRes = await pool.query<{ event_type: string; payload: any }>(
      `SELECT event_type, payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'SUBASTA_DESIERTA'`,
      [loteId]
    );
    assert.strictEqual(outboxRes.rows.length, 1);
    assert.strictEqual(outboxRes.rows[0]!.payload.motivo, 'SIN_OFERTAS');
  });

  test('3. Lotes activos vigentes (fecha_cierre > NOW) no son afectados por el closer', async () => {
    // 3.1 Crear lote con fecha de cierre a 1 hora en el futuro
    const fechaFutura = new Date(Date.now() + 3600000).toISOString();
    const loteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        titulo: 'Lote Vigente no debe cerrarse',
        precio_base: 5000,
        incremento_minimo: 200,
        fecha_cierre: fechaFutura
      }
    });
    assert.strictEqual(loteRes.statusCode, 201);
    const loteId = loteRes.json().id;

    // 3.2 Emitir una puja válida
    await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteId}/pujas`,
      headers: {
        authorization: `Bearer ${comprador2Token}`,
        'idempotency-key': `bid-vigente-${Date.now()}`
      },
      payload: { monto: 5200 }
    });

    // 3.3 Ejecutar el closer
    await closerService.cerrarLotesExpirados();

    // 3.4 Verificar que el lote continúa intacto en estado 'ACTIVO'
    const checkRes = await pool.query<{ estado: string }>(
      `SELECT estado FROM lotes_subasta WHERE id = $1`,
      [loteId]
    );
    assert.strictEqual(checkRes.rows[0]?.estado, 'ACTIVO');

    // 3.5 No debe existir orden de compra prematura
    const ordenRes = await pool.query(
      `SELECT * FROM ordenes_compra WHERE lote_id = $1`,
      [loteId]
    );
    assert.strictEqual(ordenRes.rows.length, 0);
  });

  test('4. Concurrencia: dos ejecuciones simultáneas con FOR UPDATE SKIP LOCKED no duplican órdenes', async () => {
    // 4.1 Crear 3 lotes y pujar en cada uno
    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const loteRes = await app.inject({
        method: 'POST',
        url: '/api/v1/subastas',
        headers: { authorization: `Bearer ${vendedorToken}` },
        payload: {
          titulo: `Lote Concurrente ${i} - ${Date.now()}`,
          precio_base: 1000 * i,
          incremento_minimo: 50,
          fecha_cierre: new Date(Date.now() + 600000).toISOString()
        }
      });
      const id = loteRes.json().id;
      ids.push(id);

      await app.inject({
        method: 'POST',
        url: `/api/v1/subastas/${id}/pujas`,
        headers: {
          authorization: `Bearer ${comprador1Token}`,
          'idempotency-key': `bid-concurrent-${i}-${Date.now()}`
        },
        payload: { monto: 1000 * i + 100 }
      });
    }

    // 4.2 Forzar expiración de los 3 lotes
    await pool.query(
      `UPDATE lotes_subasta SET fecha_cierre = NOW() - INTERVAL '10 seconds' WHERE id = ANY($1)`,
      [ids]
    );

    // 4.3 Ejecutar dos cierres en paralelo estricto con Promise.all
    const [cierreA, cierreB] = await Promise.all([
      closerService.cerrarLotesExpirados(50),
      closerService.cerrarLotesExpirados(50)
    ]);

    // Filtrar los adjudicados correspondientes a los 3 lotes creados en esta prueba
    const adjudicadosTest = [...cierreA.detalles, ...cierreB.detalles].filter(
      d => ids.includes(d.loteId) && d.estadoFinal === 'ADJUDICADO'
    );

    assert.strictEqual(
      adjudicadosTest.length,
      3,
      `Exactamente los 3 lotes de la prueba deben ser adjudicados entre ambas ejecuciones concurrentes (obtenido: ${adjudicadosTest.length})`
    );

    // 4.4 Verificar en base de datos que existan exactamente 3 órdenes de compra (1 por lote)
    const ordenesRes = await pool.query<{ count: string }>(
      `SELECT count(*) FROM ordenes_compra WHERE lote_id = ANY($1)`,
      [ids]
    );
    assert.strictEqual(
      Number(ordenesRes.rows[0]!.count),
      3,
      'No deben existir órdenes duplicadas bajo concurrencia extrema'
    );
  });

  test('5. Endpoint administrativo POST /api/v1/subastas/cerrar-expiradas (Protección y Ejecución)', async () => {
    // 5.1 Rechazo HTTP 401 si se invoca sin token
    const noAuthRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas/cerrar-expiradas'
    });
    assert.strictEqual(noAuthRes.statusCode, 401);

    // 5.2 Un rol no administrativo recibe 403
    const vendRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas/cerrar-expiradas',
      headers: { authorization: `Bearer ${vendedorToken}` }
    });
    assert.strictEqual(vendRes.statusCode, 403);

    // 5.3 Invocación autorizada con rol ADMIN
    const admin = await crearUsuarioConRol(app, authService, 'ADMIN', 'closer');
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas/cerrar-expiradas',
      headers: { authorization: `Bearer ${admin.token}` }
    });
    assert.strictEqual(authRes.statusCode, 200);
    const body = authRes.json();
    assert.ok(typeof body.totalEvaluados === 'number');
    assert.ok(typeof body.adjudicados === 'number');
    assert.ok(typeof body.desiertos === 'number');
    assert.ok(typeof body.ordenesGeneradas === 'number');
  });

  test('6. Worker de fondo SubastasCloserWorker (ciclo, tick y detención ordenada)', async () => {
    const worker = new SubastasCloserWorker({
      pool,
      intervalMs: 100, // Ciclo ultra rápido para pruebas
      batchSize: 10
    });

    assert.strictEqual(worker.isRunning, false);
    const tickResult = await worker.tick();
    assert.ok(typeof tickResult.totalEvaluados === 'number');

    worker.start();
    assert.strictEqual(worker.isRunning, true);

    await new Promise((resolve) => setTimeout(resolve, 250));

    await worker.stop();
    assert.strictEqual(worker.isRunning, false);
  });
});
