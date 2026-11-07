import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import type { AgregarEventoInput, Bovino, EventoTrazabilidad, TipoEventoTrazabilidad } from '@ganadito/contracts';
import {
  proyectarMetadataPublica,
  TrazabilidadError,
  TrazabilidadService
} from './trazabilidad/trazabilidad.service.js';

// Solo se simula la frontera PostgreSQL. La proyección, las decisiones de acceso,
// la validación y el verificador de cadena ejecutan el servicio real, sin red.
// La API transporta JSON: las aserciones de contenido no exigen un prototipo JS.
function comoJson(valor: unknown): unknown {
  return JSON.parse(JSON.stringify(valor));
}

const bovino: Bovino = {
  id: '11111111-1111-4111-8111-111111111111',
  codigo_arete: 'PE-PURO-001',
  organizacion_id: '22222222-2222-4222-8222-222222222222',
  raza: 'Gyr',
  sexo: 'HEMBRA',
  fecha_nacimiento: null,
  estado: 'VIVO',
  created_at: '2026-11-04T12:00:00.000Z',
  updated_at: '2026-11-04T12:00:00.000Z'
};
const autor = '33333333-3333-4333-8333-333333333333';
const genesis: EventoTrazabilidad = {
  id: 1,
  bovino_id: bovino.id,
  secuencia: 1,
  event_type: 'REGISTRO_INICIAL',
  metadata: {
    raza: 'Gyr',
    finca: 'Fundo Privado',
    ubicación: { latitud: -4.12, longitud: -75.65 },
    comentario: 'Conductor José DNI 12345678'
  },
  prev_hash: '0'.repeat(64),
  current_hash: 'e9517c111cdb44e5801ec51be3fa5c1a1478f1c86d6798a3647bcc682e4565a4',
  autor_id: autor,
  created_at: '2026-11-04T12:00:00.000Z'
};
const vacunacion: EventoTrazabilidad = {
  id: 2,
  bovino_id: bovino.id,
  secuencia: 2,
  event_type: 'VACUNACION',
  metadata: { vacuna: 'Fiebre aftosa', dosis_ml: 5, veterinario: { teléfono: '999888777' } },
  prev_hash: genesis.current_hash,
  current_hash: 'e9a1ee31e7ca057ce7b80d1337d12d067013b4d8ec8a8041f464209cdd1fc36e',
  autor_id: autor,
  created_at: '2026-11-04T13:00:00.000Z'
};

function servicioLectura(eventos: EventoTrazabilidad[] = [genesis, vacunacion]) {
  const pool = {
    async query(sql: string, params: unknown[]) {
      assert.deepEqual(params, [bovino.id]);
      if (/^SELECT (\*|id) FROM bovinos WHERE id = \$1$/.test(sql.trim())) return { rows: [bovino] };
      if (/^SELECT \* FROM pasaporte_bovino_events\s+WHERE bovino_id = \$1\s+ORDER BY secuencia ASC$/.test(sql.trim())) {
        return { rows: eventos };
      }
      throw new Error(`Consulta no permitida por la fuente de solo lectura: ${sql}`);
    }
  } as unknown as pg.Pool;
  return new TrazabilidadService(pool);
}

const casosPublicos: Array<{ tipo: TipoEventoTrazabilidad; metadata: Record<string, unknown> }> = [
  { tipo: 'REGISTRO_INICIAL', metadata: { raza: 'Brahmán', sexo: 'HEMBRA', fecha_nacimiento: null, peso_nacimiento_kg: 40, tipo_parto: 'Natural' } },
  { tipo: 'VACUNACION', metadata: { vacuna: 'Fiebre aftosa', dosis_ml: 5, lote: 'V-01', campana_oficial: true, fecha: '2026-11-04' } },
  { tipo: 'TRATAMIENTO', metadata: { producto: 'Antiparasitario', dosis_ml: 10, dias_retiro: 28, fecha_fin_retiro: null, fecha: '2026-11-04' } },
  { tipo: 'PESAJE', metadata: { peso_vivo_kg: 450.5, fecha: '2026-11-04' } },
  { tipo: 'MOVILIZACION_CSTI', metadata: { csti_numero: 'CSTI-01', guia_senasa: 'GS-01', guia_transito_senasa: 'GT-01', origen_distrito: 'Lurín', destino_distrito: 'Ate', fecha: '2026-11-04' } },
  { tipo: 'PESAJE_CAMAL', metadata: { camal_nombre: 'Camal municipal', camal_codigo_oficial: 'C-01', peso_vivo_kg: 450, peso_canal_caliente_kg: 240, rendimiento_canal_pct: 53.33 } },
  { tipo: 'INSPECCION_POST_MORTEM', metadata: { camal_codigo_oficial: 'C-01', dictamen_post_mortem: 'APTO', resultado: 'Sin observaciones' } },
  { tipo: 'CAMBIO_PROPIEDAD', metadata: { fecha: '2026-11-04' } }
];

