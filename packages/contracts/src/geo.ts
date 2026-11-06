/**
 * Tipos e interfaces geoespaciales para integración con PostGIS (EPSG:4326 - WGS84).
 */

/**
 * Coordenadas geográficas estándar [longitud, latitud] en WGS84.
 * PostGIS ST_MakePoint(longitude, latitude).
 */
export type PositionWGS84 = [longitude: number, latitude: number];

/**
 * GeoJSON Point estándar (RFC 7946).
 */
export interface PointGeoJSON {
  type: 'Point';
  coordinates: PositionWGS84;
}

/**
 * Posición que la API entrega a un tercero (Ley 29733): si `ubicacion_aproximada` es
 * true, las coordenadas están ajustadas a la rejilla de 0.01° (~1,1 km) porque el
 * establo es de otra organización. La interfaz debe indicarlo y no mostrar un punto exacto.
 */
export interface UbicacionPublica {
  latitud: number;
  longitud: number;
  ubicacion_aproximada: boolean;
}

/**
 * Objeto plano de coordenadas para transporte o entrada de formularios.
 */
export interface CoordenadasGeograficas {
  latitud: number;
  longitud: number;
}

/**
 * Ubigeo peruano oficial de 6 dígitos del INEI (Departamento 2 + Provincia 2 + Distrito 2).
 */
export type UbigeoPerunano = string;
