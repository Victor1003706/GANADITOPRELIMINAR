import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { SpotService, SpotError } from './spot.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import type { CrearCotizacionSpotInput, ConsultaPizarraQuery } from './spot.types.js';

export interface SpotRoutesOptions {
  pool: pg.Pool;
}

export const spotRoutes: FastifyPluginAsync<SpotRoutesOptions> = async (fastify, options) => {
  const { pool } = options;
  const spotService = new SpotService(pool);
  const authenticate = createAuthMiddleware(pool);
  // Ruta pública: si llega un token se valida; sin token se atiende como anónimo.
  const optionalAuthenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) return authenticate(request, reply);
  };

  /**
   * POST /api/v1/cotizaciones
   * Publica un precio de cotización Spot vinculado a un establecimiento de la organización activa.
   */
  fastify.post<{ Body: CrearCotizacionSpotInput }>(
    '/cotizaciones',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const activeOrgId = request.userSession?.activeOrganizationId;

      if (!activeOrgId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Debe tener una organización activa en la sesión para publicar una cotización spot.'
        });
      }

      try {
        const cotizacion = await spotService.crearCotizacion(activeOrgId, request.body);
        return reply.status(201).send(cotizacion);
      } catch (err: any) {
        if (err instanceof SpotError) {
          return reply.status(err.statusCode).send({
            statusCode: err.statusCode,
            error: err.name,
            message: err.message
          });
        }
        request.log.error(err);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Error al registrar la cotización spot.'
        });
      }
    }
  );

  /**
   * GET /api/v1/cotizaciones/pizarra
   * Consulta pública o autenticada de precios vigentes en la Pizarra Spot.
   */
  fastify.get<{ Querystring: Record<string, string | undefined> }>(
    '/cotizaciones/pizarra',
    { preHandler: [optionalAuthenticate] },
    async (request, reply) => {
      const { producto, ubigeo, categoria, calidad, limit, offset } = request.query;

      const queryInput: ConsultaPizarraQuery = {
        producto: producto as any,
        ubigeo: ubigeo ? ubigeo.trim() : undefined,
        categoria: categoria ? categoria.trim() : undefined,
        calidad: calidad ? calidad.trim() : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined
      };

      try {
        const resultado = await spotService.consultarPizarra(queryInput, request.userSession?.activeOrganizationId);
        return reply.status(200).send(resultado);
      } catch (err: any) {
        if (err instanceof SpotError) {
          return reply.status(err.statusCode).send({
            statusCode: err.statusCode,
            error: err.name,
            message: err.message
          });
        }
        request.log.error(err);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Error al consultar la pizarra spot.'
        });
      }
    }
  );
};
