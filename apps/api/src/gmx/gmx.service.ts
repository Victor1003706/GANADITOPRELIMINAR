import type pg from 'pg';
import {
  calcularEscandalloAnatomico,
  type CalcularEscandalloInput,
  type ResultadoEscandalloAnatomico,
  type OrdenGmx,
  type CalceGmx,
  type CrearOrdenGmxInput,
  type CrearOrdenGmxResponse,
  type OrderbookGmxResponse,
  type ProductoGmx,
  type TipoOperacionGmx,
  type EstadoOrdenGmx
} from '@ganadito/contracts';

export class GmxError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'GmxError';
  }
}

const TIPOS_OPERACION_VALIDOS: readonly TipoOperacionGmx[] = ['COMPRA', 'VENTA'];

const PRODUCTOS_GMX_VALIDOS: readonly ProductoGmx[] = [
  'MEDIA_CANAL',
  'CUARTO_DELANTERO',
  'CUARTO_TRASERO',
  'CORTES_CALIBRADOS'
];

function mapOrdenRow(row: any): OrdenGmx {
  return {
    id: row.id,
    creador_id: row.creador_id,
    organizacion_id: row.organizacion_id,
    tipo_operacion: row.tipo_operacion,
    producto: row.producto,
    cantidad_kg: Number(row.cantidad_kg),
    cantidad_restante_kg: Number(row.cantidad_restante_kg),
    precio_kilo_limite: Number(row.precio_kilo_limite),
    estado: row.estado,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapCalceRow(row: any): CalceGmx {
  return {
    id: row.id,
    orden_compra_id: row.orden_compra_id,
    orden_venta_id: row.orden_venta_id,
    cantidad_kg: Number(row.cantidad_kg),
    precio_pactado_kilo: Number(row.precio_pactado_kilo),
    monto_total: Number(row.monto_total),
    orden_comercial_id: row.orden_comercial_id ?? null,
    created_at: row.created_at
  };
}

export class GmxService {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Ejecuta el motor determinista de escandallo anatómico NTP 201.055.
   */
  ejecutarEscandallo(input: Record<string, any>): ResultadoEscandalloAnatomico {
    const pesoCanalKg = Number(input.pesoCanalKg ?? input.peso_canal_kg);
    const costoKiloCanalPEN = Number(input.costoKiloCanalPEN ?? input.costo_kilo_canal_pen);
    const margenObjetivoPct =
      input.margenObjetivoPct !== undefined || input.margen_objetivo_pct !== undefined
        ? Number(input.margenObjetivoPct ?? input.margen_objetivo_pct)
        : 0.22;
    const mermaDespostePct =
      input.mermaDespostePct !== undefined || input.merma_desposte_pct !== undefined
        ? Number(input.mermaDespostePct ?? input.merma_desposte_pct)
        : 0.035;

    try {
      return calcularEscandalloAnatomico(
        pesoCanalKg,
        costoKiloCanalPEN,
        margenObjetivoPct,
        mermaDespostePct
      );
    } catch (err: any) {
      throw new GmxError(err.message || 'Parámetros inválidos para el cálculo de escandallo.', 400);
    }
  }

  /**
   * Registra una orden en el libro GMX y ejecuta el matching inmediato transaccional
   * con prioridad Precio-Tiempo y bloqueo pesimista FOR UPDATE SKIP LOCKED.
   */
  async crearOrden(
    userId: string,
    activeOrgId: string,
    input: CrearOrdenGmxInput
  ): Promise<CrearOrdenGmxResponse> {
    if (!input.tipo_operacion || !TIPOS_OPERACION_VALIDOS.includes(input.tipo_operacion)) {
      throw new GmxError("tipo_operacion inválido. Debe ser 'COMPRA' o 'VENTA'.", 400);
    }
    if (!input.producto || !PRODUCTOS_GMX_VALIDOS.includes(input.producto)) {
      throw new GmxError(
        `Producto GMX inválido. Debe ser uno de: ${PRODUCTOS_GMX_VALIDOS.join(', ')}.`,
        400
      );
    }
    if (typeof input.cantidad_kg !== 'number' || input.cantidad_kg <= 0) {
      throw new GmxError('cantidad_kg debe ser un número positivo mayor a 0.', 400);
    }
    if (typeof input.precio_kilo_limite !== 'number' || input.precio_kilo_limite <= 0) {
      throw new GmxError('precio_kilo_limite debe ser un número positivo mayor a 0.', 400);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insertar la orden entrante en estado ABIERTA con cantidad_restante_kg = cantidad_kg
      const insertRes = 