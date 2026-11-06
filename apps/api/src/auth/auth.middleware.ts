import type { FastifyRequest, FastifyReply } from 'fastify';
import type pg from 'pg';
import type { JwtUserPayload, RolOrganizacion } from './types.js';

export function createAuthMiddleware(pool: pg.Pool) {
  /**
   * PreHandler hook que valida el JWT y comprueba en PostgreSQL que la sesión
   * y membresía organizacional activa sigan siendo válidas.
   */
  return async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    try {
      // 1. Verificar firma y expiración del JWT
      const decoded = await request.jwtVerify<JwtUserPayload>();

      if (!decoded || !decoded.user_id) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Token de acceso no válido o incompleto.'
        });
      }

      // 2. Comprobar que el usuario exista en PostgreSQL
      const userRes = await pool.query<{ id: string; email: string; nombre: string }>(
        'SELECT id, email, nombre FROM users WHERE id = $1',
        [decoded.user_id]
      );

      if (userRes.rows.length === 0) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'El usuario asociado al token no existe.'
        });
      }

      const user = userRes.rows[0]!;

      // 3. Validar en PostgreSQL la membresía EXACTA del token (organización + rol).
      //    Antes se filtraba solo por organización y se tomaba rows[0]: con varios roles en la
      //    misma organización el resultado dependía del orden de las filas.
      let activeOrgName: string | undefined;
      let activeRole: RolOrganizacion | undefined;

      if (decoded.active_organization_id) {
        if (!decoded.active_role) {
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'El token no incluye el rol del contexto activo.'
          });
        }

        const membershipRes = await pool.query<{ razon_social: string; is_active_context: boolean }>(
          `SELECT o.razon_social, uor.is_active_context
           FROM user_organizaciones_roles uor
           JOIN organizaciones o ON o.id = uor.organizacion_id
           WHERE uor.user_id = $1 AND uor.organizacion_id = $2 AND uor.rol = $3`,
          [decoded.user_id, decoded.active_organization_id, decoded.active_role]
        );

        if (membershipRes.rows.length === 0) {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            code: 'SIN_MEMBRESIA',
            message: 'El usuario no posee esa membresía (organización y rol) en la sesión.'
          });
        }

        const currentMembership = membershipRes.rows[0]!;
        if (!currentMembership.is_active_context) {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            code: 'CONTEXTO_INACTIVO',
            message: 'El contexto de esta sesión ya no está activo. Conmute su contexto activo.'
          });
        }

        activeOrgName = currentMembership.razon_social;
        activeRole = decoded.active_role;
      }

      // 4. Inyectar sesión autenticada en el request
      request.userSession = {
        userId: user.id,
        email: user.email,
        nombre: user.nombre,
        activeOrganizationId: decoded.active_organization_id,
        activeRole,
        activeOrganizationName: activeOrgName
      };
    } catch (err: any) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: err.message || 'Token de autenticación expirado o inválido.'
      });
    }
  };
}
