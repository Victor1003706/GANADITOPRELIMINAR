import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { MapaService, MapaError } from './mapa.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import type { CrearEstablecimientoInput, BusquedaCercanosQuery } from './mapa.types.js';

export interface MapaRoutesOptions {
  pool: pg.Pool;
}

export const mapaRoutes: FastifyPluginAsync<MapaRoutesOptions> = async (fastify, options) => {
  const { pool } = options;
  const mapaService = new MapaService(pool);
  const authenticate = createAuthMiddleware(pool);
  // Ruta pública: si llega un token se valida; sin token se atiende como anónimo.
  const optionalAuthenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) return authenticate(request, reply);
  };

  /**
   * POST /api/v1/establecimientos
   * Registra un nuevo establecimiento para la organización activa del usuario autenticado.
   */
  fastify.post<{ Body: CrearEstablecimientoInput }>(
    '/establecimientos',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const activeOrgId = request.userSession?.activeOrganizationId;

      if (!activeOrgId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Debe tener una organización activa en la sesión para registrar un establecimiento.'
        });
      }

      try {
        const establecimiento = await mapaService.crearEstablecimiento(activeOrgId, request.body);
        return reply.status(201).send(establecimiento);
      } catch (err: any) {
        if (err instanceof MapaError) {
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
          message: 'Error al registrar el establecimiento.'
        });
      }
    }
  );

  /**
   * GET /api/v1/establecimientos/cercanos
   * Búsqueda geoespacial radial con PostGIS (ST_DWithin y ST_Distance).
   */
  fastify.get<{ Querystring: Record<string, string | undefined> }>(
    '/establecimientos/cercanos',
    { preHandler: [optionalAuthenticate] },
    async (request, reply) => {
      const { lat, lon, radio_km, tipo, limit, offset } = request.query;

      if (lat === undefined || lon === undefined) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Los parámetros de consulta "lat" y "lon" son requeridos.'
        });
      }

      const queryInput: BusquedaCercanosQuery = {
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        radio_km: radio_km ? parseFloat(radio_km) : undefined,
        tipo: tipo as any,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined
      };

      try {
        const resultado = await mapaService.buscarCercanos(queryInput, request.userSession?.activeOrganizationId);
        return reply.status(200).send(resultado);
      } catch (err: any) {
        if (err instanceof MapaError) {
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
          message: 'Error al realizar la búsqueda geoespacial.'
        });
      }
    }
  );
};
