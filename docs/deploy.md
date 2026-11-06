# Deploy

## Local (one command)

Needs Docker with Compose 2.24 or newer (the optional `.env` uses `env_file` `path`/`required`), plus Node 20+ and `npm ci` at the repo root for the smoke script.

```sh
V2_TICK_MS=200 docker compose up --build   # or -d to run in the background; drop V2_TICK_MS for 2 s ticks
npm ci && scripts/smoke.sh                 # in a second shell, once web answers on :3000
```

`npm run smoke` does both in a throwaway compose project and tears it down (README, "Full stack smoke").

- The web app is on http://localhost:3000 (sign in with any handle).
- `api` is on http://localhost:4000 and `realtime` on ws://localhost:4001/ws. Postgres and Redis have no host ports, so a native Postgres or Redis on 5432/6379 doesn't clash.
- `migrate` runs once before api, worker and realtime start (`service_completed_successfully`).
- Defaults are `V2_BRAIN=greedy` (the offline greedy brain: no model calls, no spend, practice is free) and `AUTH_MODE=dev`, so sign in with the `x-dev-user: <handle>` header. Override them from the shell (`V2_BRAIN=model docker compose up`, which also needs `LLM_API_KEY`) or from a `.env` file. `LLM_BASE_URL` and `LLM_MODEL` pick any OpenAI-compatible provider and model (`.env.example`; default OpenRouter and `anthropic/claude-haiku-5.5`); a local Ollama on the host is `LLM_BASE_URL=http://host.docker.internal:11434/v1` with `V2_BRAIN=model` and no key. `V2_TICK_MS` sets the tick (default 2000 ms, at least 50). Model keys, Privy and NEAR settings also come from `.env`. Compose always sets `DATABASE_URL` and `REDIS_URL` itself.
- There are no replay files: a match's log and its hash are on its `v2_matches` row, and its frames stay in Redis for 6 hours for replays.
- The browser talks to api and realtime directly. `web` is built with `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` from `PUBLIC_API_URL` / `PUBLIC_WS_URL` (defaults `http://localhost:4000`, `ws://localhost:4001/ws`), because Next inlines `NEXT_PUBLIC_*` at build time, and api allows CORS from `CORS_ORIGINS` (default `http://localhost:3000,http://127.0.0.1:3000`). To serve on another host or port, set all three and rebuild web: `PUBLIC_API_URL=http://myhost:4000 PUBLIC_WS_URL=ws://myhost:4001/ws CORS_ORIGINS=http://myhost:3000 docker compose up --build`.
- `scripts/smoke.sh` is the end-to-end check. It first checks the web app (`GET /` serves the sign-in screen and the bundle names `API_URL`; `WEB_BROWSER=1` adds a headless Chromium sign-in that sees 60 free credits and the Practice tile), then health, dev sign-in and the new-account defaults, a practice match against the greedy bot over WebSocket (`scripts/ws-v2.cjs`) that ends with a log hash, the stored match and its messages, credits unchanged, and a two-client ranked match with Elo ±24 (placement K-factor) and both players in the current season. `API_URL`, `WS_URL` and `WEB_URL` point it at another stack, `SKIP_WEB=1` skips the web checks, and `SKIP_PVP=1` skips the ranked match. It prints PASS/FAIL per check and exits non-zero on any failure.
- Clean up afterwards. The disk has filled before.

  ```sh
  docker compose down -v --rmi local
  docker image prune -f && docker builder prune -af
  ```

One image recipe covers every service: `docker/node.Dockerfile` with `--build-arg APP=api|worker|realtime|migrate|web`. The web image is Next's standalone server (`next build` with `NEXT_OUTPUT=standalone`, `node apps/web/server.js` on port 3000); its build args are `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` and `NEXT_PUBLIC_AUTH_MODE`. If npm fails with `SELF_SIGNED_CERT_IN_CHAIN` behind a TLS-intercepting proxy, build with `docker build --secret id=npm_ca,src=<ca bundle> …`. Compose can't pass that secret without extra build permissions.

