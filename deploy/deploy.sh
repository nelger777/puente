#!/bin/sh
# Deploys (or updates) Puente on this server: pulls the code, rebuilds the images and
# restarts the services; migrations run when the API starts. Run from the repo root:
#   sh deploy/deploy.sh            # latest commit of the current branch
#   sh deploy/deploy.sh <commit>   # a specific version (rollback)
set -eu

cd "$(dirname "$0")/.."
[ -f deploy/.env ] || { echo "Falta deploy/.env (copia deploy/.env.example)"; exit 1; }

if [ "${1:-}" != "" ]; then
  git fetch --all --quiet
  git checkout --quiet "$1"
else
  git pull --ff-only --quiet
fi
echo "Versión: $(git log -1 --format='%h %s')"

cd deploy
docker compose up -d --build --remove-orphans

echo "Esperando a que la API esté lista…"
i=0
until [ "$(docker compose ps api --format '{{.Health}}')" = "healthy" ]; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "La API no quedó sana en 2 minutos. Últimos logs:"
    docker compose logs --tail 50 api
    exit 1
  fi
  sleep 2
done

docker image prune -f >/dev/null
. ./.env
echo "Listo: $PUBLIC_URL"
