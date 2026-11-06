import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { crearUsuarioConRol } from './test-helpers.js';
import { AuthService } from './auth/auth.service.js';
import { SunatAdapter } from './integraciones/sunat.adapter.js';
import { CavaliAdapter } from './integraciones/cavali.adapter.js';

describe('Adaptadores de Integración Tributaria (SEE-SUNAT) y Financiera (CAVALI Factoring)', { concurrency: 1 }, () => {
  const pool = getPool();
  const sunatAdapter = new SunatAdapter(pool);
  const cavaliAdapter = new CavaliAdapter(pool);
  const app = buildApp({ pool, sunatAdapter, cavaliAdapter, integracionesTributarias: true });
  const appApagada = buildApp({ pool });
  const authService = new AuthService(pool);

  let compradorToken: string;
  let compradorUserId: string;
  let compradorOrgId: string;

  let vendedorUserId: string;
  let vendedorOrgId: string;

  let ordenLiquidadaId: string;
  let ordenLiquidada2Id: string;
  let ordenPendienteId: string;

  let comprobanteConfirmadoId: string;
  let comprobantePendienteId: string;

  before(async () => {
    await runInitialMigration();
    await app.ready();

    // Limpiar tablas para pruebas deterministas
    await pool.query('DELETE FROM factoring_cavali_solicitudes;');
    await pool.query('DELETE FROM comprobantes_tributarios;');

    // 1. Registrar Comprador / Emisor de Liquidación de Compra
    const cRes = await authService.register({
      email: `frigorifico_comprador_${Date.now()}@test.com`,
      password: 'PasswordTax2026!',
      nombre: 'Frigorífico Central del Perú SAC',
      organizacion_nombre: `Frigorífico Central SAC ${Date.now()}`,
      rol_inicial: 'COMPRADOR'
    });
    compradorUserId = cRes.user.id;
    compradorOrgId = cRes.activeContext.organizacion_id;

    const cLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: cRes.user.email, password: 'PasswordTax2026!' }
    });
    compradorToken = cLogin.json().access_token;

    // 2. Registrar Vendedor Agropecuario
    const vRes = await authService.register({
      email: `productor_vendedor_${Date.now()}@test.com`,
      password: 'PasswordTax2026!',
      nombre: 'Establo San Juan de Lurín',
      organizacion_nombre: `Establo San Juan ${Date.now()}`,
      rol_inicial: 'VENDEDOR'
    });
    vendedorUserId = vRes.user.id;
    vendedorOrgId = vRes.activeContext.organizacion_id;

    // 3. Crear Lotes y Órdenes de compra en estado LIQUIDADO
    const lote1Res = await pool.query<{ id: string }>(
      `INSERT INTO lotes_subasta (
         codigo_lote, vendedor_id, precio_base, precio_actual,
         incremento_minimo, estado, fecha_inicio, fecha_cierre
       ) VALUES ($1, $2, 8000, 8500, 100, 'FINALIZADA', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour')
       RETURNING id;`,
      [`LOTE-LCE-1-${Date.now()}`, vendedorOrgId]
    );

    const orden1Res = await pool.query<{ id: string }>(
      `INSERT INTO ordenes_compra (
         lote_id, comprador_id, organizacion_compradora_id, vendedor_id, organizacion_vendedora_id,
         monto_adjudicado, comision_plataforma, total_a_pagar, estado
       ) VALUES ($1, $2, $3, $4, $5, 8500, 85, 8585, 'LIQUIDADO')
       RETURNING id;`,
      [lote1Res.rows[0]!.id, compradorUserId, compradorOrgId, vendedorUserId, vendedorOrgId]
    );
    ordenLiquidadaId = orden1Res.rows[0]!.id;

    const lote2Res = await pool.query<{ id: string }>(
      `INSERT INTO lotes_subasta (
         codigo_lote, vendedor_id, precio_base, precio_actual,
         incremento_minimo, estado, fecha_inicio, fecha_cierre
       ) VALUES ($1, $2, 12000, 12500, 100, 'FINALIZADA', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour')
       RETURNING id;`,
      [`LOTE-LCE-2-${Date.now()}`, vendedorOrgId]
    );

    const orden2Res = await pool.query<{ id: string }>(
      `INSERT INTO ordenes_compra (
         lote_id, comprador_id, organizacion_compradora_id, vendedor_id, organizacion_vendedora_id,
         monto_adjudicado, comision_plataforma, total_a_pagar, estado
       ) VALUES ($1, $2, $3, $4, $5, 12500, 125, 12625, 'LIQUIDADO')
       RETURNING id;`,
      [lote2Res.rows[0]!.id, compradorUserId, compradorOrgId, vendedorUserId, vendedorOrgId]
    );
    ordenLiquidada2Id = orden2Res.rows[0]!.id;

    // Orden en estado PENDIENTE_PAGO (no apta para liquidación electrónica)
    const lote3Res = await pool.query<{ id: string }>(
      `INSERT INTO lotes_subasta (
         codigo_lote, vendedor_id, precio_base, precio_actual,
         incremento_minimo, estado, fecha_inicio, fecha_cierre
       ) VALUES ($1, $2, 6000, 6000, 100, 'ACTIVO', NOW() - INTERVAL '10 minutes', NOW() + INTERVAL '1 hour')
       RETURNING id;`,
      [`LOTE-LCE-3-${Date.now()}`, vendedorOrgId]
    );

    const orden3Res = await pool.query<{ id: string }>(
      `INSERT INTO ordenes_compra (
         lote_id, comprador_id, organizacion_compradora_id, vendedor_id, organizacion_vendedora_id,
         monto_adjudicado, comision_plataforma, total_a_pagar, estado
       ) VALUES ($1, $2, $3, $4, $5, 6000, 60, 6060, 'PENDIENTE_PAGO')
       RETURNING id;`,
      [lote3Res.rows[0]!.id, compradorUserId, compradorOrgId, vendedorUserId, vendedorOrgId]
    );
    ordenPendienteId = orden3Res.rows[0]!.id;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  test('0. Sin TAX_INTEGRATIONS_ENABLED las escrituras SUNAT/CAVALI responden 503 (son simuladas)', async () => {
    await appApagada.ready();
    for (const url of ['/api/v1/tributario/liquidaciones-compra', '/api/v1/fintech/cavali/solicitar-factoring']) {
      const r = await appApagada.inject({ method: 'POST', url, headers: { authorization: `Bearer ${compradorToken}` }, payload: {} });
      assert.strictEqual(r.statusCode, 503, url);
      assert.strictEqual(r.json().code, 'INTEGRACION_DESHABILITADA');
    }
    await appApagada.close();
  });

  test('1. Emisión exitosa de Liquidación de Compra Electrónica vinculada a orden liquidada: serie E001, correlativo correlacionado y transición a CONFIRMADO', async () => {
    sunatAdapter.resetCircuit();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tributario/liquidaciones-compra',
      headers: { authorization: `Bearer ${compradorToken}` },
      payload: {
        orden_compra_id: ordenLiquidadaId,
        emisor_ruc: '20601234567',
        emisor_razon_social: 'Frigorífico Central del Perú SAC',
        productor_dni: '45892134',
        productor_nombre: 'Saturnino Quispe Mamani',
        productor_ppa_codigo: 'PPA-2026-004589',
        monto_total_pen: 8500.0,
        items: [
          {
            descripcion: '4 Toros Cebú Engorde en Pie',
            cantidad: 4,
            unidad_medida: 'NIU',
            precio_unitario_pen: 2125.0,
            monto_total_pen: 8500.0
          }
        ]
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const data = res.json();
    assert.strictEqual(data.sunat_status, 'CONFIRMADO');

    const comprobante = data.comprobante;
    assert.ok(comprobante.id);
    assert.strictEqual(comprobante.serie, 'E001');
    assert.strictEqual(comprobante.correlativo, 1);
    assert.strictEqual(comprobante.tipo_comprobante, 'LIQUIDACION_COMPRA_ELECTRONICA');
    assert.strictEqual(comprobante.receptor_tipo_doc, 'DNI');
    assert.strictEqual(comprobante.receptor_num_doc, '45892134');
    assert.strictEqual(comprobante.monto_total, 8500.0);
    assert.strictEqual(comprobante.estado_sunat, 'CONFIRMADO');
    assert.strictEqual(comprobante.cdr_sunat_codigo, '0');

    comprobanteConfirmadoId = comprobante.id;

    // Verificar inserción en outbox_events
    const outboxRes = await pool.query(
      `SELECT * FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'COMPROBANTE_SUNAT_CONFIRMADO'`,
      [comprobante.id]
    );
    assert.strictEqual(outboxRes.rows.length, 1);
    assert.strictEqual(outboxRes.rows[0].status, 'PENDIENTE');
  });

  test('2. Validación tributaria: rechaza emitir liquidación de compra si la orden no está en estado LIQUIDADO o si falta DNI', async () => {
    // 1. Intento sobre orden en PENDIENTE_PAGO
    const resOrdenPendiente = await app.inject({
      method: 'POST',
      url: '/api/v1/tributario/liquidaciones-compra',
      headers: { authorization: `Bearer ${compradorToken}` },
      payload: {
        orden_compra_id: ordenPendienteId,
        emisor_ruc: '20601234567',
        emisor_razon_social: 'Frigorífico Central del Perú SAC',
        productor_dni: '45892134',
        productor_nombre: 'Saturnino Quispe',
        monto_total_pen: 6000.0
      }
    });
    assert.strictEqual(resOrdenPendiente.statusCode, 400);
    assert.match(resOrdenPendiente.json().message, /estado 'LIQUIDADO'/);

    // 2. Intento con DNI inválido
    const resDniInvalido = await app.inject({
      method: 'POST',
      url: '/api/v1/tributario/liquidaciones-compra',
      headers: { authorization: `Bearer ${compradorToken}` },
      payload: {
        orden_compra_id: ordenLiquidada2Id,
        emisor_ruc: '20601234567',
        emisor_razon_social: 'Frigorífico Central del Perú SAC',
        productor_dni: '123', // Inválido
        productor_nombre: 'Productor Inválido',
        monto_total_pen: 12500.0
      }
    });
    assert.strictEqual(resDniInvalido.statusCode, 400);
    assert.match(resDniInvalido.json().message, /DNI de 8 dígitos/);
  });

  test('3. Manejo de fallos y resiliencia: simulación de timeout/caída externa donde el registro pasa a ENVIADO_PENDIENTE sin alterar la orden de compra', async () => {
    sunatAdapter.setForceFailureSimulation(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tributario/liquidaciones-compra',
      headers: { authorization: `Bearer ${compradorToken}` },
      payload: {
        orden_compra_id: ordenLiquidada2Id,
        emisor_ruc: '20601234567',
        emisor_razon_social: 'Frigorífico Central del Perú SAC',
        productor_dni: '78451296',
        productor_nombre: 'Demetrio Huamán',
        monto_total_pen: 12500.0
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const data = res.json();
    assert.strictEqual(data.sunat_status, 'ENVIADO_PENDIENTE');

    const comprobante = data.comprobante;
    assert.strictEqual(comprobante.serie, 'E001');
    assert.strictEqual(comprobante.correlativo, 2);
    assert.strictEqual(comprobante.estado_sunat, 'ENVIADO_PENDIENTE');
    assert.strictEqual(comprobante.cdr_sunat_codigo, null);
    assert.ok(comprobante.next_retry_at);

    comprobantePendienteId = comprobante.id;

    // Verificar que la orden de compra no sufrió alteraciones y sigue en LIQUIDADO
    const ordenCheck = await pool.query<{ estado: string }>(
      `SELECT estado FROM ordenes_compra WHERE id = $1`,
      [ordenLiquidada2Id]
    );
    assert.strictEqual(ordenCheck.rows[0]!.estado, 'LIQUIDADO');
  });

  test('4. Conciliación: ejecución del endpoint de conciliación resuelve registros pendientes asignando CDR exitoso', async () => {
    // Restablecer la simulación de fallos para que la conciliación proceda con éxito
    sunatAdapter.setForceFailureSimulation(false);

    let res = await app.inject({
      method: 'POST',
      url: '/api/v1/tributario/conciliar-pendientes',
      headers: { authorization: `Bearer ${compradorToken}` }
    });
    assert.strictEqual(res.statusCode, 403, 'Solo ADMIN concilia');

    const admin = await crearUsuarioConRol(app, authService, 'ADMIN', 'tax');
    res = await app.inject({
      method: 'POST',
      url: '/api/v1/tributario/conciliar-pendientes',
      headers: { authorization: `Bearer ${admin.token}` }
    });

    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.ok(data.procesados >= 1);
    assert.strictEqual(data.confirmados, data.procesados);
    assert.strictEqual(data.pendientes, 0);

    // Verificar en BD que el comprobante que estaba pendiente ahora está CONFIRMADO
    const compCheck = await pool.query<{ estado_sunat: string; cdr_sunat_codigo: string }>(
      `SELECT estado_sunat, cdr_sunat_codigo FROM comprobantes_tributarios WHERE id = $1`,
      [comprobantePendienteId]
    );
    assert.strictEqual(compCheck.rows[0]!.estado_sunat, 'CONFIRMADO');
    assert.strictEqual(compCheck.rows[0]!.cdr_sunat_codigo, '0');

    // Verificar que se haya emitido el evento Outbox
    const outboxRes = await pool.query(
      `SELECT * FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'COMPROBANTE_SUNAT_CONFIRMADO'`,
      [comprobantePendienteId]
    );
    assert.strictEqual(outboxRes.rows.length, 1);
  });

  test('5. Solicitud de factoring CAVALI calculando montos de adelanto y trazabilidad única', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/fintech/cavali/solicitar-factoring',
      headers: { authorization: `Bearer ${compradorToken}` },
      payload: {
        orden_id: ordenLiquidadaId,
        comprobante_id: comprobanteConfirmadoId,
        porcentaje_adelanto: 80.0,
        tasa_descuento_mensual: 1.2
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const data = res.json();

    const solicitud = data.solicitud;
    assert.ok(solicitud.id);
    assert.strictEqual(solicitud.orden_id, ordenLiquidadaId);
    assert.strictEqual(solicitud.comprobante_id, comprobanteConfirmadoId);
    assert.strictEqual(solicitud.monto_factura, 8500.0);
    assert.strictEqual(solicitud.porcentaje_adelanto, 80.0);
    assert.strictEqual(solicitud.tasa_descuento_mensual, 1.2);
    assert.strictEqual(solicitud.estado, 'CONFIRMADO');
    assert.match(solicitud.cavali_tracking_id, /^CAVALI-FT-\d+-[A-F0-9]{8}$/);

    // Cálculo:
    // adelanto bruto = 8500 * 0.8 = 6800.00
    // costo financiero = 6800 * 0.012 = 81.60
    // adelanto neto = 6800 - 81.60 = 6718.40
    assert.strictEqual(data.monto_adelanto_calculado, 6718.4);
    assert.strictEqual(solicitud.monto_adelanto_neto, 6718.4);

    // Verificar Outbox FACTORING_CAVALI_REGISTRADO
    const outboxRes = await pool.query(
      `SELECT * FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'FACTORING_CAVALI_REGISTRADO'`,
      [solicitud.id]
    );
    assert.strictEqual(outboxRes.rows.length, 1);
    assert.strictEqual(outboxRes.rows[0].status, 'PENDIENTE');
  });

  test('6. Unicidad: rechazo al intentar registrar comprobantes con serie y correlativo duplicados', async () => {
    // Intentar insertar directamente un duplicado en (tipo_comprobante, serie, correlativo)
    await assert.rejects(
      async () => {
        await pool.query(
          `INSERT INTO comprobantes_tributarios (
             orden_id, tipo_comprobante, serie, correlativo, emisor_ruc,
             receptor_num_doc, receptor_tipo_doc, monto_subtotal, monto_igv,
             monto_total, estado_sunat, external_correlation_id, xml_payload_resumen
           ) VALUES (
             $1, 'LIQUIDACION_COMPRA_ELECTRONICA', 'E001', 1, '20601234567',
             '45892134', 'DNI', 8500, 0, 8500, 'CONFIRMADO',
             'DUPLICATE-TEST-CORRELATION-ID', '{}'::jsonb
           );`,
          [ordenLiquidadaId]
        );
      },
      (err: any) => {
        assert.strictEqual(err.code, '23505', 'Debe disparar violación de constraint única PostgreSQL');
        assert.match(err.constraint, /uq_comprobante_serie_correlativo/);
        return true;
      }
    );
  });
});
