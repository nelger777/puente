# Decisiones de diseño

Complementa `docs/SPEC.md`. Cada decisión resuelve un hueco o una contradicción de la especificación.

## Hito 1 (2026-09-27)

| Tema                    | Decisión                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ids                     | La app genera `prefijo_` + cuid2 (`src/lib/ids.ts`); el esquema no usa `@default(cuid())`. Prefijos: `biz`, `kb`, `conv`, `msg`, `hof`, `hev`, `usr`, `ses`. |
| Sesiones del panel      | Tabla `Session` (token aleatorio en cookie httpOnly; en la base solo su hash). Revocable en logout.                                                          |
| Bloqueo de login        | `User.failedLoginCount` y `User.lockedUntil` (15 min tras 5 intentos fallidos).                                                                              |
| Saludo y sugerencias    | Campos editables `Business.greeting` y `Business.suggestions` (máx. 3), devueltos por `/widget/config`.                                                      |
| "Probar" del panel      | `Conversation.isPreview = true`: no envía correos y no cuenta en métricas ni en la bandeja de derivaciones.                                                  |
| Límite por IP           | En memoria (una sola instancia en el MVP).                                                                                                                   |
| Tope diario del negocio | Se cuenta en la base; el "día" se evalúa en el `timezone` del negocio.                                                                                       |
| Índices extra           | `Handoff(conversationId, status)` para la derivación pendiente única; `HandoffEvent(handoffId, createdAt)`.                                                  |
| Versiones               | TypeScript 6.0 (typescript-eslint aún no soporta 7), Prisma 7 estable con `@prisma/adapter-pg` (8 está en RC), pnpm 10.                                      |
| Pruebas de la API       | Base separada `puente_test` (`TEST_DATABASE_URL`); vitest se niega a correr si coincide con `DATABASE_URL`.                                                  |
| Puertos locales         | postgres 5433, mailpit SMTP 1026 / web 8026, para no chocar con otros proyectos.                                                                             |
| docker compose          | Por ahora solo postgres y mailpit; api y panel se agregan cuando existan (hitos 2 y 4).                                                                      |

## Hito 2 (2026-09-27)

| Tema                    | Decisión                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Salida de la IA         | Salidas estructuradas (`output_config.format` con JSON Schema) + validación Zod (`LlmOutputSchema`) + extracción tolerante como red de seguridad. `stop_reason` distinto de `end_turn` (corte o rechazo) se trata como salida inválida → `TECHNICAL_FAILURE`. |
| Reintentos de la IA     | Reintentos del SDK apagados. Un solo reintento propio ante error de red o 5xx; nunca ante timeout ni 4xx. Un único plazo total de `LLM_TIMEOUT_MS` para ambos intentos.                                                                                       |
| Caché de prompts        | Se marca el prompt del sistema con `cache_control`, pero en Haiku 4.5 solo se cachea desde 4096 tokens: con bases chicas no hay ahorro (tampoco costo extra).                                                                                                 |
| Derivación existente    | Se conserva el motivo original. Resumen y mensaje de WhatsApp se reemplazan solo si la nueva derivación viene de la IA; las de reglas/servidor solo registran el evento `updated`.                                                                            |
| Correos                 | Al crear un caso y al pedir contacto. Las actualizaciones no envían correo. Las conversaciones de prueba (`isPreview`) nunca envían.                                                                                                                          |
| Concurrencia            | La fila de la conversación se bloquea (`SELECT … FOR UPDATE`) al crear/actualizar la derivación: nunca hay dos pendientes.                                                                                                                                    |
| Límite por conversación | El mensaje se guarda y se cuenta siempre; desde el mensaje `max + 1` se deriva con `LIMIT` sin llamar a la IA.                                                                                                                                                |
| CORS                    | El preflight responde a cualquier origen (no trae la clave); la respuesta real solo lleva `Access-Control-Allow-Origin` si el origen está autorizado para esa clave.                                                                                          |
| Contacto                | El pedido de contacto exige `consent: true` además del teléfono.                                                                                                                                                                                              |
| Mensaje de WhatsApp     | `waMessage` se guarda sin el código; `waUrl` lleva el texto + `(Caso DER-XXXX)`. Se eliminan enlaces a nuestras propias apps.                                                                                                                                 |
| Pruebas de correo       | `mailpit.test.ts` envía por SMTP real y lo busca en la API de mailpit (`MAILPIT_URL`); el CI levanta mailpit.                                                                                                                                                 |
