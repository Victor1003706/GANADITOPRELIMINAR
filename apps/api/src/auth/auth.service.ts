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
   * Autentica por credenciales y resuelve el contexto organizacional activo.
   */
  async login(email: string, plainPassword: string): Promise<{
    user: Omit<UserRow, 'password_hash'>;
    activeContext: {
      organizacion_id: string;
      razon_social: string;
      rol: RolOrganizacion;
    } | null;
  }> {
    const userRes = await this.pool.query<UserRow>(
      'SELECT id, email, password_hash, nombre, telefono, created_at, updated_at FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (userRes.rows.length === 0) {
      // Mismo costo que un usuario existente: sin esto, la latencia revelaba qué emails existen.
      await verifyPassword(plainPassword, await hashFicticio());
      throw new AuthError('Credenciales inválidas.', 401);
    }

    const user = userRes.rows[0]!;
    const isMatch = await verifyPassword(plainPassword, user.password_hash);
    if (!isMatch) {
      throw new AuthError('Credenciales inválidas.', 401);
    }

    // Buscar contexto activo
    const memberships = await this.getUserMemberships(user.id);
    let active = memberships.find((m) => m.is_active_context) ?? null;

    if (!active && memberships.length > 0) {
      // Si ninguna está marcada como activa, activar la primera por defecto
      active = memberships[0]!;
      await this.pool.query(
        `UPDATE user_organizaciones_roles
         SET is_active_context = TRUE
         WHERE user_id = $1 AND organizacion_id = $2 AND rol = $3`,
        [user.id, active.organizacion_id, active.rol]
      );
    }

    const { password_hash, ...safeUser } = user;
    return {
      user: safeUser,
      activeContext: active
        ? {
            organizacion_id: active.organizacion_id,
            razon_social: active.razon_social,
            rol: active.rol
          }
        : null
    };
  }

  /**
   * Conmuta atómicamente el contexto organizacional activo de un usuario (RBAC dual).
   * Exactamente una fila queda con is_active_context = TRUE y las demás en FALSE.
   */
  async switchContext(
    userId: string,
    targetOrgId: string,
    targetRol: RolOrganizacion
  ): Promise<{
    organizacion_id: string;
    razon_social: string;
    rol: RolOrganizacion;
  }> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Validar que el usuario posea la membresía requerida
      const membershipCheck = await client.query<{ razon_social: string }>(
        `SELECT o.razon_social
         FROM user_organizaciones_roles uor
         JOIN organizaciones o ON o.id = uor.organizacion_id
         WHERE uor.user_id = $1 AND uor.organizacion_id = $2 AND uor.rol = $3`,
        [userId, targetOrgId, targetRol]
      );

      if (membershipCheck.rows.length === 0) {
        throw new AuthError('El usuario no posee el rol o membresía solicitada en la organización indicada.', 403);
      }

      const razonSocial = membershipCheck.rows[0]!.razon_social;

      // 2. Desactivar todos los contextos previos del usuario
      await client.query(
        `UPDATE user_organizaciones_roles
         SET is_active_context = FALSE
         WHERE user_id = $1`,
        [userId]
      );

      // 3. Activar exclusivamente el contexto seleccionado
      await client.query(
        `UPDATE user_organizaciones_roles
         SET is_active_context = TRUE
         WHERE user_id = $1 AND organizacion_id = $2 AND rol = $3`,
        [userId, targetOrgId, targetRol]
      );

      await client.query('COMMIT');

      return {
        organizacion_id: targetOrgId,
        razon_social: razonSocial,
        rol: targetRol
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Obtiene el perfil completo del usuario con su contexto activo y todas sus membresías.
   */
  async getProfile(userId: string): Promise<{
    user: Omit<UserRow, 'password_hash'>;
    activeContext: MembershipInfo | null;
    memberships: MembershipInfo[];
  }> {
    const userRes = await this.pool.query<UserRow>(
      'SELECT id, email, password_hash, nombre, telefono, created_at, updated_at FROM users WHERE id = $1',
      [userId]
    );

    if (userRes.rows.length === 0) {
      throw new AuthError('Usuario no encontrado.', 404);
    }

    const { password_hash, ...safeUser } = userRes.rows[0]!;
    const memberships = await this.getUserMemberships(userId);
    const activeContext = memberships.find((m) => m.is_active_context) ?? null;

    return {
      user: safeUser,
      activeContext,
      memberships
    };
  }

  /**
   * Vincula una organización y rol adicional a un usuario (soporte para múltiples roles/organizaciones).
   */
  async addMembership(
    userId: string,
    orgId: string,
    rol: RolOrganizacion,
    setActive: boolean = false
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (setActive) {
        await client.query('UPDATE user_organizaciones_roles SET is_active_context = FALSE WHERE user_id = $1', [userId]);
      }

      await client.query(
        `INSERT INTO user_organizaciones_roles (user_id, organizacion_id, rol, is_active_context)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, organizacion_id, rol)
         DO UPDATE SET is_active_context = user_organizaciones_roles.is_active_context OR EXCLUDED.is_active_context`,
        [userId, orgId, rol, setActive]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async getUserMemberships(userId: string): Promise<MembershipInfo[]> {
    const res = await this.pool.query<MembershipInfo>(
      `SELECT
         uor.organizacion_id,
         o.razon_social,
         uor.rol,
         uor.is_active_context,
         uor.permisos
       FROM user_organizaciones_roles uor
       JOIN organizaciones o ON o.id = uor.organizacion_id
       WHERE uor.user_id = $1
       ORDER BY uor.is_active_context DESC, o.razon_social ASC`,
      [userId]
    );
    return res.rows;
  }
}