CI (`.github/workflows/ci.yml`) runs on pushes to `main` (merges included) and by hand from the Actions tab, not on PR branches. It has two jobs: `app` (`npm ci`, `npm run typecheck`, `npm test`; the Postgres and Redis suites skip without `TEST_DATABASE_URL` / `TEST_REDIS_URL`) and `contracts` (`cargo test` and `contracts/build.sh`, stable Rust + `rust-src`).

Before a push, typecheck and unit tests also run in the pre-push hook (`.githooks/pre-push`). Everything else runs on developers' machines, by hand: the Postgres/Redis tests (`TEST_DATABASE_URL`, `TEST_REDIS_URL`), web e2e (Playwright against `apps/web/scripts/dev-backend.sh`) and the full stack smoke (`npm run smoke`; README, "Full stack smoke" says when).

`.github/workflows/deploy.yml` redeploys staging (see "Deploy from CI" below).

## Environment

`docs/backend-contract.md` (Environment) is the reference, and `.env.example` lists every variable with its default. `@skirm/server` `loadConfig()` also reads `NODE_ENV`, `NEAR_RPC_FALLBACK_URL`, `PRIVY_APP_ID` and `PRIVY_VERIFICATION_KEY`. It refuses to start on an invalid value and names the variable, never its value.

## Staging (GCP)

The layout follows System Architecture, everything in `us-central1`. One project can hold several environments: every resource name carries the environment (`ENV=staging`, later `prod`). Staging runs in the project `enduring-wharf-488408-v4` (display name `connectly-group-13`, number `922833705583`).

| Piece | GCP (`<env>` = `staging`) | Notes |
| --- | --- | --- |
| `api` | Cloud Run service `api-<env>` | port 4000, 0–1 instances, concurrency 80 |
| `realtime` | Cloud Run service `realtime-<env>` | port 4001, min 1 / max 1, concurrency 1000, timeout 3600 s, session affinity, instance-based billing |
| `worker` | Cloud Run worker pool `worker-<env>` | 1 instance |
| `migrate` | Cloud Run job `migrate-<env>` | run before every deploy |
| `web` | Cloud Run service `web-<env>` | port 3000, 0–1 instances; image `web-<env>` is built per environment (public URLs are build args) |
| Postgres | Cloud SQL for PostgreSQL 16 `skirm-pg-<env>` | db-f1-micro, 10 GiB SSD, private IP |
| Redis | Memorystore for Redis `skirm-redis-<env>` | Basic, 1 GiB, `maxmemory-policy=noeviction` (BullMQ) |
| Maps | Cloud Storage | bucket `<project>-<env>-maps` (for later; maps are bundled) |
| Secrets | Secret Manager | `<env>-database-url`, `<env>-privy-verification-key`; optional `<env>-llm-api-key` (the model brain's `LLM_API_KEY`; the older `<env>-openrouter-api-key` still works as `OPENROUTER_API_KEY`), `<env>-bench-secret` (worker: keys the hidden benchmark picks), `<env>-near-ops-key`, `<env>-ops-token` (api only, turns on `GET /ops/stats` for the skirm-ops dashboard), `<env>-relayer-private-key` (api only: the gasless relayer's `RELAYER_PRIVATE_KEY`; needs the `RELAYER_ACCOUNT_ID` variable, and the deploy stops if only one of the two is set; [gasless.md](gasless.md)) |
| Skill vault key | Cloud KMS | key ring `skill-vault`, key `skill-prompt-kek-<env>` (`SKILL_KEK_KMS`) |
| Images | Artifact Registry | repo `skirm`, tagged with the commit |
| Runtime identity | service account `skirm-run-<env>` | reads only `<env>-*` secrets |

Postgres and Redis have no public endpoint. The Cloud Run pieces reach them through Direct VPC egress (`--network default --subnet default --vpc-egress private-ranges-only`). Cloud Run URLs are `https://<service>-<project number>.<region>.run.app`, so they are known before the first deploy.

