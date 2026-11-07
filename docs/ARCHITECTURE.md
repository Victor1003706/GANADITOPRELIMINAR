# Ganadito — Arquitectura Técnica de Referencia

Este documento formaliza la arquitectura aprobada para el proyecto Ganadito, sus límites de responsabilidad y las directrices técnicas no negociables.

---

## 1. Paradigma arquitectónico

Ganadito se estructura como un **Monolito Modular con Arquitectura Hexagonal (Ports and Adapters) y CQRS Selectivo**.

### Principios rectores:
1. **Evitar microservicios prematuros:** Mantener el desarrollo dentro de un único monorepo y proceso de despliegue principal minimiza la sobrecarga operativa de redes, transacciones distribuidas y sincronización.
2. **Modularidad estricta:** Cada dominio funcional (Usuarios, Catálogo, Subastas, Pagos, Logística) encapsula sus modelos de dominio, casos de uso y puertos de entrada/salida.
3. **CQRS selectivo:** Separación entre operaciones de comando (escritura con validaciones estrictas y transacciones ACID en PostgreSQL) y operaciones de consulta (lecturas optimizadas, vistas materializadas o cachés controladas).

---

## 2. Mapa de componentes del Monorepo

```text
ganadito/
├── apps/
│   ├── web/                    # Frontend (SvelteKit + TypeScript)
│   └── api/                    # Backend API (Node.js + Fastify + TypeScript)
├── services/
│   └── ai-satellite/           # Satélite de IA (FastAPI, Python 3.12)
├── packages/
│   ├── contracts/              # Interfaces, esquemas de validación y DTOs
│   ├── shared/                 # Utilidades puras y funciones transversales
│   └── config/                 # Configuraciones comunes (TS, ESLint, Prettier)
├── infrastructure/
│   ├── docker/                 # Entornos reproducibles para desarrollo local
│   ├── database/               # Migraciones SQL y semillas controladas
│   └── deployment/             # Configuraciones de despliegue
└── docs/                       # Documentación técnica y ADRs
```

---

## 3. Persistencia y límites de autoridad de datos

### PostgreSQL 16 + PostGIS 3.4
- **Es la única fuente de verdad transaccional y comercial.**
- Maneja todas las entidades transaccionales: usuarios, lotes, pujas, pagos, órdenes y contratos.
- PostGIS gestiona las coordenadas, radios de búsqueda, distancias y ubicaciones geográficas de establos, camales y ferias con índices espaciales (`GIST`).

### Redis 7
- **Es exclusivamente una herramienta de caché efímera, presencia y mensajería.**
- No es una base de datos de persistencia definitiva. Si Redis se reinicia o pierde sus datos, la consistencia del negocio no debe sufrir daño.
- En el sistema de subastas, las pujas **deben confirmarse primero en PostgreSQL** antes de ser emitidas a través de WebSockets o SSE.

---

## 4. Límites de módulos clave

### Subastas en tiempo real
- **Consistencia e Idempotencia:** Las pujas concurrentes se serializan y resuelven a nivel de base de datos transaccional con locks o constraints optimistas/pesimistas controlados.
- **WebSocket/SSE:** Se utilizan exclusivamente como capa de transporte de eventos hacia los clientes, nunca como motor de decisión o almacenamiento.

### Pagos e Integraciones Financieras
- Los pagos se modelan a través de una arquitectura de puertos y adaptadores (Gateway Interface).
- No se asume soporte de preautorizaciones ni custodia automática en billeteras peruanas (Yape / Plin) sin documentación oficial del proveedor.
- Todo webhook de pasarela debe validar firmas criptográficas, garantizar idempotencia y registrar conciliación.

### Servicio de IA (`services/ai-satellite`)
- Ejecuta en un proceso satélite e independiente en Python (FastAPI/PyTorch/OpenCV).
- Se comunica con el backend API mediante llamadas asíncronas o colas de trabajo, protegiendo al núcleo transaccional de consumos elevados de CPU o memoria.

---

## 5. Registro de Decisiones de Arquitectura (ADR)

Toda decisión arquitectónica material (elección de base de datos, bibliotecas críticas, protocolos de comunicación) debe documentarse en `docs/decisions/` siguiendo el formato estandarizado.

- [ADR 0001: Adopción de Monolito Modular con SvelteKit, Fastify y PostgreSQL](./decisions/0001-monorepo-modular-y-arquitectura-base.md)
