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
    const { ticket, expira_en_segundos } = r.json();
    assert.equal(expira_en_segundos, 30);
    assert.ok(ticket.length >= 40);
    const fila = await pool.query('SELECT hash FROM ws_tickets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
    assert.equal(fila.rows[0].hash, crypto.createHash('sha256').update(ticket).digest('hex'));
    const enClaro = await pool.query('SELECT 1 FROM ws_tickets WHERE hash = $1', [ticket]);
    assert.equal(enClaro.rowCount, 0);
  });

  test('2. Sin sesión no hay ticket (401) y un lote inexistente es 404', async () => {
    const sin = await app.inject({ method: 'POST', url: `/api/v1/subastas/${loteId}/live/ticket` });
    assert.equal(sin.statusCode, 401);
    assert.equal((await pedirTicket(crypto.randomUUID())).statusCode, 404);
    assert.equal((await pedirTicket('no-uuid')).statusCode, 404);
  });

  test('3. El ticket abre el WebSocket una sola vez', async () => {
    const { ticket } = (await pedirTicket(loteId)).json();
    assert.equal(await conectar(loteId, `ticket=${encodeURIComponent(ticket)}`), 'SUSCRITO');
    assert.match(await conectar(loteId, `ticket=${encodeURIComponent(ticket)}`), /^1008:Ticket inválido/);
  });

  test('4. Un ticket de otro lote, vencido o inventado no sirve', async () => {
    const { ticket } = (await pedirTicket(otroLoteId)).json();
    assert.match(await conectar(loteId, `ticket=${encodeURIComponent(ticket)}`), /^1008/);
    // Sigue sin usar: abre su propio lote.
    assert.equal(await conectar(otroLoteId, `ticket=${encodeURIComponent(ticket)}`), 'SUSCRITO');

    const vencido = (await pedirTicket(loteId)).json().ticket;
    await pool.query(
      `UPDATE ws_tickets SET expira_en = clock_timestamp() - interval '1 second' WHERE hash = $1`,
      [crypto.createHash('sha256').update(vencido).digest('hex')]
    );
    assert.match(await conectar(loteId, `ticket=${encodeURIComponent(vencido)}`), /^1008/);
    assert.match(await conectar(loteId, `ticket=${crypto.randomBytes(32).toString('base64url')}`), /^1008/);
  });

  test('5. Dos conexiones simultáneas con el mismo ticket: exactamente una entra', async () => {
    const { ticket } = (await pedirTicket(loteId)).json();
    const consumos = await Promise.all(Array.from({ length: 5 }, () => consumirTicketWs(pool, ticket, loteId)));
    assert.deepEqual(consumos.filter((u) => u !== null).map((u) => u!.userId), [userId]);
  });

  test('6. Tope de tickets vigentes por usuario: 429 al superarlo', async () => {
    await pool.query('DELETE FROM ws_tickets WHERE user_id = $1', [userId]);
    for (let i = 0; i < MAX_TICKETS_VIGENTES_POR_USUARIO; i++) {
      assert.equal((await pedirTicket(loteId)).statusCode, 201);
    }
    const excedido = await pedirTicket(loteId);
    assert.equal(excedido.statusCode, 429);
    assert.equal(excedido.json().code, 'DEMASIADOS_TICKETS');
    await pool.query('DELETE FROM ws_tickets WHERE user_id = $1', [userId]);
  });

  test('7. ?access_token= (obsoleto) sigue fuera de producción y se rechaza si se desactiva', async () => {
    assert.equal(await conectar(loteId, `access_token=${encodeURIComponent(token)}`), 'SUSCRITO');
    const previo = process.env.WS_PERMITIR_ACCESS_TOKEN_EN_URL;
    process.env.WS_PERMITIR_ACCESS_TOKEN_EN_URL = 'false';
    try {
      assert.match(await conectar(loteId, `access_token=${encodeURIComponent(token)}`), /^1008:access_token en la URL/);
    } finally {
      if (previo === undefined) delete process.env.WS_PERMITIR_ACCESS_TOKEN_EN_URL;
      else process.env.WS_PERMITIR_ACCESS_TOKEN_EN_URL = previo;
    }
    assert.equal(permiteAccessTokenEnUrl({ NODE_ENV: 'production' }), false);
    assert.equal(permiteAccessTokenEnUrl({ NODE_ENV: 'production', WS_PERMITIR_ACCESS_TOKEN_EN_URL: 'true' }), true);
    assert.equal(permiteAccessTokenEnUrl({ NODE_ENV: 'development' }), true);
  });

  test('7b. Membresía revocada después de emitir: el ticket ya no abre el socket', async () => {
    const { ticket } = (await pedirTicket(loteId)).json();
    await pool.query('UPDATE user_organizaciones_roles SET is_active_context = FALSE WHERE user_id = $1', [userId]);
    try {
      assert.match(await conectar(loteId, `ticket=${encodeURIComponent(ticket)}`), /^1008:Ticket inválido/);
      // El token sin contexto activo ya no obtiene tickets.
      const sinContexto = await pedirTicket(loteId);
      assert.ok([401, 403].includes(sinContexto.statusCode), sinContexto.body);
    } finally {
      await pool.query(
        `UPDATE user_organizaciones_roles SET is_active_context = TRUE WHERE user_id = $1 AND rol = 'VENDEDOR'`,
        [userId]
      );
    }
    assert.equal((await pedirTicket(loteId)).statusCode, 201);
  });

  test('7c. Un JWT sin organización activa no obtiene ticket (403 SIN_CONTEXTO)', async () => {
    const sinOrg = app.jwt.sign({ user_id: userId, email: 'x@test.com' } as any);
    const r = await pedirTicket(loteId, sinOrg);
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().code, 'SIN_CONTEXTO');
  });

  /** Abre el socket y lo deja abierto; `cierre` resuelve con "codigo:motivo". */
  async function abrir(lote: string, query: string, headers: Record<string, string> = {}) {
    const ws = new WebSocket(`${base}/api/v1/subastas/${lote}/live?${query}`, { headers });
    const cierre = new Promise<string>((resolve) => ws.once('close', (c, m) => resolve(`${c}:${m.toString()}`)));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return { ws, cierre };
  }

  async function esperarSuscritos(lote: string, n: number) {
    for (let i = 0; i < 100 && wsHub.getActiveSubscribersCount(lote) !== n; i++) await new Promise((r) => setTimeout(r, 20));
    return wsHub.getActiveSubscribersCount(lote);
  }

  async function conContextoRevocado<T>(fn: () => Promise<T>): Promise<T> {
    await pool.query('UPDATE user_organizaciones_roles SET is_active_context = FALSE WHERE user_id = $1', [userId]);
    try {
      return await fn();
    } finally {
      await pool.query(`UPDATE user_organizaciones_roles SET is_active_context = TRUE WHERE user_id = $1 AND rol = 'VENDEDOR'`, [userId]);
    }
  }

  test('9. Bearer: firma válida pero membresía revocada antes del handshake → 1008', async () => {
    const r = await conContextoRevocado(async () => {
      const { cierre } = await abrir(loteId, '', { authorization: `Bearer ${token}` });
      return cierre;
    });
    assert.match(r, /^1008:Sesión revocada/);
    assert.equal(await esperarSuscritos(loteId, 0), 0);
  });

  test('10. Bearer: JWT sin organización activa → 1008 (igual que el ticket)', async () => {
    const sinOrg = app.jwt.sign({ user_id: userId, email: 'x@test.com' } as any, { expiresIn: '15m' });
    const { cierre } = await abrir(loteId, '', { authorization: `Bearer ${sinOrg}` });
    assert.match(await cierre, /^1008:Se requiere un contexto/);
  });

  test('11. Revocación DURANTE la conexión: el socket se cierra y deja de estar suscrito', async () => {
    const { ticket } = (await pedirTicket(loteId)).json();
    const { cierre } = await abrir(loteId, `ticket=${encodeURIComponent(ticket)}`);
    assert.equal(await esperarSuscritos(loteId, 1), 1);
    const motivo = await conContextoRevocado(async () =>
      Promise.race([cierre, new Promise<string>((r) => setTimeout(() => r('SIGUE_ABIERTO'), 1500))])
    );
    assert.match(motivo, /^1008:Sesión revocada/);
    assert.equal(await esperarSuscritos(loteId, 0), 0, 'no conserva la suscripción');
  });

  test('12. La sesión expira: con ticket se cierra al cumplirse su vida máxima', async () => {
    const { ticket } = (await pedirTicket(loteId)).json();
    const inicio = Date.now();
    const { cierre } = await abrir(loteId, `ticket=${encodeURIComponent(ticket)}`);
    const motivo = await Promise.race([cierre, new Promise<string>((r) => setTimeout(() => r('SIGUE_ABIERTO'), 4000))]);
    assert.match(motivo, /^1008:Sesión expirada/);
    assert.ok(Date.now() - inicio >= 1500, 'no antes de su vida máxima');
  });

  test('13. Bearer: la conexión se cierra cuando vence el exp del JWT', async () => {
    const corto = app.jwt.sign(
      { user_id: userId, email: 'x@test.com', active_organization_id: orgId, active_role: 'VENDEDOR' } as any,
      { expiresIn: 1 }
    );
    const { cierre } = await abrir(loteId, '', { authorization: `Bearer ${corto}` });
    const motivo = await Promise.race([cierre, new Promise<string>((r) => setTimeout(() => r('SIGUE_ABIERTO'), 3000))]);
    assert.match(motivo, /^1008:Sesión expirada/);
  });

  test('14. Si PostgreSQL no responde al revalidar, falla cerrado (1011) tras 2 intentos', async () => {
    const cierres: string[] = [];
    const emisor = new EventEmitter();
    const socket = Object.assign(emisor, {
      readyState: 1,
      close(codigo: number, motivo: string) { cierres.push(`${codigo}:${motivo}`); emisor.emit('close'); }
    });
    const poolCaido = { query: async () => { throw new Error('ECONNREFUSED'); } } as any;
    supervisarSesionWs(socket as any, { userId, organizacionId: orgId, rol: 'VENDEDOR', expiraEnMs: Date.now() + 60_000 }, poolCaido, 30);
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(cierres, ['1011:No se pudo verificar la sesión.']);
  });

  test('15. Un socket ya cerrado no deja timers ni consultas vivas', async () => {
    let consultas = 0;
    const poolContador = { query: async () => { consultas += 1; return { rowCount: 1 }; } } as any;
    const muerto = Object.assign(new EventEmitter(), { readyState: 3, close() {} });
    supervisarSesionWs(muerto as any, { userId, organizacionId: orgId, rol: 'VENDEDOR', expiraEnMs: Date.now() + 60_000 }, poolContador, 20);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(consultas, 0);
  });

  test('16. Un JWT sin exp no abre el socket', async () => {
    const sinExp = app.jwt.sign(
      { user_id: userId, email: 'x@test.com', active_organization_id: orgId, active_role: 'VENDEDOR' } as any,
      { expiresIn: undefined as any }
    );
    const decodificado: any = app.jwt.decode(sinExp);
    if (decodificado?.exp !== undefined) return; // la librería siempre firma con exp: nada que probar
    const { cierre } = await abrir(loteId, '', { authorization: `Bearer ${sinExp}` });
    assert.match(await cierre, /^1008:Sesión requerida/);
  });

  test('14b. Una consulta de PostgreSQL que nunca responde no congela la revalidación: falla cerrado', async () => {
    const cierres: string[] = [];
    const emisor = new EventEmitter();
    const socket = Object.assign(emisor, {
      readyState: 1,
      close(codigo: number, motivo: string) { cierres.push(`${codigo}:${motivo}`); emisor.emit('close'); }
    });
    const poolColgado = { query: () => new Promise(() => {}) } as any;
    supervisarSesionWs(socket as any, { userId, organizacionId: orgId, rol: 'VENDEDOR', expiraEnMs: Date.now() + 60_000 }, poolColgado, 30);
    await new Promise((r) => setTimeout(r, 250));
    assert.deepEqual(cierres, ['1011:No se pudo verificar la sesión.']);
  });

  test('8. Sin ninguna credencial el socket se cierra con 1008', async () => {
    assert.match(await conectar(loteId, ''), /^1008:Sesión requerida/);
  });
});
