import crypto from 'node:crypto';
import type pg from 'pg';

/** Vida del ticket: alcanza para abrir el socket justo después de pedirlo. */
export const TTL_TICKET_SEGUNDOS = 30;
/** Tope de tickets vigentes sin usar por usuario (evita llenar la tabla). */
export const MAX_TICKETS_VIGENTES_POR_USUARIO = 20;

export class TicketWsError extends Error {
  constructor(message: string, public statusCode: number, public code: string) {
    super(message);
    this.name = 'TicketWsError';
  }
}

const hashTicket = (ticket: string) => crypto.createHash('sha256').update(ticket).digest('hex');

/** Ticket opaco de 256 bits; en la base solo queda su SHA-256. */
export interface ContextoTicket {
  userId: string;
  organizacionId?: string;
  rol?: string;
}

export interface SesionWs {
  userId: string;
  organizacionId: string;
  rol: string;
  /** Instante (ms epoch) en que la conexión debe cerrarse y pedir credencial nueva. */
  expiraEnMs: number;
}

/** Cada cuánto se vuelve a comprobar en PostgreSQL la membresía de un socket abierto. */
export const REVALIDACION_WS_MS = 30_000;
/** Vida máxima de una conexión abierta con ticket (igual que el JWT: 15 min). */
export const DURACION_MAX_SESION_TICKET_MS = 15 * 60_000;
/** Fallos seguidos al revalidar (BD caída) tras los que se cierra por no poder verificar. */
export const MAX_FALLOS_REVALIDACION = 2;

/**
 * PostgreSQL es la autoridad de permisos: la membresía (organización + rol) debe
 * existir y seguir siendo el contexto activo. Redis no interviene.
 */
export async function membresiaVigente(
  pool: pg.Pool,
  sesion: Pick<SesionWs, 'userId' | 'organizacionId' | 'rol'>
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM user_organizaciones_roles
     WHERE user_id = $1 AND organizacion_id = $2 AND rol = $3 AND is_active_context`,
    [sesion.userId, sesion.organizacionId, sesion.rol]
  );
  return (res.rowCount ?? 0) > 0;
}

/** Probabilidad de limpiar tickets vencidos en cada emisión (no lo paga cada petición). */
export const PROBABILIDAD_LIMPIEZA = 0.05;

export async function emitirTicketWs(
  pool: pg.Pool,
  contexto: ContextoTicket,
  loteId: string,
  aleatorio: () => number = Math.random
): Promise<{ ticket: string; expira_en_segundos: number }> {
  const { userId, organizacionId, rol } = contexto;
  if (!organizacionId || !rol) {
    throw new TicketWsError('Se requiere un contexto organizacional activo.', 403, 'SIN_CONTEXTO');
  }
  const lote = await pool.query('SELECT 1 FROM lotes_subasta WHERE id = $1', [loteId]);
  if (lote.rowCount === 0) throw new TicketWsError('Lote de subasta no encontrado.', 404, 'LOTE_NO_ENCONTRADO');

  if (aleatorio() < PROBABILIDAD_LIMPIEZA) {
    await pool.query(`DELETE FROM ws_tickets WHERE expira_en < clock_timestamp() - interval '5 minutes'`);
  }

  const ticket = crypto.randomBytes(32).toString('base64url');
  // Tope e inserción en una sola sentencia. Bajo READ COMMITTED dos pedidos
  // simultáneos pueden pasar el tope por pocas unidades: aceptable para un límite
  // anti-abuso (no es un invariante de negocio).
  const res = await pool.query(
    `INSERT INTO ws_tickets (hash, user_id, organizacion_id, rol, lote_id, expira_en)
     SELECT $1, $2, $6, $7, $3, clock_timestamp() + make_interval(secs => $4)
     WHERE (SELECT count(*) FROM ws_tickets
            WHERE user_id = $2 AND usado_en IS NULL AND expira_en > clock_timestamp()) < $5`,
    [hashTicket(ticket), userId, loteId, TTL_TICKET_SEGUNDOS, MAX_TICKETS_VIGENTES_POR_USUARIO, organizacionId, rol]
  );
  if (res.rowCount === 0) {
    throw new TicketWsError('Demasiados tickets pendientes; use los emitidos o espere 30 s.', 429, 'DEMASIADOS_TICKETS');
  }
  return { ticket, expira_en_segundos: TTL_TICKET_SEGUNDOS };
}

/**
 * Consume el ticket de forma atómica: vigente, sin usar, del mismo lote y con la
 * membresía (organización + rol) con que se emitió TODAVÍA activa en PostgreSQL.
 * Devuelve la sesión o null. Un segundo intento con 