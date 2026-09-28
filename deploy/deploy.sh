#!/bin/sh
# Deploys or updates Puente with the images GitHub Actions publishes (ghcr.io). Nothing is
# compiled on the server, and only Puente's own containers are touched. From the repo root:
#   sh deploy/deploy.sh
# Version: PUENTE_VERSION in deploy/.env ("latest", or a commit SHA to pin / roll back).
set -eu

cd "$(dirname "$0")/.."
[ -f deploy/.env ] || { echo "Falta deploy/.env (copia deploy/.env.example)"; exit 1; }

# Keeps compose.yml and these scripts current (the application itself comes in the images).
git pull --ff-only --quiet || echo "Aviso: no se pudo actualizar el repositorio; sigo con la copia local."

cd deploy
docker compose pull --quiet api web
docker compose up -d --remove-orphans

echo "Esperando a que Puente esté listo…"
i=0
until [ "$(docker compose ps api --format '{{.Health}}')" = "healthy" ] &&
  [ "$(docker compose ps web --format '{{.Health}}')" = "healthy" ]; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "Puente no quedó sano en 2 minutos. Últimos logs:"
    docker compose logs --tail 50 api web
    exit 1
  fi
  sleep 2
done

docker compose images api web --format 'table {{.Service}}\t{{.Repository}}:{{.Tag}}\t{{.ID}}' 2>/dev/null ||
  docker compose images api web
echo "Listo."
