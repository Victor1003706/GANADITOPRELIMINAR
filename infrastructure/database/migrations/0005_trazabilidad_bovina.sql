-- Migración 0005: Trazabilidad Bovina, Pasaporte Digital y Cadena Inmutable de Eventos

CREATE TABLE IF NOT EXISTS bovinos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_arete VARCHAR(50) UNIQUE NOT NULL,
  organizacion_id UUID NOT NULL REFERENCES organizaciones(id),
  raza VARCHAR(50),
  sexo VARCHAR(10) NOT NULL CHECK (sexo IN ('MACHO', 'HEMBRA')),
  fecha_nacimiento DATE,
  estado VARCHAR(30) NOT NULL DEFAULT 'VIVO' CHECK (estado IN ('VIVO', 'FAENADO', 'DECESO', 'TRANSFERIDO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bovinos_organizacion ON bovinos(organizacion_id);
CREATE INDEX IF NOT EXISTS idx_bovinos_estado ON bovinos(estado);

CREATE TABLE IF NOT EXISTS pasaporte_bovino_events (
  id BIGSERIAL PRIMARY KEY,
  bovino_id UUID NOT NULL REFERENCES bovinos(id) ON DELETE CASCADE,
  secuencia INT NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash CHAR(64) NOT NULL,
  current_hash CHAR(64) NOT NULL,
  autor_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bovino_secuencia UNIQUE (bovino_id, secuencia)
);

CREATE INDEX IF NOT EXISTS idx_pasaporte_bovino_lookup ON pasaporte_bovino_events(bovino_id, secuencia ASC);
CREATE INDEX IF NOT EXISTS idx_pasaporte_bovino_autor ON pasaporte_bovino_events(autor_id);
