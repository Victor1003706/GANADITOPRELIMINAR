# PostgreSQL administrado para Ganadito

Este runbook prepara PostgreSQL 16 con PostGIS para un piloto real. No crea una cuenta en Neon ni una base remota: el propietario del servicio debe crear el proyecto, guardar las credenciales y copiar las URL como secretos del entorno.

## 1. Crear entornos independientes

Crear bases/proyectos distintos para desarrollo, staging y producción. No apuntar las pruebas contra staging ni producción. En Neon, habilitar la extensión PostGIS en la base antes de ejecutar el conjunto de migraciones si el proveedor no permite que la cree el rol de migración.

## 2. Crear roles distintos

Como administrador/propietario de la base, crear dos roles de inicio de sesión. Evitar compartirlos con personas y no incluir contraseñas en scripts versionados:

```sql
CREATE ROLE ganadito_migrator LOGIN;
CREATE ROLE ganadito_runtime LOGIN;
GRANT CONNECT ON DATABASE ganadito TO ganadito_migrator, ganadito_runtime;
GRANT USAGE, CREATE ON SCHEMA public TO ganadito_migrator;
GRANT USAGE ON SCHEMA public TO ganadito_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE ganadito_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ganadito_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE ganadito_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ganadito_runtime;
```

Establecer las contraseñas de forma interactiva con el cliente seguro del proveedor o su gestor de credenciales. El rol `ganadito_migrator` ejecuta el DDL y debe tener los permisos que el proveedor exige para PostGIS. La API usa `ganadito_runtime`; no se le concede `CREATE`, propiedad de esquema ni privilegios de administrador. Antes de abrir el piloto, conceder también al runtime sobre las tablas y secuencias ya creadas:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ganadito_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ganadito_runtime;
```

`schema_migrations` y el resto de objetos se crean con el usuario migrador. Si la plataforma separa el nombre de la base de su rol de propietario, adaptar `GRANT CONNECT` al nombre real. Confirmar permisos con el administrador del proveedor antes del primer despliegue.

## 3. Cargar secretos en el servidor

Configurar en el servicio API, no en Git:

- `DATABASE_URL`: cadena PostgreSQL del rol `ganadito_runtime`, con `sslmode=require` (o una validación TLS más estricta compatible con el proveedor).
- `DATABASE_POOL_MAX`: límite de conexiones según el tamaño de instancia/proveedor; valor inicial sugerido `8`.
- `DATABASE_MIGRATION_URL`: cadena del rol `ganadito_migrator`, solo en un job manual/automatizado de migraciones; no instalarla en el proceso web/API normal.
- `NODE_ENV=production`.
- `RUN_MIGRATIONS_ON_START=false` para mantener el proceso API sin privilegios de DDL.

Usar valores separados para staging y producción. No pegar secretos en el repositorio, tickets, logs, mensajes o archivos `.env.example`.

## 4. Aplicar migraciones

Desde una ejecución segura que tenga las mismas migraciones versionadas que el release y acceso de red a la base de destino:

```bash
npm ci
npm run db:migrate
```

En producción, el comando falla si falta `DATABASE_MIGRATION_URL` o no usa TLS. El API registra cada migración y su SHA-256 en `schema_migrations`, aplica un bloqueo de asesoría para evitar ejecuciones simultáneas y rechaza modificar una migración ya aplicada. Agregar siempre archivos SQL nuevos con prefijo numérico; nunca editar los ya aplicados.

El release inicial contiene las migraciones `0001` a `0016`, que incluyen identidad, organizaciones/roles, lotes, pujas, órdenes, pagos desactivados, trazabilidad, logística, eventos Outbox e índices espaciales. Revisar el contenido de cada migración y confirmar el inventario aplicado con el proveedor antes de actualizar una base existente.

## 5. Copias y recuperación

- Activar backups/snapshots administrados y definir retención/RPO/RTO de acuerdo con la operación.
- Antes de migraciones de alto impacto, confirmar snapshot reciente.
- Ejecutar una restauración periódica en una base aislada y guardar evidencia sin datos sensibles.
- Alertar por conexiones agotadas, latencia, errores de conexión y fallos de migración.
- Mantener el identificador del release y la versión de esquema juntos para evaluar rollback de aplicación.

## 6. Estado operativo (2026-11-06)

La instancia Neon del piloto está preparada en el proyecto `my-first-project`, rama `production`, base `neondb`.

- Se aplicaron las migraciones `0001` a `0016) desde este release; `schema_migrations` registra 16 nombres y checksums.
- Se verificaron 25 tablas del modelo, las extensiones `pgcrypto` y `postgis`, el índice espacial GiST y un cálculo de distancia.
- Las tablas previas de `public` se conservaron. El esquema adicional `ganadito` de la rama `ganadito-preview` es de otra versión y no sustituye al modelo canónico `public` de este monorepo.
- El servicio API de Vercel tiene `DATABASE_URL) configurada como secreto con el rol limitado `ganadito_runtime`. La API activa allí aún apunta al repositorio `Victor1003706/GANADITO`; no se debe asumir que el merge de este PR despliega `GANADITOPRELIMINAR`.

Antes de abrir la prueba piloto con este release, enlazar el servicio de despliegue con el repositorio y commit correctos, configurar su secreto de migración en un job aislado y verificar el endpoint de disponibilidad de base de datos. Confirmar también backups y restauración en el proveedor.

## 7. Puerta para el piloto

La base de producción ya tiene el esquema aplicado. La prueba piloto queda completa cuando el despliegue de este release usa la base y versión correctas, las credenciales de migración siguen separadas de la API, los backups están confirmados y el recorrido de usuario pasa sin errores.
