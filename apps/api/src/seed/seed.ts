import bcryptjs from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool, runInitialMigration } from '../db.js';
import { calcularHashEvento, GENESIS_PREV_HASH } from '@ganadito/contracts';

// ============================================================================
// GUARDIA DE SEGURIDAD CONTRA EJECUCIÓN EN PRODUCCIÓN
// ============================================================================

/**
 * Guardia de seguridad para impedir ejecuciones accidentales en entornos de producción
 * o sobre bases de datos no locales/tests.
 */
const HOSTS_SEED_PERMITIDOS = new Set(['localhost', '127.0.0.1', '::1', 'ganadito-postgres', 'postgres']);

/**
 * Hosts permitidos: lista exacta local/docker/CI, más los indicados explícitamente en
 * SEED_ALLOWED_HOSTS (separados por coma). No se usan coincidencias parciales del nombre
 * (p. ej. "includes('test')" aceptaría "prod-test-db.example.com").
 */
export function esHostSeedPermitido(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  const extra = (process.env.SEED_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return HOSTS_SEED_PERMITIDOS.has(host) || extra.includes(host);
}

/**
 * Parámetros de la cadena de conexión que pg (pg-connection-string) acepta para sustituir
 * el destino indicado en la autoridad de la URL. Si se permitieran, una URL que parece
 * local (`postgres://localhost/db?host=prod.example.com`) conectaría a otro servidor.
 */
const PARAMETROS_DESTINO_PROHIBIDOS = new Set(['host', 'hostaddr', 'port', 'socket']);
const PROTOCOLOS_PERMITIDOS = new Set(['postgres:', 'postgresql:']);

/**
 * Valida el destino efectivo del seed SIN abrir conexiones. Devuelve el motivo del
 * rechazo o null si el destino es local y está permitido.
 */
/** Contraseña de los usuarios de demostración (ver comentario en la creación de usuarios). */
export function resolverPasswordSeed(env: NodeJS.ProcessEnv): string {
  const fueraDeLocal = (env.SEED_ALLOWED_HOSTS ?? '').trim() !== '';
  const propia = env.SEED_PASSWORD?.trim();
  if (fueraDeLocal) {
    if (!propia || propia.length < 12) {
      throw new Error('Con SEED_ALLOWED_HOSTS se requiere SEED_PASSWORD (mínimo 12 caracteres).');
    }
    return propia;
  }
  return propia || 'ganadito2026';
}

export function validarDestinoSeed(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV === 'production') {
    return 'No se permite ejecutar seeders con NODE_ENV="production".';
  }

  const dbUrl = env.DATABASE_URL;
  if (dbUrl) {
    let url: URL;
    try {
      url = new URL(dbUrl);
    } catch {
      return 'DATABASE_URL no es una URL válida.';
    }
    if (!PROTOCOLOS_PERMITIDOS.has(url.protocol)) {
      return `DATABASE_URL usa un protocolo no permitido (${url.protocol}).`;
    }
    for (const nombre of url.searchParams.keys()) {
      if (PARAMETROS_DESTINO_PROHIBIDOS.has(nombre.toLowerCase())) {
        return `DATABASE_URL incluye el parámetro "${nombre}", que sustituye el destino de la conexión.`;
      }
    }
    if (!url.hostname || !esHostSeedPermitido(decodeURIComponent(url.hostname))) {
      return `DATABASE_URL no apunta a un host local permitido (${url.hostname || 'sin host'}).`;
    }
    return null;
  }

  const dbHost = env.DATABASE_HOST ?? 'localhost';
  if (!esHostSeedPermitido(dbHost)) {
    return `DATABASE_HOST (${dbHost}) no es un host local permitido.`;
  }
  return null;
}

/**
 * Guardia de seguridad para impedir ejecuciones accidentales en producción
 * o sobre bases de datos no locales. Se ejecuta antes de toda conexión y migración.
 */
export function assertSafeSeedEnvironment(): void {
  const motivo = validarDestinoSeed();
  if (motivo) {
    console.error(`⛔ [ERROR CRÍTICO] ${motivo} Use SEED_ALLOWED_HOSTS para autorizar otro host explícitamente. Abortando.`);
  