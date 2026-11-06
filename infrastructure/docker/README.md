# infrastructure/docker

Configuración de contenedores Docker para desarrollo local.

## Servicios incluidos
- **PostgreSQL 16 con PostGIS 3.4**: Base de datos transaccional con extensiones geoespaciales.
- **Redis 7 (Alpine)**: Motor de caché, control de presencia y mensajería efímera.

## Comandos básicos
```bash
# Iniciar servicios en segundo plano
docker compose -f infrastructure/docker/compose.yaml up -d

# Verificar estado de los contenedores
docker compose -f infrastructure/docker/compose.yaml ps

# Ver registros de logs
docker compose -f infrastructure/docker/compose.yaml logs -f

# Detener servicios (sin eliminar volúmenes ni datos persistidos)
docker compose -f infrastructure/docker/compose.yaml down
```
> [!CAUTION]
> No ejecutes `docker compose down -v` salvo que requieras eliminar conscientemente todos los datos locales.
