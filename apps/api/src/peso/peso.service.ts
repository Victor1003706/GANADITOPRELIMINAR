import crypto from 'node:crypto';
import type pg from 'pg';
import type {
  CrearEstimacionPesoInput,
  EstimacionPesoResponse,
  PesajeBalanzaResponse,
  RegistrarPesajeInput,
  ResumenPesoLote
} from '@ganadito/contracts';
import { AiClientService, AiNoDisponibleError, AiSolicitudRechazadaError } from '../integraciones/ai-client.service.js';

export class PesoError extends Error {
  constructor(message: string, public statusCode = 400, public code?: string, public detalle?: unknown) {
    super(message);
    this.name = 'PesoError';
  }
}

export const MAX_VISTAS = 4;
const MAX_IDENTIFICADOR = 64;
const MAX_IDEMPOTENCY_KEY = 128;
const MAX_PARES_EVALUACION = 2000;
/** Igual que el satélite: 8 MB de imagen equivalen a ~11,2 MB en Base64. */
export const MAX_IMAGEN_BASE64 = Math.floor((8 * 1024 * 1024 * 4) / 3) + 4;

/**
 * El lote solo admite estimaciones mientras está en BORRADOR o ACTIVO sin iniciar
 * (reloj de PostgreSQL): la información que ven los postores queda congelada al
 * empezar la puja y no puede cambiar a mitad de la subasta.
 */
const SQL_LOTE_EDITABLE = `(l.estado = 'BORRADOR' OR (l.estado = 'ACTIVO' AND l.fecha_inicio > clock_timestamp()))`;

const ADVERTENCIA_LOTE =
  'Estimación orientativa por IA, no es un pesaje ni es vinculante. La puja es por el precio total del lote.';

interface ResultadoSatelite {
  metodo: string;
  version_parametros: string;
  peso_estimado_kg: number;
  rango_min_kg: number;
  rango_max_kg: number;
  es_vinculante: boolean;
  incertidumbre: { nivel_confianza: number } & Record<string, unknown>;
  calidad?: unknown[];
  advertencias: string[];
  muestra?: unknown;
  vistas?: Array<{ muestra: unknown; calidad: unknown[] }>;
}

interface FilaEstimacion {
  id: string;
  lote_id: string;
  identificador_animal: string | null;
  metodo: string;
  version_parametros: string;
  peso_estimado_kg: string;
  rango_min_kg: string;
  rango_max_kg: string;
  nivel_confianza: string;
  numero_vistas: number;
  incertidumbre: EstimacionPesoResponse['incertidumbre'];
  calidad: EstimacionPesoResponse['calidad'];
  advertencias: string[];
  tiene_pesaje: boolean;
  created_at: Date;
  huella_solicitud?: string | null;
}

const COLUMNAS = `e.id, e.lote_id, e.identificador_animal, e.metodo, e.version_parametros,
  e.peso_estimado_kg, e.rango_min_kg, e.rango_max_kg, e.nivel_confianza, e.numero_vistas,
  e.incertidumbre, e.calidad, e.advertencias, e.created_at,
  EXISTS (SELECT 1 FROM pesajes_balanza pb WHERE pb.estimacion_id = e.id) AS tiene_pesaje`;

function aRespuesta(f: FilaEstimacion): EstimacionPesoResponse {
  return {
    id: f.id,
    lote_id: f.lote_id,
    identificador_animal: f.identificador_animal,
    metodo: f.metodo,
    version_parametros: f.version_parametros,
    peso_estimado_kg: Number(f.peso_estimado_kg),
    rango_min_kg: Number(f.rango_min_kg),
    rango_max_kg: Number(f.rango_max_kg),
    nivel_confianza: Number(f.nivel_confianza),
    numero_vistas: f.numero_vistas,
    es_vinculante: false,
    incertidumbre: f.incertidumbre,
    calidad: f.calidad,
    advertencias: f.advertencias,
    tiene_pesaje: f.tiene_pesaje,
    created_at: new Date(f.created_at).toISOString()
  };
}

const esNumeroFinito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const esPunto = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(esNumeroFinito);

