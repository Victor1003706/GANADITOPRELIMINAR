-- Migración 0003: Módulo de Pagos y Transacciones de Pasarelas

CREATE TABLE IF NOT EXISTS pagos_transacciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE RESTRICT,
  monto NUMERIC(12, 2) NOT NULL,
  moneda VARCHAR(3) NOT NULL DEFAULT 'PEN',
  proveedor VARCHAR(50) NOT NULL,
  referencia_externa VARCHAR(255) UNIQUE,
  estado VARCHAR(30) NOT NULL DEFAULT 'INICIADO'
    CHECK (estado IN ('INICIADO', 'CONFIRMADO', 'FALLIDO', 'EN_CONCILIACION')),
  raw_webhook JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagos_transacciones_orden ON pagos_transacciones(orden_id);
CREATE INDEX IF NOT EXISTS idx_pagos_transacciones_ref_ext ON pagos_transacciones(referencia_externa);
CREATE INDEX IF NOT EXISTS idx_pagos_transacciones_estado ON pagos_transacciones(estado);