### What the user supplies

- A GCP project with billing, and a deployer service account with Owner on it. Don't use the Compute Engine default service account: it only has Editor, which can't set IAM policies, read secrets, use KMS keys or create the VPC peering.
- An API key for an OpenAI-compatible model provider (default: OpenRouter with `anthropic/claude-haiku-5.5`). Without it every match plays the offline greedy brain and benchmarks and trials end `needs_model`; `scripts/deploy-gcp.sh` sets `V2_BRAIN=model` when `<env>-llm-api-key` (or the older `<env>-openrouter-api-key`) exists, `greedy` otherwise. Another provider or model: set the `LLM_BASE_URL`, `LLM_MODEL` (and optionally `LLM_PLANNER_MODEL`, `LLM_PRICE_INPUT_USD`, `LLM_PRICE_OUTPUT_USD`) repository variables, which `deploy.yml` passes to the script; unset keeps the defaults.
- The Privy app id and its **verification key** (Privy dashboard → Basics → API keys → "Verify with key instead"; a `-----BEGIN PUBLIC KEY-----` PEM, not the `privy_app_secret_…`). Add the web URL to Privy's allowed domains (Basics → Domains and clients). Never run a deployed environment with `AUTH_MODE=dev`: dev mode trusts any `x-dev-user` header.
- NEAR testnet accounts, with the contracts deployed (`contracts/README.md`, seasons included) and the `ops` account's key (`NEAR_OPS_ACCOUNT`, `<env>-near-ops-key`; a full-access key, see `contracts/README.md`). Without them the Noop adapters record ranked results as `local` and season pools read `local`.

### Match logs and the skill vault key

- **Match logs stay in Postgres:** each `v2_matches` row holds the hash-chained log and its `logHash`; ranked hashes go to the registry contract. Frames for `v2_replay` live in Redis for 6 hours. Nothing is written to Cloud Storage.
- **Cloud KMS wraps the skill data keys:** set `SKILL_KEK_KMS=projects/<project>/locations/<region>/keyRings/skill-vault/cryptoKeys/skill-prompt-kek-<env>` and leave `SKILL_KEK` unset. Each row's `key_id` records the wrapper (`gcp-kms:<key name>` or `local:<hash>`). Unwrapped data keys are cached in memory (LRU, 256 keys, 5 minutes) to limit KMS calls. The runtime account needs `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the key. Rotating the KMS key is safe, because KMS picks the key version on decrypt.
- **Precedence:** if `SKILL_KEK` is set, it seals new versions, and `SKILL_KEK_KMS` (if also set) only opens rows that KMS sealed. Rows sealed with a local KEK open only while that same `SKILL_KEK` is set; there is no re-wrap tool yet. So a deployed environment runs on KMS from day one and never sets `SKILL_KEK`.
- **Dev KEK:** with `NODE_ENV=production`, the built-in dev KEK and no `SKILL_KEK_KMS`, every service logs a loud `WARNING` at boot but still starts (the local docker run for judges sets production).

### One-time setup (per project, then per environment)

