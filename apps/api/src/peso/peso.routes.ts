import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { limitar, REGLAS } from '../rate-limit.js';
import type pg from 'pg';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { requireRole } from '../auth/authorize.js';
import { AiClientService } from '../integraciones/ai-client.service.js';
import { PesoError, PesoService } from './peso.service.js';

export interface PesoRoutesOptions {
  pool: pg.Pool;
  aiClient?: AiClientService;
  aiServiceUrl?: string;
}

/** 4 vistas de hasta ~6 MB en Base64 caben; más que eso se corta antes de parsear. */
export const LIMITE_CUERPO_ESTIMACION_BYTES = 26 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function responderError(reply: FastifyReply, err: unknown, log: { error: (e: unknown) => void }) {
  if (err instanceof PesoError) {
    return reply.status(err.statusCode).send({
      statusCode: err.statusCode,
      error: err.name,
      code: err.code,
      message: err.message,
      ...(err.detalle !== undefined ? { detalle: err.detalle } : {})
    });
  }
  log.error(err);
  return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Error en la estimación de peso.' });
}

function exigirUuid(valor: string, reply: FastifyReply): boolean {
  if (UUID.test(valor)) return true;
  reply.status(404).send({ statusCode: 404, error: 'PesoError', code: 'NO_ENCONTRADO', message: 'Recurso no encontrado.' });
  return false;
}

export const pesoRoutes: FastifyPluginAsync<PesoRoutesOptions> = async (fastify, options) => {
  const { pool } = options;
  const aiClient = options.aiClient ?? new AiClientService({ baseUrl: options.aiServiceUrl });
  const servicio = new PesoService(pool, aiClient);
  const authenticate = createAuthMiddleware(pool);
  // Lectura pública: si llega un token se valida (el dueño ve sus borradores).
  const authenticateOpcional = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) return authenticate(request, reply);
  };

  /**
   * POST /api/v1/subastas/:id/estimaciones-peso
   * El vendedor dueño del lote agrega la estimación orientativa de un animal.
   * Admite el encabezado Idempotency-Key.
   */
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/subastas/:id/estimaciones-peso',
    // onRequest (no preHandler): sesión y rol se validan ANTES de leer y parsear hasta 26 MB.
    { bodyLimit: LIMITE_CUERPO_ESTIMACION_BYTES, onRequest: [authenticate, requireRole('VENDEDOR'), limitar(fastify, REGLAS.pesoUsuario)] },
    async (request, reply) => {
      if (!exigirUuid(request.params.id, reply)) return reply;
      const clave = request.headers['idempotency-key'];
      try {
        const { estimacion, repetida } = await servicio.crearEstimacion(
          request.params.id,
          request.userSession!.activeOrganizationId!,
          request.userSession!.userId,
          request.body,
          typeof clave === 'string' ? clave : undefined
        );
        if (repetida) reply.header('Idempotent-Replayed', 'true');
        return reply.status(repetida ? 200 : 201).send(estimacion);
      } catch (err) {
        return responderError(reply, err, request.log);
      }
    }
  );

  /**
   * GET /api/v1/subastas/:id/estimaciones-peso
   * Lectura pública (igual que el snapshot del lote): estimaciones y resumen del lote.
   */
  fastify.get<{ Params: { id: string } }>(
    '/subastas/:id/estimaciones-peso',
    { onRequest: [authenticateOpcional] },
    async (request, reply) => {
    if (!exigirUuid(request.params.id, reply)) return reply;
    try {
      return reply
        .status(200)
        .send(await servicio.resumenLote(request.params.id, request.userSession?.activeOrganizationId));
    } catch (err) {
      return responderError(reply, err, request.log);
    }
  }
  );

  /**
   * POST /api/v1/estimaciones-peso/:id/pesaje
   * Peso real de balanza para la