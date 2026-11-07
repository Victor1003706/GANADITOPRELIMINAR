import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyWebsocket from '@fastify/websocket';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { getPool } from './db.js';
import { authRoutes } from './auth/auth.routes.js';
import { mapaRoutes } from './mapa/mapa.routes.js';
import { spotRoutes } from './spot/spot.routes.js';
import { subastasRoutes } from './subastas/subastas.routes.js';
import { subastasWsRoutes, SubastaWsHub } from './subastas/subastas.ws.js';
import { pagosRoutes } from './pagos/pagos.routes.js';
import type { PagosConfig } from './pagos/pagos.service.js';
import { ordenesRoutes } from './subastas/ordenes.routes.js';
import { trazabilidadRoutes } from './trazabilidad/trazabilidad.routes.js';
import { mayoristaRoutes } from './mayorista/mayorista.routes.js';
import { gmxRoutes } from './gmx/gmx.routes.js';
import { logisticaRoutes } from './logistica/logistica.routes.js';
import { aiRoutes } from './integraciones/ai.routes.js';
import { pesoRoutes } from './peso/peso.routes.js';
import { AiClientService } from './integraciones/ai-client.service.js';
import { taxRoutes } from './integraciones/tax.routes.js';
import { SunatAdapter } from './integraciones/sunat.adapter.js';
import { CavaliAdapter } from './integraciones/cavali.adapter.js';
import { checkHealth } from './health.js';
import { redactarUrl, serializarPeticion } from './log-redaction.js';
import { LimitadorTasa } from './rate-limit.js';
import type { Writable } from 'node:stream';

export interface AppOptions {
  pool?: pg.Pool;
  jwtSecret?: string;
  logger?: boolean;
  /** Destino alternativo de los logs (solo pruebas). */
  logStream?: Writable;
  /**
   * Límite de tasa (login, registro, pujas, ticket WS, peso, cotizar). Activo por defecto
   * salvo RATE_LIMIT_DISABLED=true o bajo el runner node:test (cada suite hace muchos
   * logins desde 127.0.0.1); la prueba de rate-limit lo activa explícitamente.
   */
  limitarTasa?: boolean;
  redisSubscriber?: Redis;
  wsHub?: SubastaWsHub;
  /** Solo pruebas: revalidación y vida máxima de los sockets de subastas. */
  wsRevalidacionMs?: number;
  wsDuracionMaxSesionMs?: number;
  aiClient?: AiClientService;
  aiServiceUrl?: string;
  sunatAdapter?: SunatAdapter;
  cavaliAdapter?: CavaliAdapter;
  /** Por defecto TAX_INTEGRATIONS_ENABLED; las pruebas lo fuerzan. */
  integracionesTributarias?: boolean;
  /** Overrides de configuración de pagos (por defecto se leen de PAYMENTS_* / WEBHOOK_SECRET). */
  pagos?: Partial<PagosConfig>;
}

const DEV_JWT_SECRET = 'ganadito_local_dev_only_jwt_secret_32_chars_min';
export const MIN_JWT_SECRET_LENGTH = 32;

/**
 * En producción JWT_SECRET es obligatorio (≥32 caracteres): sin él cualquiera podría
 * firmar tokens con el valor de desarrollo publicado en el repositorio.
 */
export function resolveJwtSecret(override?: string): string {
  const secret = override ?? process.env.JWT_SECRET;
  if (secret && secret.length >= MIN_JWT_SECRET_LENGTH) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`JWT_SECRET es obligatorio en producción (mínimo ${MIN_JWT_SECRET_LENGTH} caracteres).`);
  }
  if (secret) {
    throw new Error(`JWT_SECRET debe tener al menos ${MIN_JWT_SECRET_LENGTH} caracteres.`);
  }
  return DEV_JWT_SECRET;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  // Los logs nunca registran la URL cruda: puede llevar ?access_token= (WS de subastas).
  const app = Fastify({
    logger: options.logger
      ? {
          serializers: { req: serializarPeticion },
          ...(options.logStream ? { stream: options.logStream } : {})
        }
      : false
  });

  // Todos los recursos con :id usan UUID. Un id mal formado es "no encontrado" (404) en
  // vez de llegar a PostgreSQL y terminar en 500 por el error 22P02.
  const UUID_PARAM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.addHook('pre