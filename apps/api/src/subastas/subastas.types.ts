import type { EstadoLote } from '@ganadito/contracts';

export interface CrearLoteSubastaInput {
  codigo_lote?: string;
  precio_base: number;
  incremento_minimo: number;
  fecha_inicio?: string;
  fecha_cierre: string;
  anti_sniping_seconds?: number;
  anti_sniping_extension?: number;
  estado?: EstadoLote;
  /** Qué se vende (opcional): cantidad, categoría zootécnica, raza, descripción y origen. */
  cantidad_animales?: number;
  categoria?: string;
  raza?: string;
  descripcion?: string;
  /** Establecimiento de origen: debe ser de la organización vendedora. */
  establecimiento_id?: string;
}

export type { DetalleLote, LoteCatalogo } from '@ganadito/contracts';
import type { DetalleLote } from '@ganadito/contracts';

export interface LoteSubastaResponse extends Partial<DetalleLote> {
  id: string;
  codigo_lote: string;
  vendedor_id: string;
  vendedor_nombre?: string;
  estado: EstadoLote;
  precio_base: number;
  precio_actual: number;
  incremento_minimo: number;
  postor_ganador_id: string | null;
  fecha_inicio: string;
  fecha_cierre: string;
  anti_sniping_seconds: number;
  anti_sniping_extension: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface LoteSnapshotResponse {
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

export interface EmitirPujaInput {
  monto: number;
  idempotency_key: string;
}

export interface PujaAceptadaResponse {
  puja_id: string;
  lote_id: string;
  monto: number;
  secuencia: number;
  nueva_version: number;
  nuevo_precio_actual: number;
  extension_aplicada: boolean;
  nueva_fecha_cierre: string;
  idempotency_key: string;
  created_at: string;
}
