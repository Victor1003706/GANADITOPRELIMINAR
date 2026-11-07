import type { EstadoLote } from '@ganadito/contracts';

// DTO de lectura del contrato v1. PostgreSQL confirma el estado a través de la API.
export interface AuctionSnapshot {
  id: string;
  codigo_lote: string;
  estado: EstadoLote;
  precio_base: number;
  precio_actual: number;
  incremento_minimo: number;
  proxima_puja_minima: number;
  postor_ganador_id: string | null;
  postor_ganador_nombre: string | null;
  tiempo_restante_segundos: number;
  fecha_cierre: string;
  secuencia_maxima: number;
  version: number;
  es_abierta: boolean;
}

export interface PublicBid {
  puja_id: string;
  monto: number;
  secuencia: number;
  nueva_version: number;
  nuevo_precio_actual: number;
  extension_aplicada: boolean;
  nueva_fecha_cierre: string;
  created_at: string;
}

export interface AcceptedBid extends PublicBid {
  lote_id: string;
  idempotency_key: string;
}

export interface BidAttempt { lotId: string; amount: number; sessionKey: string; key: string }

export function bidAttempt(
  previous: BidAttempt | null, lotId: string, amount: number, sessionKey: string,
  makeKey: () => string = () => crypto.randomUUID()
): BidAttempt {
  if (previous?.lotId === lotId && previous.amount === amount && previous.sessionKey === sessionKey) return previous;
  return { lotId, amount, sessionKey, key: makeKey() };
}

const states: readonly string[] = ['BORRADOR', 'PUBLICADO', 'ACTIVO', 'CERRADO', 'ADJUDICADO', 'DESIERTO', 'CANCELADO'];
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export function parseSnapshot(value: unknown, lotId: string): AuctionSnapshot {
  if (!record(value) || value.id !== lotId || !nonempty(value.codigo_lote) ||
    !states.includes(String(value.estado)) || typeof value.es_abierta !== 'boolean' ||
    !['precio_base', 'precio_actual', 'incremento_minimo', 'proxima_puja_minima', 'tiempo_restante_segundos', 'secuencia_maxima', 'version'].every(key => finite(value[key])) ||
    !nonempty(value.fecha_cierre) || !Number.isFinite(Date.parse(value.fecha_cierre)) ||
    !(value.postor_ganador_id === null || nonempty(value.postor_ganador_id)) ||
    !(value.postor_ganador_nombre === null || typeof value.postor_ganador_nombre === 'string')) {
    throw new Error('La respuesta de la API no corresponde al lote solicitado o está incompleta.');
  }
  return value as unknown as AuctionSnapshot;
}

const date = (value: unknown): value is string => nonempty(value) && Number.isFinite(Date.parse(value));

function publicBid(value: unknown): PublicBid | null {
  if (!record(value) || !nonempty(value.puja_id) || !finite(value.monto) || value.monto <= 0 ||
    !finite(value.nuevo_precio_actual) || value.nuevo_precio_actual <= 0 ||
    !Number.isInteger(value.secuencia) || (value.secuencia as number) <= 0 ||
    !Number.isInteger(value.nueva_version) || (value.nueva_version as number) <= 0 ||
    typeof value.extension_aplicada !== 'boolean' || !date(value.created_at) || !date(value.nueva_fecha_cierre)) return null;
  return { puja_id: value.puja_id, monto: value.monto, secuencia: value.secuencia as number,
    nueva_version: value.nueva_version as number, nuevo_precio_actual: value.nuevo_precio_actual,
    extension_aplicada: value.extension_aplicada, nueva_fecha_cierre: value.nueva_fecha_cierre, created_at: value.created_at };
}

export function parseBidReceipt(value: unknown, lotId: string): AcceptedBid {
  const bid = publicBid(value);
  if (!bid || !record(value) || value.lote_id !== lotId || !nonempty(value.idempotency_key)) {
    throw new Error('No se pudo verificar la confirmación de la puja.');
  }
  return { ...bid, lote_id: lotId, idempotency_key: value.idempotency_key };
}

export type AuctionEvent = { kind: 'bid'; data: PublicBid } | { kind: 'refres