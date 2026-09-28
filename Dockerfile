# syntax=docker/dockerfile:1.7
# Production images for Puente (docs/DEPLOY.md).
#   target "api": Node 24 running the bundled API; applies migrations on start.
#   target "web": Caddy serving the panel and the widget, and proxying /v1 to the API.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------- build: install, generate, compile everything ----------
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
# The images are domain-agnostic: the widget calls the origin it is served from, and the
# API reads its URLs from the environment at runtime.
# Only for "prisma generate" at install time; the real URL arrives at runtime.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @puente/api build \
 && pnpm --filter @puente/widget build \
 && pnpm --filter @puente/panel build
# Self-contained API folder with production dependencies only.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @puente/api deploy --prod --legacy /out/api \
 && cp -r apps/api/dist /out/api/dist

# ---------- api ----------
FROM ${NODE_IMAGE} AS api
LABEL org.opencontainers.image.source="https://github.com/nelger777/puente"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations are idempotent: every start brings the schema up to date before serving.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node --enable-source-maps dist/server.js"]

# ---------- web ----------
FROM caddy:2-alpine AS web
LABEL org.opencontainers.image.source="https://github.com/nelger777/puente"
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/panel/dist /srv/panel
COPY --from=build /repo/apps/widget/dist /srv/widget
COPY --from=build /repo/apps/widget/demo /srv/demo
