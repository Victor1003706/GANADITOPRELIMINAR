import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';

describe('N03: idempotencia de pujas, reglas de publicación y organización postora', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);
  const password = 'PasswordPujas2026!';

  type Actor = { email: string; userId: string; orgId: string; token: string };
  let vendedor: Actor;
  let comprador: Actor;

  async function login(email: string) {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    return r.json().access_token as string;
  }

  async function registrar(rol: 'COMPRADOR' | 'VENDEDOR', prefijo: string): Promise<Actor> {
    const s = crypto.randomUUID().slice(0, 8);
    const email = `${prefijo}_${s}@test.com`;
    const reg = await authService.register({ email, password, nombre: `${prefijo} ${s}`, organizacion_nombre: `${prefijo} ${s}`, rol_inicial: rol });
    return { email, userId: reg.user.id, orgId: reg.activeContext.organizacion_id, token: await login(email) };
  }

  async function switchTo(actor: Actor, orgId: string, rol: string) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/organizations/switch-context',
      headers: { authorization: `Bearer ${actor.token}` },
      payload: { organizacion_id: orgId, rol }
    });
    assert.strictEqual(r.statusCode, 200);
    actor.token = r.json().access_token;
  }

  async function crearLote(payload: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${vendedor.token}` },
      payload: { precio_base: 1000, incremento_minimo: 50, fecha_cierre: new Date(Date.now() + 600000).toISOString(), ...payload }
    });
  }

  async function pujar(actor: Actor, loteId: string, monto: number, key: string) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteId}/pujas`,
      headers: { authorization: `Bearer ${actor.token}`, 'idempotency-key': key },
      payload: { monto }
    });
  }

  before(async () => {
    await runInitialMigration();
    await app.ready();
    vendedor = await registrar('VENDEDOR', 'n03_vend');
    comprador = await registrar('COMPRADOR', 'n03_comp');
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  test('1. Reusar la clave con otro monto u otro lote → 422 IDEMPOTENCY_KEY_REUSED; reintento idéntico → misma respuesta', async () => {
    const loteA = (await crearLote()).json().id;
    const loteB = (await crearLote()).json().id;
    const key = `k-${crypto.randomUUID()}`;

    const primera = await pujar(comprador, loteA, 1100, key);
    assert.strictEqual(primera.statusCode, 201);

    const otroMonto = await pujar(comprador, loteA, 1200, key);
    assert.strictEqual(otroMonto.statusCode, 422);
    assert.strictEqual(otroMonto.json().code, 'IDEMPOTENCY_KEY_REUSED');

    const otroLote = await pujar(comprador, loteB, 1100, key);
    assert.strictEqual(otroLote.statusCode, 422);

    const reintento = await pujar(comprador, loteA, 1100, key);
    assert.strictEqual(reintento.statusCode, 201);
    assert.strictEqual(reintento.json().puja_id, primera.json().puja_id);

    const snap = (await app.inject({ method: 'GET', url: `/api/v1/subastas/${loteA}/snapshot` })).json();
    assert.strictEqual(snap.precio_actual, 1100, 'El monto distinto no se aplicó');
    const lb = (await app.inject({ method: 'GET', url: `/api/v1/subastas/${loteB}/snapshot` })).json();
    assert.strictEqual(lb.secuencia_maxima, 0, 'El otro lote no recibió pujas');
  });

  test('1b. La misma clave tras cambiar de organización activa → 409 IDEMPOTENCY_K