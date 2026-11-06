# Registro de versión de staging

Plantilla: rellenar valores reales antes de una promoción. No contiene ni solicita secretos. Un campo pendiente mantiene pendiente la aceptación correspondiente. Distinguir evidencia de CI efímera del despliegue en un host autorizado: ninguna ejecución local o de CI demuestra por sí sola staging ni rollback del host.

| Campo | Valor |
|---|---|
| Fecha y zona horaria | Pendiente (ISO 8601 con offset) |
| Responsable de despliegue | Pendiente |
| Entorno / host autorizado | Pendiente |
| SHA web | Pendiente |
| SHA API / worker | Pendiente |
| PR web / revisión de Nicolás | Pendiente |
| PR API / revisión de Víctor | Pendiente |
| PR de contrato / SHA integrado | Pendiente |
| Node / npm realmente usados | Pendiente |
| Hash SHA256 de lockfile | Pendiente |
| `GANADITO_RELEASE_SHA` utilizado en build web | Pendiente; debe coincidir con SHA web |
| Identidad del artefacto realmente servido | Pendiente; comparar `/_app/version.json` con `release_sha` del registro del launcher |
| Run `browser-real` y SHA final | Pendiente; servicios efímeros, web adapter-node compilada |
| Origen REST / ruta WS (sin credenciales) | Pendiente |
| Base ficticia aislada confirmada por Nicolás | Pendiente (identificador sin credenciales) |
| Migraciones aplicadas y hashes confirmados | Pendiente |
| Último SHA aceptado y artefacto recuperable | Pendiente |
| Compatibilidad de esquema para recuperación | Pendiente |
| Pagos / integraciones externas | Desactivados; confirmar en la versión probada |
| Transporte WS web | Desactivado; aceptación de tickets/membresía/revocación pendiente |
| Criterios técnicos V01–V06 | Pendiente de evidencia: 18 criterios técnicos de un total de 24 |
| Aceptaciones humanas | 6 pendientes; responsable/decisión/enlace por cada entrega |

## Evidencia

| Validación | Comando / caso | Resultado y enlace seguro |
|---|---|---|
| Instalación | `npm ci` | Pendiente |
| Tipos / lint | `npm run typecheck`, `npm run lint` | Pendiente |
| Backend aislado | `npm test` con PostGIS/Redis de pruebas | Pendiente |
| Build | `npm run build` | Pendiente |
| Identidad de web compilada en CI real | Launcher `tests/e2e/real/web.mjs`, SHA del registro y de `/_app/version.json` | Pendiente; registro público sin sesiones ni credenciales |
| Navegador aislado | `npm run test:e2e`; fixtures explícitos | Pendiente; no acredita API real |
| CI del SHA final | URL del run | Pendiente |
| Acceso y aislamiento entre organizaciones | Web + API reales, datos ficticios | Pendiente |
| Lote → puja → cierre → orden pendiente | IDs ficticios y SHA web/API | Pendiente |
| Recuperación HTTP → snapshot oficial | Recarga real: sesión, precio y secuencia del mismo lote UI | Pendiente; no acredita reconexión WS |
| Mapa / Spot: API y UI reales | Anónimo, organización ajena y propietaria; aproximación/dirección null y selección | Pendiente |
| Pasaporte: API y UI reales | COMPLETA propietaria/cadena íntegra; API PUBLICA redactada sin hashes; 401/404; ruta pública web desactivada | Pendiente |
| Reconexión y permisos WS | Ticket/Bearer según cliente, membresía, revocación, expiración y snapshot | Diferido; web WS apagado, validación separada |
| Revisión delegada del código final | Claude por encargo de Nicolás, evidencia y URL | Pendiente; decisión final de Nicolás |
| Staging en host autorizado | Host, responsable, ID de despliegue y pruebas | Pendiente; CI efímera no sustituye esta evidencia |
| Recuperación/rollback del host | Artefacto anterior, autorización, compatibilidad y resultado | Pendiente; este registro no autoriza ejecutarlo |

## Incidente o recuperación

- Inicio y motivo: pendiente.
- SHA origen y SHA restaurado: pendiente.
- Estado de escrituras/workers acordado con Nicolás: pendiente.
- Compatibilidad y estado de migraciones: pendiente.
- Resultado de verificación posterior: pendiente.
- Incidencias abiertas y responsable: pendiente.
