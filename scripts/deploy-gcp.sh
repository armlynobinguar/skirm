#!/usr/bin/env bash
# Deploys one environment to GCP Cloud Run (docs/deploy.md, Staging). Needs gcloud signed in to an
# account that can deploy, and the one-time setup from docs/deploy.md done for this environment.
#
#   PROJECT=<project id> PRIVY_APP_ID=<app id> scripts/deploy-gcp.sh            # staging
#   PROJECT=... ENV=prod ... scripts/deploy-gcp.sh
#
# Images are built on Cloud Build (docker/cloudbuild*.yaml) and tagged with the current commit;
# an image that already exists for that tag is reused. Order (System Architecture): migrate, api,
# worker, web, then realtime last, because a new realtime revision ends live matches.
# Every piece runs at most 1 instance (api and web scale 0-1, worker and realtime exactly 1); each
# service's service-level max (`gcloud run services update --max=1`) is 1 as well, set once by hand.
#
# Only what changed is deployed. Each piece (migrate, api, worker, web, realtime) is compared with
# the commit its running image was built from (the image tag) and redeployed only when its inputs
# differ: its own app folder, the workspace packages it bundles, spec/, and the shared build and
# deploy files (lockfile, Dockerfile, this script, deploy.yml), which redeploy everything. Test
# files don't count. A piece that is missing, or whose tag isn't in this checkout's history, deploys.
#   SERVICES=auto (default) | all | a comma list such as web,api (exactly those, changed or not)
# Use SERVICES=all after changing something that lives outside git, such as a secret or a
# repository variable.
#
# Optional: REGION (us-central1), TAG (git short sha), V2_BRAIN (model if the
# <env>-llm-api-key or <env>-openrouter-api-key secret exists, else greedy: the offline brain, no
# model spend), NEAR_NETWORK (testnet), SKIP_BUILD=1.
# Model provider (docs/backend-contract.md, Environment; unset keeps the app defaults: OpenRouter and
# its default model): LLM_BASE_URL, LLM_MODEL, LLM_PLANNER_MODEL, LLM_PRICE_INPUT_USD,
# LLM_PRICE_OUTPUT_USD. The key is a secret: <env>-llm-api-key (LLM_API_KEY) or, under its old name,
# <env>-openrouter-api-key (OPENROUTER_API_KEY); LLM_API_KEY wins when both exist.
# Custom domain: PUBLIC_API_URL, PUBLIC_WS_URL (default the run.app URLs; baked into the web image)
# and CORS_ORIGINS (comma-separated browser origins; default the web run.app URL).
# Also passed through when set (.env.example): LLM_MODELS, BACKING_CONTRACT, NEAR_RENTALS_ONCHAIN,
# RELAYER_ACCOUNT_ID, RELAYER_FREE_TXS; RELAYER_PRIVATE_KEY is the <env>-relayer-private-key secret
# (api only). SAMPLE_MATCH_ID is baked into the web image as NEXT_PUBLIC_SAMPLE_MATCH_ID.
#
# Env vars and secrets are merged into each service (--update-env-vars / --update-secrets), so a
# value set by hand on a service survives a deploy. The flip side: unsetting a variable here does not
# remove it from the service; do that once by hand, e.g.
#   gcloud run services update api-staging --region=us-central1 --remove-env-vars=LLM_MODEL
set -euo pipefail

: "${PROJECT:?set PROJECT to the GCP project id}"
: "${PRIVY_APP_ID:?set PRIVY_APP_ID}"
ENV=${ENV:-staging}
R=${REGION:-us-central1}
TAG=${TAG:-$(git rev-parse --short HEAD)}
NEAR_NETWORK=${NEAR_NETWORK:-testnet}
cd "$(dirname "$0")/.."

