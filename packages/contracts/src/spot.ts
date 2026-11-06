import type { PointGeoJSON, UbigeoPerunano } from './geo.js';

/**
 * Catálogo de tipos de productos comercializados en la pizarra spot de Ganadito.
 */
export const PRODUCTOS_SPOT = [
  'GANADO_EN_PIE',
  'CARNE_EN_CANAL',
  'CUARTO_COMPENSADO',
  'CORTE_PORTION_CONTROL',
  'QUINTO_CUARTO'
] as const;

export type ProductoSpot = (typeof PRODUCTOS_SPOT)[number];

/**
 * Unidades de medida estandarizadas para cotizaciones de compra y venta.
 */
export const UNIDADES_MEDIDA_SPOT = [
  'KG_VIVO',
  'KG_CANAL',
  'UNIDAD'
] as const;

export type UnidadMedidaSpot = (typeof UNIDADES_MEDIDA_SPOT)[number];

/**
 * Moneda oficial transaccional de la plataforma Ganadito (Soles peruanos).
 */
export const MONEDA_OFICIAL = 'PEN' as const;
export type MonedaOficial = typeof MONEDA_OFICIAL;

/**
 * Categorías zootécnicas comunes de ganado para cotización de mercado.
 */
export const CATEGORIAS_GANADO_SPOT = [
  'TORO',
  'TORETE',
  'VACA_ENGORDE',
  'VACA_DESCARTE',
  'VAQUILLONA',
  'TERNERO',
  'TERNERA',
  'BUEY',
  'LECHON',
  'CAPRINO',
  'OVINO',
  'OTRO'
] as const;

export type CategoriaGanadoSpot = (typeof CATEGORIAS_GANADO_SPOT)[number];

/**
 * Clasificación de calidad comercial cárnica.
 */
export const CALIDADES_CARNE_SPOT = [
  'EXTRA',
  'PRIMERA',
  'SEGUNDA',
  'INDUSTRIAL',
  'ESTANDAR'
] as const;

export type CalidadCarneSpot = (typeof CALIDADES_CARNE_SPOT)[number];

/**
 * Tipo de cotización en la pizarra (oferta de venta o demanda de compra).
 */
export type SentidoCotizacionSpot = 'OFERTA_VENTA' | 'DEMANDA_COMPRA';

/**
 * Cotización de mercado en la Pizarra Spot.
 * Diseñada para alimentar tanto la tabla analítica de precios como el mapa comercial geoespacial.
 */
export interface CotizacionSpot {
  id: string;
  organizacion_id: string;
  establecimiento_id?: string;
  sentido: SentidoCotizacionSpot;

  /**
   * Tipo de producto transado
   */
  producto: ProductoSpot;

  /**
   * Categoría zootécnica o corte comercial (ej. TORETE, TORO, LOMO_FINO)
   */
  categoria: CategoriaGanadoSpot | string;

  /**
   * Calidad cárnica o grado del ganado (ej. EXTRA, PRIMERA)
   */
  calidad: CalidadCarneSpot | string;

  /**
   * Unidad de medida física
   */
  unidad_medida: UnidadMedidaSpot;

  /**
   * Precio unitario expresado en Soles (PEN) por unidad_medida
   */
  precio_unitario: number;

  /**
   * Moneda oficial: siempre 'PEN' en territorio peruano
   */
  moneda: MonedaOficial;

  /**
   * Ubigeo oficial de 6 dígitos del punto de procedencia o venta
   */
  procedencia_ubigeo: UbigeoPerunano;

  /**
   * Coordenadas geográficas estándar Point GeoJSON para visualización en el mapa comercial
   * e indexación espacial PostGIS.
   */
  coordenadas?: PointGeoJSON;

  /**
   * Volumen o cantidad disponible en oferta / solicitada en compra
   */
  volumen_disponible?: number;

  /**
   * Vigencia y marcas de tiempo
   */
  fecha_registro: string;
  vigencia_hasta: string;
  activa: boolean;

  notas?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Filtros de consulta espacial y comercial para la pizarra spot y mapa interactivo.
 */
export interface ConsultaCotizacionesSpotFiltros {
  producto?: ProductoSpot;
  categoria?: string;
  calidad?: string;
  departamento_ubigeo?: string;
  /**
   * Búsqueda por radio espacial en kilómetros respecto a un punto WGS84 (ST_DWithin en PostGIS)
   */
  radio_km?: number;
  punto_referencia?: {
    latitud: number;
    longitud: number;
  };
  precio_min?: number;
  precio_max?: number;
  solo_activas?: boolean;
}
