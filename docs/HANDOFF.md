# Status and handoff (2026-11-01)

skirm is a NEAR Hackathon entry (1–14 Nov 2026, judging 16–18 Nov). Two crews of one to three AI agents play one mirrored map for five minutes; each agent's model acts and talks every 2 s tick. Players write hidden prompt **skills**, equip them on their agents, and trade them as NFTs on an Exchange that shows proof of how each version plays. Ranked matches feed per-player Elo and 14-day seasons with a NEAR prize pool.

## Source of truth

The game is defined by the *Skirm Arena Deck* (UI prototype) and *Skirm — Game Design v2* (design doc). Where the docs below disagree with those two, the two win; where a doc and the code disagree, this file and the code say which holds.

The platform docs on claude.ai call the game "Promptlings". Read them with the Claude Docs connector or the Artifact tool's `read` action, never web fetch. Local copies of them and of the artboards are in `.design-src/`.

| Doc | Link |
| --- | --- |
| Game Concept (main) | https://claude.ai/artifact/5UhnAPVmV6JfaP6c2gs1vR |
| Game Spec (build rulebook) | https://claude.ai/artifact/SoDsx1deNGMkh4iskJq4sy |
| Formulas | https://claude.ai/artifact/14sDQJK9TdYyan5aGfog7y |
| UI/UX Spec | https://claude.ai/artifact/267kvVM55hjgwQ3WG8Xzyn |
| System Architecture | https://claude.ai/artifact/HcjhXWULUoWDZZkDFd2xLG |
| Milestones | https://claude.ai/artifact/QBJF3BZCZ3XPfsJYRTtUMV |
| Design System (Design System artifact; files under `project/`) | https://claude.ai/artifact/Min655MxghPZs5tDwBwNMk |
| Screens (Design canvas, 22 artboards `project/*.dc.html`) | https://claude.ai/artifact/H5vUH42LAWdYYbPkBzKH9E |

[docs/backend-contract.md](backend-contract.md) fixes the REST routes, WebSocket messages, queues, pub/sub, the credits rule, env vars and new-account defaults. api, worker, realtime and web all build against it.

## Decisions

- **skirm everywhere:** contracts `*.playskirm.testnet`, UI package `@skirm/ui`, CSS prefix `sk-`, GCP staging in project `enduring-wharf-488408-v4` ([deploy.md](deploy.md)). Only the design docs say "Promptlings".
- **Git:** account `tyronvt` (TyronVT), remote `git@github.com-tyronvt:TyronVT/skirm.git`. Push and merge to `main` only with the user's OK; never `--no-verify`.
- **Models:** Haiku 5.5 plans, acts and speaks through OpenRouter (`anthropic/claude-haiku-5.5`).
- **Free allowance:** 60 credits a day, spent before paid credits.

## Status

The game is built end to end on `main`: practice against the greedy bot, casual and ranked matches, spectating, the comms transcript, seasons and the ladder, the Exchange with benchmark proof and trials, cosmetics, credits and the NEAR adapters. The checks before a merge are `npm run typecheck`, `npm test`, `npm run build`, `npm run test:scripts`, `npm run typecheck:scripts` and `cargo test` in `contracts/`.

The judge invariant: `apps/realtime/test/v2-practice.test.ts` plays a fresh account with no keys, the greedy brain, a full practice match and no credits spent.

### Verified without Docker

- `scripts/smoke.sh` (backend part, `SKIP_WEB=1`) was run against the real api and realtime apps in one process over PGlite with the greedy brain: 14/14 checks passed, practice and the two-client ranked match included. That harness was temporary and is not committed.
- `bash -n` on the shell scripts and `node --check scripts/ws-v2.cjs`.

### Not run on this machine

- `npm run smoke` (Docker): the web checks and the headless browser sign-in in `scripts/smoke.sh` have not been run against a built web image.
- The Playwright e2e (`practice.spec`, `pvp.spec`, `signin`, `account`, `skills`, `wallet`) against `apps/web/scripts/dev-backend.sh`.
- The opt-in Postgres and Redis tests (`TEST_DATABASE_URL`, `TEST_REDIS_URL`).
- The NEAR sandbox integration tests (compiled with `--features sandbox --no-run` only).

