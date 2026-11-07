/**
 * Bolsa de Valores Cárnica (GMX) y Motor de Escandallo Anatómico (NTP 201.055)
 */

export type CuartoAnatomico = 'CUARTO_TRASERO' | 'CUARTO_DELANTERO';

export type CodigoCorteNtp =
  // Cuarto Trasero (8 cortes)
  | 'LOMO_FINO'
  | 'BIFE_ANGOSTO'
  | 'CUADRIL'
  | 'TAPADECUADRIL'
  | 'BOLA_DE_LOMO'
  | 'NALGA'
  | 'TORTUGUITA'
  | 'OSOBUCO_TRASERO'
  // Cuarto Delantero (10 cortes)
  | 'BIFE_ANCHO'
  | 'ASADO_DE_TIRA'
  | 'PECHO'
  | 'FALDA'
  | 'PALETA'
  | 'COGOTE'
  | 'MALAYA'
  | 'OSOBUCO_DELANTERO'
  | 'ASADO_RUSO'
  | 'BRAZUELO';

export interface DefinicionCorteNtp {
  codigo: CodigoCorteNtp;
  nombre: string;
  cuarto: CuartoAnatomico;
  /** Proporción sobre el peso neto aprovechable de la canal (suma = 1.0) */
  proporcion_neta: number;
  /** Ponderador de valor comercial relativo en el mercado peruano */
  factor_valor_comercial: number;
}

/**
 * Catálogo canónico de los 18 cortes anatómicos vacunos según la Norma Técnica Peruana NTP 201.055.
 * La suma de `proporcion_neta` de los 18 cortes es exactamente 1.0000 (100% del peso aprovechable).
 */
export const CATALOGO_CORTES_NTP_201_055: readonly DefinicionCorteNtp[] = [
  // Cuarto Trasero (8 cortes — 48% del peso aprovechable)
  {
    codigo: 'LOMO_FINO',
    nombre: 'Lomo Fino',
    cuarto: 'CUARTO_TRASERO',
    proporcion_neta: 0.022,
    factor_valor_comercial: 2.45
  },
  {
    codigo: 'BIFE_ANGOSTO',
    nombre: 'Bife Angosto',
    cuarto: 'CUARTO_TRASERO',
    proporcion_neta: 0.065,
    factor_valor_comercial: 1.85
  },
  {
    codigo: 'CUADRIL',
    nombre: 'Cuadril',
    cuarto: 'CUARTO_TRASERO',
    proporcion_neta: 0.058,
    factor_valor_comercial: 1.65
  },
  {
    codigo: 'TAPADECUADRIL',
    nombre: 'Tapadecuadril (Picaña)',
    cuarto: 'CUARTO_TRASERO',
    proporcion_neta: 0.025,
    factor_valor_comercial: 1.95
  },
  {
    codigo: 'BOLA_DE_LOMO',
    nombre: 'Bola de Lomo',
    cuarto: 'CUARTO_TRASERO',
    proporcion_neta: 0.085,
    factor_valor_comercial: 1.35
  },
  {
    codigo: 'NALGA',
    nombre: 'Nalga',
    cuarto: 'CUARTO_TRASERO',
    proporcion_neta: 0.115,
    factor_valor_comercial: 1.38
  },
  {
    codigo: 'TORTUGUITA',
    nombre: 'Tortuguita',
    cuarto: 'CUARTO_TRASERO',
    proporcion_neta: 0.045,
    factor_valor_comercial: 1.15
  },
  {
    codigo: 'OSOBUCO_TRASERO',
    nombre: 'Osobuco Trasero',
    cuarto: 'CUARTO_TRASERO',
    proporcion_neta: 0.065,
    factor_valor_comercial: 0.85
  },

  // Cuarto Delantero (10 cortes — 52% del peso aprovechable)
  {
    codigo: 'BIFE_ANCHO',
    nombre: 'Bife Ancho',
    cuarto: 'CUARTO_DELANTERO',
    proporcion_neta: 0.062,
    factor_valor_comercial: 1.65
  },
  {
    codigo: 'ASADO_DE_TIRA',
    nombre: 'Asado de Tira',
    cuarto: 'CUARTO_DELANTERO',
    proporcion_neta: 0.075,
    factor_valor_comercial: 1.42
  },
  {
    codigo: 'PECHO',
    nombre: 'Pecho',
    cuarto: 'CUARTO_DELANTERO',
    proporcion_neta: 0.068,
    factor_valor_comercial: 1.05
  },
  {
    codigo: 'FALDA',
    nombre: 'Falda',
    cuarto: 'CUARTO_DELANTERO',
    proporcion_neta: 0.055,
    factor_valor_comercial: 0.88
  },
  {
    codigo: 'PALETA',
    nombre: 'Paleta',
    cuarto: 'CUARTO_DELANTERO',
    proporcion_neta: 0.082,
    factor_valor_comercial: 1.22
  },
  {
    codigo: 'COGOTE',
    nombre: 'Cogote',
    cuarto: 'CUARTO_DELANTERO',
    proporcion_neta: 0.058,
    factor_valor_comercial: 0.82
  },
  {
    codigo: 'MALAYA',
    nombre: 'Malaya',
    cuarto: 'CUARTO_DELANTERO',
    proporcion_neta: 0.018,
    factor_valor_comercial: 1.18
  },
  {
    codigo: 'OSOBUCO_DELANTERO',
    nombre: 'Osobuco Delantero',
    cuarto: 'CUARTO_DELANTERO',
    proporcion_neta: 0.042,
    factor_valor_comercial: 0.80
  },
  {
    codigo: 'ASADO_RUSO',
    nombre: 'Asado Ruso',
    cuarto: 'CUARTO_DELANTERO',
    proporcion_neta: 0.032,
    factor_valor_comercial: 1.12
  },
  {
    codigo: 'BRAZUELO',
    nombre: 'Brazuelo',
    cuarto: 'CUARTO_DELANTERO',
    proporcion_neta: 0.028,
    factor_valor_comercial: 0.86
  }
];

