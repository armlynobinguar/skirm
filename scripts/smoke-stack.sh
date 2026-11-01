#!/usr/bin/env bash
# Full stack smoke on this machine: builds the five images, starts the stack in its own compose
# project, runs scripts/smoke.sh against it (with the headless browser sign-in), then tears down only
# that project. This replaces the old ci.yml smoke job; README, Testing says when to run it.
#
#   npm run smoke                  # or scripts/smoke-stack.sh
#   WEB_BROWSER=0 npm run smoke    # skip the headless Chromium sign-in
#   SKIP_PVP=1 npm run smoke       # stop after the practice checks (skip the two-client ranked match)
#
# Needs Docker with Compose v2 running, `npm ci`, and once `npx playwright install chromium`
# (in apps/web) for the browser check. The project is named skirm-smoke, so teardown never touches
# the data of your own `docker compose up` stack, but both use host ports 3000, 4000 and 4001: stop
# that stack first. V2_BRAIN and AUTH_MODE are pinned so .env never turns on paid model calls or
# real auth here; V2_TICK_MS=200 plays a match in seconds instead of minutes.
set -euo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME=skirm-smoke V2_BRAIN=greedy V2_TICK_MS=200 AUTH_MODE=dev
export WEB_BROWSER=${WEB_BROWSER:-1}

docker info >/dev/null 2>&1 || { echo "smoke-stack: Docker is not running" >&2; exit 2; }
for port in 3000 4000 4001; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "smoke-stack: port $port is in use (a dev server or your own compose stack); stop it first" >&2
    exit 2
  fi
done

ok=0
teardown() {
  if [ "$ok" != 1 ]; then
    docker compose ps -a
    docker compose logs --no-color --tail 300
  fi
  docker compose down -v --rmi local --remove-orphans
}
trap teardown EXIT

# One image at a time: building all five in parallel exhausts Docker Desktop's default memory.
for svc in migrate api worker realtime web; do
  docker compose build "$svc"
done
docker compose up -d

ready=0
for _ in $(seq 1 120); do
  if curl -fsS http://localhost:4000/health >/dev/null 2>&1 \
    && curl -fsS -o /dev/null http://localhost:3000/ 2>/dev/null; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "smoke-stack: api or web did not become ready" >&2; exit 1; }

scripts/smoke.sh
ok=1
