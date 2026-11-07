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
    const 