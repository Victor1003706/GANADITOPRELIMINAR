-- Migración 0014: ámbito organizacional de las claves de idempotencia.
--
-- Decisión de Nicolás (2026-11-05): una Idempotency-Key reutilizada por el MISMO usuario
-- después de cambiar de organización activa es un CONFLICTO (409), no una repetición:
-- antes se devolvía la puja anterior, atribuida a otra organización.
-- Las filas anteriores quedan con organizacion_id NULL y se tratan como heredadas
-- (sin comprobación de contexto) para no romper reintentos en curso.

ALTER TABLE idempotency_records
  ADD COLUMN IF NOT EXISTS organizacion_id UUID REFERENCES organizaciones(id) ON DELETE SET NULL;
