import type { FastifyPluginAsync } from 'fastify';
import { limitar, REGLAS } from '../rate-limit.js';
import type WebSocket from 'ws';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { JwtUserPayload } from '../auth/types.js';
import { getRedisSubscriber } from '../redis.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import {
  consumirTicketWs,
  emitirTicketWs,
  membresiaVigente,
  permiteAccessTokenEnUrl,
  sesionesWs,
  supervisarSesionWs,
  TicketWsError,
  type SesionWs
} from './ws-tickets.js';

export interface SubastasWsRoutesOptions {
  subscriber?: Redis;
  hub?: SubastaWsHub;
  pool: pg.Pool;
  /** Cada cuánto se revalida la membresía de un socket abierto (por defecto 30 s). */
  revalidacionMs?: number;
  /** Vida máxima de una conexión con ticket (por defecto 15 min). */
  duracionMaxSesionMs?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hub centralizado de suscripción Redis Pub/Sub para WebSockets de Subastas en Vivo.
 * Multiplexa una única conexión de suscriptor Redis hacia todos los clientes WebSocket activos,
 * evitando conexiones redundantes y eliminando suscripciones huérfanas al desconectarse los clientes.
 */
export class SubastaWsHub {
  private subscriber: Redis;
  private channelClients = new Map<string, Set<WebSocket>>();
  private subscribedChannels = new Set<string>();
  private isListening = false;

  constructor(subscriber: Redis) {
    this.subscriber = subscriber;
    this.ensureListener();
  }

  private ensureListener(): void {
    if (this.isListening) return;
    this.isListening = true;

    this.subscriber.on('message', (channel: string, message: string) => {
      this.handleMessage(channel, message);
    });
  }

  private handleMessage(channel: string, message: string): void {
    const clients = this.channelClients.get(channel);
    if (!clients || clients.size === 0) return;

    for (const socket of clients) {
      try {
        if (socket.readyState === 1 /* WebSocket.OPEN */) {
          socket.send(message);
        }
      } catch (err) {
        // En caso de socket roto durante el envío, la limpieza ocurrirá en el evento 'close'
      }
    }
  }

  /**
   * Conecta un cliente WebSocket al canal de eventos de la subasta indicada.
   */
  async addClient(subastaId: string, socket: WebSocket): Promise<void> {
    const channel = `subasta:events:${subastaId}`;

    let clients = this.channelClients.get(channel);
    if (!clients) {
      clients = new Set<WebSocket>();
      this.channelClients.set(channel, clients);
    }
    clients.add(socket);

    // Si es el primer cliente escuchando este canal, suscribir en Redis
    if (!this.subscribedChannels.has(channel)) {
      this.subscribedChannels.add(channel);
      try {
        await this.subscriber.subscribe(channel);
      } catch (err) {
        // Si falla la suscripción en Redis, remover cliente y reportar
        clients.delete(socket);
        this.subscribedChannels.delete(channel);
        throw err;
      }
    }

    const remove = async () => {
      await this.removeClient(subastaId, socket);
    };

    // Registrar hooks de desconexión y error en el ciclo de vida del socket
    socket.once('close', remove);
    socket.once('error', remove);

    // Si el socket se cerró antes de completar la suscripción
    if (socket.readyState !== 1 /* WebSocket.OPEN */ && socket.readyState !== 0 /* CONNECTING */) {
      await remove();
    }
  }

  /**
   * Desconecta un cliente de un canal específico y desuscribe de Redis si no quedan más clientes.
   */
  async removeClient(subastaId: string, socket: WebSocket): Promise<void> {
    const channel = `subasta:events:${subastaId}`;
    const clients = this.channelClients.get(channel);

    if (clients) {
      clients.delete(socket);

      if (clients.size === 0) {
        this.channelClients.delete(channel);
        this.subscribedChannels.delete(channel);
        try {
          await this.subscriber.unsubscribe(channel);
        } catch {
          // Ignorar errores durante desuscripción de cierre
        }
      }
    }
  }

  /**
   * Devuelve la cantidad de clientes activos para una subasta específica.
   */
  getActiveSubscribersCount(subastaId: string): number {
    const channel = `subasta:events:${subastaId}`;
    return this.channelClients.get(channel)?.size ?? 0;
  }

