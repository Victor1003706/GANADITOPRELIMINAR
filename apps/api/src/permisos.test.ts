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
      const r = await app.inject({ method: 'POST', url, headers: auth(vendedorA.token) });
      assert.strictEqual(r.statusCode, 403, url);
    }

    const admin = await crearUsuarioConRol(app, authService, 'ADMIN', 'perm');
    const cerrar = await app.inject({ method: 'POST', url: '/api/v1/subastas/cerrar-expiradas', headers: auth(admin.token) });
    assert.strictEqual(cerrar.statusCode, 200);
  });

  test('2. Dos organizaciones: la ajena no ve ni emite sobre comprobantes/órdenes de otra', async () => {
    const propio = await app.inject({ method: 'GET', url: `/api/v1/tributario/comprobantes/${comprobanteId}`, headers: auth(compradorA.token) });
    assert.strictEqual(propio.statusCode, 200);
    const delVendedor = await app.inject({ method: 'GET', url: `/api/v1/tributario/comprobantes/${comprobanteId}`, headers: auth(vendedorA.token) });
    assert.strictEqual(delVendedor.statusCode, 200);

    const ajeno = await app.inject({ method: 'GET', url: `/api/v1/tributario/comprobantes/${comprobanteId}`, headers: auth(ajenoB.token) });
    assert.strictEqual(ajeno.statusCode, 404);

    const lista = await app.inject({ method: 'GET', url: '/api/v1/tributario/comprobantes', headers: auth(ajenoB.token) });
    assert.strictEqual(lista.statusCode, 200);
    assert.deepStrictEqual(lista.json().comprobantes, [], 'Una organización nueva no ve comprobantes de otras');

    const emitir = await app.inject({
      method: 'POST',
      url: '/api/v1/tributario/liquidaciones-compra',
      headers: auth(ajenoB.token),
      payload: { orden_compra_id: ordenId, emisor_ruc: '20123456789', productor_dni: '12345678', monto_total_pen: 1010 }
    });
    assert.strictEqual(emitir.statusCode, 404);

    const factoring = await app.inject({
      method: 'POST',
      url: '/api/v1/fintech/cavali/solicitar-factoring',
      headers: auth(ajenoB.token),
      payload: { orden_id: ordenId, comprobante_id: comprobanteId, organizacion_id: vendedorA.orgId }
    });
    assert.strictEqual(factoring.statusCode, 404);

    const listaFact = await app.inject({ method: 'GET', url: '/api/v1/fintech/cavali', headers: auth(ajenoB.token) });
    assert.strictEqual(listaFact.statusCode, 200);
    assert.deepStrictEqual(listaFact.json().factorings, []);
  });

  test('3. Varios roles en la misma organización: cada contexto funciona sin depender del orden de filas', async () => {
    // El usuario vendedorA también es COMPRADOR en su misma organización.
    await authService.addMembership(vendedorA.userId, vendedorA.orgId, 'COMPRADOR', false);

    for (const rol of ['VENDEDOR', 'COMPRADOR', 'VENDEDOR', 'COMPRADOR'] as const) {
      const sw = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/organizations/switch-context',
        headers: auth(vendedorA.token),
        payload: { organizacion_id: vendedorA.orgId, rol }
      });
      assert.strictEqual(sw.statusCode, 200, `switch a ${rol}`);
      vendedorA.token = sw.json().access_token;

      const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(vendedorA.token) });
      assert.strictEqual(me.statusCode, 200, `GET /me con rol ${rol}`);
      assert.strictEqual(me.json().activeContext.rol, rol);
    }

    // Con contexto COMPRADOR no puede publicar; tras volver a VENDEDOR sí.
    const comoComprador = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: auth(vendedorA.token),
      payload: { precio_base: 500, incremento_minimo: 10, fecha_cierre: new Date(Date.now() + 600000).toISOString() }
    });
    assert.strictEqual(comoComprador.statusCode, 403);

    const activos = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_organizaciones_roles WHERE user_id = $1 AND is_active_context`,
      [vendedorA.userId]
    );
    assert.strictEqual(activos.rows[0]!.n, 1, 'Exactamente un contexto activo');
  });

  test('4. Un token de un contexto que ya no está activo recibe 403 CONTEXTO_INACTIVO', async () => {
    const tokenViejo = vendedorA.token; // contexto COMPRADOR activo
    const sw = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/organizations/switch-context',
      headers: auth(tokenViejo),
      payload: { organizacion_id: vendedorA.orgId, rol: 'VENDEDOR' }
    });
    vendedorA.token = sw.json().access_token;

    const conViejo = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(tokenViejo) });
    assert.strictEqual(conViejo.statusCode, 403);
    assert.strictEqual(conViejo.json().code, 'CONTEXTO_INACTIVO');
  });

  test('5. La base de datos impide dos contextos activos para un mismo usuario', async () => {
    await assert.rejects(
      pool.query(
        `UPDATE user_organizaciones_roles SET is_active_context = TRUE WHERE user_id = $1`,
        [vendedorA.userId]
      ),
      /uq_user_contexto_activo/
    );
  });

  test('6. Trazabilidad: otra organización no escribe en un pasaporte ajeno; el camal solo eventos de faena', async () => {
    const bovino = await app.inject({
      method: 'POST',
      url: '/api/v1/trazabilidad/bovinos',
      headers: auth(vendedorA.token),
      payload: { codigo_arete: `PE-PERM-${crypto.randomUUID().slice(0, 10)}`, raza: 'Brahman', sexo: 'MACHO' }
    });
    assert.strictEqual(bovino.statusCode, 201);
    const bovinoId = bovino.json().bovino?.id ?? bovino.json().id;

    const ajeno = await app.inject({
      method: 'POST',
      url: `/api/v1/trazabilidad/bovinos/${bovinoId}/eventos`,
      headers: auth(ajenoB.token),
      payload: { event_type: 'CAMBIO_PROPIEDAD', metadata: { nueva_organizacion_id: ajenoB.orgId } }
    });
    assert.strictEqual(ajeno.statusCode, 403);

    const camal = await crearUsuarioConRol(app, authService, 'OPERADOR_CAMAL', 'perm');
    const vacunaCamal = await app.inject({
      method: 'POST',
      url: `/api/v1/trazabilidad/bovinos/${bovinoId}/eventos`,
      headers: auth(camal.token),
      payload: { event_type: 'VACUNACION', metadata: {} }
    });
    assert.strictEqual(vacunaCamal.statusCode, 403);

    const pesaje = await app.inject({
      method: 'POST',
      url: `/api/v1/trazabilidad/bovinos/${bovinoId}/eventos`,
      headers: auth(camal.token),
      payload: { event_type: 'PESAJE_CAMAL', metadata: { peso_kg: 420 } }
    });
    assert.strictEqual(pesaje.statusCode, 201);

    const org = await pool.query<{ organizacion_id: string }>('SELECT organizacion_id FROM bovinos WHERE id = $1', [bovinoId]);
    assert.strictEqual(org.rows[0]!.organizacion_id, vendedorA.orgId, 'La propiedad no cambió');
  });
});
