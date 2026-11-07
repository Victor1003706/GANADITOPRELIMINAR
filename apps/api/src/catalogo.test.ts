import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';

describe('Catálogo de lotes (GET /subastas) y detalle del lote', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);
  const lotes: string[] = [];
  const establecimientos: string[] = [];
  let vendedor = '';
  let otroVendedor = '';
  let comprador = '';
  let establoId = '';
  // Fechas de cierre propias y lejanas para que el orden del catálogo sea determinista.
  const base = Date.now() + 20 * 365 * 86_400_000 + Math.floor(Math.random() * 1e9);

  async function token(rol: 'VENDEDOR' | 'COMPRADOR', etiqueta: string) {
    const email = `cat_${etiqueta}_${crypto.randomUUID().slice(0, 8)}@test.com`;
    await authService.register({ email, password: 'PasswordCat2026!', nombre: etiqueta, organizacion_nombre: `Org ${etiqueta} ${email}`, rol_inicial: rol });
    return (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'PasswordCat2026!' } })).json().access_token as string;
  }

  async function crearLote(t: string, extra: Record<string, unknown>, offsetMin: number) {
    const r = await app.inject({
      method: 'POST', url: '/api/v1/subastas', headers: { authorization: `Bearer ${t}` },
      payload: { codigo_lote: `CAT-${crypto.randomUUID().slice(0, 10)}`, precio_base: 5000, incremento_minimo: 100,
        fecha_cierre: new Date(base + offsetMin * 60_000).toISOString(), ...extra }
    });
    if (r.statusCode === 201) lotes.push(r.json().id);
    return r;
  }

  before(async () => {
    await runInitialMigration();
    await app.ready();
    vendedor = await token('VENDEDOR', 'vend');
    otroVendedor = await token('VENDEDOR', 'otro');
    comprador = await token('COMPRADOR', 'comp');
    const est = await app.inject({
      method: 'POST', url: '/api/v1/establecimientos', headers: { authorization: `Bearer ${vendedor}` },
      payload: { nombre_comercial: 'Establo catálogo', tipo: 'ESTABLO', direccion_texto: 'Km 5', ubigeo: '210101', latitud: -15.843217, longitud: -70.023519 }
    });
    assert.strictEqual(est.statusCode, 201, est.body);
    establoId = est.json().id;
    establecimientos.push(establoId);
  });

  after(async () => {
    if (lotes.length) await pool.query('DELETE FROM lotes_subasta WHERE id = ANY($1::uuid[])', [lotes]);
    if (establecimientos.length) await pool.query('DELETE FROM establecimientos WHERE id = ANY($1::uuid[])', [establecimientos]);
    await app.close();
    await closePool();
  });

  test('el lote guarda qué se vende y valida el detalle', async () => {
    const ok = await crearLote(vendedor, { cantidad_animales: 12, categoria: 'TORETE', raza: 'Brown Swiss', descripcion: 'Lote de 12 toretes de 18 meses', establecimiento_id: establoId }, 1);
    assert.strictEqual(ok.statusCode, 201, ok.body);
    assert.strictEqual(ok.json().cantidad_animales, 12);
    assert.strictEqual(ok.json().raza, 'Brown Swiss');
    assert.strictEqual((await crearLote(vendedor, { cantidad_animales: 0 }, 2)).statusCode, 400);
    assert.strictEqual((await crearLote(vendedor, { descripcion: 'x'.repeat(501) }, 3)).statusCode, 400);
    // El establecimiento de origen debe ser propio.
    assert.strictEqual((await crearLote(otroVendedor, { establecimiento_id: establoId }, 4)).statusCode, 403);
    assert.strictEqual((await crearLote(vendedor, { establecimiento_id: { x: 1 } }, 6)).statusCode, 400);
    assert.strictEqual((await crearLote(vendedor, { establecimiento_id: 'no-uuid' }, 7)).statusCode, 400);
  });

  test('público: solo ACTIVO por defecto, nunca BORRADOR, y origen aproximado para terceros', async () => {
    const borrador = await crearLote(vendedor, { estado: 'BORRADOR', categoria: 'VAQUILLONA' }