```sh
P=<project id> R=us-central1 ENV=staging
NUM=$(gcloud projects describe $P --format='value(projectNumber)')
gcloud config set project $P

# Per project
gcloud services enable run.googleapis.com artifactregistry.googleapis.com sqladmin.googleapis.com \
  redis.googleapis.com secretmanager.googleapis.com cloudkms.googleapis.com cloudbuild.googleapis.com \
  servicenetworking.googleapis.com compute.googleapis.com iam.googleapis.com cloudresourcemanager.googleapis.com
gcloud artifacts repositories create skirm --repository-format=docker --location=$R
gcloud kms keyrings create skill-vault --location=$R

# Private services access for Cloud SQL. On a fresh project the Service Networking agent may not exist
# yet ("Permission denied to add peering"): create it and give it its role first.
curl -fsS -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H 'Content-Type: application/json' -d '{}' \
  https://serviceusage.googleapis.com/v1beta1/projects/$P/services/servicenetworking.googleapis.com:generateServiceIdentity
gcloud projects add-iam-policy-binding $P --condition=None --role=roles/servicenetworking.serviceAgent \
  --member=serviceAccount:service-$NUM@service-networking.iam.gserviceaccount.com
gcloud compute addresses create google-managed-services --global --purpose=VPC_PEERING \
  --prefix-length=16 --network=default
gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services --network=default

# Per environment (create Cloud SQL only after the peering exists, or it fails)
gcloud sql instances create skirm-pg-$ENV --database-version=POSTGRES_16 --edition=enterprise \
  --tier=db-f1-micro --storage-type=SSD --storage-size=10 --region=$R --network=default --no-assign-ip \
  --backup-start-time=03:00 --retained-backups-count=14 \
  --enable-point-in-time-recovery --retained-transaction-log-days=7
gcloud sql databases create skirm --instance=skirm-pg-$ENV
gcloud redis instances create skirm-redis-$ENV --size=1 --tier=basic --region=$R \
  --redis-version=redis_7_2 --network=default
gcloud redis instances update skirm-redis-$ENV --region=$R --update-redis-config=maxmemory-policy=noeviction
gcloud storage buckets create gs://$P-$ENV-maps --location=$R --uniform-bucket-level-access
gcloud kms keys create skill-prompt-kek-$ENV --keyring=skill-vault --location=$R --purpose=encryption

# Runtime service account: only this environment's secrets and key
gcloud iam service-accounts create skirm-run-$ENV
SA=skirm-run-$ENV@$P.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding $P --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor \
  --condition="expression=resource.name.startsWith(\"projects/$NUM/secrets/$ENV-\"),title=$ENV-secrets-only"
gcloud kms keys add-iam-policy-binding skill-prompt-kek-$ENV --keyring=skill-vault --location=$R \
  --member=serviceAccount:$SA --role=roles/cloudkms.cryptoKeyEncrypterDecrypter
```

### Secrets

Create them from files so values never reach the shell history or a log, and delete the files afterwards.

```sh
umask 077
openssl rand -hex 24 > pgpw
gcloud sql users create skirm --instance=skirm-pg-$ENV --password="$(cat pgpw)"
PGIP=$(gcloud sql instances describe skirm-pg-$ENV --format='value(ipAddresses[0].ipAddress)')
printf 'postgres://skirm:%s@%s:5432/skirm' "$(cat pgpw)" "$PGIP" > dburl
gcloud secrets create $ENV-database-url --data-file=dburl

shred -u pgpw dburl

gcloud secrets create $ENV-privy-verification-key --data-file=privy-es256.pub.pem
# Optional: $ENV-llm-api-key (or the older $ENV-openrouter-api-key), $ENV-bench-secret (openssl rand -hex 32), $ENV-near-ops-key, $ENV-ops-token,
# $ENV-relayer-private-key (api only). The runtime account's secretAccessor binding above covers every $ENV- secret.
```

### Each deploy

```sh
PROJECT=<project id> PRIVY_APP_ID=<app id> scripts/deploy-gcp.sh      # ENV=staging by default
```

