# Ganadito

Plataforma de comercio ganadero para Perú, construida como **monolito modular**:
- SvelteKit/TypeScript en `apps/web`;
- Fastify/TypeScript en `apps/api`;
- contratos en `packages/contracts`;
- un satélite de IA FastAPI en `services/ai-satellite`;
- **PostgreSQL 16 + PostGIS 3.4** como autoridad transaccional;
- Redis solo como apoyo (difusión de eventos y presencia).

## MVP v0.1.0: qué incluye

El recorrido principal funciona de punta a punta, con la API y PostgreSQL reales:

**acceso con organización y rol → publicar un lote → catálogo → pujar (en vivo) → cierre automático → orden pendiente de pago**

| Módulo | Estado en v0.1.0 |
|---|---|
| Acceso y contexto | Registro, login, cambio de organización y rol, sesión validada por el servidor |
| Lotes | Publicación con detalle (cantidad, categoría, raza, descripción y origen), catálogo público y «Mis lotes» |
| Pujas | REST idempotente (con clave por organización), anti-sniping y **sala en vivo** por WebSocket con ticket de un solo uso. La puja es por el **precio total del lote** |
| Cierre y órdenes | El worker cierra y crea la orden `PENDIENTE_PAGO`. Los **pagos están apagados** |
| Mapa y Spot | Establecimientos y cotizaciones. Un establo ajeno se muestra en **ubicación aproximada** (Ley 29733) |
| Trazabilidad | Pasaporte bovino con cadena SHA-256: vista completa para el dueño y vista pública para el QR (`/trazabilidad/:id/publico`) |
| IA de peso | Estimación **orientativa y no vinculante** con rango e incertidumbre (API). La pantalla de captura de fotos aún no está en la web |
| GMX, mayorista, logística, SUNAT y CAVALI | Están en la API, pero en la web figuran como etapas posteriores. SUNAT y CAVALI son **simuladores apagados** (`TAX_INTEGRATIONS_ENABLED=false`) |

La aceptación del flujo V01–V06 está en [docs/ACTA_ACEPTACION_V01_V06.md](docs/ACTA_ACEPTACION_V01_V06.md), con la excepción E1: **no se despliega fuera de la CI** hasta tener un staging con una recuperación probada.

## Levantar el MVP en local

Requisitos: Node según [.nvmrc](.nvmrc), Docker (para PostgreSQL y Redis) y, opcionalmente, Python 3.12 para la IA.

1. Instala las dependencias desde la raíz:
   ```bash
   npm ci
   ```
2. Levanta PostgreSQL/PostGIS y Redis:
   ```bash
   docker compose -f infrastructure/docker/compose.yaml up -d
   ```
3. Crea tu configuración local a partir de la plantilla de ejemplo de la raíz (`.env.example`): cópiala como `.env` y deja `RUN_MIGRATIONS_ON_START=true` y `START_WORKERS=true`, porque sin el worker los lotes no se cierran.
4. Carga los datos de demostración (ficticios):
   ```bash
   npm run seed
   ```
5. Arranca la API, que escucha en el puerto 4000 y aplica las migraciones pendientes:
   ```bash
   npm run dev:api
   ```
6. En otra terminal, arranca la web en el puerto 3000:
   ```bash
   npm run dev:web
   ```
7. (Opcional) Arranca el satélite de IA en el puerto 8001:
   ```bash
   cd services/ai-satellite && python -m pip install -r requirements.txt && python run.py
   ```

Abre `http://127.0.0.1:3000`. Los usuarios de demostración y su contraseña local aparecen al final del `npm run seed`. **Fuera de local, el seed exige `SEED_PASSWORD`.**

## Validación

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
npm run test:e2e:http
npm run test:config
```

Los tests backend requieren PostgreSQL/PostGIS y Redis aislados. `test:e2e` y `test:e2e:http` usan fixtures identificados; `test:config` comprueba el entorno sin conectar a servicios. `test:e2e:real` es una suite separada con API y persistencia reales que la CI ejecuta únicamente sobre PostGIS/Redis efímeros, con guardias de destino y pagos apagados. Su [configuración aislada](docs/DEVELOPMENT.md#navegador-con-api-y-persistencia-reales-en-ci) rechaza destinos remotos o distintos del destino de prueba permitido; no usar bases compartidas, el PostgreSQL local existente ni Ne