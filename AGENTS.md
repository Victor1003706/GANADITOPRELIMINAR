# Reglas Operativas para Agentes de IA en Ganadito

Este documento rige la conducta técnica y prioridades de los agentes de IA (Google Antigravity y subagentes) en el proyecto Ganadito.

---

## 1. Jerarquía de autoridad y decisión

Cuando existan instrucciones o criterios en conflicto, la prioridad estricta es:

1. **Requisitos expresos del propietario y decisiones aprobadas.**
2. **Seguridad, legalidad e integridad de datos.**
3. **Arquitectura y contratos aprobados de Ganadito.**
4. **Skill especializada del dominio de negocio.**
5. **Skills generales de ingeniería y flujo de trabajo.**
6. **Preferencias de formato y ahorro de tokens.**

---

## 2. Invariantes de arquitectura

- **Monolito Modular con Arquitectura Hexagonal y CQRS selectivo:** No convertir el sistema a microservicios prematuros ni generar servicios independientes no autorizados.
- **Autoridad de persistencia:** **PostgreSQL 16 + PostGIS 3.4** es la única fuente de verdad transaccional y comercial.
- **Rol de Redis:** Herramienta auxiliar para caché, presencia y mensajería en tiempo real. **Nunca fuente de verdad**. Si Redis se reinicia, ningún estado transaccional debe perderse o quedar corrupto.
- **Pujas de subastas:** Toda puja debe confirmarse en PostgreSQL con control de concurrencia e idempotencia antes de notificarse a clientes vía WebSocket/SSE.
- **Pagos peruanos e integraciones:** No asumir ni inventar capacidades de preautorización, escrow o retención automática en billeteras (Yape / Plin) sin documentación oficial del proveedor.
- **Geolocalización:** Respetar la privacidad de ubicación exacta de establos y ganaderos según permisos del usuario.

---

## 3. Principios de trabajo para el agente

- **Ingeniero riguroso, no generador complaciente:** Aclara únicamente decisiones que cambien materialmente el alcance o riesgo. No tomes atajos inseguros.
- **Evidencia antes de aserciones:** No declares que un componente, base de datos o servicio funciona hasta presentar evidencia reproducible de comandos ejecutados.
- **Mínimo cambio necesario:** Proporciona la solución más simple, robusta y mantenible que satisfaga los requisitos sin sobreingeniería.
- **Protección de secretos y datos:** Prohibido registrar, imprimir o subir archivos `.env`, claves privadas o volcados de datos reales.
- **Cero cambios destructivos sin autorización:** No borres bases de datos, volúmenes de Docker, historial de Git ni archivos sin confirmación explícita.

## 4. Reparto de edición y aceptación

Nicolás es el programador principal y tiene la decisión final; Víctor es el programador secundario. Cada PR lo revisa Claude por encargo de Nicolás antes de unirlo (ver [docs/OWNERSHIP.md](docs/OWNERSHIP.md)). La matriz vigente está en [docs/OWNERSHIP.md](docs/OWNERSHIP.md). Víctor edita web, pruebas de navegador, despliegue, documentación salvo `docs/api`, manifiestos npm/lockfile, workflows y configuración raíz. Nicolás edita API y sus pruebas, contratos, documentación API, SQL/seeds, Docker, paquetes compartidos/config y servicios IA. Las excepciones de manifiestos npm tienen prioridad sobre la propiedad de las carpetas.

No editar rutas del compañero para desbloquear una pantalla. Registrar la solicitud en la entrega; una transferencia requiere tarea, rutas, editor temporal y condición de fin antes de editar. No cambiar contratos ni migraciones por cuenta propia.

Los datos simulados se aíslan en pruebas o modo de demostración explícito. Nunca reemplazar una respuesta fallida de API con datos demo ni confirmar pagos, permisos o resultados de subasta en el navegador. Pagos reales y servicios externos no habilitados permanecen desactivados.

La cola y los criterios V01-V06 están en [docs/VICTOR_DELIVERY.md](docs/VICTOR_DELIVERY.md); las brechas de la base revisada, en [docs/CONTRACT_REVIEW.md](docs/CONTRACT_REVIEW.md). No declarar entrega al 100% solo por compilar o pasar fixtures: se necesitan CI del código final, revisión cruzada y prueba web + API real cuando la entrega conecta ambas. Cada autor corrige sus cambios y nadie aprueba su propia entrega.