`scripts/deploy-gcp.sh` first works out what changed: each piece is compared with the commit its running image was built from (the image tag), and only pieces whose inputs differ are built and deployed (`SERVICES=all` deploys everything, `SERVICES=web,api` exactly those; the script header lists the inputs). A change to the lockfile, the Dockerfile, the script or `deploy.yml` redeploys everything; a change under `apps/web` or `packages/ui` deploys only web. It then builds missing images for the current commit on Cloud Build (`docker/cloudbuild.yaml` for migrate/api/worker/realtime, `docker/cloudbuild.web.yaml` for `web-<env>` with the environment's URLs and Privy app id), then deploys with `V2_BRAIN` and `SKILL_KEK_KMS` (no volume, no `SKILL_KEK`) in the System Architecture order: the `migrate-<env>` job, `api-<env>`, `worker-<env>`, `web-<env>`, and `realtime-<env>` last, because a new realtime revision ends live matches. Don't deploy during demo windows. It ends with `curl $API_URL/health`, which should return `{"ok":true}`.

Env vars and secrets are merged into each service (`--update-env-vars`, `--update-secrets`), not replaced, so a value set by hand on a service survives a deploy. The flip side: unsetting a variable (or deleting a repository variable) does not remove it from the service. Remove it once by hand, for example `gcloud run services update api-staging --region=us-central1 --remove-env-vars=LLM_MODEL` (and the same on the other services that have it).

Notes:
- `gcloud run worker-pools` uses gRPC. `scripts/deploy-gcp.sh` falls back to the REST API by itself. From an environment whose proxy only passes HTTPS/1.1 (Claude Code cloud sessions), create or update the worker pool with the Cloud Run v2 REST API instead (`POST https://run.googleapis.com/v2/projects/$P/locations/$R/workerPools?workerPoolId=worker-$ENV`, same env, secrets and `vpcAccess` as `api-<env>`, `scaling.manualInstanceCount: 1`).
- A proxy that attaches a GCP token to `*.run.app` requests gets `401 invalid_token` from the public services. Don't scope the GCP credential to `*.run.app`.
- All three backend services get the shared secret set for simplicity; `<env>-ops-token` and `<env>-relayer-private-key` go to the api only. To follow the trust table in System Architecture exactly, drop the model key (`LLM_API_KEY` / `OPENROUTER_API_KEY`; the api then casts replays with the template caster) and `BENCH_SECRET` from `api` and the Privy key from `worker`.
- `api`, `realtime` and `web` are public (`--allow-unauthenticated`), because the app does its own auth with Privy. `worker` and `migrate` have no endpoint.
- `scripts/smoke.sh` needs `AUTH_MODE=dev`, so it runs against local or a throwaway dev-auth stack only, never a deployed environment.
- Map files load from the bundled `spec/maps`. The `maps` bucket is for later.

### Deploy from CI

`.github/workflows/deploy.yml` runs `scripts/deploy-gcp.sh` for staging on every push to `main` (it does not wait for `ci`), and from the Actions tab ("Run workflow"). The Cloud Build image build is the only check: if an app fails to build, the script stops before anything is deployed. Deploys queue and never cancel each other. Each push deploys only the pieces whose inputs changed since their running image, so a frontend-only push leaves api, worker and realtime alone; a push that touches realtime's inputs still ends live matches. Run the workflow by hand with `services=all` after changing something outside git, such as a secret or a repository variable (including the `PUBLIC_*` URLs baked into web). `V2_BRAIN` is `model`, so staging matches, benchmarks and trials call the configured model (OpenRouter and `anthropic/claude-haiku-5.5` unless the `LLM_*` repository variables say otherwise) and spend from the `<env>-llm-api-key` (or `<env>-openrouter-api-key`) key; keep a spend limit on that key.

GitHub signs in with Workload Identity Federation (no key). The provider only accepts `TyronVT/skirm` on `refs/heads/main`, and the deployer account can attach only `skirm-run-<env>` and the Compute Engine default account (which Cloud Build runs as), and can't read secret values. One-time setup:

```sh
P=<project id> NUM=<project number>
SA=skirm-deploy-github@$P.iam.gserviceaccount.com
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc skirm --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == 'TyronVT/skirm' && assertion.ref == 'refs/heads/main'"
gcloud iam service-accounts create skirm-deploy-github --display-name="GitHub Actions deployer"
for role in run.admin cloudbuild.builds.editor serviceusage.serviceUsageConsumer viewer; do
  gcloud projects add-iam-policy-binding $P --member=serviceAccount:$SA --role=roles/$role --condition=None
done
gcloud storage buckets add-iam-policy-binding gs://${P}_cloudbuild --member=serviceAccount:$SA --role=roles/storage.objectAdmin
gcloud iam service-accounts add-iam-policy-binding skirm-run-staging@$P.iam.gserviceaccount.com \
  --member=serviceAccount:$SA --role=roles/iam.serviceAccountUser
# Cloud Build runs builds as the Compute Engine default account here; submitting one needs actAs on it.
gcloud iam service-accounts add-iam-policy-binding $NUM-compute@developer.gserviceaccount.com \
  --member=serviceAccount:$SA --role=roles/iam.serviceAccountUser
gcloud iam service-accounts add-iam-policy-binding $SA --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/TyronVT/skirm"
```

Repository variables (Settings → Secrets and variables → Actions → Variables; none are secret): `GCP_PROJECT`, `GCP_WIF_PROVIDER` (`projects/<number>/locations/global/workloadIdentityPools/github/providers/skirm`), `GCP_DEPLOY_SA` and `PRIVY_APP_ID`. Optional: `NEAR_OPS_ACCOUNT` (the platform signer; read only when the `<env>-near-ops-key` secret exists) and the model settings `LLM_BASE_URL`, `LLM_MODEL`, `LLM_PLANNER_MODEL`, `LLM_PRICE_INPUT_USD` and `LLM_PRICE_OUTPUT_USD` (unset: OpenRouter and its default model; the deploy sets `V2_BRAIN=model`, and without the `<env>-llm-api-key` or `<env>-openrouter-api-key` secret every agent plays the greedy brain). For the custom domain, also `PUBLIC_API_URL` (`https://api.playskirm.xyz`), `PUBLIC_WS_URL` (`wss://rt.playskirm.xyz/ws`) and `CORS_ORIGINS` (`https://playskirm.xyz,<web run.app URL>`); without them the deploy points web at the run.app URLs and the api refuses the custom domain's origin. Run `scripts/deploy-gcp.sh` by hand with the same three variables. Also optional, passed to the services only when set: `LLM_MODELS` (the per-agent model catalog, JSON; [economy.md](economy.md)), `BACKING_CONTRACT` (empty keeps writer backing off on staging), `NEAR_RENTALS_ONCHAIN`, `RELAYER_ACCOUNT_ID` and `RELAYER_FREE_TXS` (gasless onboarding, with the `<env>-relayer-private-key` secret), and `SAMPLE_MATCH_ID`, which is baked into the web image as `NEXT_PUBLIC_SAMPLE_MATCH_ID` (the ranked, recorded match behind `/verify`'s "Try a sample match"; empty hides the button). No value may contain `@`.

