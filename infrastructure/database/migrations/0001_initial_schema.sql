-- ==============================================================================
-- GANADITO — MIGRACIÓN 0001: ESQUEMA RELACIONAL Y CANÓNICO INICIAL
-- ==============================================================================

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 2. IDENTIDAD Y CONTEXTO ORGANIZACIONAL (RBAC DUAL)

-- Tabla de Organizaciones (empresas, cooperativas, personas con negocio, titulares comerciales)
CREATE TABLE IF NOT EXISTS organizaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  razon_social VARCHAR(255) NOT NULL,
  ruc VARCHAR(11) UNIQUE,
  ppa VARCHAR(50),
  estado VARCHAR(50) NOT NULL DEFAULT 'ACTIVA',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabla de Usuarios (cuentas individuales)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  telefono VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabla de Pertenencia y Roles Organizacionales (RBAC dual y alternancia de contexto)
CREATE TABLE IF NOT EXISTS user_organizaciones_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organizacion_id UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
  rol VARCHAR(50) NOT NULL CHECK (rol IN ('COMPRADOR', 'VENDEDOR', 'OPERADOR_CAMAL', 'TRANSPORTISTA', 'ADMIN', 'AUDITOR', 'OPERADOR')),
  permisos JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active_context BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, organizacion_id, rol)
);

CREATE INDEX IF NOT EXISTS idx_user_org_roles_user ON user_organizaciones_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_org_roles_org ON user_organizaciones_roles(organizacion_id);

-- 3. MAPA Y PIZARRAS SPOT

-- Tabla de Establecimientos físicos georreferenciados (establos, camales, ferias, etc.)
CREATE TABLE IF NOT EXISTS establecimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
  nombre_comercial VARCHAR(255) NOT NULL,
  tipo VARCHAR(50) NOT NULL,
  coordenadas GEOGRAPHY(POINT, 4326) NOT NULL,
  direccion_texto VARCHAR(255) NOT NULL,
  ubigeo VARCHAR(6) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice GiST para consultas espaciales en PostGIS (ST_DWithin, ST_Distance)
CREATE INDEX IF NOT EXISTS idx_establecimientos_spatial ON establecimientos USING GIST(coordenadas);
CREATE INDEX IF NOT EXISTS idx_establecimientos_org ON establecimientos(organizacion_id);
CREATE INDEX IF NOT EXISTS idx_establecimientos_ubigeo ON establecimientos(ubigeo);

-- Tabla de Cotizaciones de la Pizarra Spot
CREATE TABLE IF NOT EXISTS cotizaciones_spot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establecimiento_id UUID REFERENCES establecimientos(id) ON DELETE SET NULL,
  producto VARCHAR(50) NOT NULL,
  categoria VARCHAR(50) NOT NULL,
  calidad VARCHAR(50) NOT NULL,
  unidad_medida VARCHAR(50) NOT NULL,
  moneda VARCHAR(10) NOT NULL DEFAULT 'PEN',
  precio_unitario NUMERIC(12, 2) NOT NULL,
  procedencia_ubigeo VARCHAR(6) NOT NULL,
  fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vigencia_hasta TIMESTAMPTZ NOT NULL,
  verificado BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice compuesto B-tree optimizado para consultas de pizarra y mapa
CREATE INDEX IF NOT EXISTS idx_cotizaciones_spot_search ON cotizaciones_spot(producto, vigencia_hasta DESC, establecimiento_id);

-- 4. MOTOR DE SUBASTAS E INTEGRIDAD TRANSACCIONAL

-- Tabla de Lotes en Subasta (PostgreSQL como única autoridad transaccional)
CREATE TABLE IF NOT EXISTS