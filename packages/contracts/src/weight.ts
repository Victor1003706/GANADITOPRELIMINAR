/**
 * Contratos de la estimación ORIENTATIVA de peso vivo (zoometría, etapa 1 V1).
 * Ver docs/api/contrato-v1-peso.md. La estimación nunca es vinculante: la puja es por
 * el precio total del lote y no se liquida por kilogramo.
 */

export type PuntoPx = [number, number];

export interface PuntosAnatomicos {
  punta_hombro: PuntoPx;
  punta_nalga: PuntoPx;
  cruz: PuntoPx;
  pecho_inferior: PuntoPx;
}

export interface CalibracionAruco {
  tipo: 'ARUCO';
  lado_cm: number;
  diccionario?: 'DICT_4X4_50' | 'DICT_5X5_50' | 'DICT_6X6_50';
  marcador_id?: number;
}

export interface CalibracionReferencia {
  tipo: 'REFERENCIA';
  punto_a: PuntoPx;
  punto_b: PuntoPx;
  distancia_cm: number;
}

export interface VistaPeso {
  imagen_base64?: string;
  puntos: PuntosAnatomicos;
  calibracion: CalibracionAruco | CalibracionReferencia;
  perimetro_toracico_cm?: number;
  incertidumbre_punto_px?: number;
}

/** Cuerpo de POST /api/v1/subastas/:id/estimaciones-peso (1 a 4 vistas del mismo animal). */
export interface CrearEstimacionPesoInput {
  identificador_animal?: string;
  vistas: VistaPeso[];
}

export interface ContribucionIncertidumbre {
  fuente: string;
  descripcion: string;
  contribucion: number;
  por_vista: boolean;
}

export interface IncertidumbrePeso {
  nivel_confianza: number;
  desviacion_log: number;
  coeficiente_variacion: number;
  n_simulaciones: number;
  semilla: number;
  contribuciones: ContribucionIncertidumbre[];
}

export interface ControlCalidadPeso {
  codigo: string;
  estado: 'OK' | 'ADVERTENCIA' | 'NO_EVALUADO';
  valor: number | null;
  umbral: string;
  detalle: string;
}

export interface EstimacionPesoResponse {
  id: string;
  lote_id: string;
  identificador_animal: string | null;
  metodo: string;
  version_parametros: string;
  peso_estimado_kg: number;
  rango_min_kg: number;
  rango_max_kg: number;
  nivel_confianza: number;
  numero_vistas: number;
  es_vinculante: false;
  incertidumbre: IncertidumbrePeso;
  calidad: ControlCalidadPeso[];
  advertencias: string[];
  tiene_pesaje: boolean;
  created_at: string;
}

export interface ResumenPesoLote {
  lote_id: string;
  numero_estimaciones: number;
  peso_total_estimado_kg: number;
  /**
   * Suma de mínimos y de máximos individuales: cota CONSERVADORA (supone errores
   * perfectamente correlacionados entre animales, p. ej. el mismo sesgo del modelo).
   */
  rango_total_conservador_kg: [number, number];
  es_vinculante: false;
  advertencia: string;
  estimaciones: EstimacionPesoResponse[];
}

export interface RegistrarPesajeInput {
  peso_real_kg: number;
  perimetro_cinta_cm?: number;
  balanza_descripcion: string;
}

export interface PesajeBalanzaResponse {
  id: string;
  estimacion_id: string;
  peso_real_kg: number;
  perimetro_cinta_cm: number | null;
  balanza_descripcion: string;
  error_relativo: number;
  dentro_del_rango: boolean;
  created_at: string;
}
