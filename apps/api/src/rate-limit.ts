import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Limitador de tasa en memoria (ventana fija por clave), sin dependencias.
 *
 * Alcance: una instancia de la API (MVP). Con varias réplicas cada una cuenta por su
 * lado; para eso habría que mover los contadores a Redis. No es estado transaccional:
 * si el proceso reinicia, los contadores empiezan de cero (aceptable para un tope
 * anti-abuso, AGENTS §2).
 */
export interface ReglaLimite {
  /** Nombre del grupo (aparece en el código de error). */
  nombre: string;
  /** Solicitudes permitidas por ventana. */
  maximo: number;
  ventanaMs: number;
  /** Clave del contador: IP, usuario, email… */
  clave: (request: FastifyRequest) => string | undefined;
}

interface Contador {
  inicio: number;
  usados: number;
}

const MAX_CLAVES = 50_000;

export class LimitadorTasa {
  private contadores = new Map<string, Contador>();
  private limpieza: ReturnType<typeof setInterval>;

  constructor(private readonly ahora: () => number = Date.now) {
    this.limpieza = setInterval(() => this.purgar(), 60_000);
    this.limpieza.unref?.();
  }

  /** true si la solicitud entra; false si superó el máximo de la ventana. */
  consumir(regla: ReglaLimite, clave: string): { permitido: boolean; reintentarEnS: number } {
    const id = `${regla.nombre}:${clave}`;
    const t = this.ahora();
    let c = this.contadores.get(id);
    if (!c || t - c.inicio >= regla.ventanaMs) {
      if (!c && this.contadores.size >= MAX_CLAVES) this.purgar();
      c = { inicio: t, usados: 0 };
      this.contadores.set(id, c);
    }
    c.usados += 1;
    const reintentarEnS = Math.max(1, Math.ceil((c.inicio + regla.ventanaMs - t) / 1000));
    return { permitido: c.usados <= regla.maximo, reintentarEnS };
  }

  private purgar() {
    const t = this.ahora();
    // Ventana máxima usada por las reglas: 15 min.
    for (const [id, c] of this.contadores) if (t - c.inicio >= 15 * 60_000) this.contadores.delete(id);
  }

  cerrar() {
    clearInterval(this.limpieza);
  }

  /** Hook de Fastify (onRequest o preHandler) para una o varias reglas. */
  hook(...reglas: ReglaLimite[]) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (process.env.RATE_LIMIT_DISABLED === 'true') return;
      for (const regla of reglas) {
        const clave = regla.clave(request);
        if (!clave) continue;
        const { permitido, reintentarEnS } = this.consumir(regla, clave);
        if (!permitido) {
          reply.header('Retry-After', String(reintentarEnS));
          return reply.status(429).send({
            statusCode: 429,
            error: 'Too Many Requests',
            code: 'DEMASIADAS_SOLICITUDES',
            message: `Demasiadas solicitudes (${regla.nombre}). Intente en ${reintentarEnS} s.`
          });
        }
      }
    };
  }
}

const MINUTO = 60_000;
const porIp = (request: FastifyRequest) => request.ip;
const porUsuario = (request: FastifyRequest) => request.userSession?.userId;
const porEmail = (request: FastifyRequest) => {
  const email = (request.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email.toLowerCase().trim().slice(0, 254) : undefined;
};

/** Reglas por defecto (ajustables con variables RATE_LIMIT_*_MAX si hiciera falta). */
export const REGLAS = {
  loginIp: { nombre: 'login-ip', maximo: 20, ventanaMs: 15 * MINUTO, clave: porIp },
  loginEmail: { nombre: 'login-email', maximo: 10, ventanaMs: 15 * MINUTO, clave: porEmail },
  registroIp: { nombre: 'registro-ip', maximo: 10, ventanaMs: 15 * MINUTO, clave: porIp },
  pujasUsuario: { nombre: 'pujas', maximo: 60, ventanaMs: MINUTO, clave: porUsuario },
  ticketUsuario: { nombre: 'ticket-ws', maximo: 30, ventanaMs: MINUTO, clave: porUsuario },
  pesoUsuario: { nombre: 'estimacion-peso', maximo: 20, ventanaMs: MINUTO, clave: porUsuario },
  cotizarUsuario: { nombre: 'cotizar-flete', maximo: 30, ventanaMs: MINUTO, clave: porUsuario }
} satisfies Record<string, ReglaLimite>;

declare module 'fastify' {
  interface FastifyInstance {
    limitador: LimitadorTasa;
    limitarTasa: boolean;
  }
}

/** Hook que aplica las reglas solo si el límite está activo en esta app. */
export function limitar(fastify: import('fastify').FastifyInstance, ...reglas: ReglaLimite[]) {
  const hook = fastify.limitador.hook(...reglas);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!fastify.limitarTasa) return;
    return hook(request, reply);
  };
}
