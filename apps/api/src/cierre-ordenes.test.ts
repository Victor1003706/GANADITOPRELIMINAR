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
    assert.strictEqual(puja.statusCode, 201);

    // Cambia a la organización B ANTES del cierre.
    await switchTo(comprador, orgB, 'COMPRADOR');

    await pool.query(`UPDATE lotes_subasta SET fecha_cierre = NOW() - INTERVAL '1 second' WHERE id = $1`, [loteId]);
    await closer.cerrarLotesExpirados(100);
    await closer.cerrarLotesExpirados(100); // reintento: no debe duplicar

    const ordenes = await pool.query<{ id: string; organizacion_compradora_id: string; vendedor_id: string; estado: string }>(
      'SELECT id, organizacion_compradora_id, vendedor_id, estado FROM ordenes_compra WHERE lote_id = $1',
      [loteId]
    );
    assert.strictEqual(ordenes.rows.length, 1, 'Una única orden aun con cierres repetidos');
    const orden = ordenes.rows[0]!;
    ordenId = orden.id;
    assert.strictEqual(orden.organizacion_compradora_id, comprador.orgId, 'Organización activa al pujar, no la actual');
    assert.strictEqual(orden.vendedor_id, vendedor.userId, 'Vendedor = autor del lote');
    assert.strictEqual(orden.estado, 'PENDIENTE_PAGO');
  });

  test('2. GET /ordenes y /ordenes/:id solo muestran órdenes de la organización activa', async () => {
    // Con contexto en orgB no ve la orden (404 sin revelar existencia).
    const ajena = await app.inject({ method: 'GET', url: `/api/v1/ordenes/${ordenId}`, headers: auth(comprador.token) });
    assert.strictEqual(ajena.statusCode, 404);
    const listaB = await app.inject({ method: 'GET', url: '/api/v1/ordenes', headers: auth(comprador.token) });
    assert.ok(!listaB.json().data.some((o: any) => o.id === ordenId));

    await switchTo(comprador, comprador.orgId, 'COMPRADOR');
    const propia = await app.inject({ method: 'GET', url: `/api/v1/ordenes/${ordenId}`, headers: auth(comprador.token) });
    assert.strictEqual(propia.statusCode, 200);
    assert.strictEqual(propia.json().estado, 'PENDIENTE_PAGO');
    assert.strictEqual(propia.json().total_a_pagar, 2121);

    const comoVendedor = await app.inject({ method: 'GET', url: '/api/v1/ordenes?rol=vendedor', headers: auth(vendedor.token) });
    assert.ok(comoVendedor.json().data.some((o: any) => o.id === ordenId));
    const vendedorComoComprador = await app.inject({ method: 'GET', url: '/api/v1/ordenes?rol=comprador', headers: auth(vendedor.token) });
    assert.ok(!vendedorComoComprador.json().data.some((o: any) => o.id === ordenId));

    const malCursor = await app.inject({ method: 'GET', url: '/api/v1/ordenes?cursor=xxx', headers: auth(vendedor.token) });
    assert.strictEqual(malCursor.statusCode, 400);
  });

  test('3. Paginación por cursor sin duplicados', async () => {
    // Segundo lote/orden para el mismo vendedor.
    const lote2 = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: auth(vendedor.token),
      payload: { precio_base: 1000, incremento_minimo: 50, fecha_cierre: new Date(Date.now() + 600000).toISOString() }
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${lote2.json().id}/pujas`,
      headers: { ...auth(comprador.token), 'idempotency-key': `n04-${crypto.randomUUID()}` },
      payload: { monto: 1050 }
    });
    await pool.query(`UPDATE lotes_subasta SET fecha_cierre = NOW() - INTERVAL '1 second' WHERE id = $1`, [lote2.json().id]);
    await closer.cerrarLotesExpirados(100);

    const p1 = (await app.inject({ method: 'GET', url: '/api/v1/ordenes?rol=vendedor&limit=1', headers: auth(vendedor.token) })).json();
    assert.strictEqual(p1.data.length, 1);
    assert.ok(p1.next_cursor);
    const p2 = (
      await app.inject({ method: 'GET', url: `/api/v1/ordenes?rol=vendedor&limit=1&cursor=${p1.next_cursor}`, headers: auth(vendedor.token) })
    ).json();
    assert.strictEqual(p2.data.length, 1);
    assert.notStrictEqual(p2.data[0].id, p1.data[0].id);
    assert.ok(!('cursor_ts' in p2.data[0]), 'la marca interna del cursor no se expone');
    const detalle = (await app.inject({ method: 'GET', url: `/api/v1/ordenes/${p2.data[0].id}`, headers: auth(vendedor.token) })).json();
    assert.ok(!('cursor_ts' in detalle), 'tampoco en GET /ordenes/:id');
  });

  test('3b. Regresión: dos órdenes en el MISMO milisegundo no se saltan entre páginas', async () => {
    const ordenes = await pool.query<{ id: string }>(
      `SELECT o.id FROM ordenes_compra o WHERE o.organizacion_vendedora_id = $1 ORDER BY o.id LIMIT 2`,
      [vendedor.orgId]
    );
    assert.strictEqual(ordenes.rows.length, 2);
    // Mismo milisegundo, distinto microsegundo: con el cursor truncado a ms se perdía una.
    await pool.query(`UPDATE ordenes_compra SET created_at = '2030-01-01T00:00:00.123100Z' WHERE id = $1`, [ordenes.rows[0]!.id]);
    await pool.query(`UPDATE ordenes_compra SET created_at = '2030-01-01T00:00:00.123900Z' WHERE id = $1`, [ordenes.rows[1]!.id]);

    const vistos: string[] = [];
    let cursor: string | null = null;
    for (let pagina = 0; pagina < 10; pagina++) {
      const url: string = `/api/v1/ordenes?rol=vendedor&limit=1${cursor ? `&cursor=${cursor}` : ''}`;
      const r: any = (await app.inject({ method: 'GET', url, headers: auth(vendedor.token) })).json();
      vistos.push(...r.data.map((o: any) => o.id));
      cursor = r.next_cursor;
      if (!cursor) break;
    }
    for (const fila of ordenes.rows) assert.ok(vistos.includes(fila.id), `la orden ${fila.id} no debe saltarse`);
    assert.strictEqual(new Set(vistos).size, vistos.length, 'sin duplicados');
  });

  test('4. WebSocket: sin token o con lote inexistente se cierra con 1008', async () => {
    assert.strictEqual(await wsCloseCode(`${baseWs}/api/v1/subastas/${loteId}/live`), 1008);
    assert.strictEqual(await wsCloseCode(`${baseWs}/api/v1/subastas/${loteId}/live?access_token=invalido`), 1008);
    assert.strictEqual(
      await wsCloseCode(`${baseWs}/api/v1/subastas/${crypto.randomUUID()}/live?access_token=${comprador.token}`),
      1008
    );
  });

  test('5. Proyección pública: la adjudicación no expone comprador ni totales; eventos de orden no se publican', () => {
    const adj = proyectarEventoPublico('LOTE_SUBASTA', loteId, 'SUBASTA_ADJUDICADA', {
      lote_id: loteId,
      codigo_lote: 'L-1',
      orden_id: 'o',
      comprador_id: 'u',
      organizacion_compradora_id: 'org',
      monto_adjudicado: 2100,
      total_a_pagar: 2121
    });
    assert.deepStrictEqual(adj?.mensaje, {
      event_type: 'SUBASTA_ADJUDICADA',
      lote_id: loteId,
      data: { codigo_lote: 'L-1', monto_adjudicado: 2100, estado: 'ADJUDICADO' }
    });
    assert.strictEqual(proyectarEventoPublico('ORDEN_COMPRA', 'x', 'ORDEN_PAGADA', {}), null);
  });
});
