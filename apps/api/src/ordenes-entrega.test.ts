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
      `UPDATE lotes_subasta SET fecha_cierre = NOW() - INTERVAL '5 seconds' WHERE id = $1`,
      [loteId]
    );
    await closerService.cerrarLotesExpirados(100);

    const ordenRes = await pool.query<{ id: string; estado: string }>(
      `SELECT id, estado FROM ordenes_compra WHERE lote_id = $1`,
      [loteId]
    );
    assert.strictEqual(ordenRes.rows.length, 1);
    ordenPAGADAId = ordenRes.rows[0]!.id;

    // Simular que el pago fue recibido exitosamente por la pasarela
    await pool.query(
      `UPDATE ordenes_compra SET estado = 'PAGADO' WHERE id = $1`,
      [ordenPAGADAId]
    );
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  test('1. Despacho exitoso de orden PAGADO a EN_CUSTODIA por el vendedor', async () => {
    // 1.1 Rechazo sin token
    const noAuthRes = await app.inject({
      method: 'POST',
      url: `/api/v1/ordenes/${ordenPAGADAId}/despachar`
    });
    assert.strictEqual(noAuthRes.statusCode, 401);

    // 1.2 Rechazo si intenta despachar un tercero o el comprador
    const forbiddenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/ordenes/${ordenPAGADAId}/despachar`,
      headers: { authorization: `Bearer ${compradorToken}` }
    });
    assert.strictEqual(forbiddenRes.statusCode, 403);
    assert.match(forbiddenRes.json().message, /Solo el vendedor asignado/);

    // 1.3 Despacho autorizado por el vendedor
    const dispatchRes = await app.inject({
      method: 'POST',
      url: `/api/v1/ordenes/${ordenPAGADAId}/despachar`,
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        guia_remision: 'GR-001-000452',
        transportista_nombre: 'Transportes Ganaderos del Norte SAC',
        transportista_placa: 'T8A-920'
      }
    });

    assert.strictEqual(dispatchRes.statusCode, 200);
    const body = dispatchRes.json();
    assert.strictEqual(body.orden_id, ordenPAGADAId);
    assert.strictEqual(body.estado, 'EN_CUSTODIA');
    assert.ok(body.despachado_at);

    // 1.4 Verificar actualización en base de datos
    const checkDb = await pool.query<{ estado: string }>(
      `SELECT estado FROM ordenes_compra WHERE id = $1`,
      [ordenPAGADAId]
    );
    assert.strictEqual(checkDb.rows[0]?.estado, 'EN_CUSTODIA');

    // 1.5 Verificar evento en outbox_events
    const outboxCheck = await pool.query<{ event_type: string; payload: any }>(
      `SELECT event_type, payload
       FROM outbox_events
       WHERE aggregate_id = $1 AND event_type = 'ORDEN_DESPACHADA'`,
      [ordenPAGADAId]
    );
    assert.strictEqual(outboxCheck.rows.length, 1);
    assert.strictEqual(outboxCheck.rows[0]!.payload.guia_remision, 'GR-001-000452');
  });

  test('2. Rechazo HTTP 403 si un usuario que no es el comprador intenta confirmar la recepción', async () => {
    // 2.1 Intento de confirmación por el vendedor
    const vendedorConfirmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/ordenes/${ordenPAGADAId}/confirmar-recepcion`,
      headers: { authorization: `Bearer ${vendedorToken}` }
    });
    assert.strictEqual(vendedorConfirmRes.statusCode, 403);
    assert.match(vendedorConfirmRes.json().message, /Solo el comprador/);

    // 2.2 Intento de confirmación por un tercero ajeno
    const terceroConfirmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/ordenes/${ordenPAGADAId}/confirmar-recepcion`,
      headers: { authorization: `Bearer ${terceroToken}` }
    });
    assert.strictEqual(terceroConfirmRes.statusCode, 403);

    // La orden debe mantenerse intacta en EN_CUSTODIA
    const dbCheck = await pool.query<{ estado: string }>(
      `SELECT estado FROM ordenes_compra WHERE id = $1`,
      [ordenPAGADAId]
    );
    assert.strictEqual(dbCheck.rows[0]?.estado, 'EN_CUSTODIA');

    // Cero filas en liquidaciones_vendedores
    const liqCheck = await pool.query(
      `SELECT * FROM liquidaciones_vendedores WHERE orden_id = $1`,
      [ordenPAGADAId]
    );
    assert.strictEqual(liqCheck.rows.length, 0);
  });

  test('3. Confirmación de recepción: transiciona a LIQUIDADO, genera registro en liquidaciones_vendedores con cálculo neto exacto del 99% y emite Outbox', async () => {
    const confirmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/ordenes/${ordenPAGADAId}/confirmar-recepcion`,
      headers: { authorization: `Bearer ${compradorToken}` },
      payload: {
        calidad_conforme: true,
        observaciones: 'Ganado recibido en excelente estado en establo de destino.'
      }
    });

    assert.strictEqual(confirmRes.statusCode, 200);
    const body = confirmRes.json();

    assert.strictEqual(body.orden_id, ordenPAGADAId);
    assert.strictEqual(body.estado, 'LIQUIDADO');
    assert.ok(body.liquidacion);

    // Monto adjudicado = 5500
    // Comisión 1% = 55.00
    // Monto neto 99% = 5445.00
    assert.strictEqual(Number(body.liquidacion.monto_bruto), 5500.0);
    assert.strictEqual(Number(body.liquidacion.comision_retenida), 55.0);
    assert.strictEqual(Number(body.liquidacion.monto_neto_pagar), 5445.0);
    // La CCI del vendedor no se entrega al comprador (queda solo en la liquidación).
    assert.ok(!('cuenta_bancaria_cci' in body.liquidacion));
    assert.ok(!JSON.stringify(body).includes(cciPrueba));
    assert.doesNotMatch(body.mensaje, /custodia/i);
    assert.strictEqual(body.liquidacion.estado, 'PENDIENTE_DISPERSION');

    // 3.1 Verificar en base de datos la orden
    const ordenDb = await pool.query<{ estado: string }>(
      `SELECT estado FROM ordenes_compra WHERE id = $1`,
      [ordenPAGADAId]
    );
    assert.strictEqual(ordenDb.rows[0]?.estado, 'LIQUIDADO');

    // 3.2 Verificar en base de datos la liquidación al vendedor
    const liqDb = await pool.query<{
      id: string;
      orden_id: string;
      vendedor_id: string;
      organizacion_vendedora_id: string;
      monto_bruto: string | number;
      comision_retenida: string | number;
      monto_neto_pagar: string | number;
      cuenta_bancaria_cci: string;
      estado: string;
    }>(
      `SELECT * FROM liquidaciones_vendedores WHERE orden_id = $1`,
      [ordenPAGADAId]
    );
    assert.strictEqual(liqDb.rows.length, 1);
    const liq = liqDb.rows[0]!;

    assert.strictEqual(liq.vendedor_id, vendedorUserId);
    assert.strictEqual(liq.organizacion_vendedora_id, vendedorOrgId);
    assert.strictEqual(Number(liq.monto_bruto), 5500.0);
    assert.strictEqual(Number(liq.comision_retenida), 55.0);
    assert.strictEqual(Number(liq.monto_neto_pagar), 5445.0);
    assert.strictEqual(liq.cuenta_bancaria_cci.trim(), cciPrueba);
    assert.strictEqual(liq.estado, 'PENDIENTE_DISPERSION');

    // 3.3 Verificar evento ORDEN_LIQUIDADA en outbox_events
    const outboxCheck = await pool.query<{ event_type: string; payload: any }>(
      `SELECT event_type, payload
       FROM outbox_events
       WHERE aggregate_id = $1 AND event_type = 'ORDEN_LIQUIDADA'`,
      [ordenPAGADAId]
    );
    assert.strictEqual(outboxCheck.rows.length, 1);
    assert.strictEqual(outboxCheck.rows[0]!.event_type, 'ORDEN_LIQUIDADA');
    assert.strictEqual(outboxCheck.rows[0]!.payload.orden_id, ordenPAGADAId);
    assert.strictEqual(Number(outboxCheck.rows[0]!.payload.monto_neto_pagar), 5445.0);
  });

  test('4. Idempotencia: intentar confirmar recepción de una orden ya liquidada retorna HTTP 409 sin duplicar liquidaciones', async () => {
    // 4.1 Reintentar confirmación de la misma orden ya en estado LIQUIDADO
    const dupRes = await app.inject({
      method: 'POST',
      url: `/api/v1/ordenes/${ordenPAGADAId}/confirmar-recepcion`,
      headers: { authorization: `Bearer ${compradorToken}` }
    });

    assert.strictEqual(dupRes.statusCode, 409);
    assert.match(dupRes.json().message, /ya fue liquidada previamente/);

    // 4.2 Verificar que el recuento de liquidaciones para esta orden se mantiene en exactamente 1
    const liqCountRes = await pool.query<{ count: string }>(
      `SELECT count(*) FROM liquidaciones_vendedores WHERE orden_id = $1`,
      [ordenPAGADAId]
    );
    assert.strictEqual(Number(liqCountRes.rows[0]!.count), 1, 'No debe duplicar liquidaciones');

    // 4.3 Verificar que el recuento de eventos ORDEN_LIQUIDADA se mantiene en exactamente 1
    const outboxCountRes = await pool.query<{ count: string }>(
      `SELECT count(*) FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'ORDEN_LIQUIDADA'`,
      [ordenPAGADAId]
    );
    assert.strictEqual(Number(outboxCountRes.rows[0]!.count), 1, 'No debe emitir eventos Outbox duplicados');
  });
});
