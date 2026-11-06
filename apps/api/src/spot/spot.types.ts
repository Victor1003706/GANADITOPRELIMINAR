import type { ProductoSpot, UnidadMedidaSpot } from '@ganadito/contracts';

export interface CrearCotizacionSpotInput {
  establecimiento_id: string;
  producto: ProductoSpot;
  categoria: string;
  calidad: string;
  unidad_medida: UnidadMedidaSpot;
  precio_unitario: number;
  moneda?: string;
  procedencia_ubigeo?: string;
  fecha_registro?: string;
  vigencia_hasta: string;
  verificado?: boolean;
}

export interface CotizacionSpotResponse {
  id: string;
  establecimiento_id: string;
  establecimiento_nombre?: string;
  establecimiento_tipo?: string;
  organizacion_id?: string;
  organizacion_nombre?: string;
  producto: ProductoSpot;
  categoria: string;
  calidad: string;
  unidad_medida: UnidadMedidaSpot;
  moneda: string;
  precio_unitario: number;
  procedencia_ubigeo: string;
  fecha_registro: string;
  vigencia_hasta: string;
  verificado: boolean;
  latitud?: number;
  longitud?: number;
  /** true si latitud/longitud son aproximadas por privacidad (establo ajeno). */
  ubicacion_aproximada?: boolean;
  created_at: string;
}

/**
 * Cotización tal como la devuelve la pizarra pública: siempre trae la política de
 * ubicación. latitud/longitud son null si la cotización no tiene establecimiento.
 */
export interface CotizacionPizarraResponse extends Omit<CotizacionSpotResponse, 'latitud' | 'longitud' | 'ubicacion_aproximada'> {
  latitud: number | null;
  longitud: number | null;
  ubicacion_aproximada: boolean;
}

export interface ConsultaPizarraQuery {
  producto?: ProductoSpot;
  ubigeo?: string;
  categoria?: string;
  calidad?: string;
  limit?: number;
  offset?: number;
}
