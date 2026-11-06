# Solicitud de revisión de Víctor

> **Documento histórico.** Su estado fue reemplazado por [ACTA_ACEPTACION_V01_V06.md](ACTA_ACEPTACION_V01_V06.md) (PR #53) y por los PR #54–#58. Se conserva como evidencia; no describe el estado actual.

Repositorio de destino: `Nicolas923-source/Ganadito`. Base del plan: `dde293b`.

## PR de dependencias

Rama: `feature/victor/dependencias-web`, destino `main`.

Título propuesto: **build: preparar dependencias web de Víctor y compatibilidad TypeScript**.

Incluye manifiestos y lockfile, Playwright, adapter-node y TypeScript 6 requerido por SvelteKit 3 ya presente en la base. La configuración raíz explicita raíz de compilación/tipos Node y rutas relativas para mantener los workspaces compatibles. Conserva los scripts de `main`; los scripts nuevos se añaden con sus implementaciones en la entrega web dependiente. La rama se instaló, verificó y compiló por separado y su CI está aprobada: [PR #35](https://github.com/Nicolas923-source/Ganadito/pull/35).

## PR de interfaz e integración V01-V06

Rama: `feature/victor/v01-v06-interfaz`, destino inicial `feature/victor/dependencias-web`.

Título propuesto: **feat(web): conectar acceso, lotes y consultas con estados oficiales**.

La web base sustituía errores de API por datos demo y no tenía acceso/contexto real. Ahora dispone de cliente y proxy REST, sesión validada contra `me`, selección de membresía, publicación/consulta por ID, pujas idempotentes y snapshot tras reconexión. Mapa, Spot y pasaporte consultan las rutas existentes y rechazan respuestas malformadas. La vista de órdenes identifica el aviso recibido, pero requiere la futura consulta autorizada para confirmar su estado. Los pagos y módulos posteriores permanecen deshabilitados.

Rutas permitidas: web, pruebas navegador, despliegue, documentación no API, configuración raíz y CI. No hay cambios de backend, contratos, SQL, seeds o servicios comunes. Los DTO web describen el transporte observado en la base; su aprobación/publicación sigue correspondiendo a Nicolás. [Inventario y solicitudes](CONTRACT_REVIEW.md).

Validación del conjunto final: instalación reproducible, typecheck, build, 3 pruebas unitarias web, 2 pruebas del proxy compilado y 24 Chromium con respuestas controladas. Se verificó la salida Node de producción en localhost y el error 502 cuando la API no está disponible. No se acredita con fixtures la persistencia ni el aislamiento real de organizaciones. [Evidencia](VALIDATION_VICTOR.md).

**Estado: borrador pendiente de Nicolás, CI remota y prueba conjunta con API real.** No fusionar automáticamente. La entrega agrupa los cambios interdependientes de interfaz; revisar por V01-V06 y dividirla antes de integrar si el revisor lo solicita. Los bloqueos N01/N02/N04/N05, lectura de órdenes y contratos se resuelven en PR de Nicolás, conservando su propiedad de archivos.

## Publicación

El 4 de noviembre de 2026 el usuario completó la autenticación de Git con Git Credential Manager. La publicación usa esa cuenta autorizada. La aplicación conectada sigue sin permiso de escritura en el repositorio de Nicolás; puede leer el código y la CI. No se cambiaron permisos ni reglas de `main`, y las credenciales no se escribieron en el repositorio.

```powershell
git push -u origin feature/victor/dependencias-web
git push -u origin feature/victor/v01-v06-interfaz
```

Abrir ambos PR como borradores y solicitar revisión cruzada de Nicolás. No aprobar la propia entrega ni activar producción.

La instalación de la aplicación conectada observada pertenece solo a `Victor1003706`; para habilitar también la vía de escritura del plugin sobre repositorios de Nicolás, el propietario debe autorizar una instalación con acceso a ese repositorio. Esto no impide publicar con el Git que el usuario ya autenticó.

Una copia transferible se genera en `tmp/handoff/Ganadito_Victor.bundle` con las dos ramas y el historial necesario. Puede inspeccionarse con `git bundle verify <archivo>` y usarse como origen de `git fetch` en otro clon. No contiene `.env`, credenciales, `node_modules` ni artefactos de navegador. Los resultados de CI y la aprobación humana se consultan en cada PR; un borrador publicado no acredita aceptación final.
