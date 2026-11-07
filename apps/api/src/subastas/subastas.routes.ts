import type { FastifyPluginAsync } from 'fastify';
import { limitar, REGLAS } from '../rate-limit.js';
import type pg from 'pg';
import { SubastasService, SubastaError } from './subastas.service.js';
import { SubastasCloserService } from './subastas-closer.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { requireRole } from '../auth/authorize.js';
import type { CrearLoteSubastaInput, EmitirPujaInput } from './subastas.types.js';

export interface SubastasRoutesOptions {
  pool: pg.Pool;
}

export const subastasRoutes: FastifyPluginAsync<SubastasRoutesOptions> = async (fastify, options) => {
  const { pool } = options;
  const subastasService = new SubastasService(pool);
  const subastasCloserService = new SubastasCloserService(pool);
  const authenticate = createAuthMiddleware(pool);

  /**
   * POST /api/v1/subastas
   * Crea un lote de subasta vinculado a la organización activa del vendedor.
   */
  fastify.post<{ Body: CrearLoteSubastaInput }>(
    '/subastas',
    { preHandler: [authenticate, requireRole('VENDEDOR')] },
    async (request, reply) => {
      const activeOrgId = request.userSession?.activeOrganizationId;

      if (!activeOrgId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Debe contar con una organización activa en su sesión para publicar un lote de subasta.'
        });
      }

      try {
        const lote = await subastasService.crearLote(activeOrgId, request.body, request.userSession!.userId);
        return reply.status(201).send(lote);
      } catch (err: any) {
        if (err instanceof SubastaError) {
          return reply.status(err.statusCode).send({
            statusCode: err.statusCode,
            error: err.name,
            message: err.message,
            ...(err.code ? { code: err.code } : {})
          });
        }
        request.log.error(err);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Error al crear el lote de subasta.'
        });
      }
    }
  );

  /**
   * GET /api/v1/subastas?estado=&mios=true&limit=&cursor=
   * Catálogo público de lotes publicados; con mios=true y sesión, los de la organización.
   */
  fastify.get<{ Querystring: { estado?: string; mios?: string; limit?: string; cursor?: string } }>(
    '/subastas',
    { onRequest: [async (request, reply) => { if (request.headers.authorization) return authenticate(request, reply); }] },
    async (request, reply) => {
      try {
        const resultado = await subastasService.listarLotes(request.query ?? {}, {
          userId: request.userSession?.userId,
          organizacionId: request.userSession?.activeOrganizationId
        });
        return reply.status(200).send(resultado);
      } catch (err: any) {
        if (err instanceof SubastaError) {
          return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.name, message: err.message });
        }
        request.log.error(err);
        return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Error al listar los lotes.' });
      }
    }
  );

  /**
   * GET /api/v1/subastas/:id/snapshot
   * Consulta el Snapshot en tiempo real del lote de subasta (lectura sin bloqueos).
   */
  fastify.get<{ Params: { id: string } }>(
    '/subastas/:id/snapshot',
    // Autenticación opcional: con token, el visitante ve si él es quien va ganando.
    { onRequest: [async (request, reply) => { if (request.headers.authorization) return authenticate(request, reply); }] },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const snapshot = await subastasService.obtenerSnapshot(id, {
          userId: request.userSession?.userId,
          organizacionId: request.userSession?.activeOrganizationId
        });
        return reply.status(200).send(snapshot);
      } catch (err: