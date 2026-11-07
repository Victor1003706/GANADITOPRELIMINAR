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
      `