## Numbers for the user

- **Rates:** Quiet and Standard 20, Open 40 credits per 100 agent-ticks (0.20 / 0.20 / 0.40 per agent-tick). Holds over 150 ticks: 1 agent 30, 2 Standard (ranked) 60, 3 Standard 90, 2 Open 120.
- **Margin:** modeled cost is about $0.000168 per agent-tick ($0.001 a credit), so Quiet and Standard earn about 1.19× and Open about 2.4×, well under the markup target of 5. A unit test requires every tier to stay at least 1.15× the modeled cost.
- **More margin** is one config edit: Standard 30 / Open 60 with the allowance raised to 100 (`DEFAULTS.talk.ratePer100`, `DEFAULTS.free.dailyCredits`).
- **Global free budget:** 4,126 credits a day (`v2GlobalFreeBudget()`), about 68 free 60-credit players a day.
- **Credits per NEAR:** 1,000 (`DEFAULTS.credits.perNear`), so a 2-agent ranked match costs 60 credits = 0.06 NEAR.

## Needs the user

1. **Full stack smoke.** Run `npm run smoke` with Docker (README, "Full stack smoke") and the Playwright e2e before the next cross-service push.
2. **OpenRouter API key** (`OPENROUTER_API_KEY`, GCP `<env>-openrouter-api-key`). Without it every match plays greedy and benchmarks and trials end `needs_model`. With it: a real gauntlet run, a check of OpenRouter's billed `usage.cost` against `PRICES.haiku` before the rates are locked, and tuning of mid-match scoring stalls.
3. **NEAR:** the five contracts are live on testnet ([contracts/README.md](../contracts/README.md#deployed-on-testnet-2026-11-01)). Set `NEAR_OPS_ACCOUNT` and `<env>-near-ops-key` so the backend signs; the worker then opens the first season onchain and the market split funds its pool.
4. **Staging:** a private `<env>-bench-secret`, the Privy app id and verification key, and a deploy with `scripts/deploy-gcp.sh` (it picks Haiku when the OpenRouter secret exists; CI deploys staging with Haiku).
5. **Submission:** demo video and feature freeze, make `TyronVT/skirm` public, and the X post after the user approves the payload.

## Known limitations (deferred on purpose)

- **Agent rentals** are built (owner offers an agent per match, renter pays `market.rent`, 5% fee). The market contract needs a redeploy with `rent` before rentals work on testnet (dev mode works without it). Cosmetics are premium outfit and hair colours only (no 3D items).
- **Reconnecting through another realtime instance** works for spectators only; a player must reach the instance running their match.
- **Realtime has its own tick loop**, mirrored by `playHeadless`; they share `V2_REPLAN_EVERY` but are separate code.
- **Greedy** has no hazard lookahead (observe has no wave schedule); `PRACTICE_MAPS` avoids the maps where it plays badly.
- **Ledger** `hold()` takes a `runId` and a `stepLimit`; a match hold passes its credit amount as `stepLimit` with `agents: 1` (`apps/realtime/src/v2/credits.ts`). There is no speaker-pays row type.
- **Skills** use unlock items, not effect classes.
- **Skills contract `nft_mint`** is not idempotent onchain; the API claim plus the ownership fallback cover concurrent mints until a redeploy.
- **Production guards** for dev auth and the dev KEK are not enforced (compose sets `NODE_ENV=production` for the local judge run).
- **Replays** play stored frames (6 h in Redis); the engine does not re-simulate a log. The smoke checks the stored `logHash`.

### Spec conflicts

- **Formulas Elo example (+21 / −11) doesn't match its formula (+20 / −12).** The code follows the formula.

### Environment

- **`multer` advisory (high, DoS):** comes in through `@nestjs/platform-express`. It only matters for file uploads, and there are none.
- **Disk:** Docker images and `contracts/target` (about 3 GB, regenerable) fill the disk. Prune Docker after each end-to-end run (`docker compose down -v --rmi local && docker builder prune -af`).
