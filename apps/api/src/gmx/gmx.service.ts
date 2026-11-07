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
      const insertRes = await client.query(
        `INSERT INTO gmx_ordenes (
          creador_id, organizacion_id, tipo_operacion, producto,
          cantidad_kg, cantidad_restante_kg, precio_kilo_limite, estado
        ) VALUES ($1, $2, $3, $4, $5, $5, $6, 'ABIERTA')
        RETURNING *`,
        [
          userId,
          activeOrgId,
          input.tipo_operacion,
          input.producto,
          input.cantidad_kg,
          input.precio_kilo_limite
        ]
      );

      let ordenActual = mapOrdenRow(insertRes.rows[0]);
      let restanteKg = ordenActual.cantidad_restante_kg;

      // 2. Buscar órdenes contrapartes compatibles en el libro contrario (Precio-Tiempo)
      const sqlContrapartes =
        input.tipo_operacion === 'COMPRA'
          ? `SELECT * FROM gmx_ordenes
             WHERE producto = $1
               AND tipo_operacion = 'VENTA'
               AND organizacion_id IS DISTINCT FROM $3
               AND estado IN ('ABIERTA', 'PARCIALMENTE_CALZADA')
               AND cantidad_restante_kg > 0
               AND precio_kilo_limite <= $2
             ORDER BY precio_kilo_limite ASC, created_at ASC
             FOR UPDATE SKIP LOCKED`
          : `SELECT * FROM gmx_ordenes
             WHERE producto = $1
               AND tipo_operacion = 'COMPRA'
               AND organizacion_id IS DISTINCT FROM $3
               AND estado IN ('ABIERTA', 'PARCIALMENTE_CALZADA')
               AND cantidad_restante_kg > 0
               AND precio_kilo_limite >= $2
             ORDER BY precio_kilo_limite DESC, created_at ASC
             FOR UPDATE SKIP LOCKED`;

      // $3: la propia organización nunca es contraparte (evita autocalce / wash trading).
      const contrapartesRes = await client.query(sqlContrapartes, [
        input.producto,
        input.precio_kilo_limite,
        ordenActual.organizacion_id
      ]);

      const calcesGenerados: CalceGmx[] = [];

      // 3. Ejecutar calces iterativamente hasta agotar volumen o contrapartes
      for (const row of contrapartesRes.rows) {
        if (restanteKg <= 0) break;

        const contraparte = mapOrdenRow(row);
        const cantidadCalzada = Number(
          Math.min(restanteKg, contraparte.cantidad_restante_kg).toFixed(2)
        );
        if (cantidadCalzada <= 0) continue;

        // Precio pactado determinado por la orden pasiva (maker) en el libro
        const precioPactado = contraparte.precio_kilo_limite;
        const montoTotal = Number((cantidadCalzada * precioPactado).toFixed(2));

        const ordenCompraId =
          input.tipo_operacion === 'COMPRA' ? ordenActual.id : contraparte.id;
        const ordenVentaId =
          input.tipo_operacion === 'VENTA' ? ordenActual.id : contraparte.id;

        // Insertar calce en gmx_calces
        const calceRes = await client.query(
          `INSERT INTO gmx_calces (
            orden_compra_id, orden_venta_id, cantidad_kg, precio_pactado_kilo, monto_total
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING *`,
          [ordenCompraId, ordenVentaId, cantidadCalzada, precioPactado, montoTotal]
        );
        const nuevoCalce = mapCalceRow(calceRes.rows[0]);
        calcesGenerados.push(nuevoCalce);

        // Actualizar orden contraparte
        const nuevoRestanteContraparte = Number(
          (contraparte.cantidad_restante_kg - cantidadCalzada).toFixed(2)
        );
        const nuevoEstadoContraparte: EstadoOrdenGmx =
          nuevoRestanteContraparte <= 0 ? 'CALZADA' : 'PARCIALMENTE_CALZADA';

        await client.query(
          `UPDATE gmx_ordenes
           SET cantidad_restante_kg = $1,
               estado = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [nuevoRestanteContraparte, nuevoEstadoContraparte, contraparte.id]
        );

        // Reducir cantidad restante de la orden entrante
        restanteKg = Number((restanteKg - cantidadCalzada).toFixed(2));

        // Emitir evento transaccional en outbox_events
        await client.query(
          `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, $2, $3, $4)`,
          [
            'GMX_CALCE',
            nuevoCalce.id,
            'GMX_CALCE_GENERADO',
            JSON.stringify({
              calce_id: nuevoCalce.id,
              orden_compra_id: ordenCompraId,
              orden_venta_id: ordenVentaId,
              producto: input.producto,
              cantidad_kg: cantidadCalzada,
              precio_pactado_kilo: precioPactado,
              monto_total: montoTotal,
              timestamp: new Date().toISOString()
            })
          ]
        );
      }

      // 4. Si hubo calces, actualizar la orden entrante
      if (calcesGenerados.length > 0) {
        const estadoFinalEntrante: EstadoOrdenGmx =
          restanteKg <= 0 ? 'CALZADA' : 'PARCIALMENTE_CALZADA';

        const updateEntranteRes = await client.query(
          `UPDATE gmx_ordenes
           SET cantidad_restante_kg = $1,
               estado = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3
           RETURNING *`,
          [restanteKg, estadoFinalEntrante, ordenActual.id]
        );
        ordenActual = mapOrdenRow(updateEntranteRes.rows[0]);
      }

      await client.query('COMMIT');
      return {
        orden: ordenActual,
        calces: calcesGenerados
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Consulta pública agregada del libro de órdenes activo por niveles de precio.
   */
  async consultarOrderbook(productoParam?: string): Promise<OrderbookGmxResponse> {
    const producto: ProductoGmx = (productoParam as ProductoGmx) || 'MEDIA_CANAL';
    if (!PRODUCTOS_GMX_VALIDOS.includes(producto)) {
      throw new GmxError(
        `Producto inválido. Debe ser uno de: ${PRODUCTOS_GMX_VALIDOS.join(', ')}.`,
        400
      );
    }

    const [comprasRes, ventasRes] = await Promise.all([
      this.pool.query(
        `SELECT precio_kilo_limite AS precio_kilo,
                SUM(cantidad_restante_kg) AS volumen_total_kg,
                COUNT(*)::int AS ordenes_count
         FROM gmx_ordenes
         WHERE producto = $1
           AND tipo_operacion = 'COMPRA'
           AND estado IN ('ABIERTA', 'PARCIALMENTE_CALZADA')
           AND cantidad_restante_kg > 0
         GROUP BY precio_kilo_limite
         ORDER BY precio_kilo_limite DESC`,
        [producto]
      ),
      this.pool.query(
        `SELECT precio_kilo_limite AS precio_kilo,
                SUM(cantidad_restante_kg) AS volumen_total_kg,
                COUNT(*)::int AS ordenes_count
         FROM gmx_ordenes
         WHERE producto = $1
           AND tipo_operacion = 'VENTA'
           AND estado IN ('ABIERTA', 'PARCIALMENTE_CALZADA')
           AND cantidad_restante_kg > 0
         GROUP BY precio_kilo_limite
         ORDER BY precio_kilo_limite ASC`,
        [producto]
      )
    ]);

    const compras = comprasRes.rows.map(r => ({
      precio_kilo: Number(r.precio_kilo),
      volumen_total_kg: Number(r.volumen_total_kg),
      ordenes_count: Number(r.ordenes_count)
    }));

    const ventas = ventasRes.rows.map(r => ({
      precio_kilo: Number(r.precio_kilo),
      volumen_total_kg: Number(r.volumen_total_kg),
      ordenes_count: Number(r.ordenes_count)
    }));

    const mejorCompra = compras[0]?.precio_kilo;
    const mejorVenta = ventas[0]?.precio_kilo;
    const spreadPen =
      mejorCompra !== undefined && mejorVenta !== undefined
        ? Number((mejorVenta - mejorCompra).toFixed(2))
        : null;

    return {
      producto,
      compras,
      ventas,
      spread_pen: spreadPen,
      timestamp: new Date().toISOString()
    };
  }
}
