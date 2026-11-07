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
CREATE TABLE IF NOT EXISTS lotes_subasta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_lote VARCHAR(50) NOT NULL UNIQUE,
  vendedor_id UUID NOT NULL REFERENCES organizaciones(id) ON DELETE RESTRICT,
  estado VARCHAR(50) NOT NULL DEFAULT 'BORRADOR',
  precio_base NUMERIC(14, 2) NOT NULL,
  precio_actual NUMERIC(14, 2) NOT NULL,
  incremento_minimo NUMERIC(12, 2) NOT NULL,
  postor_ganador_id UUID REFERENCES users(id) ON DELETE SET NULL,
  fecha_inicio TIMESTAMPTZ NOT NULL,
  fecha_cierre TIMESTAMPTZ NOT NULL,
  anti_sniping_seconds INT NOT NULL DEFAULT 60,
  anti_sniping_extension INT NOT NULL DEFAULT 120,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lotes_subasta_estado ON lotes_subasta(estado);
CREATE INDEX IF NOT EXISTS idx_lotes_subasta_cierre ON lotes_subasta(fecha_cierre) WHERE estado = 'ACTIVO';

-- Tabla de Pujas Registradas (Secuencia monótona e idempotencia)
CREATE TABLE IF NOT EXISTS subasta_pujas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES lotes_subasta(id) ON DELETE CASCADE,
  postor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  monto NUMERIC(14, 2) NOT NULL,
  secuencia INT NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_lote_secuencia UNIQUE (lote_id, secuencia),
  CONSTRAINT uq_lote_idempotency UNIQUE (lote_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_subasta_pujas_lote ON subasta_pujas(lote_id, secuencia DESC);

-- 5. RESILIENCIA, IDEMPOTENCIA Y PATRÓN TRANSACTIONAL OUTBOX

-- Tabla de Registro de Idempotencia de operaciones críticas
CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation VARCHAR(100) NOT NULL,
  key VARCHAR(255) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  status VARCHAR(50) NOT NULL,
  response_code INT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, operation, key)
);

-- Tabla de Eventos Outbox (Garantía de entrega At-Least-Once y desacoplamiento con colas/WebSockets)
CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN ('PENDIENTE', 'PROCESANDO', 'PROCESADO', 'DLQ')),
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMPTZ,
  lease_worker_id VARCHAR(100),
  lease_expires_at TIMESTAMPTZ,
  fencing_token INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_polling ON outbox_events(status, next_retry_at) WHERE status IN ('PENDIENTE', 'PROCESANDO');
