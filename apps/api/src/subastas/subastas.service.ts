import type pg from 'pg';
import { sqlPosicionPublica, sqlUbicacionAproximada } from '../mapa/ubicacion-publica.js';
import crypto from 'node:crypto';
import type {
  CrearLoteSubastaInput,
  LoteSubastaResponse,
  LoteSnapshotResponse,
  EmitirPujaInput,
  PujaAceptadaResponse,
  DetalleLote,
  LoteCatalogo
} from './subastas.types.js';

export type CodigoErrorSubasta =
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'IDEMPOTENCY_KEY_OTRO_CONTEXTO'
  | 'PUJA_INSUFICIENTE'
  | 'LOTE_NO_ABIERTO'
  | 'PUJA_PROPIO_LOTE';

const ESTADOS_INICIALES_LOTE = new Set(['ACTIVO', 'BORRADOR']);
/** Tope comercial: deja margen a la comisión dentro de ordenes_compra NUMERIC(12,2). */
export const MONTO_MAXIMO_PEN = 1_000_000_000;

/** Convierte un monto a céntimos; null si no es un número con como máximo 2 decimales. */
function aCentimos(valor: unknown): number | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
  const c = Math.round(valor * 100);
  return Math.abs(c - valor * 100) < 1e-6 ? c : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SubastaError extends Error {
  constructor(message: string, public statusCode: number = 400, public code?: CodigoErrorSubasta) {
    super(message);
    this.name = 'SubastaError';
  }
}

export class SubastasService {
  constructor(private pool: pg.Pool) {}

