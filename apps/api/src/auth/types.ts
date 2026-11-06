import type { RolOrganizacion } from '@ganadito/contracts';
export type { RolOrganizacion };

/**
 * Payload firmado dentro del JWT (expiración: 15 minutos).
 */
export interface JwtUserPayload {
  user_id: string;
  active_organization_id?: string;
  active_role?: RolOrganizacion;
  email: string;
}

/**
 * Datos del usuario autenticado y su contexto activo en request.
 */
export interface UserSessionContext {
  userId: string;
  email: string;
  nombre: string;
  activeOrganizationId?: string;
  activeRole?: RolOrganizacion;
  activeOrganizationName?: string;
}

export interface RegisterUserBody {
  email: string;
  password: string;
  nombre: string;
  telefono?: string;
  organizacion_nombre?: string;
  rol_inicial?: RolOrganizacion;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface SwitchContextBody {
  organizacion_id: string;
  rol: RolOrganizacion;
}

declare module 'fastify' {
  interface FastifyRequest {
    userSession?: UserSessionContext;
  }
}
