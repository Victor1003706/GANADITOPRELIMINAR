import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import { SubastasCloserService } from './subastas/subastas-closer.service.js';
import { generateHmacSignature, resolvePagosConfig } from './pagos/pagos.service.js';

const WEBHOOK_SECRET_TEST = 'test_only_webhook_secret_0123456789abcdef';
const CHECKOUT_BASE_URL_TEST = 'http://localhost:4010/simulador';

describe('Módulo de Pagos: flag, webhooks HMAC y validación de estado/monto/moneda', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({
    pool,
    pagos: {
      enabled: true,
      webhookSecret: WEBHOOK_SECRET_TEST,
      checkoutBaseUrl: CHECKOUT_BASE_URL_TEST,
      provider: 'SIMULADOR'
    }
  });
  const authService = new AuthService(pool);
  const closerService = new SubastasCloserService(pool);
  const password = 'PasswordPagos2026!';

  let vendedorToken: string;
  let compradorToken: string;
  let otroCompradorToken: string;

  const montoOrden = 4545.0; // 4500 adjudicado + 45 comisión (1%)

  async function login(email: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password }
    });
    return res.json().access_token;
  }

  /** Crea lote → puja ganadora 4500 → cierre, y devuelve la orden en PENDIENTE_PAGO. */
  async function crearOrdenPendiente(): Promise<string> {
    const loteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        codigo_lote: `PAG-${crypto.randomUUID().slice(0, 12)}`,
        precio_base: 4000,
        incremento_minimo: 100,
        fecha_cierre: new Date(Date.now() + 600000).toISOString()
      }
    });
    assert.strictEqual(loteRes.statusCode, 201);
    const loteId = loteRes.json().id;

    const pujaRes = await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteId}/pujas`,
      headers: {
        authorization: `Bearer ${compradorToken}`,
        'idempotency-key': `bid-pay-${crypto.randomUUID()}`
      },
      payload: { monto: 4500 }
    });
    assert.strictEqual(pujaRes.statusCode, 201);

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
    assert.strictEqual(ordenRes.rows[0]!.estado, 'PENDIENTE_PAGO');
    return ordenRes.rows[0]!.id;
  }

  async function checkout(ordenId: string, token = compradorToken) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/pagos/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { orden_id: ordenId, proveedor: 'NIUBIZ' }
    });
  }

  async function enviarWebhook(
    body: Record<string, unknown>,
    opts: { timestamp?: number; signature?: string; omitTimestampHeader?: boolean } = {}
  ) {
    const ts = opts.timestamp ?? Date.now();
    const rawBody = JSON.stringify(body);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-signature': opts.signature ?? generateHmacSignature(rawBody, WEBHOOK_SECRET_TEST, ts)
    };
    if (!opts.omitTimestampHeader) headers['x-timestamp'] = String(ts);
    return app.inject({ method: 'POST', url: '/api/v1/pagos/webhook', headers, payload: rawBody });
  }

  async function estadoDe(ordenId: string, txId: string) {
    const o = await pool.query<{ estado: string }>(`SELECT estado FROM ordenes_compra WHERE id = $1`, [ordenId]);
    const t = await pool.query<{ estado: string }>(`SELECT estado FROM pagos_transacciones WHERE id = $1`, [txId]);
    const e = await pool.query<{ count: string }>(
      `SELECT count(*) FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'ORDEN_PAGADA'`,
      [ordenId]
    );
    return { orden: o.rows[0]!.estado, tx: t.rows[0]!.estado, eventosPagada: Number(e.rows[0]!.count) };
  }

  before(async () => {
    await runInitialMigration();
    await app.ready();

    const sufijo = crypto.randomUUID().slice(0, 8);
    const v = await authService.register({
      email: `vendedor_pagos_${sufijo}@test.com`,
      password,
      nombre: 'Ganadería La Pradera SAC',
      organizacion_nombre: `La Pradera SAC ${sufijo}`,
      rol_inicial: 'VENDEDOR'
    });
    const c = await authService.register({
      email: `comprador_pagos_${sufijo}@test.com`,
      password,
      nombre: 'Distribuidora San Jorge EIRL',
      organizacion_nombre: `San Jorge EIRL ${sufijo}`,
      rol_inicial: 'COMPRADOR'
    });
    const otro = await authService.register({
      email: `otro_comprador_pagos_${sufijo}@test.com`,
      password,
      nombre: 'Tercero Ajeno SAC',
      organizacion_nombre: `Tercero Ajeno ${sufijo}`,
      rol_inicial: 'COMPRADOR'
    });

    vendedorToken = await login(v.user.email);
    compradorToken = await login(c.user.email);
    otroCompradorToken = await login(otro.user.email);
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  test('0. Por defecto el módulo está deshabilitado: checkout y webhook responden 503', async () => {
    const appOff = buildApp({ pool, pagos: { enabled: false } });
    await appOff.ready();
    try {
      const c = await appOff.inject({ method: 'POST', url: '/api/v1/pagos/checkout', payload: { orden_id: 'x' } });
      const w = await appOff.inject({ method: 'POST', url: '/api/v1/pagos/webhook', payload: {} });
      assert.strictEqual(c.statusCode, 503);
      assert.strictEqual(w.statusCode, 503);
      assert.strictEqual(w.json().error, 'PagosDeshabilitados');
    } finally {
      await appOff.close();
    }
  });

  test('0b. Habilitar pagos sin WEBHOOK_SECRET suficiente o sin URL de checkout falla al arrancar', async () => {
    assert.throws(() => resolvePagosConfig({ enabled: true, webhookSecret: '', checkoutBaseUrl: CHECKOUT_BASE_URL_TEST }), /WEBHOOK_SECRET/);
    assert.throws(() => resolvePagosConfig({ enabled: true, webhookSecret: 'corto', checkoutBaseUrl: CHECKOUT_BASE_URL_TEST }), /WEBHOOK_SECRET/);
    assert.throws(() => resolvePagosConfig({ enabled: true, webhookSecret: WEBHOOK_SECRET_TEST, checkoutBaseUrl: '' }), /PAYMENTS_CHECKOUT_BASE_URL/);

    const appMal = buildApp({ pool, pagos: { enabled: true, webhookSecret: '', checkoutBaseUrl: CHECKOUT_BASE_URL_TEST } });
    await assert.rejects(async () => {
      await appMal.ready();
    }, /WEBHOOK_SECRET/);
    await appMal.close().catch(() => {});
  });

  test('1. Checkout: 401 sin sesión, 403 a terceros, 201 al comprador con proveedor fijado por el servidor y reutilización de la transacción viva', async () => {
    const ordenId = await crearOrdenPendiente();

    const unauth = await app.inject({ method: 'POST', url: '/api/v1/pagos/checkout', payload: { orden_id: ordenId } });
    assert.strictEqual(unauth.statusCode, 401);

    const ajeno = await checkout(ordenId, otroCompradorToken);
    assert.strictEqual(ajeno.statusCode, 403);

    const res = await checkout(ordenId);
    assert.strictEqual(res.statusCode, 201);
    const body = res.json();
    assert.strictEqual(body.estado, 'INICIADO');
    assert.strictEqual(body.proveedor, 'SIMULADOR', 'El cliente no elige el proveedor');
    assert.strictEqual(Number(body.monto), montoOrden);
    assert.ok(body.checkout_url.startsWith(`${CHECKOUT_BASE_URL_TEST}/pay/${body.transaccion_id}`));

    const repetido = await checkout(ordenId);
    assert.strictEqual(repetido.statusCode, 201);
    assert.strictEqual(repetido.json().transaccion_id, body.transaccion_id, 'Debe reutilizar la transacción INICIADO');

    const count = await pool.query<{ count: string }>(
      `SELECT count(*) FROM pagos_transacciones WHERE orden_id = $1`,
      [ordenId]
    );
    assert.strictEqual(Number(count.rows[0]!.count), 1);
  });

  test('2. Webhook: 401 sin firma, con firma falsa, con firma sólo del body, sin x-timestamp o con timestamp ajeno a la firma', async () => {
    const ordenId = await crearOrdenPendiente();
    const tx = (await checkout(ordenId)).json();
    const payload = {
      evento: 'pago.confirmado',
      referencia_externa: tx.referencia_externa,
      transaccion_id: tx.transaccion_id,
      monto: montoOrden,
      moneda: 'PEN',
      estado: 'CONFIRMADO',
      timestamp: Date.now()
    };
    const rawBody = JSON.stringify(payload);

    const sinFirma = await app.inject({
      method: 'POST',
      url: '/api/v1/pagos/webhook',
      headers: { 'content-type': 'application/json', 'x-timestamp': String(Date.now()) },
      payload: rawBody
    });
    assert.strictEqual(sinFirma.statusCode, 401);
    assert.match(sinFirma.json().message, /Firma HMAC requerida/);

    const falsa = await enviarWebhook(payload, { signature: '0123456789abcdef'.repeat(4) });
    assert.strictEqual(falsa.statusCode, 401);
    assert.match(falsa.json().message, /Firma HMAC inválida/);

    // Firma HMAC sólo del body (sin timestamp): antes se aceptaba y permitía replay.
    const soloBody = crypto.createHmac('sha256', WEBHOOK_SECRET_TEST).update(rawBody).digest('hex');
    const replayBody = await enviarWebhook(payload, { signature: soloBody });
    assert.strictEqual(replayBody.statusCode, 401);

    // Timestamp sólo en el body, sin cabecera.
    const sinCabecera = await enviarWebhook(payload, { omitTimestampHeader: true });
    assert.strictEqual(sinCabecera.statusCode, 401);
    assert.match(sinCabecera.json().message, /x-timestamp/);

    // Firma calculada con un timestamp antiguo, reenviada con un x-timestamp nuevo.
    const tsViejo = Date.now() - 60_000;
    const firmaVieja = generateHmacSignature(rawBody, WEBHOOK_SECRET_TEST, tsViejo);
    const reenviado = await enviarWebhook(payload, { signature: firmaVieja, timestamp: Date.now() });
    assert.strictEqual(reenviado.statusCode, 401);

    const despues = await estadoDe(ordenId, tx.transaccion_id);
    assert.deepStrictEqual(despues, { orden: 'PENDIENTE_PAGO', tx: 'INICIADO', eventosPagada: 0 });
  });

  test('3. Webhook: 401 si el timestamp está fuera de la ventana anti-replay (> 5 minutos)', async () => {
    const ordenId = await crearOrdenPendiente();
    const tx = (await checkout(ordenId)).json();
    const res = await enviarWebhook(
      { referencia_externa: tx.referencia_externa, monto: montoOrden, moneda: 'PEN', estado: 'CONFIRMADO' },
      { timestamp: Date.now() - 10 * 60 * 1000 }
    );
    assert.strictEqual(res.statusCode, 401);
    assert.match(res.json().message, /Timestamp expirado/);
  });

  test('4. Webhook de fallo: transacción FALLIDO, orden sigue PENDIENTE_PAGO; reenvío idempotente; éxito posterior → 409 sin cambios', async () => {
    const ordenId = await crearOrdenPendiente();
    const tx = (await checkout(ordenId)).json();
    const base = { referencia_externa: tx.referencia_externa, transaccion_id: tx.transaccion_id, monto: montoOrden, moneda: 'PEN' };

    const fallo = await enviarWebhook({ ...base, estado: 'FAILED' });
    assert.strictEqual(fallo.statusCode, 200);
    assert.strictEqual(fallo.json().estado, 'FALLIDO');
    assert.strictEqual(fallo.json().motivo, 'PAGO_FALLIDO');

    const falloDup = await enviarWebhook({ ...base, estado: 'FALLIDO' });
    assert.strictEqual(falloDup.statusCode, 200);
    assert.strictEqual(falloDup.json().idempotente, true);

    const exitoTardio = await enviarWebhook({ ...base, estado: 'CONFIRMADO' });
    assert.strictEqual(exitoTardio.statusCode, 409);

    assert.deepStrictEqual(await estadoDe(ordenId, tx.transaccion_id), {
      orden: 'PENDIENTE_PAGO',
      tx: 'FALLIDO',
      eventosPagada: 0
    });
  });

  test('5. Webhook de éxito con importe incorrecto: EN_CONCILIACION, la orden no se confirma', async () => {
    const ordenId = await crearOrdenPendiente();
    const tx = (await checkout(ordenId)).json();

    const res = await enviarWebhook({
      referencia_externa: tx.referencia_externa,
      monto: montoOrden - 0.01,
      moneda: 'PEN',
      estado: 'SUCCEEDED'
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json().estado, 'EN_CONCILIACION');
    assert.strictEqual(res.json().motivo, 'MONTO_NO_COINCIDE');

    assert.deepStrictEqual(await estadoDe(ordenId, tx.transaccion_id), {
      orden: 'PENDIENTE_PAGO',
      tx: 'EN_CONCILIACION',
      eventosPagada: 0
    });
  });

  test('6. Webhook de éxito con moneda incorrecta o ausente: EN_CONCILIACION, la orden no se confirma', async () => {
    for (const moneda of ['USD', undefined]) {
      const ordenId = await crearOrdenPendiente();
      const tx = (await checkout(ordenId)).json();

      const res = await enviarWebhook({
        referencia_externa: tx.referencia_externa,
        monto: montoOrden,
        ...(moneda ? { moneda } : {}),
        estado: 'PAID'
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json().motivo, 'MONEDA_NO_COINCIDE');
      assert.deepStrictEqual(await estadoDe(ordenId, tx.transaccion_id), {
        orden: 'PENDIENTE_PAGO',
        tx: 'EN_CONCILIACION',
        eventosPagada: 0
      });
    }
  });

  test('7. Webhook de éxito sobre una orden CANCELADO: EN_CONCILIACION y la orden sigue CANCELADO', async () => {
    const ordenId = await crearOrdenPendiente();
    const tx = (await checkout(ordenId)).json();
    await pool.query(`UPDATE ordenes_compra SET estado = 'CANCELADO' WHERE id = $1`, [ordenId]);

    const res = await enviarWebhook({
      referencia_externa: tx.referencia_externa,
      monto: montoOrden,
      moneda: 'PEN',
      estado: 'CONFIRMADO'
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json().motivo, 'ORDEN_NO_PAGABLE');
    assert.deepStrictEqual(await estadoDe(ordenId, tx.transaccion_id), {
      orden: 'CANCELADO',
      tx: 'EN_CONCILIACION',
      eventosPagada: 0
    });
  });

  test('8. Webhook con estado desconocido o con identificadores de transacciones distintas no modifica nada', async () => {
    const ordenId = await crearOrdenPendiente();
    const tx = (await checkout(ordenId)).json();

    const desconocido = await enviarWebhook({
      referencia_externa: tx.referencia_externa,
      monto: montoOrden,
      moneda: 'PEN',
      estado: 'PENDING'
    });
    assert.strictEqual(desconocido.statusCode, 422);

    const cruzado = await enviarWebhook({
      referencia_externa: tx.referencia_externa,
      transaccion_id: crypto.randomUUID(),
      monto: montoOrden,
      moneda: 'PEN',
      estado: 'CONFIRMADO'
    });
    assert.strictEqual(cruzado.statusCode, 404);

    assert.deepStrictEqual(await estadoDe(ordenId, tx.transaccion_id), {
      orden: 'PENDIENTE_PAGO',
      tx: 'INICIADO',
      eventosPagada: 0
    });
  });

  test('9. Éxito válido confirma una sola vez: CONFIRMADO, PAGADO y un único ORDEN_PAGADA aun con webhooks simultáneos; un fallo posterior → 409', async () => {
    const ordenId = await crearOrdenPendiente();
    const tx = (await checkout(ordenId)).json();
    const body = {
      evento: 'pago.confirmado',
      referencia_externa: tx.referencia_externa,
      transaccion_id: tx.transaccion_id,
      monto: montoOrden,
      moneda: 'PEN',
      estado: 'CONFIRMADO'
    };

    const respuestas = await Promise.all([enviarWebhook(body), enviarWebhook(body), enviarWebhook(body)]);
    for (const r of respuestas) {
      assert.strictEqual(r.statusCode, 200);
      assert.strictEqual(r.json().estado, 'CONFIRMADO');
    }
    assert.strictEqual(
      respuestas.filter((r) => r.json().idempotente === false).length,
      1,
      'Exactamente un webhook aplica la confirmación'
    );

    const outbox = await pool.query<{ payload: any }>(
      `SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'ORDEN_PAGADA'`,
      [ordenId]
    );
    assert.strictEqual(outbox.rows.length, 1);
    assert.strictEqual(outbox.rows[0]!.payload.transaccion_id, tx.transaccion_id);
    assert.strictEqual(Number(outbox.rows[0]!.payload.monto), montoOrden);

    const falloTardio = await enviarWebhook({ ...body, estado: 'FAILED' });
    assert.strictEqual(falloTardio.statusCode, 409);

    assert.deepStrictEqual(await estadoDe(ordenId, tx.transaccion_id), {
      orden: 'PAGADO',
      tx: 'CONFIRMADO',
      eventosPagada: 1
    });

    const nuevoCheckout = await checkout(ordenId);
    assert.strictEqual(nuevoCheckout.statusCode, 409, 'Una orden pagada no admite otro checkout');
  });
});
