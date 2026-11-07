import type { PointGeoJSON, UbigeoPerunano } from './geo.js';

/**
 * Roles organizacionales permitidos en la plataforma Ganadito.
 * Un usuario puede poseer distintos roles dentro de una o varias organizaciones (RBAC dual).
 */
// Debe coincidir exactamente con el CHECK de user_organizaciones_roles.rol (migración 0001).
// 'ADMINISTRADOR' no existía en la base de datos; el valor real es 'ADMIN'.
export const ROLES_ORGANIZACION = [
  'COMPRADOR',
  'VENDEDOR',
  'OPERADOR_CAMAL',
  'TRANSPORTISTA',
  'ADMIN',
  'AUDITOR',
  'OPERADOR'
] as const;

export type RolOrganizacion = (typeof ROLES_ORGANIZACION)[number];

/**
 * Tipos de documentos de identidad oficiales en Perú.
 */
export const TIPOS_DOCUMENTO_IDENTIDAD = [
  'DNI',
  'CARNET_EXTRANJERIA',
  'PASAPORTE'
] as const;

export type TipoDocumentoIdentidad = (typeof TIPOS_DOCUMENTO_IDENTIDAD)[number];

/**
 * Tipos de personería jurídica o entidad comercial.
 */
export const TIPOS_ORGANIZACION = [
  'PERSONA_NATURAL_CON_NEGOCIO',
  'EMPRESA_INDIVIDUAL_RESPONSABILIDAD_LIMITADA',
  'SOCIEDAD_ANONIMA_CERRADA',
  'SOCIEDAD_COMERCIAL_RESPONSABILIDAD_LIMITADA',
  'ASOCIACION_PRODUCTORES',
  'COOPERATIVA_AGRARIA',
  'COMUNIDAD_CAMPESINA',
  'OTRO'
] as const;

export type TipoOrganizacion = (typeof TIPOS_ORGANIZACION)[number];

/**
 * Tipos de establecimientos físicos del ecosistema ganadero y cárnico.
 */
export const TIPOS_ESTABLECIMIENTO = [
  'ESTABLO',
  'CAMAL',
  'CENTRO_BENEFICIO',
  'FERIA_GANADERA',
  'CENTRO_ACOPIO',
  'ALMACEN_FRIGORIFICO',
  'PUNTO_VENTA',
  'OFICINA_ADMINISTRATIVA'
] as const;

export type TipoEstablecimiento = (typeof TIPOS_ESTABLECIMIENTO)[number];

/**
 * Usuario humano autenticado en el sistema.
 * Puede representar tanto a un ganadero independiente como al colaborador de una empresa o camal.
 */
export interface User {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  tipo_documento: TipoDocumentoIdentidad;
  numero_documento: string;
  telefono?: string;
  activo: boolean;
  email_verificado: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Organización o empresa comercial (titular de transacciones, lotes y facturación).
 */
export interface Organizacion {
  id: string;
  /**
   * Registro Único de Contribuyentes (RUC) ante la SUNAT (11 dígitos numéricos).
   * Opcional únicamente si es productor en proceso de formalización con PPA.
   */
  ruc?: string;
  razon_social: string;
  nombre_comercial?: string;
  /**
   * Padrón de Productores Agrarios (MIDAGRI - Perú).
   * Acredita al ganadero formal o de pequeña escala.
   */
  ppa_numero?: string;
  tipo_organizacion: TipoOrganizacion;
  direccion_fiscal?: string;
  ubigeo_fiscal?: UbigeoPerunano;
  verificada: boolean;
  activa: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Relación de pertenencia y permisos de un usuario dentro de una organización (RBAC dual).
 */
export interface UserOrgRol {
  id: string;
  user_id: string;
  organizacion_id: string;
  rol: RolOrganizacion;
  activo: boolean;
  fecha_asignacion: string;
  permisos_especificos?: string[];
}

/**
 * Contexto de sesión activa para alternancia dinámica de roles y organizaciones.
 * Permite que un usuario cambie de contexto (ej. Comprador en Organización A <-> Vendedor en Organización B)
 * sin requerir cuentas separadas ni reinicios de sesión.
 */
export interface ContextoOrganizacionActivo {
  user_id: string;
  organizacion_activa: Organizacion;
  rol_activo: RolOrganizacion;
  roles_disponibles: RolOrganizacion[];
  membresias: Array<{
    organizacion_id: string;
    razon_social: string;
    rol: RolOrganizacion;
  }>;
}

/**
 * Entidad física geolocalizada perteneciente a una organización (establo, camal, feria, etc.).
 * Diseñada para persistencia directa y consultas geoespaciales en PostgreSQL + PostGIS (ST_DWithin, ST_Distance).
 */
export interface Establecimiento {
  id: string;
  organizacion_id: string;
  codigo_establecimiento?: stri