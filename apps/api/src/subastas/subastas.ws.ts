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
        this.subscribedChannels.delete