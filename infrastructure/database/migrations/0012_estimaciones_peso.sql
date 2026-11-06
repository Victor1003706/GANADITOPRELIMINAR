-- Migración 0012: estimaciones orientativas de peso por lote y pesajes de balanza.
--
-- - La estimación de la IA es SIEMPRE informativa: un CHECK impide guardarla como
--   vinculante. La puja sigue siendo por el precio total del lote.
-- - No se guarda la imagen (consentimiento y tamaño): solo las medidas intermedias
--   (muestra), la incertidumbre y los controles de calidad, para auditar y calibrar.
-- - pesajes_balanza guarda el peso real de una muestra (etapa 2). Cada estimación
--   admite como máximo un pesaje; son los pares de evaluación del modelo.

CREATE TABLE IF NOT EXISTS estimaciones_peso (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES lotes_subasta(id) ON DELETE CASCADE,
  organizacion_id UUID NOT NULL REFERENCES organizaciones(id) ON DELETE RESTRICT,
  creado_por_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  identificador_animal VARCHAR(64),
  metodo VARCHAR(64) NOT NULL,
  version_parametros VARCHAR(64) NOT NULL,
  peso_estimado_kg NUMERIC(7, 1) NOT NULL CHECK (peso_estimado_kg > 0),
  rango_min_kg NUMERIC(7, 1) NOT NULL CHECK (rango_min_kg > 0),
  rango_max_kg NUMERIC(7, 1) NOT NULL,
  nivel_confianza NUMERIC(4, 3) NOT NULL CHECK (nivel_confianza > 0 AND nivel_confianza < 1),
  numero_vistas SMALLINT NOT NULL DEFAULT 1 CHECK (numero_vistas BETWEEN 1 AND 4),
  es_vinculante BOOLEAN NOT NULL DEFAULT FALSE CHECK (es_vinculante = FALSE),
  muestra JSONB NOT NULL,
  incertidumbre JSONB NOT NULL,
  calidad JSONB NOT NULL,
  advertencias JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key VARCHAR(128),
  huella_solicitud CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT estimaciones_peso_rango_ordenado
    CHECK (rango_min_kg <= peso_estimado_kg AND peso_estimado_kg <= rango_max_kg),
  CONSTRAINT estimaciones_peso_idempotencia_completa
    CHECK ((idempotency_key IS NULL) = (huella_solicitud IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_estimaciones_peso_lote ON estimaciones_peso(lote_id, created_at);
-- Idempotencia por lote: reintentar la misma solicitud no duplica la estimación.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estimaciones_peso_idempotencia
  ON estimaciones_peso(lote_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Un mismo animal identificado no se cuenta dos veces en el lote.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estimaciones_peso_animal
  ON estimaciones_peso(lote_id, identificador_animal) WHERE identificador_animal IS NOT NULL;

CREATE TABLE IF NOT EXISTS pesajes_balanza (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimacion_id UUID NOT NULL UNIQUE REFERENCES estimaciones_peso(id) ON DELETE CASCADE,
  peso_real_kg NUMERIC(7, 1) NOT NULL CHECK (peso_real_kg > 0 AND peso_real_kg <= 2000),
  perimetro_cinta_cm NUMERIC(5, 1) CHECK (perimetro_cinta_cm IS NULL OR (perimetro_cinta_cm > 0 AND perimetro_cinta_cm <= 400)),
  balanza_descripcion VARCHAR(200) NOT NULL CHECK (length(btrim(balanza_descripcion)) > 0),
  registrado_por_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  registrado_por_organizacion_id UUID NOT NULL REFERENCES organizaciones(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
