/**
 * @ganadito/shared
 * Funciones de utilidad transversales y verificaciones reutilizables.
 */

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
