# ADR 0001: Adopción de Monolito Modular con SvelteKit, Fastify y PostgreSQL

## Estado
Aceptado

## Contexto
El proyecto Ganadito requiere una plataforma escalable, mantenible y ágil para soportar operaciones comerciales ganaderas, subastas en vivo y mapas interactivos con búsqueda geoespacial. El equipo está conformado inicialmente por dos desarrolladores. Adoptar microservicios tempranos generaría una sobrecarga innecesaria de infraestructura, latencia de red y complejidad de despliegue.

## Decisión
1. Adoptar una arquitectura de **Monolito Modular** contenida en un único repositorio Git (monorepo con npm workspaces).
2. Utilizar **SvelteKit** con TypeScript para el cliente web (`apps/web`), aprovechando su rendimiento y reactividad.
3. Utilizar **Node.js con Fastify** y TypeScript para la API transaccional (`apps/api`), garantizando alto rendimiento y baja sobrecarga.
4. Establecer **PostgreSQL 16 con PostGIS 3.4** como la autoridad definitiva de persistencia transaccional y geoespacial.
5. Utilizar **Redis 7** de forma auxiliar para caché, presencia y mensajería en tiempo real, sin rol transaccional autoritativo.
6. Aislar las capacidades de Inteligencia Artificial en un servicio satélite desacoplado en Python (`services/ai`; desde 2026-11-05 vive en `services/ai-satellite`, el esqueleto original se eliminó).

## Consecuencias
### Positivas
- Desarrollo ágil y compartición directa de tipos TypeScript mediante `packages/contracts`.
- Un solo pipeline de CI y simplificación de despliegues.
- Integridad referencial ACID garantizada en compras y subastas.

### Negativas / Riesgos mitigados
- Requiere disciplina de equipo para evitar acoplamiento indebido entre módulos (se mitiga mediante la arquitectura hexagonal y la regla de no importar módulos de dominio entre sí salvo por contratos).
