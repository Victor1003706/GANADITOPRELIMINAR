import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';

describe('N05: privacidad de ubicación en mapa y vista pública del pasaporte', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);
  const password = 'PasswordPrivacidad2026!';

  // Punto aislado (selva de Loreto) para no mezclarse con otros datos de prueba.
  // Determinista y FUERA de la rejilla de 0.01°: si el punto exacto cayera sobre la
  // rejilla, la posición aproximada coincidiría con la exacta y la prueba no probaría nada.
  const BASE = { lat: -4.123456, lon: -75.654321 };
  const distanciaARejilla = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) / 100;
  let duenoToken: string;
  let ajenoToken: string;
  let establoId: string;
  let camalId: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  async function registrar(prefijo: string) {
    const s = crypto.randomUUID().slice(0, 8);
    const email = `${prefijo}_${s}@test.com`;
    await authService.register({ email, password, nombre: `${prefijo} ${s}`, organizacion_nombre: `${prefijo} ${s}`, rol_inicial: 'VENDEDOR' });
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    return r.json().access_token as string;
  }

  async function crear(token: string, tipo: string, dLat: number) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/establecimientos',
      headers: auth(token),
      payload: {
        nombre_comercial: `${tipo} privacidad ${crypto.randomUUID().slice(0, 6)}`,
        tipo,
        latitud: BASE.lat + dLat,
        longitud: BASE.lon,
        direccion_texto: 'Fundo La Esperanza km 12',
        ubigeo: '160101'
      }
    });
    assert.strictEqual(r.statusCode, 201, r.body);
    return r.json().id as string;
  }

  async function buscar(headers: Record<string, string> = {}) {
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/establecimientos/cercanos?lat=${BASE.lat}&lon=${BASE.lon}&radio_km=20&limit=100`,
      headers
    });
    assert.strictEqual(r.statusCode, 200);
    return r.json().establecimientos as any[];
  }

  before(async () => {
    await runInitialMigration();
    await app.ready();
    duenoToken = await registrar('priv_dueno');
    ajenoToken = await registrar('priv_ajeno');
    establoId = await crear(duenoToken, 'ESTABLO', 0.001234);
    camalId = await crear(duenoToken, 'CAMAL', 0.002345);
  });

  after(async () => {
    await pool.query('DELETE FROM establecimientos WHERE id = ANY($1::uuid[])', [[establoId, camalId]]).catch(() => {});
    await app.close();
    await closePool();
  });

  test('1. La organización dueña ve la ubicación exacta y la dirección de su establo', async () => {
    const e = (await buscar(auth(duenoToken))).find((x) => x.id === establoId);
    assert.ok(e);
    assert.strictEqual(e.ubicacion_aproximada, false);
    assert.ok(Math.abs(e.latitud - (BASE.lat + 0.001234)) < 1e-9);
    assert.strictEqual(e.direccion_texto, 'Fundo La Esperanza km 12');
  });

  test('2. Anónimos y otras organizaciones reciben ubicación aproximada (rejilla 0.01°) sin dirección', async () => {
    for (const headers of [{}, auth(ajenoToken)]) {
      const lista = await buscar(headers);
      const e = lista.find((x) => x.id === establoId);
      assert.ok(e, 'El establo sigue apareciendo en la búsqueda');
      assert.strictEqual(e.ubicacion_aproximada, true);
      assert.strictEqual(e.direccion_texto, null);
      assert.ok(Math.abs(e.latitud * 100 - Math.round(e.latitud * 100)) < 1e-6, `lat ${e.latitud} no está en la rejilla`);
      assert.ok(Math.abs(e.longitud * 100 - Math.round(e.longitud * 100