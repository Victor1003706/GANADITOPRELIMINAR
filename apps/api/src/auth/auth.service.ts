import crypto from 'node:crypto';
import type pg from 'pg';
import { hashPassword, verifyPassword } from './crypto.js';
import type { RegisterUserBody, RolOrganizacion } from './types.js';

let hashFicticioCache: Promise<string> | undefined;
/** Hash bcrypt de un valor aleatorio, calculado una vez, para igualar el tiempo del login. */
function hashFicticio(): Promise<string> {
  hashFicticioCache ??= hashPassword(crypto.randomUUID());
  return hashFicticioCache;
}

export class AuthError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  nombre: string;
  telefono: string | null;
  created_at: string;
  updated_at: string;
}

export interface MembershipInfo {
  organizacion_id: string;
  razon_social: string;
  rol: RolOrganizacion;
  is_active_context: boolean;
  permisos: Record<string, unknown>;
}

export const ROLES_AUTOREGISTRO_PERMITIDOS: readonly RolOrganizacion[] = ['COMPRADOR', 'VENDEDOR'];

export interface RegisterOptions {
  allowInternalRoles?: boolean;
}

export class AuthService {
  constructor(private pool: pg.Pool) {}

  /**
   * Registra un nuevo usuario y su organización inicial con rol activo.
   */
  async register(
    data: RegisterUserBody,
    options?: RegisterOptions
  ): Promise<{
    user: Omit<UserRow, 'password_hash'>;
    activeContext: {
      organizacion_id: string;
      razon_social: string;
      rol: RolOrganizacion;
    };
  }> {
    const rolInicial: RolOrganizacion = data.rol_inicial ?? 'COMPRADOR';

    // allowInternalRoles sólo debe usarse desde código interno (seeders, tests, alta administrativa),
    // nunca a partir de datos del cliente.
    const isWhitelisted = ROLES_AUTOREGISTRO_PERMITIDOS.includes(rolInicial);

    if (!isWhitelisted && options?.allowInternalRoles !== true) {
      throw new AuthError('Rol no permitido para autoregistro', 400);
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Verificar si el email ya existe
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [data.email.toLowerCase().trim()]);
      if (existing.rows.length > 0) {
        throw new AuthError('El correo electrónico ya se encuentra registrado.', 409);
      }

      // 2. Hash de contraseña
      const passwordHash = await hashPassword(data.password);

      // 3. Crear usuario
      const userRes = await client.query<UserRow>(
        `INSERT INTO users (email, password_hash, nombre, telefono)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, password_hash, nombre, telefono, created_at, updated_at`,
        [data.email.toLowerCase().trim(), passwordHash, data.nombre.trim(), data.telefono ?? null]
      );
      const user = userRes.rows[0]!;

      // 4. Crear organización inicial
      const orgName = data.organizacion_nombre?.trim() || `Organización de ${user.nombre}`;
      const orgRes = await client.query<{ id: string; razon_social: string }>(
        `INSERT INTO organizaciones (razon_social, estado)
         VALUES ($1, 'ACTIVA')
         RETURNING id, razon_social`,
        [orgName]
      );
      const org = orgRes.rows[0]!;

      // 5. Asignar rol inicial como contexto activo
      await client.query(
        `INSERT INTO user_organizaciones_roles (user_id, organizacion_id, rol, is_active_context)
         VALUES ($1, $2, $3, TRUE)`,
        [user.id, org.id, rolInicial]
      );

      await client.query('COMMIT');

      const { password_hash, ...safeUser } = user;
      return {
        user: safeUser,
        activeContext: {
          organizacion_id: org.id,
          razon_social: org.razon_social,
          rol: rolInicial
        }
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
 