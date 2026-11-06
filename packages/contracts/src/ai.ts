/**
 * Contratos del Servicio Satélite de Inteligencia Artificial:
 * - ExpoGanadito Video Pipeline (Visión Computacional)
 * - Dr. Ganadito Bromatología CIELAB y Checklist Sanitario RM N.° 822-2018/MINSA
 */

export type EstadoDictamenIA =
  | 'COMPLETADO'
  | 'PENDIENTE_REVISION_MANUAL';

export interface VideoAnalisisInput {
  video_url?: string;
  video_base64?: string;
  duracion_segundos?: number;
  num_fotogramas?: number;
  raza_declarada?: string;
}

export interface VisionAnalisisResult {
  biotipo_sugerido: string;
  /** null si el satélite no midió (contingencia): nunca un valor inventado. */
  condicion_corporal_score: number | null;
  estimacion_dentaria: string;
  confianza_score: number;
  fotogramas_muestreados?: number;
  duracion_evaluada_seg?: number;
  es_vinculante: boolean;
  estado: EstadoDictamenIA;
  servicio_disponible?: boolean;
  fallback_manual?: boolean;
  motivo_fallback?: string;
}

export interface AnalisisBromatologicoInput {
  imagen_base64?: string;
  bgr_color?: [number, number, number];
  ancho?: number;
  alto?: number;
}

export interface AnalisisBromatologicoResult {
  l_star_promedio: number | null;
  a_star_promedio: number | null;
  b_star_promedio: number | null;
  alerta_dfd: boolean;
  diagnostico: string;
  recomendacion: string;
  umbral_dfd_l_star?: number;
  estado: EstadoDictamenIA;
  servicio_disponible?: boolean;
  fallback_manual?: boolean;
  motivo_fallback?: string;
}

export interface ChecklistMinsaInput {
  temperatura_recepcion_c: number;
  color_organoleptico?: boolean | string;
  ausencia_olores_extranos?: boolean;
  lote_id?: string;
}

export interface ChecklistMinsaResult {
  normativa_referencia: string;
  /** null = sin dictamen (contingencia: requiere inspección manual). */
  aprobado_sanitariamente: boolean | null;
  rechazo_sanitario: boolean | null;
  temperatura_recepcion_c: number;
  temperatura_conforme: boolean;
  color_conforme: boolean;
  olor_conforme: boolean;
  dictamen: string;
  observaciones: string[];
  estado: EstadoDictamenIA;
  servicio_disponible?: boolean;
  fallback_manual?: boolean;
  motivo_fallback?: string;
}
