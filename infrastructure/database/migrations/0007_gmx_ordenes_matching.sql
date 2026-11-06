-- Migración 0007: Bolsa de Valores Cárnica (GMX) — Libro de Órdenes y Matching Transaccional

CREATE TABLE IF NOT EXISTS gmx_ordenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creador_id UUID NOT NULL REFERENCES users(id),
  organizacion_id UUID NOT NULL REFERENCES organizaciones(id),
  tipo_operacion VARCHAR(10) NOT NULL CHECK (tipo_operacion IN ('COMPRA', 'VENTA')),
  producto VARCHAR(30) NOT NULL CHECK (producto IN ('MEDIA_CANAL', 'CUARTO_DELANTERO', 'CUARTO_TRASERO', 'CORTES_CALIBRADOS')),
  cantidad_kg NUMERIC(10,2) NOT NULL CHECK (cantidad_kg > 0),
  cantidad_restante_kg NUMERIC(10,2) NOT NULL CHECK (cantidad_restante_kg >= 0),
  precio_kilo_limite NUMERIC(10,2) NOT NULL CHECK (precio_kilo_limite > 0),
  estado VARCHAR(30) NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA', 'PARCIALMENTE_CALZADA', 'CALZADA', 'CANCELADA')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gmx_orderbook_compra
  ON gmx_ordenes(producto, precio_kilo_limite DESC, created_at ASC)
  WHERE estado IN ('ABIERTA', 'PARCIALMENTE_CALZADA') AND tipo_operacion = 'COMPRA';

CREATE INDEX IF NOT EXISTS idx_gmx_orderbook_venta
  ON gmx_ordenes(producto, precio_kilo_limite ASC, created_at ASC)
  WHERE estado IN ('ABIERTA', 'PARCIALMENTE_CALZADA') AND tipo_operacion = 'VENTA';

CREATE INDEX IF NOT EXISTS idx_gmx_ordenes_organizacion ON gmx_ordenes(organizacion_id);

CREATE TABLE IF NOT EXISTS gmx_calces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id UUID NOT NULL REFERENCES gmx_ordenes(id),
  orden_venta_id UUID NOT NULL REFERENCES gmx_ordenes(id),
  cantidad_kg NUMERIC(10,2) NOT NULL CHECK (cantidad_kg > 0),
  precio_pactado_kilo NUMERIC(10,2) NOT NULL CHECK (precio_pactado_kilo > 0),
  monto_total NUMERIC(12,2) NOT NULL CHECK (monto_total > 0),
  orden_comercial_id UUID NULL REFERENCES ordenes_compra(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gmx_calces_compra ON gmx_calces(orden_compra_id);
CREATE INDEX IF NOT EXISTS idx_gmx_calces_venta ON gmx_calces(orden_venta_id);
