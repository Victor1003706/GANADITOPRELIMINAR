import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { Redis } from 'ioredis';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import { SubastasCloserService } from './subastas/subastas-closer.service.js';
import { proyectarEventoPublico } from './outbox/eventos-publicos.js';
import { getRedisConfig } from './redis.js';

describe('N04: cierre con organización correcta, consulta de órdenes y WebSocket autenticado', { concurrency: 1 }, () => {
  const pool = getPool();
  const cfg = getRedisConfig();
  const redisSubscriber = cfg.url ? new Redis(cfg.url) : new Redis({ host: cfg.host, port: cfg.port, password: cfg.password });
  const app = buildApp({ pool, redisSubscriber });
  const authService = new AuthService(pool);
  const closer = new SubastasCloserService(pool);
  const password = 'PasswordCierre2026!';
  let baseWs: string;

  type Actor = { email: string; userId: string; orgId: string; token: string };
  let vendedor: Actor;
  let comprador: Actor;
  let orgB: string;
  let ordenId: string;
  let loteId: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  async function registrar(rol: 'COMPRADOR' | 'VENDEDOR', prefijo: string): Promise<Actor> {
    const s = crypto.randomUUID().slice(0, 8);
    const email = `${prefijo}_${s}@test.com`;
    const reg = await authService.register({ email, password, nombre: `${prefijo} ${s}`, organizacion_nombre: `${prefijo} ${s}`, rol_inicial: rol });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    return { email, userId: reg.user.id, orgId: reg.activeContext.organizacion_id, token: login.json().access_token };
  }

  async function switchTo(actor: Actor, orgId: string, rol: string) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/organizations/switch-context',
      headers: auth(actor.token),
      payload: { organizacion_id: orgId, rol }
    });
    assert.strictEqual(r.statusCode, 200);
    actor.token = r.json().access_token;
  }

  function wsCloseCode(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error('timeout esperando cierre')), 5000);
      ws.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      ws.on('error', () => {});
    });
  }

  before(async () => {
    await runInitialMigration();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseWs = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

    vendedor = await registrar('VENDEDOR', 'n04_vend');
    comprador = await registrar('COMPRADOR', 'n04_comp');
    // El comprador también es COMPRADOR en una segunda organización.
    const otra = await registrar('COMPRADOR', 'n04_orgb');
    orgB = otra.orgId;
    await authService.addMembership(comprador.userId, orgB, 'COMPRADOR', false);
  });

  after(async () => {
    await app.close();
    redisSubscriber.disconnect();
    await closePool();
  });

  test('1. La orden se asigna a la organización activa al pujar, aunque el comprador cambie de contexto antes del cierre', async () => {
    const lote = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: auth(vendedor.token),
      payload: { precio_base: 2000, incremento_minimo: 100, fecha_cierre: new Date(Date.now() + 600000).toISOString() }
    });
    loteId = lote.json().id;

    const puja = await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteId}/pujas`,
      headers: { ...auth(comprador.token), 'idempotency-key': `n04-${crypto.randomUUID()}` },
      payload: { monto: 2100 }
    });
    assert