import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { SunatAdapter, SunatError } from './sunat.adapter.js';
import { CavaliAdapter, CavaliError } from './cavali.adapter.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { requireRole, requireActiveOrganization } from '../auth/authorize.js';
import type {
  LiquidacionCompraInput,
  SolicitudFactoringInput
} from '@ganadito/contracts';

export interface TaxRoutesOptions {
  pool: pg.Pool;
  /**
   * SUNAT y CAVALI son SIMULADORES (no hay integración real). Por eso las escrituras
   * están apagadas salvo TAX_INTEGRATIONS_ENABLED=true: con el stub activo se guardaban
   * comprobantes "CONFIRMADO" por SUNAT que nunca se enviaron.
   */
  habilitado?: boolean;
  sunatAdapter?: SunatAdapter;
  cavaliAdapter?: CavaliAdapter;
}

export const taxRoutes: FastifyPluginAsync<TaxRoutesOptions> = async (fastify, options) => {
  const { pool } = options;
  const sunatAdapter = options.sunatAdapter ?? new SunatAdapter(pool);
  const cavaliAdapter = options.cavaliAdapter ?? new CavaliAdapter(pool);
  const authenticate = createAuthMiddleware(pool);

  // Exponer adaptadores en la instancia fastify para pruebas
  (fastify as any).sunatAdapter = sunatAdapter;
  (fastify as any).cavaliAdapter = cavaliAdapter;

  /**
   * POST /api/v1/tributario/liquidaciones-compra
   * Emite una Liquidación de Compra Electrónica (SEE-SUNAT) vinculada a orden liquidada.
   */
  const habilitado = options.habilitado ?? process.env.TAX_INTEGRATIONS_ENABLED === 'true';
  fastify.addHook('onRequest', async (request, reply) => {
    if (!habilitado && request.method !== 'GET') {
      return reply.status(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'INTEGRACION_DESHABILITADA',
        message: 'Las integraciones SUNAT y CAVALI no están habilitadas (son simuladas).'
      });
    }
  });

  fastify.post<{ Body: LiquidacionCompraInput }>(
    '/tributario/liquidaciones-compra',
    { preHandler: [authenticate, requireActiveOrganization] },
    async (request, reply) => {
      try {
        const resultado = await sunatAdapter.emitirLiquidacionCompra(request.body ?? ({} as any), request.userSession!.activeOrganizationId!);
        return reply.status(201).send(resultado);
      } catch (err: any) {
        if (err instanceof SunatError) {
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
          message: 'Error al emitir la liquidación de compra electrónica.'
        });
      }
    }
  );

  /**
   * POST /api/v1/tributario/conciliar-pendientes
   * Job de conciliación asíncrono para comprobantes en estado 'ENVIADO_PENDIENTE'.
   */
  fastify.post(
    '/tributario/conciliar-pendientes',
    { preHandler: [authenticate, requireRole('ADMIN')] },
    async (request, reply) => {
      try {
        const resultado = await sunatAdapter.conciliarComprobantesPendientes();
        return reply.status(200).send(resultado);
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Error al conciliar comprobantes tributarios pendientes.'
        });
      }
    }
  );

  /**
   * GET /api/v1/tributario/comprobantes
   * Lista comprobantes fiscales emitidos.
   */
  fastify.get<{ Querystring: { limit?: number } }>(
    '/tributario/comprobantes',
    { preHandler: [authenticate, requireActiveOrganization] },
    async (request, reply) => {
      try {
        const limit = request.query.limit ? Number(request.query.limit) : 50;
        const comprobantes = await sunatAdapter.listarComprobantes(request.userSession!.activeOrganizationId!, limit);
        return reply.status(200).send({ comprobantes });
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Error al listar los comprobantes tributarios.'
        });
      }
    }
  );

  /**
   * GET /api/v1/tributario/comprobantes/:id
   * Obtiene el detalle de un comprobante tributario.
   */
  fastify.get<{ Params: { id: string } }>(
    '/tributario/comprobantes/:id',
    { preHandler: [authenticate, requireActiveOrganization] },
    async (request, reply) => {
      try {
        const comprobante = await sunatAdapter.obtenerComprobantePorId(request.params.id, request.userSession!.activeOrganizationId!);
        return reply.status(200).send(comprobante);
      } catch (err: any) {
        if (err instanceof SunatError) {
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
          message: 'Error al obtener el comprobante tributario.'
        });
      }
    }
  );

  /**
   * POST /api/v1/fintech/cavali/solicitar-factoring
   * Registra solicitud de factoring electrónico en CAVALI Factoring Stub.
   */
  fastify.post<{ Body: SolicitudFactoringInput }>(
    '/fintech/cavali/solicitar-factoring',
    { preHandler: [authenticate, requireActiveOrganization] },
    async (request, reply) => {
      const session = request.userSession;
      try {
        const resultado = await cavaliAdapter.solicitarFactoring(
          request.body ?? ({} as any),
          session?.activeOrganizationId
        );
        return reply.status(201).send(resultado);
      } catch (err: any) {
        if (err instanceof CavaliError) {
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
          message: 'Error al procesar la solicitud de factoring CAVALI.'
        });
      }
    }
  );

  /**
   * GET /api/v1/fintech/cavali
   * Lista solicitudes de factoring electrónico.
   */
  fastify.get<{ Querystring: { limit?: number } }>(
    '/fintech/cavali',
    { preHandler: [authenticate, requireActiveOrganization] },
    async (request, reply) => {
      try {
        const limit = request.query.limit ? Number(request.query.limit) : 50;
        const factorings = await cavaliAdapter.listarFactorings(request.userSession!.activeOrganizationId!, limit);
        return reply.status(200).send({ factorings });
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Error al listar solicitudes de factoring.'
        });
      }
    }
  );

  /**
   * GET /api/v1/fintech/cavali/:id
   * Consulta una anotación de factoring por ID.
   */
  fastify.get<{ Params: { id: string } }>(
    '/fintech/cavali/:id',
    { preHandler: [authenticate, requireActiveOrganization] },
    async (request, reply) => {
      try {
        const factoring = await cavaliAdapter.obtenerFactoringPorId(request.params.id, request.userSession!.activeOrganizationId!);
        return reply.status(200).send(factoring);
      } catch (err: any) {
        if (err instanceof CavaliError) {
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
          message: 'Error al obtener la solicitud de factoring.'
        });
      }
    }
  );
};
