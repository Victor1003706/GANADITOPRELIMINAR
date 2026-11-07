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
    genesi