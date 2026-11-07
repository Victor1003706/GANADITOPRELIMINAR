import type { FastifyPluginAsync } from 'fastify';
import { limitar, REGLAS } from '../rate-limit.js';
import type pg from 'pg';
import { LogisticaService, LogisticaError, type RegistrarUnidadInput, type VisorFlete } from './logistica.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import type {
  CotizarFleteInput,
  CrearSolicitudFleteInput,
  TomarFleteInput,
  ActualizarEstadoFleteInput
} from '@ganadito/contracts';

export interface LogisticaRoutesOptions {
  pool: pg.Pool;
}

export const logisticaRoutes: FastifyPluginAsync<LogisticaRoutesOptions> = async (fastify, options) => {
  const { pool } = options;
  const logisticaService = new LogisticaService(pool);
  const authenticate = createAuthMiddleware(pool);
  // El rol se toma SOLO del contexto activo (antes valía TRANSPORTISTA en cualquier organización).
  const visor = (request: { userSession?: { userId: string; activeOrganizationId?: string; activeRole?: string } }): VisorFlete => ({
    userId: request.userSession!.userId,
    organizacionId: request.userSession!.activeOrganizationId,
    esTransportista: request.userSession!.activeRole === 'TRANSPORTISTA'
  });

  /**
   * POST /api/v1/logistica/cotizar
   * Calcula la distancia PostGIS y entrega la cotización matemática del flete con comisiones.
   */
  fastify.post<{ Body: CotizarFleteInput }>(
    '/cotizar',
    // Antes era anónima y con distancias exactas: permitía triangular establos ajenos.
    { onRequest: [authenticate, limitar(fastify, REGLAS.cotizarUsuario)] },
    async (request, reply) => {
      try {
        const resultado = await logisticaService.cotizarFlete(
          request.body ?? ({} as any),
          request.userSession!.activeOrganizationId ?? null
        );
        return reply.status(200).send(resultado);
      } catch (err: any) {
        if (err instanceof LogisticaError) {
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
          message: 'Error al cotizar el flete logístico.'
        });
      }
    }
  );

  /**
   * POST /api/v1/logistica/unidades
   * Registra una unidad de transporte vehicular homologada para el transportista.
   */
  fastify.post<{ Body: RegistrarUnidadInput }>(
    '/unidades',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession!;

      if (!session.activeOrganizationId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Se requiere una organización activa para registrar unidades de transporte.'
        });
      }

      try {
        const unidad = await logisticaService.registrarUnidad(
          session.userId,
          session.activeOrganizationId,
          request.body ?? ({} as any)
        );
        return reply.status(201).send(unidad);
      } catch (err: any) {
        if (err instanceof LogisticaError) {
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
          message: 'Error al registrar unidad de transporte.'
        });
      }
    }
  );

  /**
   * GET /api/v1/logistica/unidades
   * Lista las unidades vehiculares registradas por el transportista autenticado.
   */
  fastify.get(
    '/unidades',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession!;
      try {
        const unidades = await logisticaService.listarUnidadesTransportista(session.userId);
        return reply.status(