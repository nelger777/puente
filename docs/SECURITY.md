# Checklist de seguridad y privacidad

Cierre del Hito 5. Cada punto indica dónde está implementado y qué prueba lo verifica
(`apps/api/test/…` salvo que se indique otra cosa). Todas corren en el CI.

## Sección 8 de la especificación

| #   | Requisito                                                                              | Implementación                                                                                   | Verificado por                                                                                   |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 1   | CORS y `Origin` contra `allowedDomains` (host exacto; `localhost` solo en desarrollo)  | `engine/resolve-business.ts`, `routes/public.ts`                                                 | `chat.test.ts` (403, preflight), `engine-units.test.ts` (origin check), `isolation.test.ts`      |
| 2   | Mensaje de 1 a 1000 caracteres; límites por IP (30/min) y tope diario                  | `@puente/shared` `ChatRequestSchema`, `engine/rate-limits.ts`                                    | `chat.test.ts` (validación, 429 IP, tope diario)                                                 |
| 3   | Contraseñas con argon2id; bloqueo 15 min tras 5 fallos                                 | `lib/password.ts`, `services/auth.ts`                                                            | `password.test.ts`, `admin.test.ts` (bloqueo, mismo error para correo inexistente)               |
| 4   | `conversationToken` aleatorio de 32 bytes; en base solo su hash                        | `lib/tokens.ts`, `engine/conversation.ts`                                                        | `hardening.test.ts` (solo hashes), `chat.test.ts`                                                |
| 5   | Logs estructurados (pino) con id de solicitud, sin contenido de mensajes ni teléfonos  | `app.ts` (`x-request-id`, cuerpos nunca se registran, errores sin mensaje), `server.ts` (redact) | `handoff-actions.test.ts` (logging), `hardening.test.ts` (errores sin mensaje), `health.test.ts` |
| 6   | Retención: borrado diario de conversaciones y derivaciones con más de `RETENTION_DAYS` | `services/retention.ts`, `jobs.ts`, `pnpm --filter @puente/api retention`                        | `hardening.test.ts` (retención, sesiones vencidas)                                               |
| 7   | Consentimiento visible antes de enviar nombre y teléfono                               | Widget `handoff-card.ts`; la API exige `consent: true`                                           | `apps/widget/test/widget.test.ts`, `apps/widget/e2e`, `handoff-actions.test.ts`                  |

## Aislamiento entre negocios

| Requisito                                                 | Implementación                                                                              | Verificado por                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Toda consulta a tablas de negocio filtra por `businessId` | Rutas públicas: por la clave; panel: por el `businessId` de la sesión (`services/admin.ts`) | `isolation.test.ts` (matriz con dos negocios en todas las rutas), `admin.test.ts`, `chat.test.ts` |
| Conversaciones de "Probar" separadas de las reales        | `Conversation.isPreview`, `engine/conversation.ts`                                          | `admin.test.ts` (preview), `isolation.test.ts`                                                    |

## Panel y sesiones

| Requisito                                                                           | Implementación                           | Verificado por                                |
| ----------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| Cookie httpOnly, Secure, SameSite=Lax; token con HMAC (`SESSION_SECRET`) en la base | `routes/auth.ts`, `services/auth.ts`     | `admin.test.ts` (cookie), `hardening.test.ts` |
| CSRF: cambios solo desde el origen del panel                                        | `lib/auth-guard.ts` `requirePanelOrigin` | `admin.test.ts` (otro origen → 403)           |
| Roles ADMIN / AGENT                                                                 | `lib/auth-guard.ts` `requireRole`        | `admin.test.ts` (agente sin permisos)         |
| Respuestas del panel sin caché; `nosniff`; `no-referrer`                            | `app.ts`                                 | `hardening.test.ts` (encabezados)             |

## IA

| Requisito                                                               | Implementación                                                  | Verificado por                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| La clave de la IA vive solo en la API                                   | `engine/llm.ts`; widget y panel no la conocen                   | Revisión de código: ningún paquete de front importa el SDK |
| Salida validada; timeout/errores → derivación `TECHNICAL_FAILURE` (200) | `engine/llm.ts`, `engine/llm-output.ts`, `engine/pipeline.ts`   | `chat.test.ts`, `hardening.test.ts` (tipo de falla)        |
| Alerta si `TECHNICAL_FAILURE` > 5 % en una hora (mínimo 20 intentos)    | `services/llm-health.ts`, `jobs.ts` (cada 5 min, `ALERT_EMAIL`) | `hardening.test.ts` (alerta)                               |
| El mensaje de WhatsApp no lleva enlaces internos                        | `engine/handoff.ts` `sanitizeWaMessage`                         | `chat.test.ts`, `engine-units.test.ts`                     |
| Pruebas nunca llaman a la API real                                      | `FakeLlm` en `test/helpers.ts`, `test/e2e-server.ts`            | CI sin `ANTHROPIC_API_KEY`                                 |

## Operación

| Requisito                                                                               | Implementación                                                                                                                                        | Verificado por               |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Producción no arranca con el `SESSION_SECRET` de ejemplo ni sin `ANTHROPIC_API_KEY`     | `lib/env.ts`                                                                                                                                          | `hardening.test.ts`          |
| IP real detrás de un proxy (`TRUST_PROXY`)                                              | `server.ts`                                                                                                                                           | `hardening.test.ts` (parseo) |
| Cuerpos grandes solo donde hace falta (16 KB global; 1 MB para la base de conocimiento) | `app.ts`, `routes/admin.ts`                                                                                                                           | `hardening.test.ts`          |
| Dependencias sin vulnerabilidades altas                                                 | `pnpm audit --prod --audit-level high` en el CI; `overrides` en `pnpm-workspace.yaml` para `mysql2` y `deepmerge-ts` (dependencias del CLI de Prisma) | CI                           |

## Pendiente para el Hito 6 (despliegue)

- HTTPS obligatorio y HSTS en el proxy inverso.
- Encabezados de seguridad del panel servido (CSP, `X-Frame-Options: DENY`).
- Backups cifrados de PostgreSQL y rotación de `SESSION_SECRET` / `ANTHROPIC_API_KEY`.
