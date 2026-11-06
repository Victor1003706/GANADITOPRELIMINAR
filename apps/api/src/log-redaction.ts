import type { FastifyRequest } from 'fastify';

/**
 * Parámetros de URL que pueden llevar credenciales. El WebSocket de subastas acepta
 * `?access_token=` porque los navegadores no envían cabeceras en el upgrade
 * (contrato v1, N04); su valor nunca debe llegar a los logs.
 */
const PARAMETROS_SENSIBLES = new Set(['access_token', 'token', 'ticket', 'jwt']);
export const VALOR_REDACTADO = '[REDACTADO]';

export function redactarUrl(url: string): string {
  const inicio = url.indexOf('?');
  if (inicio === -1) return url;

  const ruta = url.slice(0, inicio);
  const consulta = url.slice(inicio + 1);
  const partes = consulta.split('&').map((parte) => {
    const igual = parte.indexOf('=');
    const nombreCrudo = igual === -1 ? parte : parte.slice(0, igual);
    let nombre: string;
    try {
      nombre = decodeURIComponent(nombreCrudo.replace(/\+/g, ' '));
    } catch {
      nombre = nombreCrudo;
    }
    return PARAMETROS_SENSIBLES.has(nombre.toLowerCase()) ? `${nombreCrudo}=${VALOR_REDACTADO}` : parte;
  });
  return `${ruta}?${partes.join('&')}`;
}

/** Serializador de peticiones de Fastify/pino que redacta credenciales en la URL. */
export function serializarPeticion(req: FastifyRequest): Record<string, unknown> {
  return {
    method: req.method,
    url: redactarUrl(req.url),
    hostname: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort
  };
}
