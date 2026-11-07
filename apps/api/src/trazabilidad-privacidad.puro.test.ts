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
      assert.deepEqual(comoJson(proyectarMetadataPublica(tipo