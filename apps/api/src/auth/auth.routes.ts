import type { FastifyPluginAsync } from 'fastify';
import { limitar, REGLAS } from '../rate-limit.js';
import type pg from 'pg';
import { AuthService, AuthError } from './auth.service.js';
import { createAuthMiddleware } from './auth.middleware.js';
import type { RegisterUserBody, LoginBody, SwitchContextBody, JwtUserPayload } from './types.js';

export interface AuthRoutesOptions {
  pool: pg.Pool;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (fastify, options) => {
  const { pool } = options;
  const authService = new AuthService(pool);
  const authenticate = createAuthMiddleware(pool);

  /**
   * POST /register
   * Crea un usuario y su organización inicial.
   */
  fastify.post<{ Body: RegisterUserBody }>('/register', { onRequest: [limitar(fastify, REGLAS.registroIp)] }, async (request, reply) => {
    const { email, password, nombre, telefono, organizacion_nombre, rol_inicial } = request.body || {};

    if (!email || !password || !nombre) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'email, password y nombre son campos obligatorios.'
      });
    }

    if (password.length < 8) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'La contraseña debe tener al menos 8 caracteres.'
      });
    }

    try {
      const result = await authService.register({
        email,
        password,
        nombre,
        telefono,
        organizacion_nombre,
        rol_inicial
      });

      // Emitir token JWT con expiración de 15 minutos (900 segundos)
      const tokenPayload: JwtUserPayload = {
        user_id: result.user.id,
        email: result.user.email,
        active_organization_id: result.activeContext.organizacion_id,
        active_role: result.activeContext.rol
      };

      const token = fastify.jwt.sign(tokenPayload, { expiresIn: '15m' });

      return reply.status(201).send({
        access_token: token,
        token_type: 'Bearer',
        expires_in: 900,
        user: result.user,
        active_context: result.activeContext
      });
    } catch (err: any) {
      if (err instanceof AuthError) {
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
        message: 'Error al registrar el usuario.'
      });
    }
  });

  /**
   * POST /login
   * Valida credenciales de acceso y emite un token JWT con contexto organizacional activo.
   */
  // preHandler: el límite por email necesita el cuerpo ya parseado.
  fastify.post<{ Body: LoginBody }>('/login', { preHandler: [limitar(fastify, REGLAS.loginIp, REGLAS.loginEmail)] }, async (request, reply) => {
    const { email, password } = request.body || {};

    if (!email || !password) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'email y password son obligatorios.'
      });
    }

    try {
      const result = await authService.login(email, password);

      const tokenPayload: JwtUserPayload = {
        user_id: result.user.id,
        email: result.user.email,
        active_organization_id: result.activeContext?.organizacion_id,
        active_role: result.activeContext?.rol
      };

      const token = fastify.jwt.sign(tokenPayload, { expiresIn: '15m' });

      return reply.status(200).send({
        access_token: token,
        token_type: 'Bearer',
        expires_in: 900,
        user: result.user,
        active_context: result.activeContext
      });
    } catch (err: any) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({
          statusCode: err.statusCode,
          error: err.name,
          message: err.message
        });
      }
  