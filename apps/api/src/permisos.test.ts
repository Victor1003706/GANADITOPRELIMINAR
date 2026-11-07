import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import { crearUsuarioConRol } from './test-helpers.js';

describe('N02: permisos por rol y aislamiento entre organizaciones', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({ pool, integracionesTributarias: true });
  const authService = new AuthService(pool);
  const password = 'PasswordPermisos2026!';

  async function registrar(rol: 'COMPRADOR' | 'VENDEDOR', prefijo: string) {
    const sufijo = crypto.randomUUID().slice(0, 8);
    const email = `${prefijo}_${sufijo}@test.com`;
    const reg = await authService.register({
      email,
      password,
      nombre: `${prefijo} ${sufijo}`,
      organizacion_nombre: `${prefijo} SAC ${sufijo}`,
      rol_inicial: rol
    });
    return { email, userId: reg.user.id, orgId: reg.activeContext.organizacion_id, token: await login(email) };
  }

  async function login(email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    return res.json().access_token;
  }

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  let vendedorA: Awaited<ReturnType<typeof registrar>>;
  let compradorA: Awaited<ReturnType<typeof registrar>>;
  let ajenoB: Awaited<ReturnType<typeof registrar>>;
  let comprobanteId: string;
  let ordenId: string;

  before(async () => {
    await runInitialMigration();
    await app.ready();

    vendedorA = await registrar('VENDEDOR', 'perm_vend');
    compradorA = await registrar('COMPRADOR', 'perm_comp');
    ajenoB = await registrar('COMPRADOR', 'perm_ajeno');

    // Orden LIQUIDADA entre vendedorA y compradorA con un comprobante tributario.
    const lote = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: auth(vendedorA.token),
      payload: { precio_base: 1000, incremento_minimo: 50, fecha_cierre: new Date(Date.now() + 600000).toISOString() }
    });
    assert.strictEqual(lote.statusCode, 201);

    const orden = await pool.query<{ id: string }>(
      `INSERT INTO ordenes_compra (lote_id, comprador_id, organizacion_compradora_id, vendedor_id,
         organizacion_vendedora_id, monto_adjudicado, comision_plataforma, total_a_pagar, estado)
       VALUES ($1, $2, $3, $4, $5, 1000, 10, 1010, 'LIQUIDADO') RETURNING id`,
      [lote.json().id, compradorA.userId, compradorA.orgId, vendedorA.userId, vendedorA.orgId]
    );
    ordenId = orden.rows[0]!.id;

    const comp = await pool.query<{ id: string }>(
      `INSERT INTO comprobantes_tributarios (orden_id, tipo_comprobante, serie, correlativo, emisor_ruc,
         receptor_num_doc, receptor_tipo_doc, monto_subtotal, monto_total, external_correlation_id, xml_payload_resumen)
       VALUES ($1, 'LIQUIDACION_COMPRA_ELECTRONICA', 'T999', $2, '20123456789', '12345678', 'DNI', 1010, 1010, $3, '{}')
       RETURNING id`,
      [ordenId, Math.floor(Math.random() * 1e9), `perm-${crypto.randomUUID()}`]
    );
    comprobanteId = comp.rows[0]!.id;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  test('1. Guardas de rol: COMPRADOR no publica lotes, VENDEDOR no puja, solo ADMIN cierra/concilia', async () => {
    const publicar = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: auth(compradorA.token),
      payload: { precio_base: 1000, incremento_minimo: 50, fecha_cierre: new Date(Date.now() + 600000).toISOString() }
    });
    assert.strictEqual(publicar.statusCode, 403);
    assert.strictEqual(publicar.json().code, 'ROL_NO_AUTORIZADO');

    for (const url of ['/api/v1/subastas/cerrar-expiradas', '/api/v1/tributario/conciliar-pendientes']) {
      const r = await app.inject