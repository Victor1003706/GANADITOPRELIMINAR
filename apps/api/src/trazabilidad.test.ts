import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import {
  GENESIS_PREV_HASH,
  calcularHashEvento,
  type PasaporteDigitalResponse,
  type VerificacionCadenaResponse
} from '@ganadito/contracts';

describe('Trazabilidad Bovina, Pasaporte Digital y Cadena Inmutable de Eventos', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);

  let ganaderoToken: string;
  let ganaderoUserId: string;
  let ganaderoOrgId: string;

  const aretePrueba = `PE-LMA-2026-${Date.now()}`;
  let bovinoCreadoId: string;
  let genesisCurrentHash: string;
  let vacunacionCurrentHash: string;
  let movilizacionCurrentHash: string;
  let faenadoCurrentHash: string;

  before(async () => {
    await runInitialMigration();
    await app.ready();

    // 1. Registrar usuario ganadero (vendedor)
    const gRes = await authService.register({
      email: `ganadero_trazabilidad_${Date.now()}@test.com`,
      password: 'PasswordTrazabilidad2026!',
      nombre: 'Ganadera Andina EIRL',
      organizacion_nombre: `Andina EIRL ${Date.now()}`,
      rol_inicial: 'VENDEDOR'
    });
    ganaderoUserId = gRes.user.id;
    ganaderoOrgId = gRes.activeContext.organizacion_id;

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: gRes.user.email, password: 'PasswordTrazabilidad2026!' }
    });
    ganaderoToken = loginRes.json().access_token;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  test('1. Rechazo HTTP 401 al intentar registrar animal o evento sin autenticación', async () => {
    const unauthBovino = await app.inject({
      method: 'POST',
      url: '/api/v1/trazabilidad/bovinos',
      payload: {
        codigo_arete: 'PE-FAIL-001',
        sexo: 'MACHO'
      }
    });
    assert.strictEqual(unauthBovino.statusCode, 401);

    const unauthEvento = await app.inject({
      method: 'POST',
      url: '/api/v1/trazabilidad/bovinos/00000000-0000-0000-0000-000000000000/eventos',
      payload: {
        event_type: 'VACUNACION',
        metadata: { vacuna: 'Fiebre Aftosa' }
      }
    });
    assert.strictEqual(unauthEvento.statusCode, 401);
  });

  test('2. Registrar un animal con arete único y verificar evento génesis con hash y secuencia 1', async () => {
    const genesisMetadata = {
      origen_fundo: 'Hacienda La Florida',
      peso_nacimiento_kg: 42.5
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/trazabilidad/bovinos',
      headers: {
        authorization: `Bearer ${ganaderoToken}`
      },
      payload: {
        codigo_arete: aretePrueba,
        raza: 'Brahman',
        sexo: 'MACHO',
        fecha_nacimiento: '2024-05-10',
        metadata: genesisMetadata
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const data = res.json();
    assert.ok(data.bovino);
    assert.ok(data.eventoGenesis);

    bovinoCreadoId = data.bovino.id;
    assert.strictEqual(data.bovino.codigo_arete, aretePrueba);
    assert.strictEqual(data.bovino.raza, 'Brahman');
    assert.strictEqual(data.bovino.sexo, 'MACHO');
    assert.strictEqual(data.bovino.estado, 'VIVO');

    const eventoGen = data.eventoGenesis;
    assert.strictEqual(eventoGen.secuencia, 1);
    assert.strictEqual(eventoGen.event_type, 'REGISTRO_INICIAL');
    assert.strictEqual(eventoGen.prev_hash, GENESIS_PREV_HASH);
    assert.strictEqual(eventoGen.prev_hash, '0'.repeat(64));

    // Validar fórmula SHA-256 del génesis
    const expectedGenesisHash = calcularHashEvento(
      GENESIS_PREV_HASH,
      bovinoCreadoId,
      1,
      'REGISTRO_INICIAL',
      genesisMetadata
    );
    assert.strictEqual(eventoGen.current_hash, expectedGenesisHash);
    genesisCurrentHash = eventoGen.current_hash;

    // Verificar inserción en outbox_events
    const outboxRes = await pool.query(
      `SELECT * FROM outbox_events WHERE aggregate_type = 'BOVINO' AND aggregate_id = $1`,
      [bovinoCreadoId]
    );
    assert.strictEqual(outboxRes.rows.length, 1);
    assert.strictEqual(outboxRes.rows[0].event_type, 'PASAPORTE_BOVINO_ACTUALIZADO');
  });

  test('3. Rechazo de aretes duplicados debe retornar HTTP 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/trazabilidad/bovinos',
      headers: {
        authorization: `Bearer ${ganaderoToken}`
      },
      payload: {
        codigo_arete: aretePrueba,
        sexo: 'HEMBRA'
      }
    });

    assert.strictEqual(res.statusCode, 409);
    const body = res.json();
    assert.strictEqual(body.statusCode, 409);
    assert.match(body.message, /Ya existe un bovino registrado con el código de arete/);
  });

  test('4. Encadenar eventos sucesivos (VACUNACION, MOVILIZACION_CSTI, PESAJE_CAMAL)', async () => {
    // 4.1 Evento Secuencia 2: VACUNACION
    const metadataVacuna = {
      vacuna: 'Fiebre Aftosa',
      dosis_ml: 5,
      veterinario_colegiatura: 'CMVP-45892'
    };
    const resVac = await app.inject({
      method: 'POST',
      url: `/api/v1/trazabilidad/bovinos/${bovinoCreadoId}/eventos`,
      headers: {
        authorization: `Bearer ${ganaderoToken}`
      },
      payload: {
        event_type: 'VACUNACION',
        metadata: metadataVacuna
      }
    });
    assert.strictEqual(resVac.statusCode, 201);
    const eventoVac = resVac.json();
    assert.strictEqual(eventoVac.secuencia, 2);
    assert.strictEqual(eventoVac.prev_hash, genesisCurrentHash);
    const expectedVacHash = calcularHashEvento(
      genesisCurrentHash,
      bovinoCreadoId,
      2,
      'VACUNACION',
      metadataVacuna
    );
    assert.strictEqual(eventoVac.current_hash, expectedVacHash);
    vacunacionCurrentHash = eventoVac.current_hash;

    // 4.2 Evento Secuencia 3: MOVILIZACION_CSTI
    const metadataMov = {
      csti_numero: 'CSTI-PE-2026-7788',
      guia_transito_senasa: 'SENASA-GUIA-99001',
      origen_distrito: 'Lurín',
      destino_distrito: 'Ate'
    };
    const resMov = await app.inject({
      method: 'POST',
      url: `/api/v1/trazabilidad/bovinos/${bovinoCreadoId}/eventos`,
      headers: {
        authorization: `Bearer ${ganaderoToken}`
      },
      payload: {
        event_type: 'MOVILIZACION_CSTI',
        metadata: metadataMov
      }
    });
    assert.strictEqual(resMov.statusCode, 201);
    const eventoMov = resMov.json();
    assert.strictEqual(eventoMov.secuencia, 3);
    assert.strictEqual(eventoMov.prev_hash, vacunacionCurrentHash);
    const expectedMovHash = calcularHashEvento(
      vacunacionCurrentHash,
      bovinoCreadoId,
      3,
      'MOVILIZACION_CSTI',
      metadataMov
    );
    assert.strictEqual(eventoMov.current_hash, expectedMovHash);
    movilizacionCurrentHash = eventoMov.current_hash;

    // 4.3 Evento Secuencia 4: PESAJE_CAMAL
    const metadataCamal = {
      camal_nombre: 'Frigorífico San Martín',
      camal_codigo_oficial: 'CAM-LMA-04',
      peso_vivo_kg: 512.0
    };
    const resCamal = await app.inject({
      method: 'POST',
      url: `/api/v1/trazabilidad/bovinos/${bovinoCreadoId}/eventos`,
      headers: {
        authorization: `Bearer ${ganaderoToken}`
      },
      payload: {
        event_type: 'PESAJE_CAMAL',
        metadata: metadataCamal
      }
    });
    assert.strictEqual(resCamal.statusCode, 201);
    const eventoCamal = resCamal.json();
    assert.strictEqual(eventoCamal.secuencia, 4);
    assert.strictEqual(eventoCamal.prev_hash, movilizacionCurrentHash);
    const expectedCamalHash = calcularHashEvento(
      movilizacionCurrentHash,
      bovinoCreadoId,
      4,
      'PESAJE_CAMAL',
      metadataCamal
    );
    assert.strictEqual(eventoCamal.current_hash, expectedCamalHash);
    faenadoCurrentHash = eventoCamal.current_hash;
  });

  test('5. Validar que PESAJE_CAMAL transiciona el estado del bovino a FAENADO en pasaporte', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/trazabilidad/bovinos/${bovinoCreadoId}/pasaporte`
    });

    assert.strictEqual(res.statusCode, 200);
    const pasaporte: PasaporteDigitalResponse = res.json();
    assert.strictEqual(pasaporte.bovino.estado, 'FAENADO');
    assert.strictEqual(pasaporte.eventos.length, 4);

    // Verificar orden estrictamente ascendente de secuencias
    assert.strictEqual(pasaporte.eventos[0]!.secuencia, 1);
    assert.strictEqual(pasaporte.eventos[1]!.secuencia, 2);
    assert.strictEqual(pasaporte.eventos[2]!.secuencia, 3);
    assert.strictEqual(pasaporte.eventos[3]!.secuencia, 4);
  });

  test('6. Consultar /verificar y corroborar integridad criptográfica (integro: true, total_eventos: 4)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/trazabilidad/bovinos/${bovinoCreadoId}/verificar`
    });

    assert.strictEqual(res.statusCode, 200);
    const audit: VerificacionCadenaResponse = res.json();
    assert.strictEqual(audit.integro, true);
    assert.strictEqual(audit.total_eventos, 4);
    assert.strictEqual(audit.secuencia_corrupta, undefined);
  });

  test('7. Corrupción controlada de datos: manipulación silenciosa en SQL detectada por /verificar', async () => {
    // 7.1 Alterar metadata de la secuencia 3 (MOVILIZACION_CSTI) directamente en la base de datos
    await pool.query(
      `UPDATE pasaporte_bovino_events
       SET metadata = '{"csti_numero":"CSTI-HACKED-000","guia_transito_senasa":"FAKE"}'::jsonb
       WHERE bovino_id = $1 AND secuencia = 3`,
      [bovinoCreadoId]
    );

    // Ejecutar auditoría criptográfica
    const auditCorrupted = await app.inject({
      method: 'GET',
      url: `/api/v1/trazabilidad/bovinos/${bovinoCreadoId}/verificar`
    });

    assert.strictEqual(auditCorrupted.statusCode, 200);
    const resultCorrupted: VerificacionCadenaResponse = auditCorrupted.json();
    assert.strictEqual(resultCorrupted.integro, false);
    assert.strictEqual(resultCorrupted.total_eventos, 4);
    assert.strictEqual(resultCorrupted.secuencia_corrupta, 3);
    assert.match(resultCorrupted.detalle!, /Hash criptográfico alterado o inválido en la secuencia 3/);

    // 7.2 Restaurar metadata y alterar prev_hash en la secuencia 2
    const originalMetadataMov = {
      csti_numero: 'CSTI-PE-2026-7788',
      guia_transito_senasa: 'SENASA-GUIA-99001',
      origen_distrito: 'Lurín',
      destino_distrito: 'Ate'
    };
    await pool.query(
      `UPDATE pasaporte_bovino_events
       SET metadata = $1
       WHERE bovino_id = $2 AND secuencia = 3`,
      [JSON.stringify(originalMetadataMov), bovinoCreadoId]
    );

    // Modificar prev_hash de la secuencia 2 con un hash corrupto
    await pool.query(
      `UPDATE pasaporte_bovino_events
       SET prev_hash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
       WHERE bovino_id = $1 AND secuencia = 2`,
      [bovinoCreadoId]
    );

    const auditPrevHashCorrupted = await app.inject({
      method: 'GET',
      url: `/api/v1/trazabilidad/bovinos/${bovinoCreadoId}/verificar`
    });

    assert.strictEqual(auditPrevHashCorrupted.statusCode, 200);
    const resultPrevCorrupted: VerificacionCadenaResponse = auditPrevHashCorrupted.json();
    assert.strictEqual(resultPrevCorrupted.integro, false);
    assert.strictEqual(resultPrevCorrupted.secuencia_corrupta, 2);
    assert.match(resultPrevCorrupted.detalle!, /Discrepancia en prev_hash en la secuencia 2/);
  });
});
