import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { OrdenesConsultaService, type OrdenResumen } from './subastas/ordenes-consulta.service.js';

test('el cursor no omite la segunda orden del mismo milisegundo con el parser instalado de pg', async () => {
  const organizacionId = '00000000-0000-4000-8000-000000000001';
  const ordenes: OrdenResumen[] = [
    {
      id: '00000000-0000-4000-8000-000000000002',
      lote_id: '00000000-0000-4000-8000-000000000012',
      codigo_lote: 'CURSOR-FICTICIO-1',
      estado: 'PENDIENTE_PAGO',
      monto_adjudicado: 1000,
      comision_plataforma: 10,
      total_a_pagar: 1010,
      organizacion_compradora_id: organizacionId,
      organizacion_vendedora_id: '00000000-0000-4000-8000-000000000003',
      created_at: '2026-11-04T10:00:00.123900Z'
    },
    {
      id: '00000000-0000-4000-8000-000000000004',
      lote_id: '00000000-0000-4000-8000-000000000014',
      codigo_lote: 'CURSOR-FICTICIO-2',
      estado: 'PENDIENTE_PAGO',
      monto_adjudicado: 2000,
      comision_plataforma: 20,
      total_a_pagar: 2020,
      organizacion_compradora_id: organizacionId,
      organizacion_vendedora_id: '00000000-0000-4000-8000-000000000003',
      created_at: '2026-11-04T10:00:00.123800Z'
    }
  ];

  // Solo sustituye la consulta externa: el servicio y los decodificadores de pg son reales.
  const pool = {
    async query(sql: string, params: unknown[]) {
      const parse = pg.types.getTypeParser(pg.types.builtins.TIMESTAMPTZ, 'text');
      // PostgreSQL compara los seis decimales; Date no debe intervenir en este límite.
      const ts = (params[2] as string | undefined)?.replace(/\.(\d{1,6})Z$/, (_, us: string) => `.${us.padEnd(6, '0')}Z`);
      const rows = ordenes
        .filter((o) => !ts || o.created_at < ts || (o.created_at === ts && o.id < (params[3] as string)))
        .slice(0, params[1] as number)
        .map((o) => ({
          ...o,
          created_at: parse(o.created_at.replace('T', ' ').replace('Z', '+00')),
          ...(/\bAS cursor_ts\b/i.test(sql) ? { cursor_ts: o.created_at } : {})
        }));
      return { rows };
    }
  } as unknown as pg.Pool;
  const service = new OrdenesConsultaService(pool);

  const primera = await service.listar(organizacionId, { limit: '1' });
  assert.ok(primera.next_cursor);
  const segunda = await service.listar(organizacionId, { limit: '1', cursor: primera.next_cursor });

  assert.deepStrictEqual([...primera.data, ...segunda.data].map((o) => o.id), [
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000004'
  ]);
  assert.strictEqual(JSON.parse(Buffer.from(primera.next_cursor, 'base64url').toString())[0], '2026-11-04T10:00:00.123900Z');
  assert.strictEqual(Object.hasOwn(primera.data[0]!, 'cursor_ts'), false);
  assert.strictEqual(Object.hasOwn(segunda.data[0]!, 'cursor_ts'), false);
  assert.strictEqual(segunda.next_cursor, null);
});

test('cursores con fechas u horas imposibles se rechazan antes de consultar PostgreSQL', async () => {
  let consultas = 0;
  const pool = { async query() { consultas++; throw new Error('No debe consultar con un cursor inválido'); } } as unknown as pg.Pool;
  const service = new OrdenesConsultaService(pool);
  for (const timestamp of ['2026-02-30T10:00:00.123900Z', '2026-99-04T10:00:00.123900Z', '2026-01-04T24:00:00Z', '0000-01-04T10:00:00Z']) {
    const cursor = Buffer.from(JSON.stringify([timestamp, '00000000-0000-4000-8000-000000000002'])).toString('base64url');
    await assert.rejects(() => service.listar('00000000-0000-4000-8000-000000000001', { cursor }), (error: unknown) => {
      assert.ok(error instanceof Error && 'statusCode' in error);
      assert.strictEqual(error.statusCode, 400);
      assert.strictEqual(error.message, 'cursor inválido.');
      return true;
    });
  }
  assert.strictEqual(consultas, 0);
});

test('el cursor conserva timestamps válidos bisiestos, antiguos y de microsegundos', async () => {
  const enviados: unknown[][] = [];
  const pool = { async query(_sql: string, params: unknown[]) { enviados.push(params); return { rows: [] }; } } as unknown as pg.Pool;
  const service = new OrdenesConsultaService(pool);
  for (const timestamp of ['2024-02-29T10:00:00.123Z', '2026-01-04T10:00:00.123900Z', '2026-01-04T10:00:00Z']) {
    const cursor = Buffer.from(JSON.stringify([timestamp, '00000000-0000-4000-8000-000000000002'])).toString('base64url');
    await service.listar('00000000-0000-4000-8000-000000000001', { cursor });
    assert.strictEqual(enviados.at(-1)![2], timestamp);
  }
  assert.strictEqual(enviados.length, 3);
});