After changing a variable or a secret, run the deploy workflow by hand with `services=all`: the default `services=auto` redeploys only the pieces whose files changed, so a new value would wait for the next commit that touches each service (the web image built for a commit is reused, so a new `SAMPLE_MATCH_ID` lands with the next commit deployed with `services=web` or `all`).

## Backups and restore

Postgres holds everything that matters: accounts, the credits ledger, purchases, rental passes and
match history. The instance keeps a daily automated backup (03:00 UTC, 14 kept) and point-in-time
recovery (7 days of transaction logs), so it can be brought back to any second of the last week.

An instance created before these flags existed gets them with:

```bash
gcloud sql instances patch skirm-pg-$ENV --backup-start-time=03:00 --retained-backups-count=14 \
  --enable-point-in-time-recovery --retained-transaction-log-days=7
```

`ENV=staging PROJECT=$PROJECT scripts/check-backups.sh` checks it (read only): backups and
point-in-time recovery on, at least 7 kept, and a successful backup in the last 36 hours. It exits
non-zero when anything is off.

**Restore** never overwrites the live instance. Clone it to the moment before the damage, check the
clone, then point the services at it:

```bash
# 1. A new instance as it was at that moment (UTC); takes minutes.
gcloud sql instances clone skirm-pg-$ENV skirm-pg-$ENV-restore --point-in-time=2026-11-03T14:04:00Z
# 2. Check it: connect through the Cloud SQL proxy and look at the rows that went wrong.
# 3. Point DATABASE_URL at it: add a new version of the `$ENV-database-url` secret with the
#    clone's private IP, then redeploy api, realtime and worker ("Each deploy" above).
# 4. Once traffic runs on the clone and it looks right, delete the old instance or keep it for review.
```

