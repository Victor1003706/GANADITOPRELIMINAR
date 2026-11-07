import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import {
  CATALOGO_CORTES_NTP_201_055,
  type ResultadoEscandalloAnatomico,
  type CrearOrdenGmxResponse,
  type OrderbookGmxResponse
} from '@ganadito/contracts';

describe('Bolsa de Valores Cárnica (GMX) y Motor de Escandallo Anatómico (NTP 201.055)', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);

  let compradorToken: string;
  let vendedorToken: string;

  let ordenCompraExactaId: string;

  before(async () => {
    await runInitialMigration();
    await app.ready();

    // Limpiar órdenes y calces previos para garantizar un libro de órdenes determinista
    await pool.query('DELETE FROM gmx_calces;');
    await pool.query('DELETE FROM gmx_ordenes;');

    // 1. Registrar Comprador Institucional (Supermercado / Frigorífico)
    const cRes = await authService.register({
      email: `comprador_gmx_${Date.now()}@test.com`,
      password: 'PasswordGmx2026!',
      nombre: 'Carnes Selectas del Perú SAC',
      organizacion_nombre: `Carnes Selectas SAC ${Date.now()}`,
      rol_inicial: 'COMPRADOR'
    });
    const cLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: cRes.user.email, password: 'PasswordGmx2026!' }
    });
    compradorToken = cLogin.json().access_token;

    // 2. Registrar Vendedor Mayorista (Camal / Productor)
    const vRes = await authService.register({
      email: `vendedor_gmx_${Date.now()}@test.com`,
      password: 'PasswordGmx2026!',
      nombre: 'Camal Frigorífico Metropolitano EIRL',
      organizacion_nombre: `Frigorífico Metropolitano ${Date.now()}`,
      rol_inicial: 'VENDEDOR'
    });
    const vLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: vRes.user.email, password: 'PasswordGmx2026!' }
    });
    vendedorToken = vLogin.json().access_token;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  test('1. Calculadora de escandallo (NTP 201.055): suma de 18 cortes + merma coincide con peso de canal y margen neto > 22%', async () => {
    const pesoCanalKg = 280.0;
    const costoKiloCanalPEN = 15.5;
    const margenObjetivoPct = 0.22;
    const mermaDespostePct = 0.035;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gmx/escandallo',
      payload: {
        pesoCanalKg,
        costoKiloCanalPEN,
        margenObjetivoPct,
        mermaDespostePct
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const data: ResultadoEscandalloAnatomico = res.json();

    assert.strictEqual(data.norma_tecnica, 'NTP 201.055');
    assert.strictEqual(data.cortes.length, 18);
    assert.strictEqual(CATALOGO_CORTES_NTP_201_055.length, 18);

    // Verificar cuartos trasero (8) y delantero (10)
    const traseros = data.cortes.filter(c => c.cuarto === 'CUARTO_TRASERO');
    const delanteros = data.cortes.filter(c => c.cuarto === 'CUARTO_DELANTERO');
    assert.strictEqual(traseros.length, 8);
    assert.strictEqual(delanteros.length, 10);

    // Suma de los 18 cortes + merma debe coincidir exactamente con pesoCanalKg
    const sumaPesosCortes = Number(
      data.cortes.reduce((acc, c) => acc + c.peso_estimado_kg, 0).toFixed(2)
    );
    const sumaTotalMasMerma = Number((sumaPesosCortes + data.merma_kg).toFixed(2));
    assert.strictEqual(sumaTotalMasMerma, pesoCanalKg);
    assert.strictEqual(data.suma_cortes_mas_merma_kg, pesoCanalKg);

    // Verificar que el margen neto ponderado cumpla la meta (> 22%)
    assert.ok(
      data.margen_neto_ponderado_pct > 22,
      `El margen neto ponderado (${data.margen_neto_ponderado_pct}%) debe superar el 22%`
    );
    assert.ok(data.