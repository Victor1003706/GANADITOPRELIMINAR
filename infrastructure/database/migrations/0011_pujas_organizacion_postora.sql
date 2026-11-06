-- Migración 0011: organización que puja y autor del lote.
-- La organización compradora de la orden debe ser la que estaba activa AL PUJAR,
-- no la que el usuario tenga activa en el momento del cierre.
ALTER TABLE subasta_pujas
  ADD COLUMN IF NOT EXISTS organizacion_postora_id UUID REFERENCES organizaciones(id) ON DELETE RESTRICT;

ALTER TABLE lotes_subasta
  ADD COLUMN IF NOT EXISTS organizacion_ganadora_id UUID REFERENCES organizaciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS creado_por_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
