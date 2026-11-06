import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { TrazabilidadService, TrazabilidadError } from './trazabilidad.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import type { RegistrarBovinoInput, AgregarEventoInput } from '@ganadito/contracts';

export interface TrazabilidadRoutesOptions {
  pool: pg.Pool;
}

export const trazabilidadRoutes: FastifyPluginAsync<TrazabilidadRoutesOptions> = async (fastify, options) => {
  const { pool } = options;
  const trazabilidadService = new TrazabilidadService(pool);
  const authenticate = createAuthMiddleware(pool);

  /**
   * POST /api/v1/trazabilidad/bovinos
   * Registro de nuevo bovino con su evento génesis (secuencia 1) y hash criptográfico inicial.
   */
  fastify.post<{ Body: RegistrarBovinoInput }>(
    '/bovinos',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession!;

      if (!session.activeOrganizationId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Debe contar con una organización activa en su sesión para registrar un bovino.'
        });
      }

      try {
        const resultado = await trazabilidadService.registrarBovino(
          session.userId,
          session.activeOrganizationId,
          request.body
        );

        return reply.status(201).send(resultado);
      } catch (err: any) {
        if (err instanceof TrazabilidadError) {
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
          message: 'Error al registrar el bovino y su evento génesis.'
        });
      }
    }
  );

  /**
   * POST /api/v1/trazabilidad/bovinos/:id/eventos
   * Añadir un evento o hito al pasaporte bovino (vacunación, movimiento, faena, cambio de dueño).
   */
  fastify.post<{ Params: { id: string }; Body: AgregarEventoInput }>(
    '/bovinos/:id/eventos',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession!;
      const { id } = request.params;

      if (!session.activeOrganizationId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Debe contar con una organización activa en su sesión para registrar un evento.'
        });
      }

      try {
        const evento = await trazabilidadService.agregarEvento(
          session.userId,
          session.activeOrganizationId,
          id,
          request.body,
          session.activeRole
        );

        return reply.status(201).send(evento);
      } catch (err: any) {
        if (err instanceof TrazabilidadError) {
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
          message: 'Error al registrar el evento en el pasaporte bovino.'
        });
      }
    }
  );

  /**
   * GET /api/v1/trazabilidad/bovinos/:id/pasaporte
   * Consulta el pasaporte digital y la historia de eventos completa del bovino.
   */
  fastify.get<{ Params: { id: string } }>(
    '/bovinos/:id/pasaporte',
    {
      // Público para el QR; si llega token se valida y la organización propietaria ve la vista completa.
      preHandler: [async (request, reply) => {
        if (request.headers.authorization) return authenticate(request, reply);
      }]
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const pasaporte = await trazabilidadService.obtenerPasaporte(id, request.userSession?.activeOrganizationId);
        return reply.status(200).send(pasaporte);
      } catch (err: any) {
        if (err instanceof TrazabilidadError) {
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
          message: 'Error al obtener el pasaporte bovino.'
        });
      }
    }
  );

  /**
   * GET /api/v1/trazabilidad/bovinos/:id/verificar
   * Auditoría criptográfica instantánea de la cadena inmutable de eventos.
   */
  fastify.get<{ Params: { id: string } }>(
    '/bovinos/:id/verificar',
    async (request, reply) => {
      const { id } = request.params;

      try {
        const resultado = await trazabilidadService.verificarIntegridadPasaporte(id);
        return reply.status(200).send(resultado);
      } catch (err: any) {
        if (err instanceof TrazabilidadError) {
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
          message: 'Error al verificar la integridad de la cadena de trazabilidad.'
        });
      }
    }
  );
};
