-- Migración 0004: Liquidaciones Neta al Vendedor (Settlement & Payout)

ALTER TABLE organizaciones ADD COLUMN IF NOT EXISTS cuenta_bancaria_cci CHAR(20);

CREATE TABLE IF NOT EXISTS liquidaciones_vendedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id UUID UNIQUE NOT NULL REFERENCES ordenes_compra(id),
  vendedor_id UUID NOT NULL REFERENCES users(id),
  organizacion_vendedora_id UUID NOT NULL REFERENCES organizaciones(id),
  monto_bruto NUMERIC(12, 2) NOT NULL,
  comision_retenida NUMERIC(12, 2) NOT NULL,
  monto_neto_pagar NUMERIC(12, 2) NOT NULL,
  cuenta_bancaria_cci CHAR(20),
  estado VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE_DISPERSION'
    CHECK (estado IN ('PENDIENTE_DISPERSION', 'DISPERSADO', 'FALLIDO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liquidaciones_vendedores_orden ON liquidaciones_vendedores(orden_id);
CREATE INDEX IF NOT EXISTS idx_liquidaciones_vendedores_org ON liquidaciones_vendedores(organizacion_vendedora_id);
CREATE INDEX IF NOT EXISTS idx_liquidaciones_vendedores_vendedor ON liquidaciones_vendedores(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_liquidaciones_vendedores_estado ON liquidaciones_vendedores(estado);
