import crypto from 'node:crypto';
import type pg from 'pg';
import type {
  CrearEstimacionPesoInput,
  EstimacionPesoResponse,
  PesajeBalanzaResponse,
  RegistrarPesajeInput,
  ResumenPesoLote
} from '@ganadito/contracts';
import { AiClientService, AiNoDisponibleError, AiSolicitudRechazadaError } from '../integraciones/ai-client.service.js';

export class PesoError extends Error {
  constructor(message: string, public statusCode = 400, public code?: string, public detalle?: unknown) {
    super(message);
    this.name = 'PesoError';
  }
}

export const MAX_VISTAS = 4;
const MAX_IDENTIFICADOR = 64;
const MAX_IDEMPOTENCY_KEY = 128;
const MAX_PARES_EVALUACION = 2000;
/** Igual que el satélite: 8 MB de imagen equivalen a ~11,2 MB en Base64. */
export const MAX_IMAGEN_BASE64 = Math.floor((8 * 1024 * 1024 * 4) / 3) + 4;

/**
 * El lote solo admite estimaciones mientras está en BORRADOR o ACTIVO sin iniciar
 * (reloj de PostgreSQL): la información que ven los postores queda congelada al
 * empezar la puja y no puede cambiar a mitad de la subasta.
 */
const SQL_LOTE_EDITABLE = `(l.estado = 'BORRADOR' OR (l.estado = 'ACTIVO' AND l.fecha_inicio > clock_timestamp()))`;

const ADVERTENCIA_LOTE =
  'Estimación orientativa por IA, no es un pesaje ni es vinculante. La puja es por el precio total del lote.';

interface ResultadoSatelite {
  metodo: string;
  version_parametros: string;
  peso_estimado_kg: number;
  rango_min_kg: number;
  rango_max_kg: number;
  es_vinculante: boolean;
  incertidumbre: { nivel_confianza: number } & Record<string, unknown>;
  calidad?: unknown[];
  advertencias: string[];
  muestra?: unknown;
  vistas?: Array<{ muestra: unknown; calidad: unknown[] }>;
}

interface FilaEstimacion {
  id: string;
  lote_id: string;
  identificador_animal: string | null;
  metodo: string;
  version_parametros: string;
  peso_estimado_kg: string;
  rango_min_kg: string;
  rango_max_kg: string;
  nivel_confianza: string;
  numero_vistas: number;
  incertidumbre: EstimacionPesoResponse['incertidumbre'];
  calidad: EstimacionPesoResponse['calidad'];
  advertencias: string[];
  tiene_pesaje: boolean;
  created_at: Date;
  huella_solicitud?: string | null;
}

const COLUMNAS = `e.id, e.lote_id, e.identificador_animal, e.metodo, e.version_parametros,
  e.peso_estimado_kg, e.rango_min_kg, e.rango_max_kg, e.nivel_confianza, e.numero_vistas,
  e.incertidumbre, e.calidad, e.advertencias, e.created_at,
  EXISTS (SELECT 1 FROM pesajes_balanza pb WHERE pb.estimacion_id = e.id) AS tiene_pesaje`;

function aRespuesta(f: FilaEstimacion): EstimacionPesoResponse {
  return {
    id: f.id,
    lote_id: f.lote_id,
    identificador_animal: f.identificador_animal,
    metodo: f.metodo,
    version_parametros: f.version_parametros,
    peso_estimado_kg: Number(f.peso_estimado_kg),
    rango_min_kg: Number(f.rango_min_kg),
    rango_max_kg: Number(f.rango_max_kg),
    nivel_confianza: Number(f.nivel_confianza),
    numero_vistas: f.numero_vistas,
    es_vinculante: false,
    incertidumbre: f.incertidumbre,
    calidad: f.calidad,
    advertencias: f.advertencias,
    tiene_pesaje: f.tiene_pesaje,
    created_at: new Date(f.created_at).toISOString()
  };
}

const esNumeroFinito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const esPunto = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(esNumeroFinito);

/** Validación superficial antes de reenviar al satélite (que valida en detalle). */
export function validarEntrada(body: unknown): CrearEstimacionPesoInput {
  const b = body as Partial<CrearEstimacionPesoInput> | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.vistas)) {
    throw new PesoError('Se requiere "vistas" (arreglo de 1 a 4 fotos del mismo animal).', 400, 'ENTRADA_INVALIDA');
  }
  if (b.vistas.length < 1 || b.vistas.length > MAX_VISTAS) {
    throw new PesoError(`"vistas" debe tener entre 1 y ${MAX_VISTAS} elementos.`, 400, 'ENTRADA_INVALIDA');
  }
  b.vistas.forEach((v, i) => {
