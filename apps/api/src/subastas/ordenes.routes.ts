import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { OrdenesEntregaService, EntregaError } from './ordenes-entrega.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { requireActiveOrganization } from '../auth/authorize.js';
import { OrdenesConsultaService, ConsultaOrdenError } from './ordenes-consulta.service.js';
import type { DespacharOrdenInput, ConfirmarRecepcionInput } from '@ganadito/contracts';

export interface OrdenesRoutesOptions {
  pool: pg.Pool;
}

export const ordenesRoutes: FastifyPluginAsync<OrdenesRoutesOptions> = async (fastify, options) => {
  const { pool } = options;
  const ordenesEntregaService = new OrdenesEntregaService(pool);
  const authenticate = createAuthMiddleware(pool);
  const consulta = new OrdenesConsultaService(pool);

  /**
   * GET /api/v1/ordenes?rol=comprador|vendedor&limit=20&cursor=...
   * Órdenes de la organización activa (paginación por cursor sobre created_at, id).
   */
  fastify.get<{ Querystring: { rol?: string; limit?: string; cursor?: string } }>(
    '/',
    { preHandler: [authenticate, requireActiveOrganization] },
    async (request, reply) => {
      try {
        const res = await consulta.listar(request.userSession!.activeOrganizationId!, request.query);
        return reply.status(200).send(res);
      } catch (err: any) {
        if (err instanceof ConsultaOrdenError) {
          return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.name, message: err.message });
        }
        request.log.error(err);
        return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Error al listar órdenes.' });
      }
    }
  );

  /**
   * GET /api/v1/ordenes/:id. 404 si no existe o no pertenece a la organización activa.
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authenticate, requireActiveOrganization] },
    async (request, reply) => {
      try {
        const orden = await consulta.obtener(request.params.id, request.userSession!.activeOrganizationId!);
        return reply.status(200).send(orden);
      } catch (err: any) {
        if (err instanceof ConsultaOrdenError) {
          return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.name, message: err.message });
        }
        request.log.error(err);
        return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Error al consultar la orden.' });
      }
    }
  );

  /**
   * POST /api/v1/ordenes/:id/despachar
   * Permite al vendedor/transportista confirmar el despacho hacia custodia física/transporte.
   */
  fastify.post<{ Params: { id: string }; Body: DespacharOrdenInput }>(
    '/:id/despachar',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession!;
      const { id } = request.params;

      try {
        const resultado = await ordenesEntregaService.despacharOrden(
          session.userId,
          session.activeOrganizationId,
          id,
          request.body
        );

        return reply.status(200).send(resultado);
      } catch (err: any) {
        if (err instanceof EntregaError) {
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
          message: 'Error al procesar el despacho de la orden de compra.'
        });
      }
    }
  );

  /**
   * POST /api/v1/ordenes/:id/confirmar-recepcion
   * Permite al comprador confirmar la entrega conforme del ganado,
   * liberando los fondos en custodia y generando la liquidación neta al vendedor.
   */
  fastify.post<{ Params: { id: string }; Body: ConfirmarRecepcionInput }>(
    '/:id/confirmar-recepcion',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession!;
      const { id } = request.params;

      try {
        const resultado = await ordenesEntregaService.confirmarRecepcion(
          session.userId,
          session.activeOrganizationId,
          id,
          request.body
        );

        return reply.status(200).send(resultado);
      } catch (err: any) {
        if (err instanceof EntregaError) {
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
          message: 'Error al confirmar la recepción de la orden de compra.'
        });
      }
    }
  );
};
