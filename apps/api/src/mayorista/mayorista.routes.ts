import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { MayoristaService, MayoristaError } from './mayorista.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { requireRole } from '../auth/authorize.js';
import type {
  CrearPoolMayoristaInput,
  UnirsePoolInput,
  ListarPoolsQuery
} from '@ganadito/contracts';

export interface MayoristaRoutesOptions {
  pool: pg.Pool;
}

export const mayoristaRoutes: FastifyPluginAsync<MayoristaRoutesOptions> = async (fastify, options) => {
  const { pool } = options;
  const mayoristaService = new MayoristaService(pool);
  const authenticate = createAuthMiddleware(pool);

  /**
   * POST /api/v1/mayorista/pools
   * Crea una nueva campaña de compra mayorista u oferta flash (requiere JWT).
   */
  fastify.post<{ Body: CrearPoolMayoristaInput }>(
    '/pools',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession!;

      if (!session.activeOrganizationId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Debe contar con una organización activa en su sesión para crear un pool mayorista.'
        });
      }

      try {
        const poolCreado = await mayoristaService.crearPool(
          session.userId,
          session.activeOrganizationId,
          request.body
        );

        return reply.status(201).send(poolCreado);
      } catch (err: any) {
        if (err instanceof MayoristaError) {
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
          message: 'Error al crear la campaña de compra mayorista.'
        });
      }
    }
  );

  /**
   * GET /api/v1/mayorista/pools
   * Listado público de campañas mayoristas activas con cálculo de progreso.
   */
  fastify.get<{ Querystring: ListarPoolsQuery }>(
    '/pools',
    async (request, reply) => {
      try {
        const pools = await mayoristaService.listarPoolsActivos(request.query);
        return reply.status(200).send(pools);
      } catch (err: any) {
        if (err instanceof MayoristaError) {
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
          message: 'Error al consultar los pools mayoristas.'
        });
      }
    }
  );

  /**
   * GET /api/v1/mayorista/pools/:id
   * Consulta el detalle y progreso de un pool mayorista.
   */
  fastify.get<{ Params: { id: string } }>(
    '/pools/:id',
    async (request, reply) => {
      const { id } = request.params;

      try {
        const poolData = await mayoristaService.obtenerPoolPorId(id);
        return reply.status(200).send(poolData);
      } catch (err: any) {
        if (err instanceof MayoristaError) {
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
          message: 'Error al obtener el pool mayorista.'
        });
      }
    }
  );

  /**
   * POST /api/v1/mayorista/pools/:id/unirse
   * Unirse a una campaña mayorista reservando volumen (requiere JWT).
   */
  fastify.post<{ Params: { id: string }; Body: UnirsePoolInput }>(
    '/pools/:id/unirse',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession!