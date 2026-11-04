# Development and testing

```sh
npm ci
npm test                          # every workspace through Turborepo (Vitest)
npm run typecheck && npm run build
cd contracts && cargo test        # the five NEAR contracts
```

`npm ci` also enables a pre-push hook ([`.githooks/pre-push`](../.githooks/pre-push)) that runs typecheck and test, plus `cargo test` when `contracts/` changed, for the commits being pushed. Don't skip it; fix what it finds.

| Suite | How to run |
| --- | --- |
| Postgres and Redis integration | Opt-in: set `TEST_DATABASE_URL` (a throwaway database) and `TEST_REDIS_URL` |
| Browser e2e | `V2_TICK_MS=200 apps/web/scripts/dev-backend.sh start`, then `npm run e2e -w @skirm/web` |
| Full stack smoke | `npm run smoke` (Docker; builds and starts the stack, runs `scripts/smoke.sh`, tears it down). Against a stack you started yourself: `V2_TICK_MS=200 docker compose up -d --build && scripts/smoke.sh` |

`scripts/smoke.sh` prints PASS or FAIL per check: the web app (and with `WEB_BROWSER=1` a headless sign-in that sees **60 free** and the Practice tile), health and sign-in, the new-account defaults, a practice match against the greedy bot over WebSocket that ends with a log hash, the stored match (ended, practice, same hash), its messages, credits untouched, and a two-client ranked match with Elo +24 / −24 (placement K-factor) and both players in the current season.

**CI** ([`ci.yml`](../.github/workflows/ci.yml)) runs on every push to `main` (pull requests are not checked in CI): typecheck and unit tests for every workspace, and the contracts (`cargo test` and the wasm build). The pre-push hook runs the same checks locally; browser e2e and the full stack smoke are run by hand (table above). [`deploy.yml`](../.github/workflows/deploy.yml) deploys what changed to staging on every push to `main` without waiting for CI; the Cloud Build image build, which runs each app's build, is its only check.

## Full stack smoke

`npm run smoke` builds the five images, starts them as a separate compose project (`skirm-smoke`) with `V2_BRAIN=greedy` and `V2_TICK_MS=200`, runs the smoke with the headless browser sign-in, and removes that project's containers, volumes and images. Your own `docker compose up` data is left alone, but the ports (3000, 4000, 4001) are shared, so stop dev servers and your own stack first. It needs Docker running and, once, `npx playwright install chromium` in `apps/web`. `WEB_BROWSER=0` skips the browser check and `SKIP_PVP=1` skips the two-client ranked match.

Run it before pushing, or before merging a PR, when a change is big or crosses services:

- it touches two or more of `apps/api`, `apps/worker`, `apps/realtime`, `apps/web`, or a shared package they all use (`packages/shared`, `packages/engine`, `packages/server`, `packages/db`);
- it adds a migration (`packages/db/migrations`), or changes `docker/`, `docker-compose.yml`, dependencies (`package-lock.json`) or configuration (`packages/server/src/config.ts`, `.env.example`);
- it changes the REST or WebSocket contract, matchmaking, practice, the match loop, credits or settlement;
- it is a release, or a merge of several PRs at once, about to reach staging.

To run it on every push from your machine, opt in once with `git config skirm.smoke true`. The pre-push hook then runs it after typecheck and test, and blocks the push if Docker isn't running. `SKIRM_SMOKE=0 git push` skips it for one push, and `git config --unset skirm.smoke` turns it off.
