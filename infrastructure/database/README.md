# infrastructure/database

Directorio destinado a esquemas SQL, scripts de migración y datos semilla (seeds) no sensibles.

> [!NOTE]
> Migraciones en `migrations/` (0001–0016), aplicadas en orden y registradas con checksum
> SHA-256 en `schema_migrations` (ver `apps/api/src/db.ts`). Una migración aplicada no se
> edita: los cambios van en una migración nueva.

Para crear roles separados, configurar PostGIS, aplicar migraciones y planificar copias/recuperación en una base administrada, seguir [PRODUCCION.md](PRODUCCION.md).