  /**
   * Crea un nuevo lote de subasta en PostgreSQL.
   */
  async crearLote(
    vendedorOrgId: string,
    input: CrearLoteSubastaInput,
    creadoPorUserId?: string
  ): Promise<LoteSubastaResponse> {
    const {
      codigo_lote,
      precio_base,
      incremento_minimo,
      fecha_inicio,
      fecha_cierre,
      anti_sniping_seconds = 60,
      anti_sniping_extension = 120,
      estado = 'ACTIVO'
    } = input;
    if (typeof precio_base !== 'number' || precio_base <= 0) {
      throw new SubastaError('precio_base debe ser un número positivo mayor a 0.', 400);
    }
    if (precio_base > MONTO_MAXIMO_PEN) {
      throw new SubastaError(`precio_base no puede superar S/ ${MONTO_MAXIMO_PEN.toLocaleString('es-PE')}.`, 400);
    }
    if (typeof incremento_minimo !== 'number' || incremento_minimo <= 0) {
      throw new SubastaError('incremento_minimo debe ser un número positivo mayor a 0.', 400);
    }
    if (!fecha_cierre) {
      throw new SubastaError('fecha_cierre es obligatoria.', 400);
    }
    if (!ESTADOS_INICIALES_LOTE.has(estado)) {
      throw new SubastaError('estado inicial inválido: solo se admite ACTIVO o BORRADOR.', 400);
    }
    for (const [campo, valor] of [
      ['anti_sniping_seconds', anti_sniping_seconds],
      ['anti_sniping_extension', anti_sniping_extension]
    ] as const) {
      if (!Number.isInteger(valor) || valor < 0 || valor > 3600) {
        throw new SubastaError(`${campo} debe ser un entero entre 0 y 3600.`, 400);
      }
    }
    if (aCentimos(precio_base) === null || aCentimos(incremento_minimo) === null) {
      throw new SubastaError('precio_base e incremento_minimo admiten como máximo 2 decimales.', 400);
    }
    const detalle = await this.validarDetalle(vendedorOrgId, input);

    const fechaInicioDate = fecha_inicio ? new Date(fecha_inicio) : new Date();
    const fechaCierreDate = new Date(fecha_cierre);

    if (isNaN(fechaInicioDate.getTime())) {
      throw new SubastaError('fecha_inicio no es una fecha válida.', 400);
    }
    if (isNaN(fechaCierreDate.getTime())) {
      throw new SubastaError('fecha_cierre no es una fecha válida.', 400);
    }
    if (fechaCierreDate.getTime() <= fechaInicioDate.getTime()) {
      throw new SubastaError('fecha_cierre debe ser posterior a la fecha de inicio.', 400);
    }

    const codigoFinal =
      codigo_lote?.trim() ||
      `LOTE-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    let res: pg.QueryResult<LoteSubastaResponse>;
    try {
      res = await this.pool.query<LoteSubastaResponse>(
      `INSERT INTO lotes_subasta (
         codigo_lote,
         vendedor_id,
         estado,
         precio_base,
         precio_actual,
         incremento_minimo,
         fecha_inicio,
         fecha_cierre,
         anti_sniping_seconds,
         anti_sniping_extension,
         version,
         creado_por_user_id,
         cantidad_animales,
         categoria,
         raza,
         descripcion,
         establecimiento_id
       )
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, 1, $10, $11, $12, $13, $14, $15)
       RETURNING
         id,
         codigo_lote,
         vendedor_id,
         estado,
         precio_base::float,
         precio_actual::float,
         incremento_minimo::float,
         postor_ganador_id,
         fecha_inicio,
         fecha_cierre,
         anti_sniping_seconds,
         anti_sniping_extension,
         version,
         cantidad_animales,
         categoria,
         raza,
         descripcion,
         establecimiento_id,
         created_at,
         updated_at`,
      [
        codigoFinal,
        vendedorOrgId,
        estado,
        precio_base,
        incremento_minimo,
        fechaInicioDate.toISOString(),
        fechaCierreDate.toISOString(),
        anti_sniping_seconds,
        anti_sniping_extension,
        creadoPorUserId ?? null,
        detalle.cantidad_animales,
        detalle.categoria,
        detalle.raza,
        detalle.descripcion,
        detalle.establecimiento_id
      ]
    );
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new SubastaError('Ya existe un lote con ese codigo_lote.', 409);
      }
      throw err;
    }

    return res.rows[0]!;
  }

  private async validarDetalle(vendedorOrgId: string, input: CrearLoteSubastaInput): Promise<DetalleLote> {
    const texto = (v: unknown, campo: string, max: number): string | null => {
      if (v === undefined || v === null || v === '') return null;
      if (typeof v !== 'string' || v.trim().length > max) {
        throw new SubastaError(`${campo} debe ser texto de hasta ${max} caracteres.`, 400);
      }
      return v.trim() || null;
    };
    const cantidad = input.cantidad_animales;
    if (cantidad !== undefined && cantidad !== null && (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10_000)) {
      throw new SubastaError('cantidad_animales debe ser un entero entre 1 y 10 000.', 400);
    }
    let establecimiento: string | null = null;
    if (input.establecimiento_id !== undefined && input.establecimiento_id !== null && input.establecimiento_id !== '') {
      if (typeof input.establecimiento_id !== 'string' || !UUID_RE.test(input.establecimiento_id)) {
        throw new SubastaError('establecimiento_id debe ser un UUID.', 400);
      }
      const est = await this.pool.query(
        'SELECT 1 FROM establecimientos WHERE id::text = $1 AND organizacion_id = $2',
        [input.establecimiento_id, vendedorOrgId]
      );
      if (est.rowCount === 0) {
        throw new SubastaError('El establecimiento de origen debe pertenecer a su organización.', 403);
      }
      establecimiento = input.establecimiento_id;
    }
    return {
      cantidad_animales: cantidad ?? null,
      categoria: texto(input.categoria, 'categoria', 40),
      raza: texto(input.raza, 'raza', 60),
      descripcion: texto(input.descripcion, 'descripcion', 500),
      establecimiento_id: establecimiento
    };
  }

  /**
   * Catálogo de lotes (GET /subastas). Público: solo lotes publicados (no BORRADOR).
   * Con `mios` y una sesión de vendedor: todos los lotes de su organización, incluidos
   * los borradores. El origen se entrega con la posición PÚBLICA del establecimiento.
   * Paginación por cursor (fecha_cierre, id).
   */
  async listarLotes(
    query: { estado?: string; mios?: string; limit?: string; cursor?: string },
    visor: { userId?: string; organizacionId?: string }
  ): Promise<{ data: LoteCatalogo[]; next_cursor: string | null }> {
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new SubastaError('limit debe ser un entero entre 1 y 50.', 400);
    }
    const mios = query.mios === 'true';
    if (mios && !visor.organizacionId) {
      throw new SubastaError('Inicie sesión con su organización para ver sus lotes.', 401);
    }
    const estados = ['ACTIVO', 'ADJUDICADO', 'DESIERTO', 'CERRADO', 'CANCELADO', 'BORRADOR'];
    if (query.estado !== undefined && !estados.includes(query.estado)) {
      throw new SubastaError(`estado debe ser uno de: ${estados.join(', ')}.`, 400);
    }
    if (query.estado === 'BORRADOR' && !mios) {
      throw new SubastaError('Los borradores solo se listan con mios=true.', 400);
    }

    const values: unknown[] = [visor.organizacionId ?? null, limit + 1];
    const condiciones: string[] = [mios ? 'l.vendedor_id = $1' : "l.estado <> 'BORRADOR'"];
    if (query.estado) {
      values.push(query.estado);
      condiciones.push(`l.estado = $${values.length}`);
    } else if (!mios) {
      condiciones.push("l.estado = 'ACTIVO'");
    }
    if (query.cursor) {
      let ts: unknown, id: unknown;
      try {
        [ts, id] = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      } catch {
        throw new SubastaError('cursor inválido.', 400);
      }
      if (typeof ts !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(ts) || Number.isNaN(Date.parse(ts)) || typeof id !== 'string' || !UUID_RE.test(id)) {
        throw new SubastaError('cursor inválido.', 400);
      }
      values.push(ts, id);
      condiciones.push(`(l.fecha_cierre, l.id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }

