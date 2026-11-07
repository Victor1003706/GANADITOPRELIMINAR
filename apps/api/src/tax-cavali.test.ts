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
 