To restore a whole daily backup instead: `gcloud sql backups list --instance=skirm-pg-$ENV`, then
`gcloud sql backups restore <BACKUP_ID> --restore-instance=skirm-pg-$ENV-restore --backup-instance=skirm-pg-$ENV`
(create the target instance first; restoring onto the live one replaces its data).

**Restore drill**, once a month and before mainnet: clone to a point in time, run
`SELECT count(*) FROM accounts; SELECT count(*) FROM ledger_rows;` on the clone, compare with the
live instance, then delete the clone. A backup that has never been restored is not a backup yet.

## Error reporting

Every service writes unexpected errors as structured log lines that Cloud Error Reporting groups on
its own (no SDK or key): api 5xx responses, realtime errors while handling a client message, and
unhandled rejections and uncaught exceptions in api, realtime and worker (an uncaught exception
exits the process, and Cloud Run starts a fresh instance). An event carries the error's name, code
and stack frames, the service and revision, and for the api the method and path. It never carries
the error message or a query string, which can quote secrets or user text.

To be told about new errors, turn on notifications once per project: Error Reporting in the console
→ "Configure notifications" → pick a notification channel (email or Slack). New error groups and
spikes then alert.

## Rate limits

The api counts every request per client in one-minute windows, with Redis counters shared by every
instance. The client is the `X-Forwarded-For` entry added by our own proxy, counted from the end
(`TRUSTED_PROXY_HOPS`: 1 on plain Cloud Run, 2 behind an external HTTPS load balancer), so a
client cannot pick a fresh bucket by sending its own header:

| Bucket | Default | Routes |
| --- | --- | --- |
| strict | 20 / min (`RATE_LIMIT_STRICT`) | `POST /auth/session`, `/credits/deposits`, `/rentals/:offerId`, `/market/:id/purchase`, `/listing`, `/trial`, `/skills/:id/mint`, `/cosmetics/:id/buy`: NEAR RPC, paid work, sign-in |
| general | 300 / min (`RATE_LIMIT_GENERAL`) | everything else; `GET /health` is never limited |

Over the limit: 429 `rate_limited` with `Retry-After`. If Redis is down the limiter lets requests
through rather than taking the api with it. The realtime server caps each connection at 30 messages
per 10 s (one `rate_limited` error, then the rest are dropped).

These limits stop one client flooding NEAR RPC or the queues. Volumetric attacks belong at the edge:
put the Cloud Run services behind an external HTTPS load balancer with a Cloud Armor policy (a
per-IP `rate-based-ban` rule, for example 600 requests per minute, and the preconfigured WAF rules).

## Cost alert

Milestones (Observability) asks for a cost alert, and System Architecture routes alerts through Cloud Logging/Monitoring and Billing budgets. The app can't reach those, so it writes a log line:

- worker and realtime add every model call's `costUsd` to a per-UTC-day total in Redis (`cost:usd:<YYYY-MM-DD>`, shared by all instances).
- When the day's total crosses 50 % and 80 % of `COST_ALERT_DAILY_USD` (default 10, `0` = off), one instance logs `cost_alert` at warn. At 100 % it logs at error. Fields: `day`, `level`, `spentUsd`, `budgetUsd`.
- On GCP, create a log-based metric on `jsonPayload.msg="cost_alert"` (the realtime line starts with `[realtime] cost_alert`) and alert on it in Cloud Monitoring. Keep the Billing budget and the provider spend limits on each key: they are the hard stops.
