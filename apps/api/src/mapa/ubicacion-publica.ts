/**
 * Política única de privacidad de ubicación (AGENTS.md §2, Ley 29733) para TODAS las
 * lecturas públicas de establecimientos: mapa, Pizarra Spot y cualquier lectura futura.
 *
 * La ubicación exacta de un ESTABLO solo la ve su propia organización. Para anónimos y
 * otras organizaciones se entrega el punto ajustado a una rejilla de 0.01° (~1.1 km) y
 * sin dirección textual. Camales, ferias y centros de beneficio son públicos.
 */
export const REJILLA_UBICACION_GRADOS = 0.01;

/**
 * Expresión SQL booleana: true si la ubicación de `alias` debe aproximarse para el
 * visitante cuyo `organizacion_id` llega en el parámetro `paramVisitante` (NULL = anónimo).
 */
export function sqlUbicacionAproximada(alias: string, paramVisitante: string): string {
  return `(${alias}.tipo = 'ESTABLO' AND ${alias}.organizacion_id IS DISTINCT FROM ${paramVisitante}::uuid)`;
}

/** Expresión SQL geography con la posición que puede ver el visitante. */
export function sqlPosicionPublica(alias: string, paramVisitante: string): string {
  return `CASE WHEN ${sqlUbicacionAproximada(alias, paramVisitante)}
               THEN ST_SnapToGrid(${alias}.coordenadas::geometry, ${REJILLA_UBICACION_GRADOS})::geography
               ELSE ${alias}.coordenadas END`;
}