describe('V05: proyección pública pura', () => {
  for (const { tipo, metadata } of casosPublicos) {
    test(`${tipo}: publica exclusivamente los primitivos permitidos`, () => {
      assert.deepEqual(comoJson(proyectarMetadataPublica(tipo, {
        ...metadata,
        dirección: 'Fundo El Oculto km 12',
        teléfono: '999888777',
        comentario: 'José DNI 12345678',
        nuevo: { contacto: 'privado@example.test' }
      })), { ...metadata, dirección: '[REDACTADO]', teléfono: '[REDACTADO]', comentario: '[REDACTADO]', nuevo: '[REDACTADO]' });
    });
  }

  for (const tipo of ['constructor', 'toString', '__proto__', 'HITO_HISTORICO_DESCONOCIDO']) {
    test(`${tipo}: no hereda una lista pública y conserva el evento histórico redactado`, async () => {
      assert.deepEqual(comoJson(proyectarMetadataPublica(tipo, { raza: 'Gyr', comentario: 'DNI 12345678' })), {
        raza: '[REDACTADO]', comentario: '[REDACTADO]'
      });
      const historico = { ...genesis, event_type: tipo } as EventoTrazabilidad;
      const resultado = await servicioLectura([historico]).obtenerPasaporte(bovino.id);
      assert.equal(resultado.eventos.length, 1);
      assert.equal(resultado.eventos[0]?.event_type, tipo);
      assert.deepEqual(comoJson(resultado.eventos[0]?.metadata), { raza: '[REDACTADO]', finca: '[REDACTADO]', ubicación: '[REDACTADO]', comentario: '[REDACTADO]' });
    });
  }

  test('redacta objetos y arreglos incluso bajo claves permitidas sin mutar metadata privada', () => {
    const metadata = {
      raza: { nombre: 'Gyr', ubicación: { latitud: -4.1 } },
      sexo: ['HEMBRA', { teléfono: '999888777' }],
      notas: 'DNI 12345678',
      dirección: 'Carretera km 12'
    };
    const original = structuredClone(metadata);
    assert.deepEqual(comoJson(proyectarMetadataPublica('REGISTRO_INICIAL', metadata)), {
      raza: '[REDACTADO]', sexo: '[REDACTADO]', notas: '[REDACTADO]', dirección: '[REDACTADO]'
    });
    assert.deepEqual(metadata, original);
  });

  test('una clave JSON __proto__ se redacta como dato propio en un objeto sin herencia', () => {
    const metadata: unknown = JSON.parse('{"__proto__":{"telefono":"999888777"},"raza":"Gyr"}');
    const resultado = proyectarMetadataPublica('REGISTRO_INICIAL', metadata);
    assert.equal(Object.getPrototypeOf(resultado), null);
    assert.equal(Object.hasOwn(resultado, '__proto__'), true);
    assert.equal(resultado.__proto__, '[REDACTADO]');
    assert.equal(resultado.raza, 'Gyr');
  });

  for (const metadata of [null, undefined, 'DNI 12345678', ['999888777'], 42]) {
    test(`metadata raíz ${String(metadata)} no publica valores fuera de un objeto`, () => {
      assert.deepEqual(comoJson(proyectarMetadataPublica('REGISTRO_INICIAL', metadata)), {});
    });
  }

  for (const organizacion of [undefined, '44444444-4444-4444-8444-444444444444']) {
    test(`lector ${organizacion ? 'ajeno' : 'anónimo'} recibe nullables y ningún hash o dato privado`, async () => {
      const servicio = servicioLectura();
      const antes = structuredClone([genesis, vacunacion]);
      const resultado = await servicio.obtenerPasaporte(bovino.id, organizacion);
      assert.equal(resultado.vista, 'PUBLICA');
      assert.equal(resultado.bovino.organizacion_id, null);
      for (const evento of resultado.eventos) {
        assert.equal(evento.autor_id, null);
        assert.equal(Object.hasOwn(evento, 'prev_hash'), false);
        assert.equal(Object.hasOwn(evento, 'current_hash'), false);
      }
      const json = JSON.stringify(resultado);
      for (const secreto of [autor, bovino.organizacion_id, genesis.current_hash, vacunacion.current_hash, '12345678', '999888777', 'Fundo Privado', '-4.12', '-75.65']) {
        assert.equal(json.includes(secreto), false, `No debe publicarse ${secreto}`);
      }
      assert.deepEqual([genesis, vacunacion], antes);
      assert.deepEqual(await servicio.verificarIntegridadPasaporte(bovino.id), { integro: true, total_eventos: 2 });
    });
  }

  test('el propietario recibe la cadena original, autores y organización completos', async () => {
    const servicio = servicioLectura();
    const resultado = await servicio.obtenerPasaporte(bovino.id, bovino.organizacion_id);
    assert.equal(resultado.vista, 'COMPLETA');
    assert.deepEqual(resultado.bovino, bovino);
    assert.deepEqual(resultado.eventos, [genesis, vacunacion]);
    assert.equal(resultado.eventos[0]?.prev_hash, '0'.repeat(64));
    assert.equal(resultado.eventos[0]?.current_hash, 'e9517c111cdb44e5801ec51be3fa5c1a1478f1c86d6798a3647bcc682e4565a4');
    assert.equal(resultado.eventos[1]?.prev_hash, 'e9517c111cdb44e5801ec51be3fa5c1a1478f1c86d6798a3647bcc682e4565a4');
    assert.equal(resultado.eventos[1]?.current_hash, 'e9a1ee31e7ca057ce7b80d1337d12d067013b4d8ec8a8041f464209cdd1fc36e');
    assert.deepEqual(await servicio.verificarIntegridadPasaporte(bovino.id), { integro: true, total_eventos: 2 });
  });

  test('verificar detecta metadata modificada y sigue respondiendo solo el resumen', async () => {
    const resultado = await servicioLectura([genesis, { ...vacunacion, metadata: { vacuna: 'Alterada' } }]).verificarIntegridadPasaporte(bovino.id);
    assert.equal(resultado.integro, false);
    assert.equal(resultado.total_eventos, 2);
    assert.equal(resultado.secuencia_corrupta, 2);
    assert.deepEqual(Object.keys(resultado).sort(), ['detalle', 'integro', 'secuencia_corrupta', 'total_eventos']);
  });
});

