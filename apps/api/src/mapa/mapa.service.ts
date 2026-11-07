import type pg from 'pg';
import { REJILLA_UBICACION_GRADOS, sqlUbicacionAproximada } from './ubicacion-publica.js';
import type {
  CrearEstablecimientoInput,
  EstablecimientoResponse,
  EstablecimientoCercanoResponse,
  BusquedaCercanosQuery
} from './mapa.types.js';

export class MapaError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'MapaError';
  }
}

export class MapaService {
  constructor(private pool: pg.Pool) {}

  /**
   * Registra un nuevo establecimiento físico con coordenadas geográficas en PostGIS (EPSG:4326).
   */
  async crearEstablecimiento(
    organizacionId: string,
    input: CrearEstablecimientoInput
  ): Promise<EstablecimientoResponse> {
    const { nombre_comercial, tipo, latitud, longitud, direccion_texto, ubigeo, activo } = input;

    // 1. Validaciones de dominio
    if (!nombre_comercial || !nombre_comercial.trim()) {
      throw new MapaError('nombre_comercial es obligatorio.', 400);
    }
    if (!tipo) {
      throw new MapaError('tipo de establecimiento es obligatorio.', 400);
    }
    if (typeof latitud !== 'number' || latitud < -90 || latitud > 90) {
      throw new MapaError('latitud inválida (debe estar comprendida entre -90 y 90).', 400);
    }
    if (typeof longitud !== 'number' || longitud < -180 || longitud > 180) {
      throw new MapaError('longitud inválida (debe estar comprendida entre -180 y 180).', 400);
    }
    if (!ubigeo || !/^\d{6}$/.test(ubigeo.trim())) {
      throw new MapaError('ubigeo debe contener exactamente 6 dígitos numéricos del INEI.', 400);
    }

    // 2. Inserción con PostGIS: ST_SetSRID(ST_MakePoint(longitud, latitud), 4326)::geography
    const res = await this.pool.query<EstablecimientoResponse>(
      `INSERT INTO establecimientos (
         organizacion_id,
         nombre_comercial,
         tipo,
         coordenadas,
         direccion_texto,
         ubigeo,
         activo
       )
       VALUES (
         $1,
         $2,
         $3,
         ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
         $6,
         $7,
         $8
       )
       RETURNING
         id,
         organizacion_id,
         nombre_comercial,
         tipo,
         ST_Y(coordenadas::geometry) AS latitud,
         ST_X(coordenadas::geometry) AS longitud,
         direccion_texto,
         ubigeo,
         activo,
         created_at,
         updated_at`,
      [
        organizacionId,
        nombre_comercial.trim(),
        tipo,
        longitud, // $4 = longitud (X)
        latitud,  // $5 = latitud (Y)
        direccion_texto.trim(),
        ubigeo.trim(),
        activo !== undefined ? activo : true
      ]
    );

    return res.rows[0]!;
  }

  /**
   * Búsqueda radial de establecimientos en PostGIS utilizando ST_DWithin y cálculo de distancia con ST_Distance.
   */
  async buscarCercanos(query: BusquedaCercanosQuery, viewerOrgId?: string): Promise<{
    centro: { latitud: number; longitud: number };
    radio_km: number;
    total: number;
    establecimientos: EstablecimientoCercanoResponse[];
  }> {
    const { lat, lon, radio_km = 50, tipo, limit = 20, offset = 0 } = query;

    if (typeof lat !== 'number' || isNaN(lat) || lat < -90 || lat > 90) {
      throw new MapaError('Parámetro "lat" (latitud) inválido o faltante (-90 a 90).', 400);
    }
    if (typeof lon !== 'number' || isNaN(lon) || lon < -180 || lon > 180) {
      throw new MapaError('Parámetro "lon" (longitud) inválido o faltante (-180 a 180).', 400);
    }
    if (typeof radio_km !== 'number' || isNaN(radio_km) || radio_km <= 0 || radio_km > 2000) {
      throw new MapaError('Parámetro "radio_km" debe ser mayor a 0 y no superior a 2000 km.', 400);
    }

    const radioMetros = radio_km * 1000;
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const safeOffset = Math.max(0, offset);

    // Privacidad (AGENTS.md §2): la ubicación exacta de un ESTABLO solo se entrega a su
    // organización. Para el resto se usa un punto ajustado a una rejilla de 0.01° (~1.1 km)
    // tanto en la respuesta como en el filtro y la distancia, para que no pueda
    // reconstruirse por trilateración. La dirección textual también se oculta.
    // El prefiltro sobre `coordenadas` (radio + 2 km) mantiene el uso del índice GiST.
    const res = await this.pool.query<EstablecimientoCercanoResponse>(
      `WITH candidatos AS (
         SELECT e.*,
                ${sqlUbicacionAproximada('e', '$7')} AS aprox
         FROM establecimientos e
         WHERE ST_DWithin(e.coordenadas, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3 + 2000)
           AND e.activo = TRUE
           AND ($4::varchar IS NULL OR e.tipo = $4)
       ),
       posicionados AS (
         SELECT c.*,
                CASE WHEN c.aprox
                     THEN ST_SnapToGrid(c.coordenadas::geometry, ${REJILLA_UBICACION_GRADOS})::geography
                     ELSE c.coordenadas END AS pos
         FROM candidatos c
       )
       SELECT
         id,
         organizacion_id,
         nombre_comercial,
         tipo,
         ST_Y(pos::geometry) AS latitud,
         ST_X(pos::geometry) AS longitud,
         CASE WHEN aprox THEN NULL ELSE direccion_texto END AS direccion_texto,
         ubigeo,
         activo,
         aprox AS ubicacion_aproximada,
         ROUND((ST_Distance(pos, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0)::numeric, 2)::float AS distancia_km,
         created_at,
         updated_at
       FROM posicionados
       WHERE ST_DWithin(pos, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
       ORDER BY distancia_km ASC, id ASC
       LIMIT $5 OFFSET $6`,
      [lon, lat, radioMetros, tipo ?? null, safeLimit, safeOffset, viewerOrgId ?? null]
    );

    return {
      centro: { latitud: lat, longitud: lon },
      radio_km,
      total: res.rows.length,
      establecimientos: res.rows
    };
  }
}
