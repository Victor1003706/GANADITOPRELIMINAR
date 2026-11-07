# Catálogo de Skills — Ganadito

**Fecha de actualización:** 30-10-2026  
**Entorno de ejecución:** Google Antigravity  
**Ubicación de skills:** `.agents/skills/`

Este documento registra las skills oficiales instaladas en el repositorio para guiar a los agentes de IA en el desarrollo y mantenimiento de Ganadito.

---

## 1. Skills de Flujo de Trabajo e Ingeniería (Superpowers)

Origen: [obra/superpowers](https://github.com/obra/superpowers)  
Licencia: MIT  
Propósito: Metodología rigurosa de desarrollo asistido por IA, evitando atajos inseguros, alucinaciones o aserciones sin pruebas.

| Skill | Disparador principal / Cuándo usar | Aporte específico a Ganadito |
|---|---|---|
| **`brainstorming`** | Antes de cualquier trabajo creativo, diseño de funciones o requerimiento nuevo. | Evita construir cosas no pedidas; aclara objetivos y alternativas con el usuario. |
| **`writing-plans`** | Tareas de múltiples pasos con especificación definida. | Genera un plan de implementación detallado paso a paso con criterios de verificación. |
| **`executing-plans`** | Ejecución en línea de un plan paso a paso. | Mantiene el foco en el plan sin saltarse pasos ni dar por terminadas tareas a medias. |
| **`subagent-driven-development`** | Ejecución de tareas independientes de un plan mediante subagentes. | Coordina subagentes aislados con verificación estricta por paso. |
| **`systematic-debugging`** | Ante cualquier bug, fallo de pruebas o error inesperado. | Diagnóstico sistemático de causa raíz con pruebas de reproducción antes de modificar código. |
| **`test-driven-development`** | Al implementar lógica de negocio o corrección de defectos. | Ciclo rojo-verde-refactor estricto; evidencia de pruebas antes de código productivo. |
| **`verification-before-completion`** | Antes de declarar cualquier trabajo como terminado o listo para PR. | Exige evidencia reproducible mediante comandos reales ejecutados en terminal. |
| **`requesting-code-review`** | Al completar una tarea o antes de integrar cambios en ramas. | Solicita y estructura la revisión de código por pares con criterios rigurosos. |
| **`receiving-code-review`** | Al recibir comentarios u observaciones de revisión. | Procesa el feedback con rigor técnico sin concesiones automáticas ni atajos. |
| **`finishing-a-development-branch`** | Tras completar la implementación y superar pruebas. | Guía la integración limpia hacia la rama principal (`main`) o apertura de PR. |
| **`dispatching-parallel-agents`** | Cuando existen 2 o más tareas independientes sin estado compartido. | Paraleliza tareas de forma segura respetando límites y recursos. |
| **`using-git-worktrees`** | Trabajo que requiera aislamiento del espacio de trabajo. | Configura worktrees para no alterar el árbol activo. |
| **`using-superpowers`** | Al iniciar cualquier sesión o conversación. | Regula la invocación de skills y el orden metodológico. |

---

## 2. Skills de Ingeniería de Contexto

Origen: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)  
Licencia: Apache-2.0  
Propósito: Optimización del contexto del agente, prevención de degradación y alineación con reglas del proyecto.

| Skill | Disparador principal / Cuándo usar | Aporte específico a Ganadito |
|---|---|---|
| **`context-engineering`** | Al iniciar sesión, al notar degradación de respuesta o al configurar reglas de proyecto. | Optimiza los tokens, estructura archivos de reglas (`AGENTS.md`) y conserva el foco técnico. |

---

## 3. Estado de Skills en Fases Posteriores

Según lo indicado en la estrategia del ecosistema:
- **Skills de Frontend y Diseño** (`impeccable`, `design-taste-frontend`, `emil-design-eng`): Reservadas para la fase de maquetación y UI de SvelteKit.
- **Skills de Dominio Ganadito** (`ganadito-domain-model`, `ganadito-auction-engineering`, `ganadito-geospatial-postgis`, `ganadito-payments-and-ledger`, `ganadito-security-and-permissions`, `ganadito-api-and-con