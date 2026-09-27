# Puente — contexto para Claude Code

Puente es una plataforma multi-negocio que instala un asistente con IA en cualquier sitio web con una línea de código. El asistente responde solo con la base de conocimiento del negocio y, cuando no puede resolver, deriva al cliente al WhatsApp del negocio con un resumen de la charla ya escrito (enlace `wa.me`, sin API de WhatsApp).

La especificación completa está en `docs/SPEC.md`. Léela antes de empezar cada hito. Las decisiones que resuelven huecos de la especificación están en `docs/DECISIONS.md`; tienen prioridad sobre la especificación.

## Cómo trabajar

- Construye por hitos, en orden (ver `docs/SPEC.md` § Hitos). No empieces un hito sin cerrar el anterior con sus pruebas en verde.
- Al empezar un hito, propón un plan corto (archivos a crear o tocar, pruebas) y espera confirmación.
- Cambios pequeños y verificables. Corre `pnpm lint && pnpm typecheck && pnpm test` antes de dar algo por terminado.
- Si algo de la especificación es ambiguo o contradictorio, pregunta en lugar de suponer.
- No agregues dependencias fuera del stack sin justificarlo.

## Stack

- Monorepo con pnpm workspaces. TypeScript estricto en todo.
- `apps/api`: Node.js 24 LTS, Fastify, Zod, Prisma, PostgreSQL.
- `apps/widget`: TypeScript sin framework, Vite en modo librería, un solo archivo `v1.js`, Shadow DOM.
- `apps/panel`: React, Vite, TypeScript, React Router.
- `packages/shared`: esquemas Zod y tipos compartidos (contratos de la API).
- IA: `@anthropic-ai/sdk`. Modelo por variable `LLM_MODEL` (por defecto `claude-haiku-4-5-20251001`).
- Pruebas: Vitest; Playwright para el widget de punta a punta.
- Local: `docker compose up -d` (postgres en :5433, mailpit en :1026 SMTP y http://localhost:8026; api y panel se suman en los hitos 2 y 4).

## Estructura

```
apps/
  api/        src/{routes,services,engine,db,lib}, prisma/
  widget/     src/, demo/index.html
  panel/      src/{pages,components,api}
packages/
  shared/     src/{schemas,types}
docs/{SPEC.md,DECISIONS.md}
docker-compose.yml
```

## Reglas no negociables

- La clave de la IA vive solo en la API. El widget y el panel nunca llaman a la IA.
- Toda consulta a tablas de negocio filtra por `business_id`. Hay pruebas que lo verifican.
- Toda entrada y salida de la API se valida con los esquemas Zod de `packages/shared`.
- La salida de la IA se valida con Zod. Si falla, tiempo agotado o error: derivar con motivo `falla_tecnica`. El cliente nunca queda sin salida.
- El límite por conversación y la caída de la IA responden 200 con derivación, no error.
- Una sola derivación pendiente por conversación: si ya existe, se actualiza.
- El mensaje de WhatsApp no incluye enlaces internos (lo ve el cliente). Solo el texto y `(Caso DER-XXXX)`.
- Nunca registrar en logs el contenido de mensajes ni teléfonos.
- Pruebas del motor con la IA simulada (mock del cliente de Anthropic). No llamar a la API real en CI.

## Convenciones

- Código, nombres y commits en inglés; textos de interfaz en español.
- Commits convencionales (`feat:`, `fix:`, `test:`...).
- Errores de la API: `{ "error": { "code": "snake_case", "message": "..." } }`.
- Ids con prefijo legible (`biz_`, `conv_`, `msg_`); código de caso `DER-` + 4 a 6 dígitos.
- Fechas en UTC en la base; el horario del negocio se evalúa en su `timezone`.

## Comandos

- Primera vez: `cp .env.example .env`, `pnpm install` (genera el cliente de Prisma), `docker compose up -d`, `pnpm db:migrate`, `pnpm db:seed`.
- `pnpm dev` — levanta api, widget y panel en modo desarrollo.
- `pnpm test` / `pnpm test:e2e` — pruebas unitarias / Playwright (e2e: requiere `docker compose up -d` y una vez `pnpm --filter @puente/widget exec playwright install chromium`).
- Demo del widget: `pnpm dev` y abrir http://localhost:5173/demo/index.html (clave `pk_demo_opticamirador` de la semilla).
- Panel: `pnpm dev` y abrir http://localhost:5174 (usuario de la semilla `admin@opticamirador.com` / `puente-admin-dev`).
- `pnpm db:migrate` / `pnpm db:seed` — migraciones y datos de ejemplo.
- `pnpm lint` / `pnpm typecheck` / `pnpm format`.
- Las pruebas de la API usan la base `puente_test` (`TEST_DATABASE_URL`) y aplican las migraciones solas.
