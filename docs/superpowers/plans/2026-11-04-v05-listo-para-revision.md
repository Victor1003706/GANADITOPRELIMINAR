# Preparación técnica V05 y entrega V01-V06

> **For agentic workers:** ejecutar tareas independientes con subagent-driven-development y revisión final independiente; no detener entre pasos rutinarios ya autorizados.

**Goal:** cerrar la preparación técnica de Víctor con privacidad V05 coherente y recorrido real sobre web compilada; dejar las seis aceptaciones finales para Nicolás.

**Architecture:** mantener monolito y PostgreSQL como autoridad. DTO de lectura discriminado PUBLICA/COMPLETA sin debilitar entidades privadas; no hashes privados públicos. La UI representa la posición aproximada que entrega la API y nunca deduce la real. Integración en servicios efímeros ya existentes, sin despliegues.

**Tech Stack:** Node24/TypeScript/Fastify, Svelte5/Leaflet, Playwright y adapter-node compilado.

**Spec:** petición del propietario de completar preparación técnica y autorización explícita TRANSFERENCIA_V05_2026-11-04.md; OWNERSHIP.md/VICTOR_DELIVERY.md.

## Restricciones

No editar rutas N fuera de la transferencia, contratos de WS/pujas, SQL, migraciones ni IA. No fusionar, desplegar, autoaprobar ni registrar firmas de Nicolás. No pruebas sobre DB local existente/Neon. No datos demo como sustitución ni completar datos privados. No afirmar 24/24 o ausencia universal de errores por pasar pruebas.

## Tarea 1: contrato y privacidad (editor temporal)

Rutas: cuatro archivos transferidos y pruebas focales puras/privacidad existentes.

- [x] DTO lectura discriminado: COMPLETA conserva entidades/autor/organización/hashes; PUBLICA representa nullables reales y omite ambos hashes.
- [x] Lookup de metadata seguro ante propiedades heredadas y desconocidas; regresión roja/verdes sin modificar historial.
- [x] Ocho tipos permitidos, objetos/arrays, acentos, texto libre, autor/organización nulos, ausencia de hashes pública, presencia privada e integridad intacta.
- [x] Documentar la política aprobada y eliminar casts que ocultan nulabilidad.

## Tarea 2: interfaz y navegador con fixtures

Rutas: apps/web y tests/e2e/map-trace.spec.ts.

- [x] Transportar/validar ubicacion_aproximada y nullables; indicador ausente o inválido no se interpreta como ubicación exacta.
- [x] Área o marcador difuso, avisos y distancia aproximada en mapa/lista/Spot/popup; selección conserva privacidad.
- [x] Pasaporte discriminado, contexto dueño y respuestas PUBLICA sin atribuciones inventadas; mantener ruta pública web desactivada.
- [x] Regresiones de posiciones propias/ajenas, respuestas malformadas, contexto/cancelación, XSS y ausencia de consultas en ruta pública desactivada.

## Tarea 3: integración real y artefacto de entrega

Rutas: tests/e2e/real, configuración/CI propia si corresponde, infrastructure/deployment.

- [x] Recorrido V05 real con API existente: datos ficticios, anónimo/ajeno/dueño en mapa y Spot; pasaporte propietario/verificación y proyección pública sin hashes en API. Sin SQL directo ni seeds.
- [x] El recorrido real usa web compilada adapter-node y registra su SHA; conservar guardias, pagos/WS apagados y ausencia de artefactos sensibles.
- [x] Actualizar runbook/registro: recuperación HTTP/recarga comprobada, WS diferido por permisos/revocación y staging real aún sujeto a autorización.

## Entrega final

- [x] Typecheck/build, pruebas relevantes y revisión independiente del diff con defectos corregidos.
- [x] Publicar PR acotado contra main `5b73e470` (Nicolás ya integró #37/#44 y los originales #46/#50), observar CI del HEAD final y evidencias reales, incluidas regresiones previas.
- [x] Registrar matriz técnica verificable y solicitud de revisión de Nicolás. V05 real correcto permite 18/24; las seis aceptaciones quedan pendientes y no se redefinen como pruebas automáticas.

## Revisión focal

No datos privados en PUBLICA ni propiedades heredadas interpretadas como tipos válidos. No cambiar precisión pública en front por ausencia de flag. No reutilizar respuestas de otro contexto ni expon