g() { gcloud --project="$PROJECT" --quiet "$@"; }
NUM=$(g projects describe "$PROJECT" --format='value(projectNumber)')
REG=$R-docker.pkg.dev/$PROJECT/skirm
SA=skirm-run-$ENV@$PROJECT.iam.gserviceaccount.com
API_URL=${PUBLIC_API_URL:-https://api-$ENV-$NUM.$R.run.app}
WS_URL=${PUBLIC_WS_URL:-wss://realtime-$ENV-$NUM.$R.run.app/ws}
WEB_URL=https://web-$ENV-$NUM.$R.run.app
CORS=${CORS_ORIGINS:-$WEB_URL}
has_secret() { g secrets describe "$ENV-$1" >/dev/null 2>&1; }
has_image() { g artifacts docker images describe "$REG/$1:$TAG" >/dev/null 2>&1; }

# ---------- what to deploy ----------
ALL=(migrate api worker web realtime)
# Inputs that redeploy everything.
COMMON=(package.json package-lock.json tsconfig.base.json turbo.json .dockerignore
  docker/node.Dockerfile scripts/deploy-gcp.sh .github/workflows/deploy.yml)
BACKEND=(packages/shared packages/engine packages/db packages/server packages/ledger
  packages/decision-engine spec docker/cloudbuild.yaml)
NOT_TESTS=(':(exclude,glob)**/*.test.ts' ':(exclude,glob)**/*.test.tsx' ':(exclude,glob)**/e2e/**')
inputs() {
  case $1 in
    migrate) echo packages/db packages/shared docker/tsup.migrate.config.ts docker/cloudbuild.yaml ;;
    api | worker | realtime) echo "apps/$1 ${BACKEND[*]}" ;;
    # packages/engine imports the map JSON from spec/.
    web) echo apps/web packages/shared packages/engine packages/ui spec docker/cloudbuild.web.yaml ;;
  esac
}
# The commit tag of the image a piece runs now; empty when it doesn't exist or can't be read (a
# worker-pools describe behind an HTTP/1.1-only proxy), which deploys it.
running_tag() {
  local image
  case $1 in
    migrate) image=$(g run jobs describe "migrate-$ENV" --region="$R" \
      --format='value(spec.template.spec.template.spec.containers[0].image)' 2>/dev/null) ;;
    worker) image=$(g run worker-pools describe "worker-$ENV" --region="$R" \
      --format='value(spec.template.spec.containers[0].image)' 2>/dev/null) ;;
    *) image=$(g run services describe "$1-$ENV" --region="$R" \
      --format='value(spec.template.spec.containers[0].image)' 2>/dev/null) ;;
  esac
  [[ $image == *:* ]] && echo "${image##*:}" || true
}
want() {
  case ${SERVICES:-auto} in
    all) return 0 ;;
    auto) ;;
    *) [[ ",$SERVICES," == *",$1,"* ]]; return ;;
  esac
  local tag
  tag=$(running_tag "$1")
  if [ -z "$tag" ] || ! git cat-file -e "$tag^{commit}" 2>/dev/null; then
    echo "$1: running image unknown (${tag:-none}), deploying" >&2
    return 0
  fi
  # shellcheck disable=SC2046 # inputs are plain paths
  if git diff --quiet "$tag" HEAD -- "${COMMON[@]}" $(inputs "$1") "${NOT_TESTS[@]}"; then
    echo "$1: unchanged since $tag, skipping" >&2
    return 1
  fi
  echo "$1: changed since $tag, deploying" >&2
}
case ${SERVICES:-auto} in
  auto | all) ;;
  *) for s in ${SERVICES//,/ }; do
       [[ " ${ALL[*]} " == *" $s "* ]] || { echo "unknown service in SERVICES: $s (${ALL[*]})" >&2; exit 1; }
     done ;;
esac
DEPLOY=" "
for s in "${ALL[@]}"; do if want "$s"; then DEPLOY+="$s "; fi; done
deploying() { [[ $DEPLOY == *" $1 "* ]]; }
if [ "$DEPLOY" = " " ]; then
  echo "Nothing to deploy for $TAG."
  exit 0
fi
echo "Deploying $TAG:$DEPLOY"

# realtime plays the configured model (LLM_*), and the worker benchmarks skills with it, unless
# V2_BRAIN=greedy.
if [ -z "${V2_BRAIN:-}" ]; then
  if has_secret llm-api-key || has_secret openrouter-api-key; then V2_BRAIN=model; else V2_BRAIN=greedy; fi
fi

# ---------- images (only the ones being deployed, and only if missing for this tag) ----------
if [ "${SKIP_BUILD:-}" != 1 ]; then
  APPS=
  for s in migrate api worker realtime; do
    if deploying "$s" && ! has_image "$s"; then APPS+=${APPS:+,}$s; fi
  done
  if [ -n "$APPS" ]; then
    g builds submit --region="$R" --config=docker/cloudbuild.yaml \
      --substitutions="^@^_REG=$REG@_TAG=$TAG@_APPS=$APPS" .
  fi
  if deploying web && ! has_image "web-$ENV"; then
    g builds submit --region="$R" --config=docker/cloudbuild.web.yaml \
      --substitutions="_REG=$REG,_TAG=$TAG,_IMAGE=web-$ENV,_API_URL=$API_URL,_WS_URL=$WS_URL,_PRIVY_APP_ID=$PRIVY_APP_ID,_NEAR_NETWORK=$NEAR_NETWORK,_SAMPLE_MATCH_ID=${SAMPLE_MATCH_ID:-}" .
  fi
fi

# ---------- config ----------
REDIS_HOST=$(g redis instances describe "skirm-redis-$ENV" --region="$R" --format='value(host)')
NET=(--region="$R" --service-account="$SA" --network=default --subnet=default --vpc-egress=private-ranges-only)
# No volumes: a match's log and hash are on its row, its frames a while in Redis.
NOVOL=(--clear-volume-mounts --clear-volumes)
# '@'-separated (gcloud's ^@^ delimiter syntax below) because CORS_ORIGINS holds commas.
ENV_VARS="NODE_ENV=production@AUTH_MODE=privy@PRIVY_APP_ID=$PRIVY_APP_ID@V2_BRAIN=$V2_BRAIN"
ENV_VARS+="@REDIS_URL=redis://$REDIS_HOST:6379@NEAR_NETWORK=$NEAR_NETWORK"
ENV_VARS+="@SKILL_KEK_KMS=projects/$PROJECT/locations/$R/keyRings/skill-vault/cryptoKeys/skill-prompt-kek-$ENV"
ENV_VARS+="@PUBLIC_API_URL=$API_URL@PUBLIC_WS_URL=$WS_URL@CORS_ORIGINS=$CORS"
for v in LLM_BASE_URL LLM_MODEL LLM_PLANNER_MODEL LLM_PRICE_INPUT_USD LLM_PRICE_OUTPUT_USD LLM_MODELS \
  BACKING_CONTRACT NEAR_RENTALS_ONCHAIN RELAYER_ACCOUNT_ID RELAYER_FREE_TXS; do
  if [ -n "${!v:-}" ]; then
    # '@' is the list delimiter; a value holding one would split into a bogus variable.
    if [[ ${!v} == *@* ]]; then echo "$v must not contain '@'" >&2; exit 1; fi
    ENV_VARS+="@$v=${!v}"
  fi
done
# Never SKILL_KEK here: Cloud KMS (SKILL_KEK_KMS) seals the skill vault (docs/deploy.md).
SECRETS="DATABASE_URL=$ENV-database-url:latest"
SECRETS+=",PRIVY_VERIFICATION_KEY=$ENV-privy-verification-key:latest"
# LLM_API_KEY (or OPENROUTER_API_KEY, its old name) is the v2 brain's key; BENCH_SECRET keys the
# hidden benchmark picks (worker).
for s in llm-api-key openrouter-api-key near-ops-key bench-secret; do
  if has_secret $s; then
    var=$(echo "$s" | tr a-z- A-Z_)
    SECRETS+=",$var=$ENV-$s:latest"
  fi
done
if has_secret near-ops-key; then ENV_VARS+="@NEAR_OPS_ACCOUNT=${NEAR_OPS_ACCOUNT:?set NEAR_OPS_ACCOUNT}"; fi
# Only the api reads OPS_TOKEN (GET /ops/stats for the skirm-ops dashboard); without the secret the route is off.
API_SECRETS=$SECRETS
if has_secret ops-token; then API_SECRETS+=",OPS_TOKEN=$ENV-ops-token:latest"; fi
# Gasless relay (api only): the api refuses to start with just one of RELAYER_ACCOUNT_ID and
# RELAYER_PRIVATE_KEY, so require both or neither here.
if has_secret relayer-private-key; then
  : "${RELAYER_ACCOUNT_ID:?set RELAYER_ACCOUNT_ID (the $ENV-relayer-private-key secret exists)}"
  API_SECRETS+=",RELAYER_PRIVATE_KEY=$ENV-relayer-private-key:latest"
elif [ -n "${RELAYER_ACCOUNT_ID:-}" ]; then
  echo "RELAYER_ACCOUNT_ID is set but the $ENV-relayer-private-key secret does not exist" >&2
  exit 1
fi
# Cloud Run sets PORT itself; the apps read API_PORT / REALTIME_PORT, which default to the ports below.

# ---------- 1. migrations ----------
if deploying migrate; then
  g run jobs deploy "migrate-$ENV" --image="$REG/migrate:$TAG" "${NET[@]}" \
    --set-secrets="DATABASE_URL=$ENV-database-url:latest" --max-retries=0
  g run jobs execute "migrate-$ENV" --region="$R" --wait
fi

# ---------- 2. api ----------
if deploying api; then
  g run deploy "api-$ENV" --image="$REG/api:$TAG" "${NET[@]}" "${NOVOL[@]}" --port=4000 \
    --allow-unauthenticated --min-instances=0 --max-instances=1 --concurrency=80 \
    --update-env-vars="^@^$ENV_VARS" --update-secrets="$API_SECRETS"
fi

# ---------- 3. worker ----------
# gcloud manages worker pools over gRPC. Behind a proxy that only passes HTTP/1.1, fall back to the
# Cloud Run v2 REST API with api-$ENV's env, secrets and network (the env and secrets are the same
# for every piece, so api-$ENV has them whether or not it was redeployed this run), minus the api-only
# secrets.
if deploying worker && ! g run worker-pools deploy "worker-$ENV" --image="$REG/worker:$TAG" "${NET[@]}" \
  --instances=1 --update-env-vars="^@^$ENV_VARS" --update-secrets="$SECRETS"; then
  echo "gcloud run worker-pools failed; using the REST API" >&2
  RUN=https://run.googleapis.com/v2/projects/$PROJECT/locations/$R
  AUTH="Authorization: Bearer ${CLOUDSDK_AUTH_ACCESS_TOKEN:-$(gcloud auth print-access-token)}"
  body=$(curl -fsS -H "$AUTH" "$RUN/services/api-$ENV" | python3 -c '
import json, sys
t = json.load(sys.stdin)["template"]; c = t["containers"][0]
print(json.dumps({"launchStage": "BETA", "scaling": {"manualInstanceCount": 1}, "template": {
  "serviceAccount": t["serviceAccount"], "vpcAccess": t["vpcAccess"],
  # api-only secrets stay on the api.
  "containers": [{"image": sys.argv[1],
                  "env": [e for e in c["env"] if e["name"] not in ("OPS_TOKEN", "RELAYER_PRIVATE_KEY")],
                  "resources": {"limits": c["resources"]["limits"]}}]}}))' "$REG/worker:$TAG")
  if curl -fsS -o /dev/null -H "$AUTH" "$RUN/workerPools/worker-$ENV"; then
    op=$(curl -fsS -X PATCH -H "$AUTH" -H 'Content-Type: application/json' -d "$body" "$RUN/workerPools/worker-$ENV")
  else
    op=$(curl -fsS -X POST -H "$AUTH" -H 'Content-Type: application/json' -d "$body" "$RUN/workerPools?workerPoolId=worker-$ENV")
  fi
  opname=$(echo "$op" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
  while :; do
    st=$(curl -fsS -H "$AUTH" "https://run.googleapis.com/v2/$opname" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("error: " + json.dumps(d["error"]) if "error" in d else "done" if d.get("done") else "running")')
    case $st in done) break ;; error*) echo "worker-$ENV: $st" >&2; exit 1 ;; esac
    sleep 5
  done
  echo "Worker pool [worker-$ENV] deployed."
fi

# ---------- 4. web ----------
if deploying web; then
  g run deploy "web-$ENV" --image="$REG/web-$ENV:$TAG" --region="$R" --port=3000 \
    --allow-unauthenticated --min-instances=0 --max-instances=1
fi

# ---------- 5. realtime (last) ----------
if deploying realtime; then
  g run deploy "realtime-$ENV" --image="$REG/realtime:$TAG" "${NET[@]}" "${NOVOL[@]}" --port=4001 \
    --allow-unauthenticated --min-instances=1 --max-instances=1 --concurrency=1000 --timeout=3600 \
    --session-affinity --no-cpu-throttling --update-env-vars="^@^$ENV_VARS" --update-secrets="$SECRETS"
fi

echo
echo "deployed:$DEPLOY"
echo "web:      $WEB_URL"
echo "api:      $API_URL  ($(curl -fsS "$API_URL/health" || echo 'health check failed'))"
echo "realtime: $WS_URL"
