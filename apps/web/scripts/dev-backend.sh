#!/usr/bin/env bash
# Runs the skirm backend natively for web development and e2e: apps/api (:4000),
# apps/worker and apps/realtime (ws://localhost:4001/ws), built from their dist bundles.
#
#   apps/web/scripts/dev-backend.sh start     # ensure Postgres + Redis, build, migrate, start, wait
#   apps/web/scripts/dev-backend.sh stop      # stop the three node services started by `start`
#   apps/web/scripts/dev-backend.sh status
#   apps/web/scripts/dev-backend.sh restart
#   apps/web/scripts/dev-backend.sh logs [api|worker|realtime]
#
# Settings (env, all optional):
#   SKIRM_DEV_DIR   state dir: pid files and logs (default /tmp/skirm-dev-backend)
#   DATABASE_URL    default postgres://skirm:skirm@localhost:5432/skirm
#   REDIS_URL       default redis://localhost:6379
#   SKIP_BUILD=1    use the existing dist/ bundles (turbo caches builds anyway)
#   CORS_ORIGINS    default http://localhost:3000,http://127.0.0.1:3000 (the web app's origins)
#   V2_TICK_MS      v2 match tick length in ms, default 2000 as in production; 200 plays a practice
#                   match out in seconds (e2e/practice.spec.ts needs it)
# Fixed for a reproducible local stack: AUTH_MODE=dev and V2_BRAIN=greedy (the offline brain: no
# model key, no spend, so practice against the bot crew is free).
#
# Postgres and Redis are started if they are down (`service postgresql start`, and
# `redis-server --daemonize yes` from /tmp so dump.rdb stays out of the repo); `stop` leaves them up.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DIR="${SKIRM_DEV_DIR:-/tmp/skirm-dev-backend}"
SERVICES=(api worker realtime)

export DATABASE_URL="${DATABASE_URL:-postgres://skirm:skirm@localhost:5432/skirm}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export AUTH_MODE=dev
export V2_BRAIN=greedy
export V2_TICK_MS="${V2_TICK_MS:-2000}"
export API_PORT="${API_PORT:-4000}"
export REALTIME_PORT="${REALTIME_PORT:-4001}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"
export NODE_ENV=development

log() { printf '[dev-backend] %s\n' "$*"; }

pid_of() { cat "$DIR/$1.pid" 2>/dev/null || true; }
running() { local p; p="$(pid_of "$1")"; [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; }

# host and port of a postgres:// or redis:// URL (defaults 5432 / 6379).
url_host() { local u="${1#*://}"; u="${u#*@}"; u="${u%%/*}"; echo "${u%%:*}"; }
url_port() { local u="${1#*://}"; u="${u#*@}"; u="${u%%/*}"; if [[ "$u" == *:* ]]; then echo "${u##*:}"; else echo "$2"; fi; }
tcp_open() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null; }

pg_up() {
  local h p; h="$(url_host "$DATABASE_URL")"; p="$(url_port "$DATABASE_URL" 5432)"
  if command -v pg_isready >/dev/null; then pg_isready -h "$h" -p "$p" -q 2>/dev/null; else tcp_open "$h" "$p"; fi
}

redis_up() {
  local h p; h="$(url_host "$REDIS_URL")"; p="$(url_port "$REDIS_URL" 6379)"
  if command -v redis-cli >/dev/null; then redis-cli -h "$h" -p "$p" ping >/dev/null 2>&1; else tcp_open "$h" "$p"; fi
}

ensure_postgres() {
  if pg_up; then return; fi
  log "starting Postgres"
  service postgresql start >/dev/null
  for _ in $(seq 1 30); do pg_up && return; sleep 0.5; done
  log "Postgres did not come up"; exit 1
}

ensure_redis() {
  if redis_up; then return; fi
  log "starting Redis"
  (cd /tmp && redis-server --daemonize yes >/dev/null)
  for _ in $(seq 1 30); do redis_up && return; sleep 0.3; done
  log "Redis did not come up"; exit 1
}

build() {
  if [[ "${SKIP_BUILD:-}" == 1 ]]; then return; fi
  log "building api, worker, realtime (turbo)"
  (cd "$ROOT" && npx turbo run build --filter=@skirm/api --filter=@skirm/worker --filter=@skirm/realtime \
    --output-logs=errors-only >"$DIR/build.log" 2>&1) || { log "build failed, see $DIR/build.log"; tail -40 "$DIR/build.log"; exit 1; }
}

wait_http() {
  local url="$1" secs="$2"
  for _ in $(seq 1 $((secs * 4))); do curl -fsS "$url" >/dev/null 2>&1 && return 0; sleep 0.25; done
  return 1
}

wait_port() {
  local port="$1" secs="$2"
  for _ in $(seq 1 $((secs * 4))); do tcp_open 127.0.0.1 "$port" && return 0; sleep 0.25; done
  return 1
}

start() {
  mkdir -p "$DIR"
  for s in "${SERVICES[@]}"; do
    if running "$s"; then log "$s already running (pid $(pid_of "$s")); use restart"; exit 1; fi
  done
  if curl -fsS "http://localhost:$API_PORT/health" >/dev/null 2>&1; then
    log "something else already answers on :$API_PORT (docker compose?); stop it first"; exit 1
  fi
  ensure_postgres
  ensure_redis
  build
  log "migrating $DATABASE_URL"
  (cd "$ROOT/apps/realtime" && node dist/migrate.js) >"$DIR/migrate.log" 2>&1 || { cat "$DIR/migrate.log"; exit 1; }
  for s in "${SERVICES[@]}"; do
    # A plain command (no subshell) so $! is the node pid itself; stdio detached from the caller.
    cd "$ROOT/apps/$s"
    nohup node dist/main.js </dev/null >"$DIR/$s.log" 2>&1 &
    echo $! >"$DIR/$s.pid"
    cd "$ROOT"
    log "started $s (pid $(pid_of "$s"), log $DIR/$s.log)"
  done
  if ! wait_http "http://localhost:$API_PORT/health" 60; then log "api did not become healthy"; tail -30 "$DIR/api.log"; stop; exit 1; fi
  if ! wait_port "$REALTIME_PORT" 60; then log "realtime did not open :$REALTIME_PORT"; tail -30 "$DIR/realtime.log"; stop; exit 1; fi
  sleep 1
  for s in "${SERVICES[@]}"; do
    if ! running "$s"; then log "$s exited"; tail -30 "$DIR/$s.log"; stop; exit 1; fi
  done
  log "up: api http://localhost:$API_PORT, realtime ws://localhost:$REALTIME_PORT/ws"
}

stop() {
  local s p
  for s in "${SERVICES[@]}"; do
    p="$(pid_of "$s")"
    if [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; then
      kill "$p" 2>/dev/null || true
      for _ in $(seq 1 40); do kill -0 "$p" 2>/dev/null || break; sleep 0.25; done
      kill -9 "$p" 2>/dev/null || true
      log "stopped $s"
    fi
    rm -f "$DIR/$s.pid"
  done
}

status() {
  local s
  for s in "${SERVICES[@]}"; do
    if running "$s"; then echo "$s: running (pid $(pid_of "$s"))"; else echo "$s: stopped"; fi
  done
  curl -fsS "http://localhost:$API_PORT/health" 2>/dev/null && echo || echo "api health: down"
}

mkdir -p "$DIR"
case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  logs) tail -n 100 -f "$DIR/${2:-api}.log" ;;
  *) echo "usage: $0 start|stop|restart|status|logs [api|worker|realtime]" >&2; exit 2 ;;
esac
