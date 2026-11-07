import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type pg from 'pg';
import { getPool, closePool, runInitialMigration } from './db.js';
import { OrdenesConsultaService } from './subastas/ordenes-consulta.service.js';

// PostgreSQL real solo en los servicios efímeros de CI; la regresión local es ordenes-cursor.test.ts.
describe('cursor de órdenes con PostgreSQL real', {
  concurrency: 1,
  skip: process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
}, () => {
  before(async () => {
    assert.strictEqual(process.env.GANADITO_ALLOW_CURSOR_DB_TEST, 'isolated-ci-fixtures', 'Falta autorización del job efímero');
    const destino = new URL(process.env.DATABASE_URL ?? '');
    assert.ok(['postgres:', 'postgresql:'].includes(destino.protocol), 'Protocolo de prueba no permitido');
    assert.ok(['localhost', '127.0.0.1'].includes(destino.hostname), 'Las pruebas requieren el servicio loopback efímero');
    assert.strictEqual(destino.pathname, '/ganadito', 'Base de fixtures del job incorrecta');
    assert.ok(destino.port === '' || destino.port === '5432', 'Puerto de fixtures incorrecto');
    assert.strictEqual(destino.search, '', 'No se permiten overrides de conexión');
    assert.strictEqual(destino.hash, '', 'No se permiten fragmentos de conexión');
    await runInitialMigration();
  });
  after(closePool);

  const casos = [
    {
      nombre: 'recorre dos órdenes del mismo milisegundo sin omitir ni duplicar',
      timestamps: ['2026-11-04T10:00:00.123900Z', '2026-11-04T10:00:00.123800Z'],
      ordenEsperado: [0, 1]
    },
    {
      nombre: 'desempata por UUID descendente cuando los seis decimales son idénticos',
      timestamps: ['2026-11-04T10:00:00.123800Z', '2026-11-04T10:00:00.123800Z'],
      ordenEsperado: [1, 0]
    }
  ];

  for (const caso of casos) {
    test(caso.nombre, async () => {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL TIME ZONE 'America/Lima'");
        const compradorId = crypto.randomUUID();
        const organizacionCompradoraId = crypto.randomUUID();
        const organizacionVendedoraId = crypto.randomUUID();
        const prefijoId = crypto.randomUUID().slice(0, 24);
        const ordenesIds = [`${prefijoId}000000000001`, `${prefijoId}000000000002`];

        await client.query(
          `INSERT INTO users (id, email, password_hash, nombre) VALUES ($1, $2, 'fixture-sin-login', 'Comprador cursor ficticio')`,
          [compradorId, `cursor-${compradorId}@example.invalid`]
        );
        await client.query(
          `INSERT INTO organizaciones (id, razon_social) VALUES ($1, 'Compradora cursor ficticia'), ($2, 'Vendedora cursor ficticia')`,
          [organizacionCompradoraId, organizacionVendedoraId]
        );
        for (let i = 0; i < ordenesIds.length; i++) {
          const loteId = crypto.randomUUID();
          await client.query(
            `INSERT INTO lotes_subasta
             (id, codigo_lote, vendedor_id, estado, precio_base, precio_actual, incremento_minimo, fecha_inicio, fecha_cierre)
             VALUES ($1, $2, $3, 'ADJUDICADO', 1000, 1000, 10, NOW() - INTERVAL '1 hour', NOW())`,
            [loteId, `CURSOR-${loteId}`, organizacionVendedoraId]
          );
          await client.query(
            `INSERT INTO ordenes_compra
             (id, lote_id, comprador_id, organizacion_compradora_id, organizacion_vendedora_id,
              monto_adjudicado, comision_plataforma, total_a_pagar, created_at)
             VALUES ($1, $2, $3, $4, $5, 1000, 10, 1010, $6::timestamptz)`,
            [ordenesIds[i], loteId, compradorId, organizacionCompradoraId, organizacionVendedoraId, caso.timestamps[i]]
          );
        }

        // El mismo cliente mantiene todas las consultas dentro de la transacción de fixtures propios.
        const service = new OrdenesConsultaService(client