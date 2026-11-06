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
        return reply.status(200).send({ unidades });
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Error al obtener unidades de transporte.'
        });
      }
    }
  );

  /**
   * POST /api/v1/logistica/solicitudes
   * Crea una nueva solicitud de flete en estado 'PENDIENTE_ASIGNACION'.
   */
  fastify.post<{ Body: CrearSolicitudFleteInput }>(
    '/solicitudes',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession!;
      if (!session.activeOrganizationId) {
        return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Se requiere una organización activa.' });
      }
      try {
        const solicitud = await logisticaService.crearSolicitud(
          session.userId,
          session.activeOrganizationId,
          request.body ?? ({} as any)
        );
        return reply.status(201).send(solicitud);
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
          message: 'Error al crear la solicitud de flete.'
        });
      }
    }
  );

  /**
   * GET /api/v1/logistica/solicitudes/:id
   * Obtiene el detalle de una solicitud de flete.
   */
  fastify.get<{ Params: { id: string } }>(
    '/solicitudes/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const solicitud = await logisticaService.obtenerSolicitudPorId(request.params.id, visor(request));
        return reply.status(200).send(solicitud);
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
          message: 'Error al obtener la solicitud de flete.'
        });
      }
    }
  );

  /**
   * GET /api/v1/logistica/solicitudes
   * Lista solicitudes de flete según filtros opcionales.
   */
  fastify.get<{ Querystring: { estado?: any; transportista_id?: string } }>(
    '/solicitudes',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const solicitudes = await logisticaService.listarSolicitudes(visor(request), {
          estado: request.query.estado,
          transportista_id: request.query.transportista_id
        });
        return reply.status(200).send({ solicitudes });
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Error al listar solicitudes de flete.'
        });
      }
    }
  );

  /**
   * POST /api/v1/logistica/solicitudes/:id/tomar-flete
   * Asigna el flete al transportista autenticado con bloqueo pesimista SELECT ... FOR UPDATE.
   */
  fastify.post<{ Params: { id: string }; Body: TomarFleteInput }>(
    '/solicitudes/:id/tomar-flete',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession!;

      // Rol TRANSPORTISTA en el contexto ACTIVO.
      const esTransportista = session.activeRole === 'TRANSPORTISTA';

      if (!esTransportista) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Solo usuarios con rol TRANSPORTISTA pueden tomar solicitudes de flete.'
        });
      }

      try {
        const fleteAsignado = await logisticaService.tomarFlete(
          session.userId,
          request.params.id,
          request.body ?? ({} as any)
        );
        return reply.status(200).send(fleteAsignado);
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
          message: 'Error al procesar la asignación del flete.'
        });
      }
    }
  );

  /**
   * PATCH /api/v1/logistica/solicitudes/:id/estado
   * Actualiza el estado del viaje ('EN_TRANSITO' -> 'ENTREGADO') e inserta 'FLETE_COMPLETADO'.
   */
  fastify.patch<{ Params: { id: string }; Body: ActualizarEstadoFleteInput }>(
    '/solicitudes/:id/estado',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession!;
      const nuevoEstado = request.body?.estado;

      if (!nuevoEstado) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Debe especificar el nuevo estado en el cuerpo de la petición.'
        });
      }

      try {
        const solicitudActualizada = await logisticaService.actualizarEstado(
          session.userId,
          request.params.id,
          nuevoEstado
        );
        return reply.status(200).send(solicitudActualizada);
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
          message: 'Error al actualizar el estado del viaje.'
        });
      }
    }
  );
};
