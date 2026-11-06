import type pg from 'pg';
import { sqlPosicionPublica, sqlUbicacionAproximada } from '../mapa/ubicacion-publica.js';
import type {
  CrearCotizacionSpotInput,
  CotizacionSpotResponse,
  CotizacionPizarraResponse,
  ConsultaPizarraQuery
} from './spot.types.js';

export class SpotError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'SpotError';
  }
}

export class SpotService {
  constructor(private pool: pg.Pool) {}

  /**
   * Registra una cotización en la Pizarra Spot vinculada a un establecimiento de la organización activa.
   */
  async crearCotizacion(
    organizacionId: string,
    input: CrearCotizacionSpotInput
  ): Promise<CotizacionSpotResponse> {
    const {
      establecimiento_id,
      producto,
      categoria,
      calidad,
      unidad_medida,
      precio_unitario,
      moneda = 'PEN',
      procedencia_ubigeo,
      fecha_registro,
      vigencia_hasta
    } = input;
    // La Pizarra es pública: una cotización nunca nace "verificada" por decisión del cliente.
    const verificado = false;

    // 1. Validaciones básicas
    if (!establecimiento_id) {
      throw new SpotError('establecimiento_id es obligatorio.', 400);
    }
    if (!producto) {
      throw new SpotError('producto es obligatorio.', 400);
    }
    if (typeof precio_unitario !== 'number' || precio_unitario <= 0) {
      throw new SpotError('precio_unitario debe ser un valor numérico positivo mayor a 0.', 400);
    }
    if (!vigencia_hasta) {
      throw new SpotError('vigencia_hasta es obligatoria.', 400);
    }

    const fechaRegistroDate = fecha_registro ? new Date(fecha_registro) : new Date();
    const vigenciaHastaDate = new Date(vigencia_hasta);

    if (isNaN(vigenciaHastaDate.getTime())) {
      throw new SpotError('vigencia_hasta no es una fecha válida.', 400);
    }

    if (vigenciaHastaDate.getTime() <= fechaRegistroDate.getTime()) {
      throw new SpotError('vigencia_hasta debe ser una fecha posterior a la fecha de registro.', 400);
    }

    // 2. Verificar que el establecimiento pertenezca a la organización activa del usuario
    const estRes = await this.pool.query<{
      id: string;
      ubigeo: string;
      nombre_comercial: string;
      tipo: string;
    }>(
      `SELECT id, ubigeo, nombre_comercial, tipo
       FROM establecimientos
       WHERE id = $1 AND organizacion_id = $2`,
      [establecimiento_id, organizacionId]
    );

    if (estRes.rows.length === 0) {
      throw new SpotError('El establecimiento no existe o no pertenece a la organización activa.', 403);
    }

    const est = estRes.rows[0]!;
    const ubigeoFinal = procedencia_ubigeo?.trim() || est.ubigeo;

    // 3. Insertar cotización
    const res = await this.pool.query<CotizacionSpotResponse>(
      `INSERT INTO cotizaciones_spot (
         establecimiento_id,
         producto,
         categoria,
         calidad,
         unidad_medida,
         moneda,
         precio_unitario,
         procedencia_ubigeo,
         fecha_registro,
         vigencia_hasta,
         verificado
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING
         id,
         establecimiento_id,
         producto,
         categoria,
         calidad,
         unidad_medida,
         moneda,
         precio_unitario::float,
         procedencia_ubigeo,
         fecha_registro,
         vigencia_hasta,
         verificado,
         created_at`,
      [
        establecimiento_id,
        producto,
        categoria,
        calidad,
        unidad_medida,
        moneda,
        precio_unitario,
        ubigeoFinal,
        fechaRegistroDate.toISOString(),
        vigenciaHastaDate.toISOString(),
        verificado
      ]
    );

    const cotizacion = res.rows[0]!;
    cotizacion.establecimiento_nombre = est.nombre_comercial;
    cotizacion.establecimiento_tipo = est.tipo;

    return cotizacion;
  }

  /**
   * Consulta la Pizarra Spot filtrando exclusivamente cotizaciones vigentes.
   * Utiliza el índice compuesto (producto, vigencia_hasta DESC, establecimiento_id).
   */
  async consultarPizarra(query: ConsultaPizarraQuery, viewerOrgId?: string): Promise<{
    total: number;
    cotizaciones: CotizacionPizarraResponse[];
  }> {
    const { producto, ubigeo, categoria, calidad, limit = 50, offset = 0 } = query;

    const safeLimit = Math.min(Math.max(1, limit), 200);
    const safeOffset = Math.max(0, offset);

    const conditions: string[] = ['cs.vigencia_hasta >= CURRENT_TIMESTAMP'];
    const values: any[] = [];

    if (producto) {
      values.push(producto);
      conditions.push(`cs.producto = $${values.length}`);
    }

    if (ubigeo) {
      values.push(ubigeo.trim());
      conditions.push(`cs.procedencia_ubigeo = $${values.length}`);
    }

    if (categoria) {
      values.push(categoria);
      conditions.push(`cs.categoria = $${values.length}`);
    }

    if (calidad) {
      values.push(calidad);
      conditions.push(`cs.calidad = $${values.length}`);
    }

    values.push(safeLimit);
    const limitPlaceholder = `$${values.length}`;
    values.push(safeOffset);
    const offsetPlaceholder = `$${values.length}`;

    values.push(viewerOrgId ?? null);
    const visitantePlaceholder = `$${values.length}`;

    // Misma política de privacidad que el mapa: establos ajenos en rejilla 0.01°.
    const sql = `
      SELECT
        cs.id,
        cs.establecimiento_id,
        e.nombre_comercial AS establecimiento_nombre,
        e.tipo AS establecimiento_tipo,
        e.organizacion_id,
        o.razon_social AS organizacion_nombre,
        cs.producto,
        cs.categoria,
        cs.calidad,
        cs.unidad_medida,
        cs.moneda,
        cs.precio_unitario::float,
        cs.procedencia_ubigeo,
        cs.fecha_registro,
        cs.vigencia_hasta,
        cs.verificado,
        ST_Y((${sqlPosicionPublica('e', visitantePlaceholder)})::geometry) AS latitud,
        ST_X((${sqlPosicionPublica('e', visitantePlaceholder)})::geometry) AS longitud,
        COALESCE(${sqlUbicacionAproximada('e', visitantePlaceholder)}, FALSE) AS ubicacion_aproximada,
        cs.created_at
      FROM cotizaciones_spot cs
      LEFT JOIN establecimientos e ON e.id = cs.establecimiento_id
      LEFT JOIN organizaciones o ON o.id = e.organizacion_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY cs.producto ASC, cs.vigencia_hasta DESC, cs.precio_unitario ASC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `;

    const res = await this.pool.query<CotizacionPizarraResponse>(sql, values);

    return {
      total: res.rows.length,
      cotizaciones: res.rows
    };
  }
}
