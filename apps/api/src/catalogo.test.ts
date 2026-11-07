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
    const borrador = await crearLote(vendedor, { estado: 'BORRADOR', categoria: 'VAQUILLONA' }, 5);
    assert.strictEqual(borrador.statusCode, 201);
    const r = await app.inject({ method: 'GET', url: '/api/v1/subastas?limit=50' });
    assert.strictEqual(r.statusCode, 200, r.body);
    const ids = r.json().data.map((l: any) => l.id);
    assert.ok(!ids.includes(borrador.json().id), 'un BORRADOR no es público');
    assert.ok(r.json().data.every((l: any) => l.estado === 'ACTIVO'));
    assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/subastas?estado=BORRADOR' })).statusCode, 400);

    // Buscar nuestro lote con origen recorriendo el catálogo.
    let cursor: string | null = null;
    let propio: any;
    for (let i = 0; i < 40 && !propio; i++) {
      const pagina: any = (await app.inject({ method: 'GET', url: `/api/v1/subastas?limit=50${cursor ? `&cursor=${cursor}` : ''}`, headers: { authorization: `Bearer ${comprador}` } })).json();
      propio = pagina.data.find((l: any) => l.establecimiento_id === establoId);
      cursor = pagina.next_cursor;
      if (!cursor) break;
    }
    assert.ok(propio, 'el lote con origen aparece en el catálogo');
    assert.strictEqual(propio.es_mio, false);
    assert.strictEqual(propio.origen.ubicacion_aproximada, true, 'un ESTABLO ajeno se muestra aproximado');
    assert.ok(Math.abs(propio.origen.latitud - -15.843217) > 1e-4, 'no revela la latitud exacta');
    assert.strictEqual(propio.origen.ubigeo, '210101');
  });

  test('mios=true: exige sesión y lista todos los lotes propios, incluidos borradores', async () => {
    assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/subastas?mios=true' })).statusCode, 401);
    const r = await app.inject({ method: 'GET', url: '/api/v1/subastas?mios=true&limit=50', headers: { authorization: `Bearer ${vendedor}` } });
    assert.strictEqual(r.statusCode, 200);
    const datos = r.json().data;
    assert.ok(datos.some((l: any) => l.estado === 'BORRADOR'));
    assert.ok(datos.every((l: any) => l.es_mio === true));
    const conOrigen = datos.find((l: any) => l.establecimiento_id === establoId);
    assert.strictEqual(conOrigen.origen.ubicacion_aproximada, false, 'el dueño ve su posición exacta');
    const ajenos = (await app.inject({ method: 'GET', url: '/api/v1/subastas?mios=true&limit=50', headers: { authorization: `Bearer ${otroVendedor}` } })).json().data;
    assert.ok(!ajenos.some((l: any) => lotes.includes(l.id)), 'otra organización no ve mis lotes con mios=true');
  });

  test('paginación por cursor sin saltos ni duplicados', async () => {
    for (let i = 0; i < 3; i++) await crearLote(otroVendedor, { categoria: `PAG-${i}` }, 100 + i);
    const vistos: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const r: any = (await app.inject({ method: 'GET', url: `/api/v1/subastas?mios=true&limit=1${cursor ? `&cursor=${cursor}` : ''}`, headers: { authorization: `Bearer ${otroVendedor}` } })).json();
      vistos.push(...r.data.map((l: any) => l.id));
      cursor = r.next_cursor;
      if (!cursor) break;
    }
    assert.strictEqual(new Set(vistos).size, vistos.length, 'sin duplicados');
    assert.strictEqual(vistos.length, 3);
    assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/subastas?cursor=xxx' })).statusCode, 400);
    assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v1/subastas?limit=999' })).statusCode, 400);
    const malo = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    for (const c of [malo(['2026-99-99T00:00:00Z', crypto.randomUUID()]), malo(['2026-11-05T00:00:00Z', '-'.repeat(36)])]) {
      assert.strictEqual((await app.inject({ method: 'GET', url: `/api/v1/subastas?cursor=${c}` })).statusCode, 400, 'un cursor imposible da 400, no 500');
    }
  });
});
