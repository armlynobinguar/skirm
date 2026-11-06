# syntax=docker/dockerfile:1
#
# One image recipe for the Node services (System Architecture, Service inventory):
#   APP=api | worker | realtime   NestJS app, bundled by its own tsup.config.ts (apps/$APP,
#                                 `npm run build -w @skirm/$APP`; workspace deps are bundled from
#                                 source, so no upstream package builds are needed)
#   APP=migrate                   the @skirm/db migrate CLI, bundled by docker/tsup.migrate.config.ts
#   APP=web                       apps/web (Next.js), `next build` with NEXT_OUTPUT=standalone
#
#   docker build -f docker/node.Dockerfile --build-arg APP=api -t skirm-api .
#
# The api/worker/realtime/migrate images run `node dist/main.js` as the unprivileged `node` user.
# Workspace packages (@skirm/*) are bundled into dist/; third-party runtime deps come from a
# production-only `npm ci --omit=dev --workspace` of that app (packages/db for migrate), kept in the
# workspace layout so bundles resolve them by walking up.
#
# The web image runs Next's self-contained standalone server (apps/web/server.js, port 3000) and
# needs no npm install of its own. NEXT_PUBLIC_* values are inlined into the browser bundle at build
# time, so the public URLs the browser uses are build args:
#   --build-arg NEXT_PUBLIC_API_URL=http://localhost:4000      (default)
#   --build-arg NEXT_PUBLIC_WS_URL=ws://localhost:4001/ws      (default)
#   --build-arg NEXT_PUBLIC_AUTH_MODE=dev                      (default)
#
# Behind a TLS-intercepting proxy, pass its CA bundle as an optional build secret:
#   docker build --secret id=npm_ca,src=/path/to/ca.crt ...

ARG NODE_VERSION=26
# Picks the final stage (runtime-node or runtime-web, see the bottom of this file).
ARG APP

