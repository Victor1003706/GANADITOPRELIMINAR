## Objetivo y comportamiento
<!-- Problema concreto, comportamiento resultante y tarea V/N. -->

## Editor, rutas y contrato

- Tarea y editor único:
- Rutas permitidas; reserva temporal y condición de fin si aplica:
- Contrato utilizado y SHA / PR integrado en main:
- Dependencias previas y orden en la cola de integración:
- Revisor cruzado (Víctor revisa a Nicolás; Nicolás revisa a Víctor):

<!-- Comparar con docs/OWNERSHIP.md. Manifiestos y lockfile van en PR de dependencias separado. -->

## Tipo de cambio
- [ ] `feat`: Nueva funcionalidad
- [ ] `fix`: Corrección de un defecto
- [ ] `docs`: Modificación o adición de documentación
- [ ] `refactor`: Refactorización sin cambio funcional
- [ ] `test`: Adición o mejora de pruebas
- [ ] `chore`: Mantenimiento, dependencias o configuración
- [ ] `ci`: Cambios en flujos de integración continua

## Tareas realizadas
- [ ] 

## Evidencia de validación local
<!-- Registrar comando, SHA, resultado y límites. No marcar checks no ejecutados. -->
- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint` (indicar paquetes/reglas realmente cubiertos)
- [ ] `npm test` (PostGIS/Redis aislados; sin servicios externos reales)
- [ ] `npm run build`
- [ ] `npm run test:e2e` (fixtures explícitos; no equivale a API real)
- [ ] CI aprobada sobre el código final.

## Integración real y limitaciones

- SHA web / API / worker, entorno ficticio aislado y migraciones aplicadas:
- Casos reproducidos con navegador + API reales:
- Casos pendientes, bloqueantes y responsable:
- Recuperación y compatibilidad de esquema si cambia entorno/configuración:

<!-- Si no se ha probado API real, escribirlo. No inventar confirmación de puja, orden, pago o integración externa. -->

## Lista de verificación de seguridad y calidad
- [ ] No incluye secretos, contraseñas, tokens ni archivos `.env`.
- [ ] No incluye datos personales reales ni volcados de base de datos.
- [ ] No rompe contratos existentes sin plan de compatibilidad.
- [ ] Las dependencias añadidas están justificadas y revisadas.
- [ ] Las rutas modificadas corresponden al editor o a una reserva documentada.
- [ ] Pagos reales e integraciones no habilitadas continúan desactivados.
- [ ] La revisión del otro programador cubre el código final; el autor no aprueba su entrega.
