/**
 * Contratos y tipos del motor transaccional de subastas en vivo.
 *
 * Invariante arquitectónico de Ganadito:
 * PostgreSQL 16 es la única fuente de verdad transaccional para pujas y lotes.
 * WebSocket/SSE actúa como capa de transporte de eventos efímeros, nunca de decisión.
 */

/**
 * Estados del ciclo de vida de un lote en subasta.
 */
export const ESTADOS_LOTE = [
  'BORRADOR',
  'PUBLICADO',
  'ACTIVO',
  'CERRADO',
  'ADJUDICADO',
  'DESIERTO',
  'CANCELADO'
] as const;

export type EstadoLote = (typeof ESTADOS_LOTE)[number];

/**
 * Clave de idempotencia única (UUID v4 o cadena opaca generada por el cliente)
 * para evitar pujas duplicadas ante reintentos de red o clics dobles.
 */
export type IdempotencyKey = string;

/**
 * Entidad Lote de Subasta.
 * Incluye campos requeridos para el control de concurrencia optimista (versión)
 * y reglas anti-sniping para extender el cierre ante ofertas de último segundo.
 */
export interface LoteSubasta {
  id: string;
  codigo: string;
  subasta_id?: string;
  organizacion_vendedora_id: string;
  establecimiento_origen_id: string;
  titulo: string;
  descripcion?: string;

  /**
   * Datos ganaderos del lote
   */
  especie: 'BOVINO' | 'OVINO' | 'CAPRINO' | 'PORCINO' | 'EQUINO';
  categoria?: string;
  cantidad_cabezas: number;
  peso_total_estimado_kg?: number;
  peso_promedio_estimado_kg?: number;

  /**
   * Parámetros financieros (en Soles - PEN)
   */
  precio_base: number;
  precio_actual: number;
  incremento_minimo: number;

  /**
   * Configuración de Anti-Sniping:
   * Si entra una puja válida dentro de los últimos `anti_sniping_seconds` antes del cierre,
   * el tiempo de finalización se extiende automáticamente por `anti_sniping_extension` segundos.
   */
  anti_sniping_seconds: number;
  anti_sniping_extension: number;

  /**
   * Tiempos y estado del lote
   */
  estado: EstadoLote;
  fecha_inicio: string;
  fecha_cierre_programada: string;
  fecha_cierre_efectiva?: string;

  /**
   * Control de concurrencia optimista en PostgreSQL.
   * Se incrementa en cada puja confirmada para validar atomicidad sin locks destructivos.
   */
  version: number;

  /**
   * Datos del postor ganador actual (adjudicación provisional o definitiva)
   */
  postor_ganador_id?: string;
  organizacion_ganadora_id?: string;

  created_at: string;
  updated_at: string;
}

/**
 * Estado transaccional de una puja procesada.
 */
export const ESTADOS_PUJA = [
  'REGISTRADA',
  'SUPERADA',
  'GANADORA',
  'RECHAZADA'
] as const;

export type EstadoPuja = (typeof ESTADOS_PUJA)[number];

/**
 * Registro inmutable de una puja enviada y procesada.
 */
export interface Puja {
  id: string;
  lote_id: string;
  postor_id: string;
  organizacion_compradora_id: string;

  /**
   * Monto ofertado (debe ser mayor o igual a precio_actual + incremento_minimo).
   */
  monto: number;

  /**
   * Secuencia incremental estrictamente monótona del lote en PostgreSQL (1, 2, 3...).
   */
  secuencia: number;

  /**
   * Clave para garantizar que reintentos de red no generen pujas múltiples.
   */
  idempotency_key: IdempotencyKey;

  estado: EstadoPuja;
  timestamp: string;
  motivo_rechazo?: string;
}

/**
 * Solicitud de envío de puja desde el cliente (WebSocket o HTTP POST).
 */
export interface EnviarPujaRequest {
  lote_id: string;
  monto: number;
  idempotency_key: IdempotencyKey;
  version_esperada: number;
}

/**
 * Evento emitido tras confirmar una puja en PostgreSQL para distribución por WebSocket/SSE.
 */
export interface PujaConfirmadaEvent {
  tipo: 'PUJA_CONFIRMADA';
  lote_id: string;
  secuencia: number;
  monto: number;
  nuevo_precio_actual: number;
  postor_anonimizado: string;
  extension_aplicada: boolean;
  nueva_fecha_cierre?: string;
  nueva_version: number;
  timestamp: string;
}


/** Qué se vende en un lote (todos opcionales). La puja es por el PRECIO TOTAL del lote. */
export interface DetalleLote {
  cantidad_animales: number | null;
  categoria: string | null;
  raza: string | null;
  descripcion: string | null;
  establecimiento_id: string | null;
}

/** Fila del catálogo GET /api/v1/subastas (ver docs/api/contrato-v1-acceso-lotes.md). */
export interface LoteCatalogo extends DetalleLote {
  id: string;
  codigo_lote: string;
  estado: EstadoLote;
  precio_base: number;
  precio_actual: number;
  incremento_minimo: number;
  fecha_inicio: string;
  fecha_cierre: string;
  es_abierta: boolean;
  total_pujas: number;
  /** Origen público: posición aproximada (rejilla 0.01°) si es un ESTABLO de otra organización. */
  origen: { ubigeo: string; latitud: number; longitud: number; ubicacion_aproximada: boolean } | null;
  /** Suma de estimaciones de peso por IA: orientativa y NO vinculante; null si no hay. */
  peso_estimado_total_kg: number | null;
  es_mio: boolean;
}

export interface CatalogoLotesResponse {
  data: LoteCatalogo[];
  next_cursor: string | null;
}