# ---------- base ----------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
# bufferutil and utf-8-validate (via ws) ship no linux-arm64 prebuilds, so on arm64 (Docker on
# Apple Silicon) npm compiles them with node-gyp. amd64 (Cloud Build) uses the prebuilds and skips
# this. Build stages only: the runtime stages start again from the bare node image.
RUN if [ "$(uname -m)" = aarch64 ]; then \
      apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
      && rm -rf /var/lib/apt/lists/*; \
    fi
WORKDIR /repo

# ---------- manifests: only package.json files + lockfile, so dependency layers stay cached ----------
FROM base AS manifests
COPY . /src
RUN mkdir -p /out \
 && cp /src/package.json /src/package-lock.json /out/ \
 && cd /src \
 && find apps packages -mindepth 2 -maxdepth 2 -name package.json -exec cp --parents {} /out/ \;

# ---------- deps: full install (build tools: tsup, @swc/core) ----------
FROM base AS deps
COPY --from=manifests /out/ ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci

# ---------- prod-deps: runtime dependencies of this APP's workspace only ----------
# `--workspace` installs just that workspace's tree (its @skirm/* deps' third-party deps included),
# not every app's: migrate (packages/db) needs only pg, and no image carries Next.js or React.
FROM base AS prod-deps
ARG APP
COPY --from=manifests /out/ ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    case "${APP:-}" in migrate) ws=@skirm/db ;; *) ws="@skirm/${APP}" ;; esac; \
    npm ci --omit=dev --workspace "$ws"

# ---------- build ----------
FROM deps AS build
ARG APP
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:4001/ws
ARG NEXT_PUBLIC_AUTH_MODE=dev
ARG NEXT_PUBLIC_PRIVY_APP_ID=
ARG NEXT_PUBLIC_PRIVY_CLIENT_ID=
ARG NEXT_PUBLIC_NEAR_NETWORK=testnet
ARG NEXT_PUBLIC_NEAR_CONTRACT_SKILLS=skills.playskirm.testnet
ARG NEXT_PUBLIC_NEAR_CONTRACT_MARKET=market.playskirm.testnet
ARG NEXT_PUBLIC_NEAR_CONTRACT_DEPOSITS=deposits.playskirm.testnet
ARG NEXT_PUBLIC_NEAR_CONTRACT_REGISTRY=registry.playskirm.testnet
ARG NEXT_PUBLIC_SAMPLE_MATCH_ID=
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN set -eu; \
    case "${APP:-}" in \
      api|worker|realtime) \
        npm run build --workspace "@skirm/${APP}"; \
        src="apps/${APP}/dist"; dir="apps/${APP}" ;; \
      migrate) \
        npx tsup --config docker/tsup.migrate.config.ts; \
        src="dist/migrate"; dir="packages/db" ;; \
      web) \
        NEXT_OUTPUT=standalone NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL}" \
          NEXT_PUBLIC_WS_URL="${NEXT_PUBLIC_WS_URL}" NEXT_PUBLIC_AUTH_MODE="${NEXT_PUBLIC_AUTH_MODE}" \
          NEXT_PUBLIC_PRIVY_APP_ID="${NEXT_PUBLIC_PRIVY_APP_ID}" \
          NEXT_PUBLIC_PRIVY_CLIENT_ID="${NEXT_PUBLIC_PRIVY_CLIENT_ID}" \
          NEXT_PUBLIC_NEAR_NETWORK="${NEXT_PUBLIC_NEAR_NETWORK}" \
          NEXT_PUBLIC_NEAR_CONTRACT_SKILLS="${NEXT_PUBLIC_NEAR_CONTRACT_SKILLS}" \
          NEXT_PUBLIC_NEAR_CONTRACT_MARKET="${NEXT_PUBLIC_NEAR_CONTRACT_MARKET}" \
          NEXT_PUBLIC_NEAR_CONTRACT_DEPOSITS="${NEXT_PUBLIC_NEAR_CONTRACT_DEPOSITS}" \
          NEXT_PUBLIC_NEAR_CONTRACT_REGISTRY="${NEXT_PUBLIC_NEAR_CONTRACT_REGISTRY}" \
          NEXT_PUBLIC_SAMPLE_MATCH_ID="${NEXT_PUBLIC_SAMPLE_MATCH_ID}" \
          npm run build --workspace @skirm/web; \
        test -f apps/web/.next/standalone/apps/web/server.js \
          || { echo "apps/web/.next/standalone/apps/web/server.js was not produced" >&2; exit 1; }; \
        mkdir -p /out && cp -R apps/web/.next/standalone/. /out/; \
        cp -R apps/web/.next/static /out/apps/web/.next/static; \
        if [ -d apps/web/public ]; then cp -R apps/web/public /out/apps/web/public; fi; \
        exit 0 ;; \
      *) echo "APP build-arg must be api, worker, realtime, migrate or web (got '${APP:-}')" >&2; exit 1 ;; \
    esac; \
    test -f "${src}/main.js" || { echo "${src}/main.js was not produced" >&2; exit 1; }; \
    mkdir -p "/out/${dir}" && cp -R "${src}" "/out/${dir}/dist"

# ---------- runtime: web (Next standalone server) ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime-web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    SKIRM_APP=web \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# standalone/ holds server.js, the traced node_modules and the workspace sources it needs.
COPY --from=build --chown=root:root /out/ ./
# Next may write its cache (.next/cache) at runtime.
RUN mkdir -p /app/apps/web/.next/cache && chown -R node:node /app/apps/web/.next/cache
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "server.js"]

# ---------- runtime: api, worker, realtime, migrate ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime-node
ARG APP
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    SKIRM_APP=${APP}
WORKDIR /app
COPY --from=prod-deps --chown=root:root /repo/ ./
# Map files, for code that reads them from disk rather than from the bundle.
COPY --chown=root:root spec ./spec
# The bundle sits in its workspace folder (apps/$APP/dist, or packages/db/dist for migrate) so
# that non-hoisted deps resolve exactly as in the repo; /app/svc links to that folder.
COPY --from=build --chown=root:root /out/ ./
RUN set -eu; \
    case "${APP}" in migrate) dir=packages/db ;; *) dir="apps/${APP}" ;; esac; \
    ln -s "/app/${dir}" /app/svc
WORKDIR /app/svc
USER node
EXPOSE 4000 4001
CMD ["node", "--enable-source-maps", "dist/main.js"]

# ---------- final stage, chosen by APP ----------
FROM runtime-node AS runtime-api
FROM runtime-node AS runtime-worker
FROM runtime-node AS runtime-realtime
FROM runtime-node AS runtime-migrate
FROM runtime-${APP} AS runtime
