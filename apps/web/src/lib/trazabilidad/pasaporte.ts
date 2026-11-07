import { apiRequest } from '#lib/api.ts';
import type { PasaporteDigitalVista, VerificacionCadenaResponse } from '@ganadito/contracts';

/**
 * Lectura del pasaporte bovino (contrato `PasaporteDigitalVista`).
 * - COMPLETA: solo la organización dueña; trae autor y hashes de la cadena.
 * - PUBLICA: QR o terceros; organización y autor en null, metadata por lista blanca y
 *   SIN prev_hash/current_hash. La integridad se comprueba con GET /verificar.
 * Los nombres históricos de evento se leen como texto; el enum de negocio rige la escritura.
 */
type Completa = Extract<PasaporteDigitalVista, { vista: 'COMPLETA' }>;
type Publica = Extract<PasaporteDigitalVista, { vista: 'PUBLICA' }>;

export interface EventoLectura {
  readonly id: number | string;
  readonly bovino_id: string;
  readonly secuencia: number;
  readonly event_type: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly autor_id: string | null;
  readonly prev_hash?: string;
  readonly current_hash?: string;
  readonly created_at: string | Date;
}

export type PasaporteLectura =
  | (Omit<Completa, 'eventos'> & { readonly eventos: readonly EventoLectura[] })
  | (Omit<Publica, 'eventos'> & { readonly eventos: readonly EventoLectura[] });

function esObjeto(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Valida la forma discriminada. Con `organizacionId` null (anónimo) solo se acepta la
 * vista PUBLICA; una COMPLETA debe pertenecer a la organización activa.
 */
export function esPasaporte(value: unknown, id: string, organizacionId: string | null): value is PasaporteLectura {
  if (!esObjeto(value) || !esObjeto(value.bovino) || (value.vista !== 'COMPLETA' && value.vista !== 'PUBLICA')) return false;
  const completa = value.vista === 'COMPLETA';
  const bovino = value.bovino;
  if (bovino.id !== id ||
      typeof bovino.codigo_arete !== 'string' ||
      (completa ? !organizacionId || bovino.organizacion_id !== organizacionId : bovino.organizacion_id !== null) ||
      typeof bovino.sexo !== 'string' || !['MACHO', 'HEMBRA'].includes(bovino.sexo) ||
      typeof bovino.estado !== 'string' || !['VIVO', 'FAENADO', 'DECESO', 'TRANSFERIDO'].includes(bovino.estado) ||
      !(bovino.raza === null || typeof bovino.raza === 'string') ||
      !(bovino.fecha_nacimiento === null || (typeof bovino.fecha_nacimiento === 'string' && Number.isFinite(Date.parse(bovino.fecha_nacimiento)))) ||
      !Array.isArray(value.eventos)) return false;
  const secuencias = new Set<number>();
  for (const evento of value.eventos) {
    if (!esObjeto(evento) || (typeof evento.id !== 'string' && !(typeof evento.id === 'number' && Number.isFinite(evento.id))) ||
        evento.bovino_id !== id || typeof evento.secuencia !== 'number' || !Number.isInteger(evento.secuencia) || evento.secuencia <= 0 ||
        secuencias.has(evento.secuencia) || typeof evento.event_type !== 'string' || !esObjeto(evento.metadata) ||
        typeof evento.created_at !== 'string' || !Number.isFinite(Date.parse(evento.created_at))) return false;
    if (completa) {
      if (typeof evento.autor_id !== 'string' || !evento.autor_id ||
          typeof evento.prev_hash !== 'string' || typeof evento.current_hash !== 'string' ||
          !/^[a-f0-9]{64}$/i.test(evento.prev_hash) || !/^[a-f0-9]{64}$/i.test(evento.current_hash)) return false;
    } else if (evento.autor_id !== null || 'prev_hash' in evento || 'current_hash' in evento) return false;
    secuencias.add(evento.secuencia);
  }
  return true;
}

export function esVerificacion(value: unknown): value is VerificacionCadenaResponse {
  return esObjeto(value) && typeof value.integro === 'boolean' && typeof value.total_eventos === 'number' && Number.isInteger(value.total_eventos) && value.total_eventos >= 0 &&
    (value.secuencia_corrupta === undefined || (typeof value.secuencia_corrupta === 'number' && Number.isInteger(value.secuencia_corrupta))) &&
 