export interface CorteEscandalloResultado {
  codigo: CodigoCorteNtp;
  nombre: string;
  cuarto: CuartoAnatomico;
  proporcion_pct: number;
  peso_estimado_kg: number;
  costo_unitario_prorrateado_pen: number;
  costo_total_corte_pen: number;
  precio_sugerido_kilo_pen: number;
  ingreso_estimado_pen: number;
  margen_unitario_pen: number;
  margen_corte_pct: number;
}

export interface ResultadoEscandalloAnatomico {
  norma_tecnica: 'NTP 201.055';
  peso_canal_kg: number;
  costo_kilo_canal_pen: number;
  costo_total_canal_pen: number;
  merma_desposte_pct: number;
  merma_kg: number;
  peso_aprovechable_kg: number;
  suma_cortes_mas_merma_kg: number;
  margen_objetivo_pct: number;
  ingreso_total_estimado_pen: number;
  utilidad_neta_estimada_pen: number;
  /** Margen neto expresado en porcentaje (ej. 22.85 para > 22%) */
  margen_neto_ponderado_pct: number;
  /** Margen neto expresado en proporción (ej. 0.2285 para > 0.22) */
  margen_neto_ponderado_ratio: number;
  cortes: CorteEscandalloResultado[];
}

export interface CalcularEscandalloInput {
  pesoCanalKg: number;
  costoKiloCanalPEN: number;
  margenObjetivoPct?: number;
  mermaDespostePct?: number;
}

/**
 * Función pura determinista que calcula el escandallo anatómico de los 18 cortes NTP 201.055,
 * garantizando conservación exacta de masa (suma de cortes + merma = pesoCanalKg)
 * y cumplimiento del margen neto objetivo ponderado.
 */
