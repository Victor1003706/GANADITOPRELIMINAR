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
    assert.ok(data.margen_neto_ponderado_ratio > 0.22);
    assert.ok(data.ingreso_total_estimado_pen > data.costo_total_canal_pen);
  });

  test('2. Creación de orden de compra sin contraparte inmediata permanece en estado ABIERTA', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gmx/ordenes',
      headers: { authorization: `Bearer ${compradorToken}` },
      payload: {
        tipo_operacion: 'COMPRA',
        producto: 'MEDIA_CANAL',
        cantidad_kg: 500,
        precio_kilo_limite: 16.0
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const body: CrearOrdenGmxResponse = res.json();

    assert.strictEqual(body.orden.estado, 'ABIERTA');
    assert.strictEqual(body.orden.cantidad_kg, 500);
    assert.strictEqual(body.orden.cantidad_restante_kg, 500);
    assert.strictEqual(body.orden.precio_kilo_limite, 16.0);
    assert.strictEqual(body.calces.length, 0);

    ordenCompraExactaId = body.orden.id;

    // Verificar aparición en el orderbook público
    const bookRes = await app.inject({
      method: 'GET',
      url: '/api/v1/gmx/orderbook?producto=MEDIA_CANAL'
    });
    assert.strictEqual(bookRes.statusCode, 200);
    const book: OrderbookGmxResponse = bookRes.json();
    assert.strictEqual(book.compras.length, 1);
    assert.strictEqual(book.compras[0]!.precio_kilo, 16.0);
    assert.strictEqual(book.compras[0]!.volumen_total_kg, 500);
  });

  test('3. Inserción de orden de venta que calza exactamente con la orden previa: ambas pasan a CALZADA y se registra en gmx_calces', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gmx/ordenes',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        tipo_operacion: 'VENTA',
        producto: 'MEDIA_CANAL',
        cantidad_kg: 500,
        precio_kilo_limite: 15.8 // <= 16.0 de la compra activa
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const body: CrearOrdenGmxResponse = res.json();

    // La orden de venta entrante queda CALZADA con 0 kg restantes
    assert.strictEqual(body.orden.estado, 'CALZADA');
    assert.strictEqual(body.orden.cantidad_restante_kg, 0);
    assert.strictEqual(body.calces.length, 1);

    const calce = body.calces[0]!;
    assert.strictEqual(calce.orden_compra_id, ordenCompraExactaId);
    assert.strictEqual(calce.orden_venta_id, body.orden.id);
    assert.strictEqual(calce.cantidad_kg, 500);
    assert.strictEqual(calce.precio_pactado_kilo, 16.0);
    assert.strictEqual(calce.monto_total, 8000.0); // 500 * 16.0

    // Verificar en BD que la orden de compra previa también pasó a CALZADA
    const compraDb = await pool.query(
      `SELECT estado, cantidad_restante_kg FROM gmx_ordenes WHERE id = $1`,
      [ordenCompraExactaId]
    );
    assert.strictEqual(compraDb.rows[0].estado, 'CALZADA');
    assert.strictEqual(Number(compraDb.rows[0].cantidad_restante_kg), 0);
  });

  test('4. Calce parcial: orden de compra de 1000 kg absorbe una venta de 400 kg (venta CALZADA y compra PARCIALMENTE_CALZADA con 600 kg restantes)', async () => {
    // 4.1 Vendedor publica oferta de 400 kg de CUARTO_TRASERO a S/ 19.50
    const ventaRes = await app.inject({
      method: 'POST',
      url: '/api/v1/gmx/ordenes',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        tipo_operacion: 'VENTA',
        producto: 'CUARTO_TRASERO',
        cantidad_kg: 400,
        precio_kilo_limite: 19.5
      }
    });
    assert.strictEqual(ventaRes.statusCode, 201);
    const ventaData: CrearOrdenGmxResponse = ventaRes.json();
    assert.strictEqual(ventaData.orden.estado, 'ABIERTA');
    const ordenVentaParcialId = ventaData.orden.id;

    // 4.2 Comprador lanza orden de compra de 1000 kg a S/ 20.00
    const compraRes = await app.inject({
      method: 'POST',
      url: '/api/v1/gmx/ordenes',
      headers: { authorization: `Bearer ${compradorToken}` },
      payload: {
        tipo_operacion: 'COMPRA',
        producto: 'CUARTO_TRASERO',
        cantidad_kg: 1000,
        precio_kilo_limite: 20.0
      }
    });
    assert.strictEqual(compraRes.statusCode, 201);
    const compraData: CrearOrdenGmxResponse = compraRes.json();

    // La orden de compra absorbe 400 kg y queda PARCIALMENTE_CALZADA con 600 kg restantes
    assert.strictEqual(compraData.orden.estado, 'PARCIALMENTE_CALZADA');
    assert.strictEqual(compraData.orden.cantidad_kg, 1000);
    assert.strictEqual(compraData.orden.cantidad_restante_kg, 600);
    assert.strictEqual(compraData.calces.length, 1);
    assert.strictEqual(compraData.calces[0]!.cantidad_kg, 400);
    assert.strictEqual(compraData.calces[0]!.precio_pactado_kilo, 19.5);
    assert.strictEqual(compraData.calces[0]!.monto_total, 7800.0);

    // La orden de venta de 400 kg debe haber pasado a CALZADA con 0 kg restantes
    const ventaDb = await pool.query(
      `SELECT estado, cantidad_restante_kg FROM gmx_ordenes WHERE id = $1`,
      [ordenVentaParcialId]
    );
    assert.strictEqual(ventaDb.rows[0].estado, 'CALZADA');
    assert.strictEqual(Number(ventaDb.rows[0].cantidad_restante_kg), 0);

    // El orderbook de CUARTO_TRASERO debe mostrar los 600 kg restantes en COMPRA y 0 en VENTA
    const bookRes = await app.inject({
      method: 'GET',
      url: '/api/v1/gmx/orderbook?producto=CUARTO_TRASERO'
    });
    const book: OrderbookGmxResponse = bookRes.json();
    assert.strictEqual(book.compras.length, 1);
    assert.strictEqual(book.compras[0]!.volumen_total_kg, 600);
    assert.strictEqual(book.ventas.length, 0);
  });

  test('5. Emisión de evento Outbox (GMX_CALCE_GENERADO) tras cada calce exitoso', async () => {
    const calcesDb = await pool.query(`SELECT id FROM gmx_calces`);
    assert.strictEqual(calcesDb.rows.length, 2);

    const calceIds = calcesDb.rows.map(r => r.id);
    const outboxRes = await pool.query(
      `SELECT * FROM outbox_events
       WHERE aggregate_type = 'GMX_CALCE'
         AND event_type = 'GMX_CALCE_GENERADO'
         AND aggregate_id = ANY($1::text[])`,
      [calceIds]
    );

    assert.strictEqual(outboxRes.rows.length, 2);
  });
});
