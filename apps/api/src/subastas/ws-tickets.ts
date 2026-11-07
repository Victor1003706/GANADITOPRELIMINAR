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
 * Devuelve la sesión o null. Un segundo intento con el mismo ticket siempre falla.
 */
export async function consumirTicketWs(pool: pg.Pool, ticket: string, loteId: string): Promise<SesionWs | null> {
  if (ticket.length < 20 || ticket.length > 100) return null;
  const res = await pool.query<{ user_id: string; organizacion_id: string; rol: string }>(
    `UPDATE ws_tickets t SET usado_en = clock_timestamp()
     WHERE t.hash = $1 AND t.lote_id = $2 AND t.usado_en IS NULL AND t.expira_en > clock_timestamp()
       AND EXISTS (
         SELECT 1 FROM user_organizaciones_roles uor
         WHERE uor.user_id = t.user_id AND uor.organizacion_id = t.organizacion_id
           AND uor.rol = t.rol AND uor.is_active_context)
     RETURNING t.user_id, t.organizacion_id, t.rol`,
    [hashTicket(ticket), loteId]
  );
  const fila = res.rows[0];
  return fila
    ? { userId: fila.user_id, organizacionId: fila.organizacion_id, rol: fila.rol, expiraEnMs: Date.now() + DURACION_MAX_SESION_TICKET_MS }
    : null;
}

/** Identidad asociada a cada socket abierto (para auditoría o eventos por usuario). */
export const sesionesWs = new WeakMap<object, SesionWs>();

interface SocketSupervisable {
  readonly readyState: number;
  close(code?: number, reason?: string): void;
  once(evento: 'close', fn: () => void): unknown;
}

/**
 * Mantiene vigente la autorización DURANTE la conexión:
 *  - cierra al expirar la sesión (exp del JWT o 15 min con ticket);
 *  - revalida la membresía en PostgreSQL cada `revalidacionMs` y cierra si se revocó;
 *  - si la BD no responde `MAX_FALLOS_REVALIDACION` veces seguidas, cierra (falla cerrado).
 * Cada instancia revalida sus propios sockets contra PostgreSQL: no depende de un aviso
 * entre instancias que podría perderse.
 */
export function supervisarSesionWs(
  socket: SocketSupervisable,
  sesion: SesionWs,
  pool: pg.Pool,
  revalidacionMs: number = REVALIDACION_WS_MS
): void {
  // El handshake hace varios await: si el cliente ya cortó, su 'close' ocurrió antes de
  // registrar el listener y los timers no se limpiarían nunca. No se crean.
  if (socket.readyState !== 0 && socket.readyState !== 1) return;
  let fallos = 0;
  let cerrado = false;
  let enCurso = false;
  const cerrar = (codigo: number, motivo: string) => {
    if (cerrado) return;
    cerrado = true;
    if (socket.readyState === 0 || socket.readyState === 1) socket.close(codigo, motivo);
  };
  // Acotado: setTimeout dispara de inmediato con retrasos > 2^31-1 ms.
  const restante = Math.min(Math.max(0, sesion.expiraEnMs - Date.now()), DURACION_MAX_SESION_TICKET_MS);
  const timerExpiracion = setTimeout(() => cerrar(1008, 'Sesión expirada; reconecte con un ticket nuevo.'), restante);
  const timerRevalidacion = setInterval(async () => {
    // Sin solapes: con la BD lenta no se apilan consultas del mismo socket.
    if (enCurso || cerrado) return;
    enCurso = true;
    let plazo: ReturnType<typeof setTimeout> | undefined;
    try {
      // Plazo por consulta: una promesa de PostgreSQL que nunca resuelve dejaría enCurso
      // en true para siempre y el socket seguiría recibiendo sin revalidarse. Vencer el
      // plazo cuenta como fallo (falla cerrado tras MAX_FALLOS_REVALIDACION).
      const vigente = await Promise.race([
        membresiaVigente(pool, sesion),
        new Promise<never>((_, rechazar) => {
          // Plazo propio, el doble del intervalo: una BD lenta pero sana no suma fallos espurios.
          plazo = setTimeout(() => rechazar(new Error('PLAZO_REVALIDACION')), 2 * revalidacionMs);
          plazo.unref?.();
        })
      ]);
      fallos = 0;
      if (!vigente) cerrar(1008, 'Sesión revocada.');
    } catch {
      fallos += 1;
      if (fallos >= MAX_FALLOS_REVALIDACION) cerrar(1011, 'No se pudo verificar la sesión.');
    } finally {
      if (plazo) clearTimeout(plazo);
      enCurso = false;
    }
  }, revalidacionMs);
  timerExpiracion.unref?.();
  timerRevalidacion.unref?.();
  socket.once('close', () => {
    cerrado = true;
    clearTimeout(timerExpiracion);
    clearInterval(timerRevalidacion);
  });
}

/**
 * ?access_token= queda solo por compatibilidad mientras la web migra al ticket.
 * Por defecto se permite fuera de producción y se rechaza en producción; la variable
 * WS_PERMITIR_ACCESS_TOKEN_EN_URL ('true' | 'false') lo fuerza.
 */
export function permiteAccessTokenEnUrl(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.WS_PERMITIR_ACCESS_TOKEN_EN_URL;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return env.NODE_ENV !== 'production';
}