export function calcularEscandalloAnatomico(
  pesoCanalKg: number,
  costoKiloCanalPEN: number,
  margenObjetivoPct: number = 0.22,
  mermaDespostePct: number = 0.035
): ResultadoEscandalloAnatomico {
  if (typeof pesoCanalKg !== 'number' || pesoCanalKg <= 0) {
    throw new Error('pesoCanalKg debe ser un número positivo mayor a 0.');
  }
  if (typeof costoKiloCanalPEN !== 'number' || costoKiloCanalPEN <= 0) {
    throw new Error('costoKiloCanalPEN debe ser un número positivo mayor a 0.');
  }
  if (typeof margenObjetivoPct !== 'number' || margenObjetivoPct <= 0 || margenObjetivoPct >= 0.95) {
    throw new Error('margenObjetivoPct debe estar entre 0 (exclusivo) y 0.95.');
  }
  if (typeof mermaDespostePct !== 'number' || mermaDespostePct < 0 || mermaDespostePct >= 0.5) {
    throw new Error('mermaDespostePct debe estar entre 0 y 0.50.');
  }

  const costoTotalCanal = Number((pesoCanalKg * costoKiloCanalPEN).toFixed(2));
  const mermaKg = Number((pesoCanalKg * mermaDespostePct).toFixed(2));
  const pesoAprovechableKg = Number((pesoCanalKg - mermaKg).toFixed(2));

  // Calcular pesos por corte asegurando que la suma sea exactamente pesoAprovechableKg
  const pesosKg: number[] = [];
  let acumuladoPeso = 0;

  for (let i = 0; i < CATALOGO_CORTES_NTP_201_055.length; i++) {
    const def = CATALOGO_CORTES_NTP_201_055[i]!;
    if (i === CATALOGO_CORTES_NTP_201_055.length - 1) {
      const restante = Number((pesoAprovechableKg - acumuladoPeso).toFixed(2));
      pesosKg.push(restante);
      acumuladoPeso = Number((acumuladoPeso + restante).toFixed(2));
    } else {
      const pesoCorte = Number((pesoAprovechableKg * def.proporcion_neta).toFixed(2));
      pesosKg.push(pesoCorte);
      acumuladoPeso = Number((acumuladoPeso + pesoCorte).toFixed(2));
    }
  }

  // Ponderación comercial total para distribuir costos y precios según valor anatómico
  let sumaUnidadesValor = 0;
  for (let i = 0; i < CATALOGO_CORTES_NTP_201_055.length; i++) {
    const def = CATALOGO_CORTES_NTP_201_055[i]!;
    const peso = pesosKg[i]!;
    sumaUnidadesValor += peso * def.factor_valor_comercial;
  }

  // Ingreso objetivo para superar el margen requerido (tanto sobre ventas como sobre costo)
  // Usamos factor (1 - margenObjetivoPct - 0.005) para asegurar margen neto > margenObjetivoPct tras redondeo
  const divisorMargen = Math.max(0.05, 1 - margenObjetivoPct - 0.005);
  const ingresoObjetivoTotal = costoTotalCanal / divisorMargen;

  const cortes: CorteEscandalloResultado[] = [];
  let ingresoTotalAcumulado = 0;

  for (let i = 0; i < CATALOGO_CORTES_NTP_201_055.length; i++) {
    const def = CATALOGO_CORTES_NTP_201_055[i]!;
    const pesoCorte = pesosKg[i]!;
    const pesoValor = pesoCorte * def.factor_valor_comercial;
    const participacionValor = sumaUnidadesValor > 0 ? pesoValor / sumaUnidadesValor : def.proporcion_neta;

    const costoTotalCorte = Number((costoTotalCanal * participacionValor).toFixed(2));
    const costoUnitarioProrrateado = pesoCorte > 0
      ? Number((costoTotalCorte / pesoCorte).toFixed(2))
      : 0;

    const ingresoCorteObjetivo = ingresoObjetivoTotal * participacionValor;
    const precioSugeridoKilo = pesoCorte > 0
      ? Number((Math.ceil((ingresoCorteObjetivo / pesoCorte) * 100) / 100).toFixed(2))
      : 0;

    const ingresoEstimado = Number((pesoCorte * precioSugeridoKilo).toFixed(2));
    ingresoTotalAcumulado = Number((ingresoTotalAcumulado + ingresoEstimado).toFixed(2));

    const margenUnitario = Number((precioSugeridoKilo - costoUnitarioProrrateado).toFixed(2));
    const margenCortePct = precioSugeridoKilo > 0
      ? Number((((precioSugeridoKilo - costoUnitarioProrrateado) / precioSugeridoKilo) * 100).toFixed(2))
      : 0;

    cortes.push({
      codigo: def.codigo,
      nombre: def.nombre,
      cuarto: def.cuarto,
      proporcion_pct: Number((def.proporcion_neta * 100).toFixed(2)),
      peso_estimado_kg: pesoCorte,
      costo_unitario_prorrateado_pen: costoUnitarioProrrateado,
      costo_total_corte_pen: costoTotalCorte,
      precio_sugerido_kilo_pen: precioSugeridoKilo,
      ingreso_estimado_pen: ingresoEstimado,
      margen_unitario_pen: margenUnitario,
      margen_corte_pct: margenCortePct
    });
  }

  const utilidadNeta = Number((ingresoTotalAcumulado - costoTotalCanal).toFixed(2));
  const margenNetoRatio = ingresoTotalAcumulado > 0
    ? Number((utilidadNeta / ingresoTotalAcumulado).toFixed(4))
    : 0;
  const margenNetoPct = Number((margenNetoRatio * 100).toFixed(2));
  const sumaCortesMasMerma = Number((acumuladoPeso + mermaKg).toFixed(2));

  return {
    norma_tecnica: 'NTP 201.055',
    peso_canal_kg: pesoCanalKg,
    costo_kilo_canal_pen: costoKiloCanalPEN,
    costo_total_canal_pen: costoTotalCanal,
    merma_desposte_pct: mermaDespostePct,
    merma_kg: mermaKg,
    peso_aprovechable_kg: pesoAprovechableKg,
    suma_cortes_mas_merma_kg: sumaCortesMasMerma,
    margen_objetivo_pct: margenObjetivoPct,
    ingreso_total_estimado_pen: ingresoTotalAcumulado,
    utilidad_neta_estimada_pen: utilidadNeta,
    margen_neto_ponderado_pct: margenNetoPct,
    margen_neto_ponderado_ratio: margenNetoRatio,
    cortes
  };
}