/** Validación superficial antes de reenviar al satélite (que valida en detalle). */
export function validarEntrada(body: unknown): CrearEstimacionPesoInput {
  const b = body as Partial<CrearEstimacionPesoInput> | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.vistas)) {
    throw new PesoError('Se requiere "vistas" (arreglo de 1 a 4 fotos del mismo animal).', 400, 'ENTRADA_INVALIDA');
  }
  if (b.vistas.length < 1 || b.vistas.length > MAX_VISTAS) {
    throw new PesoError(`"vistas" debe tener entre 1 y ${MAX_VISTAS} elementos.`, 400, 'ENTRADA_INVALIDA');
  }
  b.vistas.forEach((v, i) => {
    const puntos = v?.puntos as unknown as Record<string, unknown> | undefined;
    const claves = ['punta_hombro', 'punta_nalga', 'cruz', 'pecho_inferior'];
    if (!puntos || !claves.every((k) => esPunto(puntos[k]))) {
      throw new PesoError(`Vista ${i}: faltan puntos anatómicos válidos.`, 400, 'ENTRADA_INVALIDA');
    }
    const tipo = (v.calibracion as { tipo?: string } | undefined)?.tipo;
    if (tipo !== 'ARUCO' && tipo !== 'REFERENCIA') {
      throw new PesoError(`Vista ${i}: calibracion.tipo debe ser ARUCO o REFERENCIA.`, 400, 'ENTRADA_INVALIDA');
    }
    if (v.imagen_base64 !== undefined && typeof v.imagen_base64 !== 'string') {
      throw new PesoError(`Vista ${i}: imagen_base64 debe ser texto.`, 400, 'ENTRADA_INVALIDA');
    }
    if (typeof v.imagen_base64 === 'string' && v.imagen_base64.length > MAX_IMAGEN_BASE64) {
      throw new PesoError(`Vista ${i}: la imagen supera 8 MB.`, 413, 'IMAGEN_DEMASIADO_GRANDE');
    }
  });
  let identificador: string | undefined;
  if (b.identificador_animal !== undefined && b.identificador_animal !== null) {
    if (typeof b.identificador_animal !== 'string') {
      throw new PesoError('identificador_animal debe ser texto.', 400, 'ENTRADA_INVALIDA');
    }
    identificador = b.identificador_animal.trim();
    if (!identificador || identificador.length > MAX_IDENTIFICADOR) {
      throw new PesoError(`identificador_animal debe tener entre 1 y ${MAX_IDENTIFICADOR} caracteres.`, 400, 'ENTRADA_INVALIDA');
    }
  }
  return { vistas: b.vistas, ...(identificador ? { identificador_animal: identificador } : {}) };
}

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const esListaDeObjetos = (v: unknown) => Array.isArray(v) && v.every(esObjeto);

function incertidumbreValida(v: unknown): boolean {
  if (!esObjeto(v)) return false;
  return (
    esNumeroFinito(v.nivel_confianza) &&
    esNumeroFinito(v.desviacion_log) &&
    (v.desviacion_log as number) >= 0 &&
    Array.isArray(v.contribuciones) &&
    v.contribuciones.every((c) => esObjeto(c) && typeof c.fuente === 'string' && esNumeroFinito(c.contribucion))
  );
}

function controlesValidos(v: unknown): boolean {
  return Array.isArray(v) && v.every((c) => esObjeto(c) && typeof c.codigo === 'string' && typeof c.estado === 'string');
}

/** La muestra debe traer las medidas que la calibración necesita después. */
function muestraValida(v: unknown): boolean {
  return esObjeto(v) && esNumeroFinito(v.largo_corporal_cm) && esNumeroFinito(v.profundidad_pecho_cm);
}

/**
 * Comprueba la respuesta COMPLETA del satélite antes de guardarla (no solo el núcleo
 * numérico): incertidumbre, advertencias, calidad y muestra(s). Cualquier forma
 * inesperada es un 502 del proveedor, nunca un 500 ni un INSERT incompleto.
 */
