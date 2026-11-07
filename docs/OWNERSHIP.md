# Propiedad de archivos y reservas

Base del acuerdo: plan de programación Víctor + Nicolás, páginas 2 y 3; código revisado `dde293bc977ac090d631b6c90a2cb4bb6efcb40e`. Cada tarea tiene un editor, rutas permitidas, contrato y criterio de aceptación. Las excepciones de esta tabla tienen prioridad sobre las carpetas generales.

| Rutas | Editor | Alcance |
|---|---|---|
| `apps/web/**` | Víctor | Pantallas, componentes, sesión, cliente HTTP y WebSocket. |
| `tests/e2e/**` | Víctor | Navegador; datos y comandos de API coordinados con Nicolás. |
| `infrastructure/deployment/**` | Víctor | Preparación de staging y recuperación; producción requiere habilitación separada. |
| `README.md`, `AGENTS.md`, `docs/**` salvo `docs/api/**` | Víctor | Acuerdos, instrucciones y evidencia; revisión de Nicolás. |
| Todos los `package.json` y `package-lock.json` | Víctor | Manifiestos y lockfile coherentes, en PR de dependencias separado. |
| `.github/workflows/**`, `tsconfig.base.json`, configuración raíz y `.env.example` | Víctor | Integración y variables sin secretos, revisadas por Nicolás. |
| `.github/PULL_REQUEST_TEMPLATE.md` | Víctor | Reserva de integración V06 para describir editor, contrato, pruebas y revisión; finaliza al integrar o retirar el PR. |
| `apps/api/**` | Nicolás | Arranque, auth, rutas, servicios, Redis, workers y pruebas backend. |
| `infrastructure/database/**`, `infrastructure/docker/**` | Nicolás | Migraciones, seeds y servicios locales; una sola cola de cambios SQL. |
| `packages/contracts/src/**`, `docs/api/**` | Nicolás | Contratos y ejemplos, acordados antes de implementar cambios dependientes. |
| `packages/shared/**`, `packages/config/**` | Nicolás | Utilidades y configuración compartida; consultar impacto en frontend. |
| `services/ai-satellite/**` | Nicolás | IA de peso (V1) real y orientativa; video y CIELAB marcados como simulados o sin validar. |

Ejemplos sensibles: `app.ts`, `index.ts`, `db.ts` y módulos de API pertenecen a Nicolás; `+layout.svelte`, `app.css` y componentes globales web pertenecen a Víctor. La excepción de manifiestos npm se aplica también dentro de carpetas de Nicolás.

## Registro por tarea

Antes de comenzar, registrar en el PR o en la tabla siguiente el editor y el alcance exacto. Una ruta sin asignación necesita una reserva documentada. Solicitar un cambio no autoriza a editar el archivo del compañero.

| Entrega | Editor | Rutas reservadas | Vigencia | Dependencia / revisión |
|---|---|---|---|---|
| V01-V05, interfaz inicial | Víctor | `apps/web/**` | Desarrollo y corrección de la entrega; termina al integrar o retirar su PR | Contratos existentes inventariados en [CONTRACT_REVIEW.md](CONTRACT_REVIEW.md); Nicolás revisa. |
| Dependencias de V06 | Víctor | Manifiestos npm y lockfile | PR de dependencias, previo a integración | Nicolás valida paquetes afectados. |
| V06, navegador | Víctor | `tests/e2e/**` | PR de pruebas e integración | Fixtures explícitos; API real pendiente de N01 y contratos de lectura. |
| V06, documentación y CI | Víctor | Documentación asignada, `.github/workflows/**`, plantilla de PR, `infrastructure/deployment/**` | PR de integración; revisión de Nicolás antes de fusión | No modifica backend, contratos ni migraciones. |
| V05, privacidad autorizada | Víctor/Codex, temporal | `apps/api/src/trazabilidad/trazabilidad.service.ts`, `apps/api/src/mapa/mapa.types.ts`, `packages/contracts/src/traceability.ts`, `docs/api/contrato-v1-consulta.md` y pruebas específicas | Desde autorización expresa hasta entregar PR verificado; ver [registro](TRANSFERENCIA_V05_2026-11-04.md) | PUBLICA sin hashes; originales de Nicolás #46/#50 adoptados. La entrega corrige dirección nullable del tipo cercano y añade pruebas backend complementarias; Nicolás revisa. |

Una transferencia debe indicar tarea, rutas, editor temporal, inicio y condición de fin. Pausar las ramas que editen esos archivos, transferir sus pruebas y resolver los cambios pendientes antes de devolver la propiedad. La excepción V05 consta autorizada expresamente por el propietario; no constituye una transferencia general de backend a Víctor.

## Comprobación de propiedad

Revisar las tres vistas antes de publicar:

```bash
git status --short
git diff --name-only
git diff --cached --name-only
git diff --name-only origin/main...HEAD
```

Comparar cada ruta con esta matriz y con el alcance del PR, incluidas las excepciones. CI valida código y navegador; **no bloquea automáticamente edición por propietario**. El login de quien abre un PR o una etiqueta no demuestra quién editó cada archivo. Una comprobación automática futura debe acordar identidad, reservas y excepciones antes de convertirse en un check obligatorio.

Nadie aprueba su propia entrega. Desde el 2026-11-04, por decisión de Nicolás, que es el programador principal y tiene la decisión final:

- `main` no exige aprobación en GitHub;
- **Claude revisa cada PR por encargo de Nicolás** antes de unirlo con squash: revisión crítica con evidencia, más la CI obligatoria en verde;
- lo que falte corregir va en un **PR nuevo**;
- Víctor, el programador secundario, puede revisar después de la unión y abrir PR de corrección.

Un check verde por sí solo no sustituye la revisión.
