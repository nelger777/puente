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
