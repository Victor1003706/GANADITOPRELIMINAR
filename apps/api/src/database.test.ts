import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool, runInitialMigration } from './db.js';

describe('Integración PostgreSQL + PostGIS (Ganadito)', () => {
  after(async () => {
    await closePool();
  });

  test('debe ejecutar la migración inicial 0001 y verificar la extensión PostGIS', async () => {
    // 1. Ejecutar migración canónica DDL
    await runInitialMigration();

    const pool = getPool();

    // 2. Comprobar versión de PostGIS
    const postgisResult = await pool.query<{ postgis_version: string }>('SELECT PostGIS_Version();');
    assert.ok(postgisResult.rows.length > 0, 'PostGIS debe retornar al menos una fila');
    const version = postgisResult.rows[0]?.postgis_version;
    assert.ok(typeof version === 'string' && version.length > 0, `PostGIS_Version debe ser una cadena válida (obtenido: ${version})`);
    assert.match(version, /^3\./, `PostGIS debe ser versión 3.x (obtenido: ${version})`);

    // 3. Comprobar existencia de todas las tablas requeridas
    const requiredTables = [
      'organizaciones',
      'users',
      'user_organizaciones_roles',
      'establecimientos',
      'cotizaciones_spot',
      'lotes_subasta',
      'subasta_pujas',
      'ordenes_compra',
      'pagos_transacciones',
      'liquidaciones_vendedores',
      'bovinos',
      'pasaporte_bovino_events',
      'pools_compra_mayorista',
      'pool_participaciones',
      'gmx_ordenes',
      'gmx_calces',
      'transportistas_unidades',
      'fletes_solicitudes',
      'comprobantes_tributarios',
      'factoring_cavali_solicitudes',
      'idempotency_records',
      'outbox_events'
    ];

    const tablesResult = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`
    );
    const existingTables = new Set(tablesResult.rows.map((r) => r.table_name));

    for (const table of requiredTables) {
      assert.ok(existingTables.has(table), `La tabla requerida '${table}' debe existir en el esquema public`);
    }

    // 4. Comprobar índice espacial GiST en establecimientos
    const indexResult = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'establecimientos' AND indexname = 'idx_establecimientos_spatial';`
    );
    assert.strictEqual(indexResult.rows.length, 1, 'El índice espacial GiST idx_establecimientos_spatial debe existir');

    // 5. Comprobar constraint única de secuencia en subasta_pujas
    const constraintResult = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname = 'uq_lote_secuencia';`
    );
    assert.strictEqual(constraintResult.rows.length, 1, 'El constraint uq_lote_secuencia debe existir en subasta_pujas');

    // 6. Comprobar constraint única uq_pool_organizacion en pool_participaciones
    const poolConstraintRes = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname = 'uq_pool_organizacion';`
    );
    assert.strictEqual(poolConstraintRes.rows.length, 1, 'El constraint uq_pool_organizacion debe existir en pool_participaciones');

    // 7. Comprobar índices del libro de órdenes GMX
    const gmxIdxRes = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'gmx_ordenes' AND indexname IN ('idx_gmx_orderbook_compra', 'idx_gmx_orderbook_venta');`
    );
    assert.strictEqual(gmxIdxRes.rows.length, 2, 'Los índices de calce GMX deben existir en gmx_ordenes');
  });
});
