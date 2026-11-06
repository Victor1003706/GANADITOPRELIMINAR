import crypto from 'node:crypto';

export type EstadoBovino = 'VIVO' | 'FAENADO' | 'DECESO' | 'TRANSFERIDO';
export type SexoBovino = 'MACHO' | 'HEMBRA';

/** Tipos de evento de negocio admitidos. La API rechaza cualquier otro (400). */
export const TIPOS_EVENTO_TRAZABILIDAD = [
  'REGISTRO_INICIAL',
  'VACUNACION',
  'TRATAMIENTO',
  'PESAJE',
  'MOVILIZACION_CSTI',
  'PESAJE_CAMAL',
  'INSPECCION_POST_MORTEM',
  'CAMBIO_PROPIEDAD'
] as const;

export function esTipoEventoTrazabilidad(valor: unknown): valor is TipoEventoTrazabilidad {
  return typeof valor === 'string' && (TIPOS_EVENTO_TRAZABILIDAD as readonly string[]).includes(valor);
}

export type TipoEventoTrazabilidad =
  | 'REGISTRO_INICIAL'
  | 'VACUNACION'
  | 'TRATAMIENTO'
  | 'PESAJE'
  | 'MOVILIZACION_CSTI'
  | 'PESAJE_CAMAL'
  | 'INSPECCION_POST_MORTEM'
  | 'CAMBIO_PROPIEDAD';

export interface Bovino {
  id: string;
  codigo_arete: string;
  organizacion_id: string;
  raza: string | null;
  sexo: SexoBovino;
  fecha_nacimiento: string | Date | null;
  estado: EstadoBovino;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface EventoTrazabilidad {
  id: number | string;
  bovino_id: string;
  secuencia: number;
  event_type: TipoEventoTrazabilidad;
  metadata: Record<string, unknown>;
  prev_hash: string;
  current_hash: string;
  autor_id: string;
  created_at: string | Date;
}

export const GENESIS_PREV_HASH = '0'.repeat(64);

export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj ?? {});
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + keys.map(k => `${JSON.stringify(k)}:${canonicalJsonStringify((obj as any)[k])}`).join(',') + '}';
}

export function calcularHashEvento(
  prevHash: string,
  bovinoId: string,
  secuencia: number,
  eventType: string,
  metadata: Record<string, unknown>
): string {
  const metadataStr = canonicalJsonStringify(metadata);
  const payload = `${prevHash}${bovinoId}${secuencia}${eventType}${metadataStr}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export interface RegistrarBovinoInput {
  codigo_arete: string;
  raza?: string;
  sexo: SexoBovino;
  fecha_nacimiento?: string;
  metadata?: Record<string, unknown>;
}

export interface AgregarEventoInput {
  event_type: TipoEventoTrazabilidad;
  metadata: Record<string, unknown>;
}

export interface PasaporteDigitalResponse {
  bovino: Bovino;
  eventos: EventoTrazabilidad[];
}

/** Bovino en la vista pública (QR): no revela la organización dueña. */
export interface BovinoPublico extends Omit<Bovino, 'organizacion_id'> {
  organizacion_id: null;
}

/**
 * Evento en la vista pública: sin autor, con metadata proyectada por lista blanca (las
 * claves no públicas valen "[REDACTADO]") y SIN prev_hash / current_hash: un hash de
 * metadata privada de baja entropía (DNI, placa, coordenadas) permitiría probar
 * candidatos hasta encontrar el valor. La integridad se comprueba con GET /verificar,
 * que recalcula la cadena completa en el servidor.
 */
export interface EventoTrazabilidadPublico extends Omit<EventoTrazabilidad, 'autor_id' | 'prev_hash' | 'current_hash'> {
  autor_id: null;
}

/** Respuesta de GET /trazabilidad/bovinos/:id/pasaporte, discriminada por `vista`. */
export type PasaporteDigitalVista =
  | (PasaporteDigitalResponse & { vista: 'COMPLETA' })
  | { vista: 'PUBLICA'; bovino: BovinoPublico; eventos: EventoTrazabilidadPublico[] };

export interface VerificacionCadenaResponse {
  integro: boolean;
  total_eventos: number;
  secuencia_corrupta?: number;
  detalle?: string;
}
