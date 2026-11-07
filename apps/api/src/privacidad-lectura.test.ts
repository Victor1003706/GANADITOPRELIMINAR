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
      assert.ok(Math.abs(e.longitud * 100 - Math.round(e.longitud * 100)) < 1e-6);

      // Un establecimiento público (CAMAL) mantiene la ubicación exacta.
      const c = lista.find((x) => x.id === camalId);
      assert.strictEqual(c.ubicacion_aproximada, false);
      assert.ok(Math.abs(c.latitud - (BASE.lat + 0.002345)) < 1e-9);
    }
  });

  test('2b. Pizarra Spot: misma privacidad que el mapa para anónimo, organización ajena y dueña', async () => {
    const pub = await app.inject({
      method: 'POST',
      url: '/api/v1/cotizaciones',
      headers: auth(duenoToken),
      payload: {
        establecimiento_id: establoId,
        producto: 'GANADO_EN_PIE',
        categoria: `PRIV-${crypto.randomUUID().slice(0, 6)}`,
        calidad: 'EXTRA',
        unidad_medida: 'KG_VIVO',
        precio_unitario: 9.1,
        vigencia_hasta: new Date(Date.now() + 86400000).toISOString(),
        // El cliente intenta autodeclararse "verificado": debe ignorarse.
        verificado: true
      }
    });
    assert.strictEqual(pub.statusCode, 201, pub.body);
    assert.strictEqual(pub.json().verificado, false, 'el cliente no decide la verificación');
    const { id: cotizacionId, categoria } = pub.json();

    async function leer(headers: Record<string, string> = {}) {
      const r = await app.inject({
        method: 'GET',
        url: `/api/v1/cotizaciones/pizarra?producto=GANADO_EN_PIE&categoria=${categoria}`,
        headers
      });
      assert.strictEqual(r.statusCode, 200, r.body);
      const c = r.json().cotizaciones.find((x: any) => x.id === cotizacionId);
      assert.ok(c, 'La cotización aparece en la pizarra');
      return c;
    }

    const latExacta = BASE.lat + 0.001234;
    assert.ok(distanciaARejilla(latExacta) > 1e-3, 'precondición: el fixture no está sobre la rejilla');
    for (const headers of [{}, auth(ajenoToken)]) {
      const c = await leer(headers);
      assert.strictEqual(c.ubicacion_aproximada, true);
      assert.ok(Math.abs(c.latitud - latExacta) > 1e-6, 'Spot no debe revelar la latitud exacta del establo ajeno');
      assert.ok(Math.abs(c.latitud * 100 - Math.round(c.latitud * 100)) < 1e-6, `lat ${c.latitud} no está en la rejilla`);
      assert.ok(Math.abs(c.longitud * 100 - Math.round(c.longitud * 100)) < 1e-6);
    }

    const propia = await leer(auth(duenoToken));
    assert.strictEqual(propia.ubicacion_aproximada, false);
    assert.ok(Math.abs(propia.latitud - latExacta) < 1e-9);

    await pool.query('DELETE FROM cotizaciones_spot WHERE id = $1', [cotizacionId]);
  });

  test('3. Un token inválido en la ruta pública responde 401 (no se degrada a anónimo)', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/establecimientos/cercanos?lat=${BASE.lat}&lon=${BASE.lon}`,
      headers: { authorization: 'Bearer invalido' }
    });
    assert.strictEqual(r.statusCode, 401);
  });

  test('4. Pasaporte: vista pública sin autor ni metadata sensible; el dueño ve la vista completa; la integridad se mantiene', async () => {
    const bov = await app.inject({
      method: 'POST',
      url: '/api/v1/trazabilidad/bovinos',
      headers: auth(duenoToken),
      payload: { codigo_arete: `PE-PRIV-${crypto.randomUUID().slice(0, 10)}`, raza: 'Gyr', sexo: 'HEMBRA' }
    });
    assert.strictEqual(bov.statusCode, 201);
    const bovinoId = bov.json().bovino.id;

    const ev = await app.inject({
      method: 'POST',
      url: `/api/v1/trazabilidad/bovinos/${bovinoId}/eventos`,
      headers: auth(duenoToken),
      payload: { event_type: 'MOVILIZACION_CSTI', metadata: { gps: { lat: -4.1, lon: -75.6 }, destino: 'Feria Iquitos', dni_conductor: '12345678' } }
    });
    assert.strictEqual(ev.statusCode, 201);

    const publico = (await app.inject({ method: 'GET', url: `/api/v1/trazabilidad/bovinos/${bovinoId}/pasaporte` })).json();
    assert.strictEqual(publico.vista, 'PUBLICA');
    const mov = publico.eventos.find((e: any) => e.event_type === 'MOVILIZACION_CSTI');
    assert.strictEqual(mov.autor_id, null);
    // Sin hashes en la vista pública: permitirían adivinar metadata privada de baja entropía.
    assert.ok(!('current_hash' in mov) && !('prev_hash' in mov), 'la vista pública no expone hashes');
    assert.ok(!publico.eventos.some((e: any) => 'current_hash' in e || 'prev_hash' in e));
    assert.strictEqual(mov.metadata.gps, '[REDACTADO]');
    assert.strictEqual(mov.metadata.dni_conductor, '[REDACTADO]');
    // Lista blanca: "destino" no es público (puede ser otro fundo); el distrito sí lo sería.
    assert.strictEqual(mov.metadata.destino, '[REDACTADO]');
    assert.strictEqual(publico.bovino.organizacion_id, null, 'la vista pública no revela la organización dueña');

    const ajeno = (await app.inject({ method: 'GET', url: `/api/v1/trazabilidad/bovinos/${bovinoId}/pasaporte`, headers: auth(ajenoToken) })).json();
    assert.strictEqual(ajeno.vista, 'PUBLICA');

    const dueno = (await app.inject({ method: 'GET', url: `/api/v1/trazabilidad/bovinos/${bovinoId}/pasaporte`, headers: auth(duenoToken) })).json();
    assert.strictEqual(dueno.vista, 'COMPLETA');
    assert.deepStrictEqual(dueno.eventos.find((e: any) => e.event_type === 'MOVILIZACION_CSTI').metadata.gps, { lat: -4.1, lon: -75.6 });
    assert.match(dueno.eventos[0].current_hash, /^[a-f0-9]{64}$/, 'el dueño sí ve la cadena completa');

    const verif = (await app.inject({ method: 'GET', url: `/api/v1/trazabilidad/bovinos/${bovinoId}/verificar` })).json();
    assert.strictEqual(verif.integro, true);
  });

  test('5. Bordes de la lista blanca: constructor/toString/__proto__ se rechazan al registrar y no rompen la vista pública', async () => {
    const bov = await app.inject({
      method: 'POST',
      url: '/api/v1/trazabilidad/bovinos',
      headers: auth(duenoToken),
      payload: { codigo_arete: `PE-BORDE-${crypto.randomUUID().slice(0, 10)}`, raza: 'Brown Swiss', sexo: 'MACHO' }
    });
    assert.strictEqual(bov.statusCode, 201);
    const bovinoId = bov.json().bovino.id;

    for (const tipo of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'NO_EXISTE']) {
      const r = await app.inject({
        method: 'POST',
        url: `/api/v1/trazabilidad/bovinos/${bovinoId}/eventos`,
        headers: auth(duenoToken),
        payload: { event_type: tipo, metadata: { dato: 'ficticio' } }
      });
      assert.strictEqual(r.statusCode, 400, `${tipo} debe rechazarse: ${r.body}`);
    }

    // Filas históricas con esos tipos (anteriores a la validación) no deben provocar 500.
    const sec = await pool.query<{ s: number; autor: string }>(
      'SELECT MAX(secuencia) AS s, (array_agg(autor_id))[1] AS autor FROM pasaporte_bovino_events WHERE bovino_id = $1',
      [bovinoId]
    );
    let secuencia = Number(sec.rows[0]!.s);
    const autor = sec.rows[0]!.autor;
    for (const tipo of ['constructor', 'toString', '__proto__']) {
      secuencia += 1;
      await pool.query(
        `INSERT INTO pasaporte_bovino_events (bovino_id, secuencia, event_type, metadata, prev_hash, current_hash, autor_id)
         VALUES ($1, $2, $3, $4, $5, $5, $6)`,
        // JSON literal: con un objeto JS, "__proto__" cambiaría el prototipo en vez de ser clave.
        [bovinoId, secuencia, tipo, '{"__proto__":{"x":1},"constructor":"y","gps":{"lat":-4.1}}', 'f'.repeat(64), autor]
      );
    }
    const publico = await app.inject({ method: 'GET', url: `/api/v1/trazabilidad/bovinos/${bovinoId}/pasaporte` });
    assert.strictEqual(publico.statusCode, 200, publico.body);
    const d = publico.json();
    assert.strictEqual(d.vista, 'PUBLICA');
    assert.strictEqual(d.bovino.organizacion_id, null);
    for (const e of d.eventos.filter((x: any) => ['constructor', 'toString', '__proto__'].includes(x.event_type))) {
      assert.strictEqual(e.autor_id, null);
      // Tipo sin lista blanca: TODA su metadata queda redactada, incluidas claves heredadas.
      assert.deepStrictEqual(Object.keys(e.metadata).sort(), ['__proto__', 'constructor', 'gps']);
      for (const valor of Object.values(e.metadata)) assert.strictEqual(valor, '[REDACTADO]');
      assert.ok(!JSON.stringify(e.metadata).includes('-4.1'));
    }
  });
});