describe('V05: validación de tipos antes de agregar a la cadena', () => {
  for (const { tipo, metadata } of casosPublicos) {
    test(`acepta el tipo permitido ${tipo} y conserva su metadata privada`, async () => {
      const metadataPrivada = {
        ...metadata,
        comentario: 'Registro privado José DNI 12345678',
        ...(tipo === 'CAMBIO_PROPIEDAD' ? { nueva_organizacion_id: '44444444-4444-4444-8444-444444444444' } : {})
      };
      const client = {
        async query(sql: string, params?: unknown[]) {
          const consulta = sql.trim();
          if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(consulta)) return { rows: [] };
          if (/^SELECT \* FROM bovinos WHERE id = \$1 FOR UPDATE$/.test(consulta)) return { rows: [bovino] };
          if (/^SELECT \* FROM pasaporte_bovino_events/.test(consulta)) return { rows: [genesis] };
          if (/^SELECT 1 FROM organizaciones/.test(consulta)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
          if (/^UPDATE bovinos SET (estado|organizacion_id) =/.test(consulta)) return { rows: [], rowCount: 1 };
          if (/^INSERT INTO pasaporte_bovino_events/.test(consulta) && params) {
            return { rows: [{
              id: 2, bovino_id: params[0], secuencia: params[1], event_type: params[2],
              metadata: JSON.parse(params[3] as string), prev_hash: params[4], current_hash: params[5],
              autor_id: params[6], created_at: '2026-11-04T13:00:00.000Z'
            }] };
          }
          if (/^INSERT INTO outbox_events/.test(consulta)) return { rows: [], rowCount: 1 };
          throw new Error(`Consulta inesperada en la fuente transaccional: ${sql}`);
        },
        release() {}
      };
      const servicio = new TrazabilidadService({ async connect() { return client; } } as unknown as pg.Pool);
      const resultado = await servicio.agregarEvento(autor, bovino.organizacion_id, bovino.id, {
        event_type: tipo, metadata: metadataPrivada
      });
      assert.equal(resultado.event_type, tipo);
      assert.equal(resultado.secuencia, 2);
      assert.equal(resultado.prev_hash, 'e9517c111cdb44e5801ec51be3fa5c1a1478f1c86d6798a3647bcc682e4565a4');
      assert.deepEqual(resultado.metadata, metadataPrivada);
      assert.equal(resultado.autor_id, autor);
    });
  }

  for (const tipo of ['constructor', 'toString', '__proto__', 'DESCONOCIDO', '', null, 7, {}]) {
    test(`rechaza event_type=${String(tipo)} con error de dominio 400`, async () => {
      const pool = {
        async connect() { throw new Error('Se intentó acceder a PostgreSQL con un tipo inválido'); }
      } as unknown as pg.Pool;
      const servicio = new TrazabilidadService(pool);
      await assert.rejects(servicio.agregarEvento(autor, bovino.organizacion_id, bovino.id, {
        event_type: tipo, metadata: {}
      } as AgregarEventoInput), (error: unknown) => error instanceof TrazabilidadError && error.statusCode === 400);
    });
  }
});
