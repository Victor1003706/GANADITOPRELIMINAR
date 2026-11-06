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

  test('1b. La misma clave tras cambiar de organización activa → 409 IDEMPOTENCY_KEY_OTRO_CONTEXTO (no repite la puja anterior)', async () => {
    const lote = (await crearLote()).json().id;
    const key = `k-${crypto.randomUUID()}`;
    const primera = await pujar(comprador, lote, 1100, key);
    assert.strictEqual(primera.statusCode, 201, primera.body);

    // El comprador también es COMPRADOR en una segunda organización y cambia a ella.
    const orgB = await pool.query<{ id: string }>(`INSERT INTO organizaciones (razon_social) VALUES ($1) RETURNING id`, [`Org B ${crypto.randomUUID().slice(0, 6)}`]);
    await pool.query(
      `INSERT INTO user_organizaciones_roles (user_id, organizacion_id, rol, is_active_context) VALUES ($1, $2, 'COMPRADOR', FALSE)`,
      [comprador.userId, orgB.rows[0]!.id]
    );
    const orgOriginal = comprador.orgId;
    await switchTo(comprador, orgB.rows[0]!.id, 'COMPRADOR');
    try {
      const otraOrg = await pujar(comprador, lote, 1100, key);
      assert.strictEqual(otraOrg.statusCode, 409, otraOrg.body);
      assert.strictEqual(otraOrg.json().code, 'IDEMPOTENCY_KEY_OTRO_CONTEXTO');
      const n = await pool.query('SELECT count(*)::int AS n FROM subasta_pujas WHERE lote_id = $1', [lote]);
      assert.strictEqual(n.rows[0].n, 1, 'no se crea una segunda puja');
    } finally {
      await switchTo(comprador, orgOriginal, 'COMPRADOR');
    }
    // De vuelta en la organización original, el reintento sí es una repetición.
    const repetida = await pujar(comprador, lote, 1100, key);
    assert.strictEqual(repetida.json().puja_id, primera.json().puja_id);
  });

  test('1c. Registro heredado (organizacion_id NULL): se usa la organización original de la puja', async () => {
    const lote = (await crearLote()).json().id;
    const key = `k-${crypto.randomUUID()}`;
    const primera = await pujar(comprador, lote, 1100, key);
    assert.strictEqual(primera.statusCode, 201, primera.body);
    // Simula un registro anterior a la migración 0014.
    await pool.query(`UPDATE idempotency_records SET organizacion_id = NULL WHERE user_id = $1 AND key = $2`, [comprador.userId, key]);

    // Misma organización: repetición legítima.
    assert.strictEqual((await pujar(comprador, lote, 1100, key)).json().puja_id, primera.json().puja_id);

    // Otra organización: conflicto, aunque el registro no tenga organización.
    const orgB = await pool.query<{ id: string }>(`INSERT INTO organizaciones (razon_social) VALUES ($1) RETURNING id`, [`Org L ${crypto.randomUUID().slice(0, 6)}`]);
    await pool.query(`INSERT INTO user_organizaciones_roles (user_id, organizacion_id, rol, is_active_context) VALUES ($1, $2, 'COMPRADOR', FALSE)`, [comprador.userId, orgB.rows[0]!.id]);
    const original = comprador.orgId;
    await switchTo(comprador, orgB.rows[0]!.id, 'COMPRADOR');
    try {
      const r = await pujar(comprador, lote, 1100, key);
      assert.strictEqual(r.statusCode, 409, r.body);
      assert.strictEqual(r.json().code, 'IDEMPOTENCY_KEY_OTRO_CONTEXTO');
      assert.ok(!r.body.includes(primera.json().puja_id), 'el conflicto no revela el recibo original');
    } finally {
      await switchTo(comprador, original, 'COMPRADOR');
    }

    // Puja sin organización registrada (datos previos a 0011): conflicto opaco también.
    await pool.query('UPDATE subasta_pujas SET organizacion_postora_id = NULL WHERE id = $1', [primera.json().puja_id]);
    assert.strictEqual((await pujar(comprador, lote, 1100, key)).statusCode, 409);
  });

  test('2. Cinco envíos simultáneos con la misma clave: una sola puja, ninguna respuesta 500', async () => {
    const lote = (await crearLote()).json().id;
    const key = `k-${crypto.randomUUID()}`;
    const respuestas = await Promise.all(Array.from({ length: 5 }, () => pujar(comprador, lote, 1100, key)));

    for (const r of respuestas) assert.ok([201, 409].includes(r.statusCode), `status ${r.statusCode}`);
    const ids = new Set(respuestas.filter((r) => r.statusCode === 201).map((r) => r.json().puja_id));
    assert.strictEqual(ids.size, 1);

    const filas = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM subasta_pujas WHERE lote_id = $1', [lote]);
    assert.strictEqual(filas.rows[0]!.n, 1);
  });

  test('3. Miembros de la organización vendedora no pujan aunque tengan rol COMPRADOR o cambien de organización', async () => {
    const lote = (await crearLote()).json().id;

    // 3.1 Mismo usuario vendedor con rol COMPRADOR en su propia organización.
    await authService.addMembership(vendedor.userId, vendedor.orgId, 'COMPRADOR', false);
    await switchTo(vendedor, vendedor.orgId, 'COMPRADOR');
    const mismaOrg = await pujar(vendedor, lote, 1100, `k-${crypto.randomUUID()}`);
    assert.strictEqual(mismaOrg.statusCode, 403);
    assert.strictEqual(mismaOrg.json().code, 'PUJA_PROPIO_LOTE');

    // 3.2 El mismo usuario, comprador en OTRA organización.
    const otraOrg = await registrar('COMPRADOR', 'n03_otra');
    await authService.addMembership(vendedor.userId, otraOrg.orgId, 'COMPRADOR', false);
    await switchTo(vendedor, otraOrg.orgId, 'COMPRADOR');
    const desdeOtra = await pujar(vendedor, lote, 1100, `k-${crypto.randomUUID()}`);
    assert.strictEqual(desdeOtra.statusCode, 403);
    assert.strictEqual(desdeOtra.json().code, 'PUJA_PROPIO_LOTE');

    await switchTo(vendedor, vendedor.orgId, 'VENDEDOR');
  });

  test('4. Publicación: estado inválido, anti-sniping negativo, más de 2 decimales y fecha_inicio inválida → 400', async () => {
    for (const payload of [
      { estado: 'ADJUDICADO' },
      { anti_sniping_seconds: -5 },
      { anti_sniping_extension: 1.5 },
      { precio_base: 1000.123 },
      { fecha_inicio: 'no-es-fecha' }
    ]) {
      const r = await crearLote(payload);
      assert.strictEqual(r.statusCode, 400, JSON.stringify(payload));
    }
  });

  test('5. Lote BORRADOR o que aún no inicia no admite pujas (400 LOTE_NO_ABIERTO); monto con 3 decimales → 400', async () => {
    const borrador = (await crearLote({ estado: 'BORRADOR' })).json().id;
    const r1 = await pujar(comprador, borrador, 1100, `k-${crypto.randomUUID()}`);
    assert.strictEqual(r1.statusCode, 400);
    assert.strictEqual(r1.json().code, 'LOTE_NO_ABIERTO');

    const futuro = (
      await crearLote({
        fecha_inicio: new Date(Date.now() + 300000).toISOString(),
        fecha_cierre: new Date(Date.now() + 900000).toISOString()
      })
    ).json().id;
    const r2 = await pujar(comprador, futuro, 1100, `k-${crypto.randomUUID()}`);
    assert.strictEqual(r2.statusCode, 400);
    assert.strictEqual(r2.json().code, 'LOTE_NO_ABIERTO');

    const activo = (await crearLote()).json().id;
    const r3 = await pujar(comprador, activo, 1100.005, `k-${crypto.randomUUID()}`);
    assert.strictEqual(r3.statusCode, 400);
  });

  test('6. Se registra la organización activa al pujar; el evento público no incluye la clave de idempotencia', async () => {
    const lote = (await crearLote()).json().id;
    const key = `k-${crypto.randomUUID()}`;
    const r = await pujar(comprador, lote, 1100, key);
    assert.strictEqual(r.statusCode, 201);

    const puja = await pool.query<{ organizacion_postora_id: string }>(
      'SELECT organizacion_postora_id FROM subasta_pujas WHERE id = $1',
      [r.json().puja_id]
    );
    assert.strictEqual(puja.rows[0]!.organizacion_postora_id, comprador.orgId);

    const loteRow = await pool.query<{ organizacion_ganadora_id: string; creado_por_user_id: string }>(
      'SELECT organizacion_ganadora_id, creado_por_user_id FROM lotes_subasta WHERE id = $1',
      [lote]
    );
    assert.strictEqual(loteRow.rows[0]!.organizacion_ganadora_id, comprador.orgId);
    assert.strictEqual(loteRow.rows[0]!.creado_por_user_id, vendedor.userId);

    const evento = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'PUJA_ACEPTADA'`,
      [lote]
    );
    assert.strictEqual(evento.rows.length, 1);
    assert.ok(!('idempotency_key' in evento.rows[0]!.payload));
  });
});
