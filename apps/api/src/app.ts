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
  app.addHook('preValidation', async (request, reply) => {
    const id = (request.params as Record<string, unknown> | undefined)?.id;
    if (typeof id === 'string' && !UUID_PARAM.test(id)) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Recurso no encontrado.' });
    }
  });

  // Errores de restricción de PostgreSQL que una ruta no tradujo: respuesta coherente sin
  // filtrar el detalle (que puede incluir valores).
  app.setErrorHandler((error: any, request, reply) => {
    const porCodigo: Record<string, [number, string]> = {
      '22P02': [404, 'Recurso no encontrado.'],
      '23505': [409, 'El recurso ya existe.'],
      '23514': [400, 'Datos fuera de rango.'],
      '22003': [400, 'Valor numérico fuera de rango.']
    };
    const mapeo = typeof error?.code === 'string' ? porCodigo[error.code] : undefined;
    if (mapeo) return reply.status(mapeo[0]).send({ statusCode: mapeo[0], error: mapeo[0] === 409 ? 'Conflict' : mapeo[0] === 404 ? 'Not Found' : 'Bad Request', message: mapeo[1] });
    const status = typeof error?.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) request.log.error(error);
    return reply.status(status).send({ statusCode: status, error: status >= 500 ? 'Internal Server Error' : error.name ?? 'Error', message: status >= 500 ? 'Error interno.' : error.message });
  });

  // El 404 por defecto de Fastify escribe la URL cruda en el log y en la respuesta.
  app.setNotFoundHandler((request, reply) => {
    const mensaje = `Route ${request.method}:${redactarUrl(request.url)} not found`;
    request.log.info(mensaje);
    reply.code(404).send({ message: mensaje, error: 'Not Found', statusCode: 404 });
  });

  const pool = options.pool ?? getPool();

  const limitarTasa = options.limitarTasa ?? (process.env.RATE_LIMIT_DISABLED !== 'true' && !process.env.NODE_TEST_CONTEXT);
  const limitador = new LimitadorTasa();
  app.decorate('limitador', limitador);
  app.decorate('limitarTasa', limitarTasa);
  app.addHook('onClose', async () => limitador.cerrar());
  const jwtSecret = resolveJwtSecret(options.jwtSecret);

  // Preservar rawBody para validación criptográfica de firmas HMAC
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      (req as any).rawBody = body;
      try {
        const json =
          typeof body === 'string' && body.trim().length > 0
            ? JSON.parse(body)
            : {};
        done(null, json);
      } catch (err: any) {
        err.statusCode = 400;
        done(err, undefined);
      }
    }
  );

  // Registrar plugin oficial de WebSockets
  app.register(fastifyWebsocket);

  // Registrar plugin oficial de JWT
  app.register(fastifyJwt, {
    secret: jwtSecret
  });

  // Ruta base de Health Check
  app.get('/health', async (_request, reply) => {
    const report = await checkHealth(pool);
    return reply.status(report.db === 'ok' ? 200 : 503).send(report);
  });

  // Registrar rutas de autenticación y RBAC dual
  app.register(authRoutes, {
    prefix: '/api/v1/auth',
    pool
  });

  // Registrar rutas geoespaciales de mapa y establecimientos
  app.register(mapaRoutes, {
    prefix: '/api/v1',
    pool
  });

  // Registrar rutas comerciales de cotizaciones en Pizarra Spot
  app.register(spotRoutes, {
    prefix: '/api/v1',
    pool
  });

  // Registrar motor transaccional de subastas en vivo (REST)
  app.register(subastasRoutes, {
    prefix: '/api/v1',
    pool
  });

  // Registrar difusión WebSocket de subastas en vivo (WebSockets)
  app.register(subastasWsRoutes, {
    prefix: '/api/v1',
    subscriber: options.redisSubscriber,
    hub: options.wsHub,
    pool,
    revalidacionMs: options.wsRevalidacionMs,
    duracionMaxSesionMs: options.wsDuracionMaxSesionMs
  });

  // Registrar módulo financiero de pagos y webhooks de pasarelas
  app.register(pagosRoutes, {
    prefix: '/api/v1/pagos',
    pool,
    config: options.pagos
  });

  // Registrar ciclo de entrega y liquidaciones de órdenes de compra
  app.register(ordenesRoutes, {
    prefix: '/api/v1/ordenes',
    pool
  });

  // Registrar módulo de trazabilidad bovina y pasaporte digital inmutable
  app.register(trazabilidadRoutes, {
    prefix: '/api/v1/trazabilidad',
    pool
  });

  // Registrar motor de compras mayoristas, agregación de demanda B2B y ofertas flash
  app.register(mayoristaRoutes, {
    prefix: '/api/v1/mayorista',
    pool
  });

  // Registrar Bolsa de Valores Cárnica (GMX) y Motor de Escandallo Anatómico (NTP 201.055)
  app.register(gmxRoutes, {
    prefix: '/api/v1/gmx',
    pool
  });

  // Registrar Pasarela Logística Integrada (Ganadito Cargo & Express API)
  app.register(logisticaRoutes, {
    prefix: '/api/v1/logistica',
    pool
  });

  // Registrar Cliente Resiliente del Servicio Satélite de Inteligencia Artificial
  app.register(aiRoutes, {
    prefix: '/api/v1/ia',
    pool,
    aiClient: options.aiClient,
    aiServiceUrl: options.aiServiceUrl
  });

  // Estimación orientativa de peso por lote (zoometría) y pesajes de balanza
  app.register(pesoRoutes, {
    prefix: '/api/v1',
    pool,
    aiClient: options.aiClient,
    aiServiceUrl: options.aiServiceUrl
  });

  // Registrar Adaptadores Tributarios (SEE-SUNAT) y Fintech (CAVALI Factoring)
  app.register(taxRoutes, {
    prefix: '/api/v1',
    pool,
    sunatAdapter: options.sunatAdapter,
    cavaliAdapter: options.cavaliAdapter,
    habilitado: options.integracionesTributarias
  });

  return app;
}