/**
 * Tipos de dominio para Órdenes y Calces en la Bolsa de Valores Cárnica (GMX)
 */
export type TipoOperacionGmx = 'COMPRA' | 'VENTA';

export type ProductoGmx =
  | 'MEDIA_CANAL'
  | 'CUARTO_DELANTERO'
  | 'CUARTO_TRASERO'
  | 'CORTES_CALIBRADOS';

export type EstadoOrdenGmx =
  | 'ABIERTA'
  | 'PARCIALMENTE_CALZADA'
  | 'CALZADA'
  | 'CANCELADA';

export interface OrdenGmx {
  id: string;
  creador_id: string;
  organizacion_id: string;
  tipo_operacion: TipoOperacionGmx;
  producto: ProductoGmx;
  cantidad_kg: number;
  cantidad_restante_kg: number;
  precio_kilo_limite: number;
  estado: EstadoOrdenGmx;
  created_at: string | Date;
  updated_at?: string | Date;
}

export interface CalceGmx {
  id: string;
  orden_compra_id: string;
  orden_venta_id: string;
  cantidad_kg: number;
  precio_pactado_kilo: number;
  monto_total: number;
  orden_comercial_id: string | null;
  created_at: string | Date;
}

export interface CrearOrdenGmxInput {
  tipo_operacion: TipoOperacionGmx;
  producto: ProductoGmx;
  cantidad_kg: number;
  precio_kilo_limite: number;
}

export interface CrearOrdenGmxResponse {
  orden: OrdenGmx;
  calces: CalceGmx[];
}

export interface NivelPrecioOrderbook {
  precio_kilo: number;
  volumen_total_kg: number;
  ordenes_count: number;
}

export interface OrderbookGmxResponse {
  producto: ProductoGmx;
  compras: NivelPrecioOrderbook[];
  ventas: NivelPrecioOrderbook[];
  spread_pen: number | null;
  timestamp: string;
}
