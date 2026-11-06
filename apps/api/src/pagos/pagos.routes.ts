import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type pg from 'pg';
import { PagosService, PagoError, resolvePagosConfig, type PagosConfig } from './pagos.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import type { CheckoutInput, WebhookPagoPayload } from '@ganadito/contracts';

export interface PagosRoutesOptions {
  pool: pg.Pool;
  config?: Partial<PagosConfig>;
}

function enviarPagosDeshabilitados(reply: FastifyReply) {
  return reply.status(503).send({
    statusCode: 503,
    error: 'PagosDeshabilitados',
    message: 'El módulo de pagos no está habilitado en este entorno.'
  });
}

export const pagosRoutes: FastifyPluginAsync<PagosRoutesOptions> = async (fastify, options) => {
  const { pool } = options;

  // Lanza al registrar el plugin si PAYMENTS_ENABLED=true sin configuración segura,
  // de modo que app.ready() / listen() fallan en el arranque y no en el primer cobro.
  const config = resolvePagosConfig(options.config);

  if (!config.enabled) {
    fastify.post('/checkout', async (_request, reply) => enviarPagosDeshabilitados(reply));
    fastify.post('/webhook', async (_request, reply) => enviarPagosDeshabilitados(reply));
    return;
  }

  const pagosService = new PagosService(pool, config);
  const authenticate = createAuthMiddleware(pool);

  /**
   * POST /api/v1/pagos/checkout
   * Inicia o reutiliza la intención de pago de una orden en estado PENDIENTE_PAGO.
   */
  fastify.post<{ Body: CheckoutInput }>(
    '/checkout',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const session = request.userSession;

      if (!session) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Sesión no autenticada.'
        });
      }

      try {
        const resultado = await pagosService.iniciarCheckout(
          session.userId,
          session.activeOrganizationId,
          request.body
        );

        return reply.status(201).send(resultado);
      } catch (err: any) {
        if (err instanceof PagoError) {
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
          message: 'Error al iniciar la intención de pago.'
        });
      }
    }
  );

  /**
   * POST /api/v1/pagos/webhook
   * Callback del proveedor. Requiere x-signature = HMAC-SHA256(`${x-timestamp}.${rawBody}`).
   */
  fastify.post<{ Body: WebhookPagoPayload }>(
    '/webhook',
    async (request, reply) => {
      const rawBody = (request as any).rawBody;

      if (typeof rawBody !== 'string') {
        // Sin el body exacto recibido no es posible verificar la firma.
        return reply.status(415).send({
          statusCode: 415,
          error: 'Unsupported Media Type',
          message: 'El webhook debe enviarse como application/json.'
        });
      }

      try {
        const resultado = await pagosService.procesarWebhook(
          request.headers,
          rawBody,
          request.body
        );

        return reply.status(200).send(resultado);
      } catch (err: any) {
        if (err instanceof PagoError) {
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
          message: 'Error al procesar el webhook de pago.'
        });
      }
    }
  );
};
