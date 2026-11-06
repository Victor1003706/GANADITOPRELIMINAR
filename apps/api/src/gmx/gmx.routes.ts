import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { GmxService, GmxError } from './gmx.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import type { CrearOrdenGmxInput, CalcularEscandalloInput } from '@ganadito/contracts';

export interface GmxRoutesOptions {
  pool: pg.Pool;
}

export const gmxRoutes: FastifyPluginAsync<GmxRoutesOptions> = async (fastify, options) => {
  const { pool } = options;
  const gmxService = new GmxService(pool);
  const authenticate = createAuthMiddleware(pool);

  /**
   * POST /api/v1/gmx/escandallo
   * Calculadora zootécnica determinista de los 18 cortes anatómicos según NTP 201.055.
   */
  fastify.post<{ Body: CalcularEscandalloInput }>(
    '/escandallo',
    async (request, reply) => {
      try {
        const resultado = gmxService.ejecutarEscandallo((request.body ?? {}) as Record<string, any>);
        return reply.status(200).send(resultado);
      } catch (err: any) {
        if (err instanceof GmxError) {
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
          message: 'Error al calcular el escandallo anatómico.'
        });
      }
    }
  );

  /**
   * POST /api/v1/gmx/ordenes
   * Registra una orden de COMPRA o VENTA en la Bolsa Cárnica (GMX) y ejecuta matching inmediato.
   */
  fastify.post<{ Body: CrearOrdenGmxInput }>(
    '/ordenes',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession!;

      if (!session.activeOrganizationId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Debe contar con una organización activa en su sesión para operar en GMX.'
        });
      }

      try {
        const resultado = await gmxService.crearOrden(
          session.userId,
          session.activeOrganizationId,
          request.body
        );
        return reply.status(201).send(resultado);
      } catch (err: any) {
        if (err instanceof GmxError) {
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
          message: 'Error al procesar la orden en la Bolsa GMX.'
        });
      }
    }
  );

  /**
   * GET /api/v1/gmx/orderbook
   * Consulta pública agregada del libro de órdenes activo por niveles de precio.
   */
  fastify.get<{ Querystring: { producto?: string } }>(
    '/orderbook',
    async (request, reply) => {
      try {
        const book = await gmxService.consultarOrderbook(request.query.producto);
        return reply.status(200).send(book);
      } catch (err: any) {
        if (err instanceof GmxError) {
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
          message: 'Error al consultar el libro de órdenes GMX.'
        });
      }
    }
  );
};
