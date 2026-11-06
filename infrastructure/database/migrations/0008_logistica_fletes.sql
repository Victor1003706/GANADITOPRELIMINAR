-- Migración 0008: Pasarela Logística Integrada (Ganadito Cargo & Express API)

CREATE TABLE IF NOT EXISTS transportistas_unidades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id UUID NOT NULL REFERENCES organizaciones(id),
  transportista_id UUID NOT NULL REFERENCES users(id),
  placa VARCHAR(15) UNIQUE NOT NULL,
  tipo_unidad VARCHAR(40) NOT NULL CHECK (tipo_unidad IN ('CAMION_JAULA_SIMPLE', 'CAMION_JAULA_DOBLE_PISO', 'FURGON_ISOTERMICO_REFRIGERADO', 'FURGON_SECO')),
  capacidad_toneladas NUMERIC(6,2) NOT NULL CHECK (capacidad_toneladas > 0),
  capacidad_cabezas INT NULL,
  tiene_termoregistrador BOOLEAN NOT NULL DEFAULT FALSE,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transportistas_unidades_transportista ON transportistas_unidades(transportista_id);
CREATE INDEX IF NOT EXISTS idx_transportistas_unidades_org ON transportistas_unidades(organizacion_id);

CREATE TABLE IF NOT EXISTS fletes_solicitudes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id UUID NULL REFERENCES ordenes_compra(id),
  solicitante_id UUID NOT NULL REFERENCES users(id),
  origen_establecimiento_id UUID NOT NULL REFERENCES establecimientos(id),
  destino_establecimiento_id UUID NOT NULL REFERENCES establecimientos(id),
  tipo_carga VARCHAR(30) NOT NULL CHECK (tipo_carga IN ('GANADO_EN_PIE', 'CARNE_CANAL', 'INSUMOS_GRANOS')),
  peso_toneladas NUMERIC(6,2) NOT NULL CHECK (peso_toneladas > 0),
  distancia_km NUMERIC(8,2) NOT NULL CHECK (distancia_km >= 0),
  costo_flete_bruto NUMERIC(10,2) NOT NULL CHECK (costo_flete_bruto > 0),
  comision_referral_fee NUMERIC(10,2) NOT NULL CHECK (comision_referral_fee >= 0),
  total_flete NUMERIC(10,2) NOT NULL CHECK (total_flete > 0),
  unidad_id UUID NULL REFERENCES transportistas_unidades(id),
  transportista_id UUID NULL REFERENCES users(id),
  estado VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE_ASIGNACION' CHECK (estado IN ('PENDIENTE_ASIGNACION', 'ASIGNADO', 'EN_TRANSITO', 'ENTREGADO', 'CANCELADO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fletes_solicitudes_estado ON fletes_solicitudes(estado);
CREATE INDEX IF NOT EXISTS idx_fletes_solicitudes_transportista ON fletes_solicitudes(transportista_id);
CREATE INDEX IF NOT EXISTS idx_fletes_solicitudes_solicitante ON fletes_solicitudes(solicitante_id);
