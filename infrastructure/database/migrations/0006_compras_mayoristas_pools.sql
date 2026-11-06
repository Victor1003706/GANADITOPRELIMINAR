-- Migración 0006: Compras Mayoristas, Demand Pooling B2B y Ofertas Flash

CREATE TABLE IF NOT EXISTS pools_compra_mayorista (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creador_id UUID NOT NULL REFERENCES users(id),
  organizacion_id UUID NOT NULL REFERENCES organizaciones(id),
  tipo_producto VARCHAR(50) NOT NULL CHECK (tipo_producto IN ('INSUMO_AGRICOLA', 'GRANO_FORRAJE', 'MEDIAS_CANALES', 'CUARTOS_COMPENSADOS', 'CORTES_CALIBRADOS', 'EQUIPAMIENTO_SANITARIO')),
  titulo VARCHAR(150) NOT NULL,
  descripcion TEXT NOT NULL,
  precio_unitario_mayorista NUMERIC(12,2) NOT NULL CHECK (precio_unitario_mayorista > 0),
  meta_volumen NUMERIC(10,2) NOT NULL CHECK (meta_volumen > 0),
  volumen_acumulado NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (volumen_acumulado >= 0),
  unidad_medida VARCHAR(20) NOT NULL CHECK (unidad_medida IN ('KG', 'TONELADA', 'UNIDAD', 'SACO_50KG')),
  fecha_limite TIMESTAMPTZ NOT NULL,
  estado VARCHAR(30) NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO', 'ALCANZADO', 'EXPIRADO_FALLIDO', 'CERRADO_ORDENADO', 'CANCELADO')),
  es_oferta_flash BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pools_activos ON pools_compra_mayorista(estado, fecha_limite) WHERE estado = 'ABIERTO';
CREATE INDEX IF NOT EXISTS idx_pools_tipo ON pools_compra_mayorista(tipo_producto);
CREATE INDEX IF NOT EXISTS idx_pools_org ON pools_compra_mayorista(organizacion_id);

CREATE TABLE IF NOT EXISTS pool_participaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES pools_compra_mayorista(id) ON DELETE RESTRICT,
  comprador_id UUID NOT NULL REFERENCES users(id),
  organizacion_compradora_id UUID NOT NULL REFERENCES organizaciones(id),
  cantidad NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
  monto_total NUMERIC(12,2) NOT NULL CHECK (monto_total > 0),
  estado VARCHAR(30) NOT NULL DEFAULT 'RESERVADO' CHECK (estado IN ('RESERVADO', 'CONFIRMADO', 'REEMBOLSADO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_pool_organizacion UNIQUE (pool_id, organizacion_compradora_id)
);

CREATE INDEX IF NOT EXISTS idx_participaciones_pool ON pool_participaciones(pool_id);
CREATE INDEX IF NOT EXISTS idx_participaciones_comprador ON pool_participaciones(comprador_id);