    const res = await this.pool.query<LoteCatalogo & { cursor_ts: string; lat: number | null; lon: number | null; ubigeo: string | null; aprox: boolean | null }>(
      `SELECT l.id, l.codigo_lote, l.estado,
              l.precio_base::float, l.precio_actual::float, l.incremento_minimo::float,
              l.fecha_inicio, l.fecha_cierre,
              (l.estado = 'ACTIVO' AND l.fecha_inicio <= clock_timestamp() AND l.fecha_cierre > clock_timestamp()) AS es_abierta,
              l.cantidad_animales, l.categoria, l.raza, l.descripcion, l.establecimiento_id,
              (SELECT count(*)::int FROM subasta_pujas p WHERE p.lote_id = l.id) AS total_pujas,
              (SELECT sum(ep.peso_estimado_kg)::float FROM estimaciones_peso ep WHERE ep.lote_id = l.id) AS peso_estimado_total_kg,
              (l.vendedor_id IS NOT DISTINCT FROM $1::uuid) AS es_mio,
              e.ubigeo,
              ST_Y((${sqlPosicionPublica('e', '$1')})::geometry) AS lat,
              ST_X((${sqlPosicionPublica('e', '$1')})::geometry) AS lon,
              ${sqlUbicacionAproximada('e', '$1')} AS aprox,
              to_char(l.fecha_cierre AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
       FROM lotes_subasta l
       LEFT JOIN establecimientos e ON e.id = l.establecimiento_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY l.fecha_cierre ASC, l.id ASC
       LIMIT $2`,
      values
    );
    const hayMas = res.rows.length > limit;
    const filas = hayMas ? res.rows.slice(0, limit) : res.rows;
    const data = filas.map(({ cursor_ts: _c, lat, lon, ubigeo, aprox, ...lote }) => ({
      ...lote,
      origen: ubigeo !== null && lat !== null && lon !== null ? { ubigeo, latitud: lat, longitud: lon, ubicacion_aproximada: !!aprox } : null
    }));
    const ultimo = filas[filas.length - 1];
    return {
      data,
      next_cursor: hayMas && ultimo ? Buffer.from(JSON.stringify([ultimo.cursor_ts, ultimo.id])).toString('base64url') : null
    };
  }

  /**
   * Lectura pública del lote. Privacidad: el postor que va ganando (id y nombre, dato
   * personal) solo se revela A ÉL MISMO; para los demás va null. Un lote en BORRADOR no
   * está publicado: solo lo ve su organización vendedora (404 para el resto).
   */
  /**
   * Consulta el Snapshot oficial en tiempo real del lote sin bloqueos transaccionales.
   * Calcula el tiempo restante oficial del reloj del servidor de base de datos.
   */
  async obtenerSnapshot(loteId: string, visor: { userId?: string; organizacionId?: string } = {}): Promise<LoteSnapshotResponse> {
    const res = await this.pool.query<{
      id: string;
      codigo_lote: string;
      estado: any;
      precio_base: number;
      precio_actual: number;
      incremento_minimo: number;
      proxima_puja_minima: number;
      postor_ganador_id: string | null;
      postor_ganador_nombre: string | null;
      tiempo_restante_segundos: number;
      fecha_cierre: string;
      secuencia_maxima: number;
      version: number;
      iniciado: boolean;
      antes_del_cierre: boolean;
      vendedor_id: string;
    }>(
      `SELECT
         l.id,
         l.vendedor_id,
         l.codigo_lote,
         l.estado,
         l.precio_base::float,
         l.precio_actual::float,
         l.incremento_minimo::float,
         (l.precio_actual + l.incremento_minimo)::float AS proxima_puja_minima,
         l.postor_ganador_id,
         u.nombre AS postor_ganador_nombre,
         GREATEST(0, ROUND(EXTRACT(EPOCH FROM (l.fecha_cierre - NOW()))))::int AS tiempo_restante_segundos,
         (l.fecha_inicio <= NOW()) AS iniciado,
         (l.fecha_cierre > NOW()) AS antes_del_cierre,
         l.fecha_cierre,
         COALESCE(MAX(p.secuencia), 0)::int AS secuencia_maxima,
         l.version
       FROM lotes_subasta l
       LEFT JOIN users u ON u.id = l.postor_ganador_id
       LEFT JOIN subasta_pujas p ON p.lote_id = l.id
       WHERE l.id = $1
       GROUP BY l.id, u.nombre`,
      [loteId]
    );

    if (res.rows.length === 0) {
      throw new SubastaError('Lote de subasta no encontrado.', 404);
    }

    const { iniciado, antes_del_cierre, vendedor_id, ...row } = res.rows[0]!;
    if (row.estado === 'BORRADOR' && vendedor_id !== visor.organizacionId) {
      throw new SubastaError('Lote de subasta no encontrado.', 404);
    }
    if (!visor.userId || row.postor_ganador_id !== visor.userId) {
      row.postor_ganador_id = null;
      row.postor_ganador_nombre = null;
    }
    // Misma regla que la escritura: ACTIVO, ya iniciado y antes del cierre oficial.
    const esAbierta = row.estado === 'ACTIVO' && iniciado && antes_del_cierre;

    return {
      ...row,
      es_abierta: esAbierta
    };
  }

  /**
   * Procesa la emisión de una puja con control estricto de concurrencia pesimista (FOR UPDATE),
   * verificación de idempotencia, anti-sniping y generación de outbox en una transacción ACID en PostgreSQL.
   */
  async emitirPuja(
    userId: string,
    activeOrgId: string | undefined,
    loteId: string,
    input: EmitirPujaInput
  ): Promise<PujaAceptadaResponse> {
    const { monto, idempotency_key } = input;

    if (!idempotency_key || typeof idempotency_key !== 'string' || !idempotency_key.trim()) {
      throw new SubastaError('idempotency_key es obligatoria para emitir una puja.', 400);
    }
    const trimmedKey = idempotency_key.trim();
    if (trimmedKey.length > 100) {
      throw new SubastaError('idempotency_key admite como máximo 100 caracteres.', 400);
    }
    const montoCentimos = aCentimos(monto);
    // Sin tope, una puja de 1e10 se aceptaba y luego el cierre fallaba al crear la orden
    // (NUMERIC(12,2)): el lote quedaba ACTIVO para siempre, reintentándose en cada ciclo.
    if (montoCentimos !== null && montoCentimos > MONTO_MAXIMO_PEN * 100) {
      throw new SubastaError(`El monto no puede superar S/ ${MONTO_MAXIMO_PEN.toLocaleString('es-PE')}.`, 400);
    }
    if (montoCentimos === null || montoCentimos <= 0) {
      throw new SubastaError('monto debe ser un número positivo con como máximo 2 decimales.', 400);
    }
    if (!activeOrgId) {
      throw new SubastaError('Debe pujar con una organización activa.', 403);
    }

    // La huella identifica la operación lógica: mismo usuario + lote + monto.
    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ userId, loteId, montoCentimos }))
      .digest('hex');

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Reservar la clave. Si otra transacción la está insertando, este INSERT espera a que
      //    termine: si confirmó, no inserta (rowCount 0) y leemos su resultado; si revirtió, inserta.
      const reserva = await client.query(
        `INSERT INTO idempotency_records (user_id, operation, key, payload_hash, status, organizacion_id)
         VALUES ($1, 'EMITIR_PUJA', $2, $3, 'PROCESANDO', $4)
         ON CONFLICT (user_id, operation, key) DO NOTHING`,
        [userId, trimmedKey, payloadHash, activeOrgId]
      );

      if (reserva.rowCount === 0) {
        const previo = await client.query<{
          status: string;
          payload_hash: string;
          response_body: PujaAceptadaResponse;
          organizacion_id: string | null;
        }>(
          `SELECT status, payload_hash, response_body, organizacion_id
           FROM idempotency_records
           WHERE user_id = $1 AND operation = 'EMITIR_PUJA' AND key = $2
           FOR UPDATE`,
          [userId, trimmedKey]
        );
        const record = previo.rows[0];

        // Misma clave desde OTRA organización activa: conflicto de contexto, nunca una
        // repetición (devolvería una puja atribuida a la organización anterior).
        // organizacion_id NULL = registro anterior a la migración 0014 (heredado).
        if (record && record.organizacion_id !== null && record.organizacion_id !== activeOrgId) {
          throw new SubastaError(
            'La clave de idempotencia ya se usó con otra organización activa. Genere una clave nueva.',
            409,
            'IDEMPOTENCY_KEY_OTRO_CONTEXTO'
          );
        }
        if (record && record.payload_hash !== payloadHash) {
          throw new SubastaError(
            'La clave de idempotencia ya se usó con otra solicitud (lote o monto distinto).',
            422,
            'IDEMPOTENCY_KEY_REUSED'
          );
        }
        if (!record || record.status !== 'COMPLETED') {
          throw new SubastaError(
            'Existe una puja en proceso con esta misma clave de idempotencia.',
            409,
            'IDEMPOTENCY_IN_PROGRESS'
          );
        }
        // Registro heredado (anterior a 0014, sin organización): se recupera la organización
        // ORIGINAL desde la puja guardada. Si no coincide con la activa, o no se puede
        // determinar, conflicto opaco: nunca se entrega el recibo a otro contexto.
        if (record.organizacion_id === null) {
          const original = await client.query<{ organizacion_postora_id: string | null }>(
            'SELECT organizacion_postora_id FROM subasta_pujas WHERE id = $1',
            [record.response_body?.puja_id ?? null]
          );
          if (original.rows[0]?.organizacion_postora_id !== activeOrgId) {
            throw new SubastaError(
              'La clave de idempotencia ya se usó con otra organización activa. Genere una clave nueva.',
              409,
              'IDEMPOTENCY_KEY_OTRO_CONTEXTO'
            );
          }
        }
        await client.query('COMMIT');
        return record.response_body;
      }

      // 2. Bloqueo pesimista del lote.
      const loteRes = await client.query<{
        id: string;
        vendedor_id: string;
        estado: string;
        precio_actual_centimos: string;
        incremento_minimo_centimos: string;
        anti_sniping_seconds: number;
        anti_sniping_extension: number;
      }>(
        `SELECT
           id,
           vendedor_id,
           estado,
           ROUND(precio_actual * 100)::bigint AS precio_actual_centimos,
           ROUND(incremento_minimo * 100)::bigint AS incremento_minimo_centimos,
           anti_sniping_seconds,
           anti_sniping_extension
         FROM lotes_subasta
         WHERE id = $1
         FOR UPDATE`,
        [loteId]
      );

      if (loteRes.rows.length === 0) {
        throw new SubastaError('Lote de subasta no encontrado.', 404);
      }

      // 2b. Reloj real de PostgreSQL leído DESPUÉS de obtener el bloqueo. NOW() conserva el
      //     inicio de la transacción: una puja que esperó el FOR UPDATE se evaluaría con la hora
      //     anterior y podría aceptarse tras el cierre. clock_timestamp() es la hora actual, y
      //     la sentencia separada garantiza que se evalúa ya con la fila bloqueada.
      const relojRes = await client.query<{
        no_iniciado: boolean;
        segundos_restantes: number;
        fecha_cierre: Date;
      }>(
        `SELECT
           fecha_inicio > clock_timestamp() AS no_iniciado,
           EXTRACT(EPOCH FROM (fecha_cierre - clock_timestamp()))::float AS segundos_restantes,
           fecha_cierre
         FROM lotes_subasta
         WHERE id = $1`,
        [loteId]
      );

      const lote = { ...loteRes.rows[0]!, ...relojRes.rows[0]! };

      if (lote.estado !== 'ACTIVO') {
        throw new SubastaError(
          `El lote no se encuentra activo para recibir ofertas (estado: ${lote.estado}).`,
          400,
          'LOTE_NO_ABIERTO'
        );
      }
      if (lote.no_iniciado) {
        throw new SubastaError('La subasta todavía no ha iniciado.', 400, 'LOTE_NO_ABIERTO');
      }
      if (lote.segundos_restantes <= 0) {
        throw new SubastaError('La subasta ha expirado y no admite nuevas pujas.', 400, 'LOTE_NO_ABIERTO');
      }

      // 3. Nadie de la organización vendedora (con cualquier rol) puja por el lote.
      const miembroVendedor = await client.query(
        `SELECT 1 FROM user_organizaciones_roles WHERE user_id = $1 AND organizacion_id = $2 LIMIT 1`,
        [userId, lote.vendedor_id]
      );
      if (activeOrgId === lote.vendedor_id || (miembroVendedor.rowCount ?? 0) > 0) {
        throw new SubastaError(
          'El vendedor no puede pujar por su propio lote de subasta.',
          403,
          'PUJA_PROPIO_LOTE'
        );
      }

      const minRequeridoCentimos =
        Number(lote.precio_actual_centimos) + Number(lote.incremento_minimo_centimos);
      if (montoCentimos < minRequeridoCentimos) {
        throw new SubastaError(
          `El monto ofertado (${monto}) es inferior al mínimo requerido (${(minRequeridoCentimos / 100).toFixed(2)}).`,
          400,
          'PUJA_INSUFICIENTE'
        );
      }

      // 4. Anti-sniping: extender desde la fecha de cierre vigente.
      const extensionAplicada = lote.segundos_restantes <= lote.anti_sniping_seconds;
      const fechaCierreActual = new Date(lote.fecha_cierre);
      const nuevaFechaCierre = extensionAplicada
        ? new Date(fechaCierreActual.getTime() + lote.anti_sniping_extension * 1000)
        : fechaCierreActual;

      // 5. Secuencia monótona (protegida por el FOR UPDATE del lote y uq_lote_secuencia).
      const seqRes = await client.query<{ next_secuencia: number }>(
        `SELECT COALESCE(MAX(secuencia), 0) + 1 AS next_secuencia
         FROM subasta_pujas
         WHERE lote_id = $1`,
        [loteId]
      );
      const siguienteSecuencia = Number(seqRes.rows[0]!.next_secuencia);
      const montoFinal = montoCentimos / 100;

      const pujaRes = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO subasta_pujas (lote_id, postor_id, organizacion_postora_id, monto, secuencia, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at`,
        [loteId, userId, activeOrgId, montoFinal, siguienteSecuencia, trimmedKey]
      );
      const puja = pujaRes.rows[0]!;

      const updateLoteRes = await client.query<{ version: number }>(
        `UPDATE lotes_subasta
         SET precio_actual = $1,
             postor_ganador_id = $2,
             organizacion_ganadora_id = $3,
             fecha_cierre = $4,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $5
         RETURNING version`,
        [montoFinal, userId, activeOrgId, nuevaFechaCierre.toISOString(), loteId]
      );
      const nuevaVersion = updateLoteRes.rows[0]!.version;

      const responsePayload: PujaAceptadaResponse = {
        puja_id: puja.id,
        lote_id: loteId,
        monto: montoFinal,
        secuencia: siguienteSecuencia,
        nueva_version: nuevaVersion,
        nuevo_precio_actual: montoFinal,
        extension_aplicada: extensionAplicada,
        nueva_fecha_cierre: nuevaFechaCierre.toISOString(),
        idempotency_key: trimmedKey,
        created_at: puja.created_at
      };

      // 6. Evento outbox en la misma transacción. El payload público no lleva la clave de
      //    idempotencia (es un dato del cliente que puja).
      const { idempotency_key: _clavePrivada, ...eventoPublico } = responsePayload;
      await client.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status)
         VALUES ('LOTE_SUBASTA', $1, 'PUJA_ACEPTADA', $2, 'PENDIENTE')`,
        [loteId, JSON.stringify(eventoPublico)]
      );

      await client.query(
        `UPDATE idempotency_records
         SET status = 'COMPLETED',
             response_code = 201,
             response_body = $1,
             updated_at = NOW()
         WHERE user_id = $2 AND operation = 'EMITIR_PUJA' AND key = $3`,
        [JSON.stringify(responsePayload), userId, trimmedKey]
      );

      await client.query('COMMIT');

      return responsePayload;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
