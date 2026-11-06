import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RolOrganizacion } from './types.js';

/**
 * PreHandler que exige un contexto activo con alguno de los roles indicados.
 * Debe ejecutarse después de `authenticate`.
 */
export function requireRole(...roles: RolOrganizacion[]) {
  return async function authorize(request: FastifyRequest, reply: FastifyReply) {
    const session = request.userSession;
    if (!session) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Sesión no autenticada.' });
    }
    if (!session.activeOrganizationId || !session.activeRole) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        code: 'SIN_CONTEXTO',
        message: 'Debe seleccionar una organización y rol activos.'
      });
    }
    if (!roles.includes(session.activeRole)) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        code: 'ROL_NO_AUTORIZADO',
        message: `Esta operación requiere uno de los roles: ${roles.join(', ')}.`
      });
    }
  };
}

/** Exige únicamente que exista organización activa (cualquier rol). */
export async function requireActiveOrganization(request: FastifyRequest, reply: FastifyReply) {
  const session = request.userSession;
  if (!session?.activeOrganizationId) {
    return reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      code: 'SIN_CONTEXTO',
      message: 'Debe seleccionar una organización activa.'
    });
  }
}
