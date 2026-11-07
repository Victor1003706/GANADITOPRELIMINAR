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
    