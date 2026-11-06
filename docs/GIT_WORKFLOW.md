# Ramas, revisión e integración

Un repositorio oficial, dos clones y una rama por tarea. Víctor coordina la cola de PR. La [matriz de propiedad](OWNERSHIP.md) y sus excepciones se aplican también cuando una rama está aislada: Git no bloquea la edición de rutas ajenas.

**Actualización vigente (5 de noviembre de 2026):** #45 actualizó AGENTS/OWNERSHIP: Nicolás decide la integración, con revisión de Claude y CI obligatoria; las correcciones posteriores van en PR nuevo. Las referencias siguientes a PR apilados, reglas de aprobación y método merge describen el procedimiento anterior y deben contrastarse con ese acuerdo y los ajustes actuales. #37/#44 y #46–#50 ya están integrados por otras acciones. La entrega V05 nueva parte de main `5b73e470`; Codex no fusiona, no despliega y no aprueba su propio código. La delegación de Víctor permite aprobar únicamente cambios ajenos realmente revisados, sin bloqueantes y con CI exacta verde.

## Empezar una tarea

```bash
git switch main
git pull --ff-only origin main
git switch -c codex/victor/v01-base-web
```

Usar nombres de tarea, por ejemplo `codex/victor/v06-navegador` o `feature/nicolas/n01-arranque-api`, sin ramas personales permanentes. Registrar editor, rutas permitidas, contrato y aceptación antes de editar. Si una ruta no está asignada, documentar una reserva temporal con su responsable y condición de fin; una petición de cambio no autoriza editarla.

## Separar entregas

1. Nicolás publica el PR de contrato y ejemplos; Víctor lo revisa contra las necesidades de la pantalla. Integrarlo antes de cambios dependientes.
2. Víctor publica dependencias en PR separado, con manifiestos y lockfile coherentes. Nicolás solicita biblioteca, versión y motivo antes de instalar. Tras integrarlo, ambos actualizan ramas y ejecutan `npm ci`.
3. Víctor publica integración (scripts, variables, CI y documentación) separada del backend. Nicolás revisa los paquetes afectados.
4. Cada autor implementa su entrega en sus rutas; cada autor corrige sus hallazgos. Ver [cola completa](VICTOR_DELIVERY.md).

Los datos de ejemplo se identifican y se aíslan del modo operativo. El frontend no modifica API, SQL o contratos para desbloquearse ni confirma decisiones comerciales sin respuesta del servidor.

## Comprobar antes de commit y PR

```bash
git status --short
git diff
git diff --cached
git diff --name-only origin/main...HEAD
```

La comparación entre ramas muestra lo confirmado; `status` y `diff` también detectan trabajo pendiente. Comparar todas las rutas con el alcance autorizado y preparar solo las de la tarea:

```bash
git add ruta/al/archivo
git diff --cached
git commit -m "feat: conectar consulta de lote al snapshot oficial"
```

Usar Conventional Commits (`feat`, `fix`, `docs`, `test`, `chore`, `ci`, `refactor`, `perf`) y explicar el cambio concreto. Nunca incluir `.env`, JWT, tokens, claves, datos personales ni dumps.

## Verificar y publicar

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
git push -u origin codex/victor/v01-base-web
```

Ejecutar checks pertinentes con los servicios de prueba requeridos; registrar fallidos o no ejecutados. Instalar Chromium antes del primer e2e según [DEVELOPMENT.md](DEVELOPMENT.md). El PR usa la [plantilla](../.github/PULL_REQUEST_TEMPLATE.md) e incluye objetivo, rutas, contrato, dependencias, pruebas y limitaciones.

| Autor | Revisor del código final |
|---|---|
| Víctor + Codex | Nicolás + Claude Code |
| Nicolás + Claude Code | Víctor + Codex |

Nadie aprueba su entrega. No editar la rama del compañero mientras trabaja. La revisión automática o de un asistente no sustituye la revisión cruzada. Un e2e con fixtures no demuestra integración API real.

Las guías iniciales entregadas por Víctor el 4 de noviembre de 2026 reservaban **Approve** a la persona revisora. Después, el propietario autorizó expresamente en este chat que Codex registre aprobaciones de cambios de Nicolás ya revisados y comprobados, para ahorrar tiempo. Esa decisión posterior tiene prioridad sobre la guía: se fija el SHA, se comprueban diff, pruebas y CI exacta y se conserva el alcance de la revisión. Un `COMMENT` favorable no cuenta como aprobación formal. No aprobar PR propios ni dependencias bloqueadas; una CI verde no acredita funcionamiento universal. Esta delegación no autoriza fusionar PR ni desplegar. No duplicar commits heredados por otra rama.

## Integrar uno por uno

Exigir CI aprobada del SHA final, conversaciones resueltas, revisión cruzada y evidencia web + API cuando corresponda. No hacer push directo a `main`. Las protecciones de GitHub deben comprobarse en el repositorio; este documento no las activa ni afirma que estén configuradas.

Orden de la guía: **#27 → #25 → #28 → #26 → #30 → #31 → #32 → #33 → #34**; #35 → #36 se revisan en paralelo y #37 verifica la integración completa sobre N05. Cada paso depende de resolver sus hallazgos: la posición en la lista no autoriza fusionar un PR bloqueado. Usar **Create a merge commit** para conservar los commits compartidos y los PR apilados. La persona responsable comprueba la base real del PR siguiente después de cada fusión.

Estado comprobado: ruleset `reglas-main` (`26218842`) activo, una aprobación y resolución de conversaciones. Su lista `required_status_checks` está vacía, por lo que la guía exige comprobar manualmente `Validar Monorepo` en verde; no asumir que GitHub impone ese nombre de check. `dismiss_stale_reviews_on_push=false`: si cambia el SHA, revisar el diff y repetir checks aunque GitHub conserve una aprobación anterior. El método merge es la política acordada; no se cambiaron ajustes ni permisos del repositorio.

Los PR de Nicolás #30–#34 todavía usan el workflow de sus bases, filtrado hacia `main`; carecen de CI individual. La rama de Víctor ya quitó ese filtro y prueba el conjunto en #37. La evidencia integrada no reemplaza los checks del SHA que se vaya a fusionar. El [registro de revisión](REVIEW_NICOLAS_2026-11-04.md) distingue ambos niveles y fija los SHA revisados.

Víctor coordina primero contratos/dependencias, después backend y por último conexión final web. Una web aislada puede integrarse antes si no rompe el modo operativo y declara sus dependencias. Tras cada fusión, el autor del siguiente PR incorpora la versión actual:

```bash
git fetch origin
git merge origin/main
```

Repetir checks afectados y revisar el diff final. Resolver conflictos con ambos responsables; no seleccionar automáticamente un archivo completo para ganar el conflicto. Si una rama publicada requiere reescribir historia, coordinarlo primero; no usar force-push como solución rutinaria.

## Secretos expuestos

Revocar o rotar primero el secreto comprometido, coordinar el incidente con el propietario y comprobar el alcance. Borrar el archivo en otro commit no elimina el secreto del historial. Cualquier limpieza de historial, force-push o restauración de datos requiere coordinación y autorización explícita; no improvisar esos comandos desde una corrección web.

## Cierre

La tarea se cierra cuando coinciden autor/rutas, contrato y dependencias están identificados, pruebas y CI pasan, no hay bloqueantes y el compañero revisó el código final. Si conecta pantalla y API, probarlas juntas con datos ficticios. Registrar cambios de entorno/esquema y recuperación en [staging](../infrastructure/deployment/README.md). Pagos reales y servicios externos no habilitados permanecen desactivados.