export function validarResultadoSatelite(r: unknown, numeroVistas = 1): ResultadoSatelite {
  const x = r as ResultadoSatelite | null;
  const formaVistas =
    numeroVistas === 1
      ? !!x && x.vistas === undefined && muestraValida(x.muestra) && controlesValidos(x.calidad)
      : !!x &&
        esListaDeObjetos(x.vistas) &&
        x.vistas!.length === numeroVistas &&
        x.vistas!.every((v) => muestraValida(v.muestra) && controlesValidos(v.calidad));
  const ok =
    formaVistas &&
    !!x &&
    typeof x.metodo === 'string' &&
    typeof x.version_parametros === 'string' &&
    esNumeroFinito(x.peso_estimado_kg) &&
    esNumeroFinito(x.rango_min_kg) &&
    esNumeroFinito(x.rango_max_kg) &&
    x.peso_estimado_kg > 0 &&
    x.rango_min_kg > 0 &&
    x.rango_min_kg <= x.peso_estimado_kg &&
    x.peso_estimado_kg <= x.rango_max_kg &&
    x.es_vinculante === false &&
    incertidumbreValida(x.incertidumbre) &&
    x.incertidumbre.nivel_confianza > 0 &&
    x.incertidumbre.nivel_confianza < 1 &&
    Array.isArray(x.advertencias) &&
    x.advertencias.every((a) => typeof a === 'string');
  if (!ok) {
    throw new PesoError('El servicio de IA devolvió una respuesta inválida.', 502, 'IA_RESPUESTA_INVALIDA');
  }
  return x!;
}

/** Errores de validación del satélite sin eco de la entrada (podría ser una imagen de MB). */
function detalleSeguro(detalle: unknown): unknown {
  const d = (detalle as { detail?: unknown } | null)?.detail;
  if (typeof d === 'string') return d.slice(0, 500);
  if (Array.isArray(d)) {
    return d.slice(0, 10).map((e: any) => ({ loc: Array.isArray(e?.loc) ? e.loc : [], msg: String(e?.msg ?? '') }));
  }
  return 'Solicitud rechazada por el servicio de IA.';
}

export class PesoService {
  constructor(private readonly pool: pg.Pool, private readonly ai: AiClientService) {}

  /** 404 si no existe, 403 si es de otra organización; devuelve si aún admite estimaciones. */
  private async verificarLoteDelVendedor(loteId: string, organizacionId: string): Promise<boolean> {
    const res = await this.pool.query<{ vendedor_id: string; editable: boolean }>(
      `SELECT l.vendedor_id, ${SQL_LOTE_EDITABLE} AS editable FROM lotes_subasta l WHERE l.id = $1`,
      [loteId]
    );
    const lote = res.rows[0];
    if (!lote) throw new PesoError('Lote no encontrado.', 404, 'LOTE_NO_ENCONTRADO');
    if (lote.vendedor_id !== organizacionId) {
      throw new PesoError('El lote no pertenece a la organización activa.', 403, 'LOTE_AJENO');
    }
    return lote.editable;
  }

  private async buscarIdempotente(loteId: string, clave: string, huella: string): Promise<EstimacionPesoResponse | null> {
    const res = await this.pool.query<FilaEstimacion>(
      `SELECT ${COLUMNAS}, e.huella_solicitud FROM estimaciones_peso e WHERE e.lote_id = $1 AND e.idempotency_key = $2`,
      [loteId, clave]
    );
    const fila = res.rows[0];
    if (!fila) return null;
    if (fila.huella_solicitud !== huella) {
      throw new PesoError('La Idempotency-Key ya se usó con otra solicitud.', 409, 'IDEMPOTENCIA_CONFLICTO');
    }
    return aRespuesta(fila);
  }

