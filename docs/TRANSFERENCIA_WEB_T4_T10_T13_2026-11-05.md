# Transferencia temporal: web, tareas 4, 10 y 13 (2026-11-05)

**Autorización:** el 2026-11-05, Nicolás, que es el programador principal y tiene la decisión final según AGENTS.md §4, pidió expresamente en el chat completar las tareas 4, 10 y 13 de `GUIA_CODEX_VICTOR.md`.

**Editor temporal:** Claude, por encargo de Nicolás. Rama `feature/nicolas/web-ticket-pasaporte-publico`.

**Rutas de Víctor transferidas (solo para estas tareas):**
- `apps/web/src/routes/subastas/[id]/+page.svelte`, para la tarea 4: ticket del WebSocket.
- `apps/web/src/routes/trazabilidad/[id]/+page.svelte` y `.../publico/+page.svelte`, para las tareas 10 y 13: pasaporte público.
- `apps/web/src/lib/components/trazabilidad/{LineaTiempoEventos,FichaBovinoHeader,VistaPasaporte}.svelte` y `apps/web/src/lib/trazabilidad/pasaporte.ts`.
- `tests/e2e/fixtures.ts`, `tests/e2e/auctions.spec.ts` y `tests/e2e/map-trace.spec.ts`.

**No se transfieren:** los manifiestos npm, el lockfile, `.github` ni el despliegue.

**Condición de fin:** el PR queda verificado con la CI del SHA final. Después, la propiedad vuelve a Víctor, que puede revisar después de la unión y abrir un PR de corrección (`docs/OWNERSHIP.md`).

**Decisiones:**
- **Tarea 4.** Cada conexión y cada reconexión piden `POST /live/ticket` y abren con `?ticket=`; ya no se usa `?access_token=`.
- **Cierres `1008`:**
  - con «expirada», se reconecta de inmediato con un ticket nuevo;
  - con «ticket», se reintenta una sola vez;
  - en cualquier otro caso (revocada, sin contexto), se desconecta sin reintentar.
- **Otros cierres:** con `1011` o un corte de red, se reintenta con retroceso exponencial.
- **Pedido del ticket:** si responde `401`, `403` o `404`, no se abre ningún socket.
- **Tareas 10 y 13.**
  - La vista `PUBLICA` ahora **se muestra**: la ficha sin organización, los eventos con metadata redactada, «Autor reservado», **sin hashes** y la verificación de integridad hecha por el servidor (`/verificar`).
  - `/trazabilidad/:id/publico` es la ruta del QR. Siempre consulta **sin token**, aunque haya sesión, y rechaza una vista `COMPLETA`.
  - `/trazabilidad/:id` sin sesión también muestra la vista pública.
  - La validación quedó en un único módulo, `lib/trazabilidad/pasaporte.ts`, compartido por ambas rutas sin duplicar código.

## Ampliación: higiene del repositorio (2026-11-05)

Nicolás pidió expresamente una revisión completa del repositorio y la corrección de las fallas, mezclas y duplicados. Bajo esa autorización, el PR de higiene toca estas rutas de Víctor:
- `apps/web/src/lib/components/**`: se eliminan 19 componentes sin uso (unas 5.900 líneas) que fabricaban resultados de SUNAT, CAVALI, logística, mayorista, GMX y MINSA y prometían garantías. Ninguna ruta los importaba.
- `.github/workflows/ci.yml`: se quitan las variables `DB_*`, que no lee nadie.
- `apps/api/package.json`: el glob de pruebas va entre comillas.
- `.gitignore`.
- Avisos de documento histórico en los informes reemplazados de `docs/`, más correcciones en `docs/ARCHITECTURE.md`, `docs/OWNERSHIP.md`, el ADR 0001 y los README de los paquetes.
- La plantilla de variables de entorno queda **pendiente**: el hook local de Nicolás bloquea cualquier operación que la mencione, así que la sube él. Los cambios propuestos son:
  - el puerto de la IA pasa de 8000 a 8001;
  - se documentan las variables que el código sí lee;
  - se quitan las que no lee nadie.

**Condición de fin:** el PR se une con la CI en verde. Las rutas vuelven a Víctor, que puede revisar después de la unión.

## Ampliación: MVP v0.1.0 (2026-11-05)

Con la misma autorización de Nicolás («crea la primera versión del MVP»), el PR del catálogo toca estas rutas de Víctor:
- `apps/web/src/routes/subastas/+page.svelte` y el componente nuevo `apps/web/src/lib/components/subastas/CatalogoLotes.svelte`: catálogo, «Mis lotes» y detalle del lote en el formulario.
- `tests/e2e/{fixtures,auctions.spec,confirmation.spec}.t