  /**
   * Cierra ordenadamente el hub, desuscribiendo todos los canales y cerrando sockets activos.
   */
  async close(): Promise<void> {
    for (const [channel, clients] of this.channelClients.entries()) {
      for (const socket of clients) {
        try {
          socket.close(1001, 'Server shutting down');
        } catch {}
      }
      try {
        await this.subscriber.unsubscribe(channel);
      } catch {}
    }

    this.channelClients.clear();
    this.subscribedChannels.clear();
  }
}

/**
 * Plugin Fastify para las rutas de WebSocket de Subastas en Vivo.
 */
export const subastasWsRoutes: FastifyPluginAsync<SubastasWsRoutesOptions> = async (
  fastify,
  options
) => {
  let hub = options.hub;

  const getHub = (): SubastaWsHub => {
    if (!hub) {
      const subscriber = options.subscriber ?? getRedisSubscriber();
      hub = new SubastaWsHub(subscriber);
    }
    return hub;
  };

  fastify.addHook('onClose', async () => {
    if (hub) {
      await hub.close();
    }
  });

  /**
   * GET /api/v1/subastas/:id/live
   * Endpoint WebSocket para transmisión en tiempo real de eventos de subasta (pujas aceptadas, cierre).
   */
  const authenticate = createAuthMiddleware(options.pool);

  /**
   * POST /api/v1/subastas/:id/live/ticket
   * Emite un ticket de un solo uso (30 s) para abrir el WebSocket sin poner el JWT en la URL.
   */
  fastify.post<{ Params: { id: string } }>(
    '/subastas/:id/live/ticket',
    { onRequest: [authenticate, limitar(fastify, REGLAS.ticketUsuario)] },
    async (request, reply) => {
      const id = request.params.id?.trim();
      if (!id || !UUID_RE.test(id)) {
        return reply.status(404).send({ statusCode: 404, error: 'Not Found', code: 'LOTE_NO_ENCONTRADO', message: 'Lote de subasta no encontrado.' });
      }
      try {
        const s = request.userSession!;
        const emitido = await emitirTicketWs(
          options.pool,
          { userId: s.userId, organizacionId: s.activeOrganizationId, rol: s.activeRole },
          id
        );
        reply.header('Cache-Control', 'no-store');
        return reply.status(201).send(emitido);
      } catch (err) {
        if (err instanceof TicketWsError) {
          return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.name, code: err.code, message: err.message });
        }
        throw err;
      }
    }
  );

  fastify.get<{ Params: { id: string }; Querystring: { access_token?: string; ticket?: string } }>(
    '/subastas/:id/live',
    { websocket: true },
    async (socket, request) => {
      const id = request.params.id?.trim();

      if (!id || !UUID_RE.test(id)) {
        socket.close(1008, 'ID de subasta inválido.');
        return;
      }

      // Autenticación, en orden de preferencia:
      //  1. ?ticket= de un solo uso (navegadores: no pueden enviar cabeceras en el upgrade);
      //  2. Authorization: Bearer (clientes no navegador);
      //  3. ?access_token= (OBSOLETO: el JWT queda en la URL; solo si está permitido).
      const { ticket, access_token: tokenEnUrl } = request.query;
      let sesion: SesionWs;
      if (ticket !== undefined) {
        const consumida = await consumirTicketWs(options.pool, ticket, id);
        if (!consumida) {
          socket.close(1008, 'Ticket inválido, vencido o ya usado.');
          return;
        }
        sesion = options.duracionMaxSesionMs
          ? { ...consumida, expiraEnMs: Date.now() + options.duracionMaxSesionMs }
          : consumida;
      } else {
        const header = request.headers.authorization;
        let token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
        if (!token && tokenEnUrl !== undefined) {
          if (!permiteAccessTokenEnUrl()) {
            socket.close(1008, 'access_token en la URL no está permitido; use ?ticket=.');
            return;
          }
          request.log.warn('WS con ?access_token= (obsoleto): migrar a POST /live/ticket.');
          token = tokenEnUrl;
        }
        let decoded: (JwtUserPayload & { exp?: number }) | null = null;
        try {
          decoded = token ? fastify.jwt.verify<JwtUserPayload & { exp?: number }>(token) : null;
        } catch {
          decoded = null;
        }
        if (!decoded?.user_id || typeof decoded.exp !== 'number') {
          socket.close(1008, 'Sesión requerida.');
          return;
        }
        // Igual que el ticket: hace falta un contexto activo y vigente EN POSTGRESQL; una
        // firma válida no basta si la membresía se revocó durante los 15 min del JWT.
        if (!decoded.active_organization_id || !decoded.active_role) {
          socket.close(1008, 'Se requiere un contexto organizacional activo.');
          return;
        }
        sesion = {
          userId: decoded.user_id,
          organizacionId: decoded.active_organization_id,
          rol: decoded.active_role,
          expiraEnMs: decoded.exp * 1000
        };
        if (!(await membresiaVigente(options.pool, sesion))) {
          socket.close(1008, 'Sesión revocada.');
          return;
        }
      }

      const lote = await options.pool.query('SELECT 1 FROM lotes_subasta WHERE id = $1', [id]);
      if (lote.rowCount === 0) {
        socket.close(1008, 'Lote de subasta no encontrado.');
        return;
      }

      // El cliente pudo cortar durante los await anteriores: no registrar nada.
      if (socket.readyState !== 1) return;
      sesionesWs.set(socket, sesion);
      supervisarSesionWs(socket, sesion, options.pool, options.revalidacionMs);
      await getHub().addClient(id, socket);
    }
  );
};