  async crearEstimacion(
    loteId: string,
    organizacionId: string,
    userId: string,
    body: unknown,
    idempotencyKey?: string
  ): Promise<{ estimacion: EstimacionPesoResponse; repetida: boolean }> {
    const entrada = validarEntrada(body);
    if (idempotencyKey !== undefined && (idempotencyKey.length < 1 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY)) {
      throw new PesoError('Idempotency-Key inválida.', 400, 'ENTRADA_INVALIDA');
    }
    const editable = await this.verificarLoteDelVendedor(loteId, organizacionId);

    const huella = idempotencyKey
      ? crypto.createHash('sha256').update(JSON.stringify([loteId, userId, entrada])).digest('hex')
      : null;
    // El reintento de una solicitud YA guardada se responde con lo persistido (200) aunque
    // la subasta haya empezado después: la regla de "lote editable" aplica solo a altas nuevas.
    if (idempotencyKey && huella) {
      const previa = await this.buscarIdempotente(loteId, idempotencyKey, huella);
      if (previa) return { estimacion: previa, repetida: true };
    }
    if (!editable) {
      throw new PesoError(
        'El lote ya inició su subasta o está cerrado: no admite nuevas estimaciones.',
        409,
        'LOTE_NO_EDITABLE'
      );
    }

    // La llamada al satélite va FUERA de toda transacción: no se retienen bloqueos
    // mientras corre el Monte Carlo.
    let crudo: unknown;
    try {
      crudo = await this.ai.estimarPeso(entrada.vistas);
    } catch (err) {
      if (err instanceof AiSolicitudRechazadaError) {
        const status = err.status === 413 ? 413 : 422;
        throw new PesoError('El servicio de IA rechazó las fotos o los puntos.', status, 'IA_RECHAZO', detalleSeguro(err.detalle));
      }
      if (err instanceof AiNoDisponibleError) {
        throw new PesoError('El servicio de estimación no está disponible. Intente más tarde.', 503, 'IA_NO_DISPONIBLE');
      }
      throw err;
    }
    const r = validarResultadoSatelite(crudo, entrada.vistas.length);
    // La forma la decide el pedido (validada arriba), no la presencia de `vistas` en la respuesta.
    const multivista = entrada.vistas.length > 1;
    const muestras = multivista ? r.vistas!.map((v) => v.muestra) : [r.muestra];
    const calidad = multivista ? r.vistas!.flatMap((v) => v.calidad) : (r.calidad ?? []);

    try {
      // El INSERT vuelve a comprobar que el lote siga editable: si la subasta empezó
      // mientras corría la IA, no se agrega nada.
      const ins = await this.pool.query<{ id: string }>(
        `INSERT INTO estimaciones_peso (
           lote_id, organizacion_id, creado_por_user_id, identificador_animal, metodo, version_parametros,
           peso_estimado_kg, rango_min_kg, rango_max_kg, nivel_confianza, numero_vistas,
           muestra, incertidumbre, calidad, advertencias, idempotency_key, huella_solicitud)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
         FROM lotes_subasta l
         WHERE l.id = $1 AND l.vendedor_id = $2 AND ${SQL_LOTE_EDITABLE}
         ON CONFLICT (lote_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          loteId,
          organizacionId,
          userId,
          entrada.identificador_animal ?? null,
          r.metodo,
          r.version_parametros,
          r.peso_estimado_kg,
          r.rango_min_kg,
          r.rango_max_kg,
          r.incertidumbre.nivel_confianza,
          entrada.vistas.length,
          JSON.stringify({ vistas: muestras }),
          JSON.stringify(r.incertidumbre),
          JSON.stringify(calidad),
          JSON.stringify(r.advertencias),
          idempotencyKey ?? null,
          huella
        ]
      );
      if (ins.rows.length === 0) {
        if (idempotencyKey && huella) {
          // Carrera: otra solicitud con la misma clave insertó primero.
          const previa = await this.buscarIdempotente(loteId, idempotencyKey, huella);
          if (previa) return { estimacion: previa, repetida: true };
        }
        throw new PesoError('El lote dejó de admitir estimaciones durante el cálculo.', 409, 'LOTE_NO_EDITABLE');
      }
      return { estimacion: await this.obtener(ins.rows[0]!.id), repetida: false };
    } catch (err: any) {
      if (err?.code === '23505' && err?.constraint === 'uq_estimaciones_peso_animal') {
        // Carrera de dos reintentos con la misma clave y el mismo animal: el perdedor
        // choca con el índice del animal, pero debe reproducir la respuesta guardada.
        if (idempotencyKey && huella) {
          const previa = await this.buscarIdempotente(loteId, idempotencyKey, huella);
          if (previa) return { estimacion: previa, repetida: true };
        }
        throw new PesoError('Ese animal ya tiene una estimación en el lote.', 409, 'ANIMAL_DUPLICADO');
      }
      throw err;
    }
  }

  private async obtener(id: string): Promise<EstimacionPesoResponse> {
    const res = await this.pool.query<FilaEstimacion>(`SELECT ${COLUMNAS} FROM estimaciones_peso e WHERE e.id = $1`, [id]);
    return aRespuesta(res.rows[0]!);
  }

  /** Un lote en BORRADOR no está publicado: solo su organización dueña ve sus estimaciones. */
  async resumenLote(loteId: string, organizacionVisitante?: string): Promise<ResumenPesoLote> {
    const lote = await this.pool.query<{ estado: string; vendedor_id: string }>(
      'SELECT estado, vendedor_id FROM lotes_subasta WHERE id = $1',
      [loteId]
    );
    const fila = lote.rows[0];
    if (!fila || (fila.estado === 'BORRADOR' && fila.vendedor_id !== organizacionVisitante)) {
      throw new PesoError('Lote no encontrado.', 404, 'LOTE_NO_ENCONTRADO');
    }
    const res = await this.pool.query<FilaEstimacion>(
      `SELECT ${COLUMNAS} FROM estimaciones_peso e WHERE e.lote_id = $1 ORDER BY e.created_at, e.id`,
      [loteId]
    );
    const estimaciones = res.rows.map(aRespuesta);
    // Suma en décimas de kg (enteros) para no acumular error de coma flotante.
    const sumar = (f: (e: EstimacionPesoResponse) => number) =>
      estimaciones.reduce((acc, e) => acc + Math.round(f(e) * 10), 0) / 10;
    return {
      lote_id: loteId,
      numero_estimaciones: estimaciones.length,
      peso_total_estimado_kg: sumar((e) => e.peso_estimado_kg),
      rango_total_conservador_kg: [sumar((e) => e.rango_min_kg), sumar((e) => e.rango_max_kg)],
      es_vinculante: false,
      advertencia: ADVERTENCIA_LOTE,
      estimaciones
    };
  }

  async registrarPesaje(
    estimacionId: string,
    organizacionId: string,
    userId: string,
    body: unknown
  ): Promise<PesajeBalanzaResponse> {
    const b = body as Partial<RegistrarPesajeInput> | null;
    if (!b || !esNumeroFinito(b.peso_real_kg) || b.peso_real_kg <= 0 || b.peso_real_kg > 2000) {
      throw new PesoError('peso_real_kg debe estar entre 0 y 2000.', 400, 'ENTRADA_INVALIDA');
    }
    if (b.perimetro_cinta_cm !== undefined && (!esNumeroFinito(b.perimetro_cinta_cm) || b.perimetro_cinta_cm <= 0 || b.perimetro_cinta_cm > 400)) {
      throw new PesoError('perimetro_cinta_cm debe estar entre 0 y 400.', 400, 'ENTRADA_INVALIDA');
    }
    const balanza = typeof b.balanza_descripcion === 'string' ? b.balanza_descripcion.trim() : '';
    if (!balanza || balanza.length > 200) {
      throw new PesoError('balanza_descripcion es obligatoria (máx. 200 caracteres).', 400, 'ENTRADA_INVALIDA');
    }
    // Conflicto de interés: nadie vinculado a la organización vendedora registra la balanza
    // de sus propios animales (sesgaría la calibración). Se comprueba por USUARIO: no basta
    // con cambiar a un contexto OPERADOR de otra organización, ni con ser quien creó la
    // estimación.
    const duena = await this.pool.query<{ organizacion_id: string; conflicto: boolean }>(
      `SELECT e.organizacion_id,
              (e.organizacion_id = $2
               OR e.creado_por_user_id = $3
               OR EXISTS (SELECT 1 FROM user_organizaciones_roles uor
                          WHERE uor.user_id = $3 AND uor.organizacion_id = e.organizacion_id)) AS conflicto
       FROM estimaciones_peso e WHERE e.id = $1`,
      [estimacionId, organizacionId, userId]
    );
    if (!duena.rows[0]) throw new PesoError('Estimación no encontrada.', 404, 'ESTIMACION_NO_ENCONTRADA');
    if (duena.rows[0].conflicto) {
      throw new PesoError('La organización vendedora no puede registrar el pesaje de su propio lote.', 403, 'CONFLICTO_DE_INTERES');
    }
    try {
      const res = await this.pool.query<{
        id: string; estimacion_id: string; peso_real_kg: string; perimetro_cinta_cm: string | null;
        balanza_descripcion: string; created_at: Date; peso_estimado_kg: string; rango_min_kg: string; rango_max_kg: string;
      }>(
        `WITH nuevo AS (
           INSERT INTO pesajes_balanza (estimacion_id, peso_real_kg, perimetro_cinta_cm, balanza_descripcion,
                                        registrado_por_user_id, registrado_por_organizacion_id)
           SELECT e.id, $2, $3, $4, $5, $6 FROM estimaciones_peso e
           WHERE e.id = $1 AND e.organizacion_id <> $6
             AND e.creado_por_user_id IS DISTINCT FROM $5
             AND NOT EXISTS (SELECT 1 FROM user_organizaciones_roles uor
                             WHERE uor.user_id = $5 AND uor.organizacion_id = e.organizacion_id)
           RETURNING *)
         SELECT n.id, n.estimacion_id, n.peso_real_kg, n.perimetro_cinta_cm, n.balanza_descripcion, n.created_at,
                e.peso_estimado_kg, e.rango_min_kg, e.rango_max_kg
         FROM nuevo n JOIN estimaciones_peso e ON e.id = n.estimacion_id`,
        [estimacionId, b.peso_real_kg, b.perimetro_cinta_cm ?? null, balanza, userId, organizacionId]
      );
      const f = res.rows[0];
      if (!f) throw new PesoError('Estimación no encontrada.', 404, 'ESTIMACION_NO_ENCONTRADA');
      const real = Number(f.peso_real_kg);
      return {
        id: f.id,
        estimacion_id: f.estimacion_id,
        peso_real_kg: real,
        perimetro_cinta_cm: f.perimetro_cinta_cm === null ? null : Number(f.perimetro_cinta_cm),
        balanza_descripcion: f.balanza_descripcion,
        error_relativo: Math.round(((Number(f.peso_estimado_kg) - real) / real) * 10000) / 10000,
        dentro_del_rango: Number(f.rango_min_kg) <= real && real <= Number(f.rango_max_kg),
        created_at: new Date(f.created_at).toISOString()
      };
    } catch (err: any) {
      if (err?.code === '23505') throw new PesoError('La estimación ya tiene un pesaje registrado.', 409, 'PESAJE_DUPLICADO');
      if (err?.code === '22P02') throw new PesoError('Estimación no encontrada.', 404, 'ESTIMACION_NO_ENCONTRADA');
      throw err;
    }
  }

  /**
   * Pares (estimación, balanza) para medir el error y proponer una calibración. Las
   * medidas salen de la primera vista; el perímetro, de la cinta del pesaje.
   */
  async evaluar(): Promise<{ n_pares: number; evaluacion: unknown }> {
    const res = await this.pool.query<{
      peso_real_kg: string; peso_estimado_kg: string; rango_min_kg: string; rango_max_kg: string;
      largo: string | null; profundidad: string | null; perimetro_cinta_cm: string | null;
    }>(
      `SELECT pb.peso_real_kg, e.peso_estimado_kg, e.rango_min_kg, e.rango_max_kg,
              e.muestra->'vistas'->0->>'largo_corporal_cm' AS largo,
              e.muestra->'vistas'->0->>'profundidad_pecho_cm' AS profundidad,
              pb.perimetro_cinta_cm
       FROM pesajes_balanza pb JOIN estimaciones_peso e ON e.id = pb.estimacion_id
       ORDER BY pb.created_at DESC
       LIMIT ${MAX_PARES_EVALUACION}`
    );
    if (res.rows.length === 0) {
      throw new PesoError('Todavía no hay pesajes de balanza registrados.', 409, 'SIN_PESAJES');
    }
    const num = (v: string | null) => (v === null || v === undefined ? undefined : Number(v));
    const pares = res.rows.map((f) => ({
      peso_real_kg: Number(f.peso_real_kg),
      peso_estimado_kg: Number(f.peso_estimado_kg),
      rango_min_kg: Number(f.rango_min_kg),
      rango_max_kg: Number(f.rango_max_kg),
      ...(num(f.largo) ? { largo_corporal_cm: num(f.largo) } : {}),
      ...(num(f.profundidad) ? { profundidad_pecho_cm: num(f.profundidad) } : {}),
      ...(num(f.perimetro_cinta_cm) ? { perimetro_cinta_cm: num(f.perimetro_cinta_cm) } : {})
    }));
    try {
      return { n_pares: pares.length, evaluacion: await this.ai.evaluarPeso(pares) };
    } catch (err) {
      if (err instanceof AiNoDisponibleError) {
        throw new PesoError('El servicio de evaluación no está disponible.', 503, 'IA_NO_DISPONIBLE');
      }
      if (err instanceof AiSolicitudRechazadaError) {
        throw new PesoError('El servicio de IA rechazó los pares.', 422, 'IA_RECHAZO', detalleSeguro(err.detalle));
      }
      throw err;
    }
  }
}
