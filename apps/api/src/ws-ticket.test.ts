import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { getPool, closePool, runInitialMigration } from './db.js';
import { getRedisSubscriber, closeRedis } from './redis.js';
import { SubastaWsHub } from './subastas/subastas.ws.js';
import { MAX_TICKETS_VIGENTES_POR_USUARIO, consumirTicketWs, permiteAccessTokenEnUrl, supervisarSesionWs } from './subastas/ws-tickets.js';
import { EventEmitter } from 'node:events';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';

describe('Ticket efímero de un solo uso para el WebSocket de subastas', { concurrency: 1 }, () => {
  const pool = getPool();
  const redisSubscriber = getRedisSubscriber();
  const wsHub = new SubastaWsHub(redisSubscriber);
  // Revalidación y vida máxima cortas para poder probar revocación y expiración.
  const app = buildApp({ pool, redisSubscriber, wsHub, wsRevalidacionMs: 100, wsDuracionMaxSesionMs: 2000 });
  const authService = new AuthService(pool);
  let base: string;
  let token: string;
  let userId: string;
  let orgId: string;
  let loteId: string;
  let otroLoteId: string;
  const lotes: string[] = [];

  async function crearLote(t: string) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${t}` },
      payload: {
        codigo_lote: `WS-${crypto.randomUUID().slice(0, 12)}`,
        precio_base: 1000,
        incremento_minimo: 50,
        fecha_cierre: new Date(Date.now() + 3600_000).toISOString()
      }
    });
    assert.equal(r.statusCode, 201, r.body);
    lotes.push(r.json().id);
    return r.json().id as string;
  }

  async function pedirTicket(lote: string, t = token) {
    return app.inject({ method: 'POST', url: `/api/v1/subastas/${lote}/live/ticket`, headers: { authorization: `Bearer ${t}` } });
  }

  /** Abre el socket y devuelve 'SUSCRITO' o el motivo del cierre 1008. */
  async function conectar(lote: string, query: string): Promise<string> {
    const ws = new WebSocket(`${base}/api/v1/subastas/${lote}/live?${query}`);
    const resultado = await new Promise<string>((resolve, reject) => {
      ws.once('close', (codigo, motivo) => resolve(`${codigo}:${motivo.toString()}`));
      ws.once('error', reject);
      ws.once('open', async () => {
        for (let i = 0; i < 50; i++) {
          if (wsHub.getActiveSubscribersCount(lote) > 0) return resolve('SUSCRITO');
          await new Promise((r) => setTimeout(r, 20));
        }
      });
    });
    ws.close();
    for (let i = 0; i < 50 && wsHub.getActiveSubscribersCount(lote) > 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return resultado;
  }

  before(async () => {
    await runInitialMigration();
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `ws://127.0.0.1:${(app.server.address() as any).port}`;
    const email = `ws_ticket_${crypto.randomUUID().slice(0, 8)}@test.com`;
    const reg = await authService.register({ email, password: 'PasswordWs2026!', nombre: 'WS', organizacion_nombre: 'Org WS', rol_inicial: 'VENDEDOR' });
    userId = reg.user.id;
    orgId = reg.activeContext.organizacion_id;
    token = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'PasswordWs2026!' } })).json().access_token;
    loteId = await crearLote(token);
    otroLoteId = await crearLote(token);
  });

  after(async () => {
    await pool.query('DELETE FROM lotes_subasta WHERE id = ANY($1::uuid[])', [lotes]);
    await app.close();
    await wsHub.close();
    await closeRedis();
    await closePool();
  });

  test('1. Con sesión se emite un ticket opaco de 30 s, sin caché, y solo se guarda su hash', async () => {
    const r = await pedirTicket(loteId);
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.headers['cache-control'], 'no-store');
    const { ticket, expira