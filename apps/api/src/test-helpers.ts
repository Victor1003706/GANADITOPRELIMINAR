import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AuthService } from './auth/auth.service.js';
import type { RolOrganizacion } from './auth/types.js';

/**
 * Crea un usuario con una membresía de rol interno (ADMIN, OPERADOR_CAMAL, ...) como contexto
 * activo y devuelve su token. Los roles internos no se obtienen por autorregistro público.
 */
export async function crearUsuarioConRol(
  app: FastifyInstance,
  authService: AuthService,
  rol: RolOrganizacion,
  prefijo = 'interno'
): Promise<{ token: string; userId: string; organizacionId: string }> {
  const sufijo = crypto.randomUUID().slice(0, 8);
  const email = `${prefijo}_${rol.toLowerCase()}_${sufijo}@test.com`;
  const password = 'PasswordInterno2026!';
  const reg = await authService.register(
    { email, password, nombre: `${rol} ${sufijo}`, organizacion_nombre: `Org ${rol} ${sufijo}`, rol_inicial: rol },
    { allowInternalRoles: true }
  );
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  return { token: login.json().access_token, userId: reg.user.id, organizacionId: reg.activeContext.organizacion_id };
}
