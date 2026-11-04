<div align="center">

# skirm

**Two crews of AI agents, one shared map, five minutes. You write the strategy; they play it.**

Write strategies in plain language, equip them on a crew, and send it against a rival crew on a mirrored map.
Strategies that win become tradeable NFTs on NEAR, with public proof of how they play.

[![CI](https://github.com/TyronVT/skirm/actions/workflows/ci.yml/badge.svg)](https://github.com/TyronVT/skirm/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-API-E0234E?logo=nestjs&logoColor=white)
![NEAR](https://img.shields.io/badge/NEAR-near--sdk%205-00C08B?logo=near&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose%20v2-2496ED?logo=docker&logoColor=white)

[Quick start](#quick-start) · [Judge path](#the-judge-path-free-no-keys) · [Walkthrough](docs/walkthrough.md) · [Architecture](#architecture) · [NEAR](#where-near-fits) · [Backend contract](docs/backend-contract.md) · [Deploy](docs/deploy.md)

</div>

---

## Overview

In skirm you don't move the pieces. You build a **crew** of one to three agents (Rook, Wren and Moss to start), give each a role, a talk tier and up to three **skills**: hidden prompt strategies such as *"find the one gap a spreading liquid needs and block it first"*. Two crews drop onto the same mirrored map, with water, fire and lava that spread in waves, switches that flood the rival's lane and supply drops worth fighting over. Every 2 seconds each agent's model acts and may speak, to its own crew or loud enough for the rival to overhear. The first crew to deliver the map's goal wins; otherwise the score at 150 ticks (5:00) decides.

Skills are **NEAR NFTs**. A strategy can be minted, proven on hidden benchmark seeds and in ranked play, and sold on the **Exchange**; its writer earns a royalty on every resale. Buyers get the right to *use* a skill, never its prompt text.

> Built for **NEAR Hackathon 2026**. Tracks: *Games With Real Economies*, *NFTs That Do Something*, *Agent Economy*.

### Why it works

A normal game would need code for every strategy-and-map combination. A language model can apply a general strategy to a map it has never seen, so players compete on the quality of their strategies and how their crews talk, not on hand-written bots. The engine is the referee: every match writes a hash-chained log of every action and every delivered line, and its hash is the proof of the result.

## Features

| | |
| --- | --- |
| ⚔️ **Ranked and casual matches** | Elo matchmaking over WebSocket, accept (10 s), lock-in (30 s, the rival hidden), then a 5-minute live match on one shared map. Spectate any live match. |
| 🤝 **Private lobbies and tournaments** | Challenge a friend with a share code on your map, difficulty, talk rule and crew size (unranked, credits as in casual). Brackets of 4, 8 or 16 seeded by Elo, the next round made as results come in, and an optional prize pool of paid credits for the top four. |
| 🎯 **Live commands** | Three orders a match (hold the gate, go for the drop, regroup, block the flow, or a short filtered line) to one agent or the whole crew. They land on the next tick, are written into the hash-chained log, and only your crew sees them. |
| 🥇 **Ranked tiers** | Bronze to Master from Elo after 5 placement matches, Elo decay for inactive Diamond and Master players, and leaderboards overall, per map and per skill. |
| 🚫 **Draft mode** | A casual queue where each crew bans one of the rival's equipped skills (by public name, never its prompt) before lock-in. Bans show in the debrief. |
| 🤖 **Practice vs Greedy bot** | Starts at once, no matchmaking, free on the offline brain: the judge path below. |
| 🗣️ **Talk** | Agents talk every tick. Lines pass a leak and abuse filter before anyone hears them; the rival overhears what is said in range. The debrief has the full transcript. |
| 🧠 **Skills as strategy** | Plain-language prompts, sealed in a vault and injected server-side into the agent's model call only. Only their creator ever sees the text. |
| ⏱️ **Skill triggers** | A skill can play only when its condition holds: a hazard within N tiles, behind or ahead on score, the rival near a switch, carrying an item, or under N seconds left. Triggers are public on the Exchange; the prompt stays sealed. |
| 🔍 **"Why did it do that?"** | After a match, a per-agent, per-tick timeline: what the agent saw, the crew plan, what it did and which skill drove it, with key moments on a scrubber. Players see only their own crew. |
| 🎬 **Shareable replays** | A revocable public link to a replay or a clip, highlight moments with jump buttons, a one-line caster per highlight and a link preview image. Shared replays never show plans, inner voice or crew commands. |
| 🧭 **Onboarding** | A guided first match against the bot with tips at each phase, six starter strategies to copy into a draft, and a first-steps checklist on Home. |
| 🧪 **Exchange proof** | Every minted version gets a hidden benchmark (6 seeded matches, half with hijack lines) with win, leak and manipulation rates, ranked stats per map, head-to-head counters and 3 free trials for buyers. |
| 🏆 **Seasons** | 14-day ladders from ranked matches (win 25, draw 12, loss 5 points). The top 10 split a NEAR pool: 30 / 20 / 15 % then 5 % × 7. |
| 🎯 **Quests and achievements** | 3 daily and 2 weekly quests drawn per UTC day and week, play streaks, permanent achievements, each mintable as a soulbound badge on NEAR. Quest rewards refill free credits inside the global free budget. |
| 🎨 **Cosmetics** | Premium outfit and hair colours, bought with paid credits. Purely visual. |
| 💳 **Credits** | Quiet and Standard 0.20, Open 0.40 credits per agent-tick, held up front and charged as the match plays. 60 free credits a day. |

## Quick start

**Prerequisite:** Docker with Compose v2. No API keys or wallet needed.

```sh
git clone https://github.com/TyronVT/skirm.git && cd skirm
docker compose up --build
```

Open **http://localhost:3000** and sign in with any handle. The first build takes a few minutes. When `docker compose ps` shows `web`, `api` and `realtime` as healthy, you're ready. For quicker matches (2 s ticks make a match up to 5 minutes), start with `V2_TICK_MS=200 docker compose up --build`.

| Service | URL | Role |
| --- | --- | --- |
| `web` | http://localhost:3000 | Next.js app (every screen) |
| `api` | http://localhost:4000 | REST API (`GET /health` → `{"ok":true}`) |
| `realtime` | ws://localhost:4001/ws | Matchmaking, live matches, spectating |
| `worker` | (no port) | Skill benchmarks and trials, seasons, registry writes, the official skills seed |
| `postgres`, `redis`, `migrate` | (internal) | Data, queues, one-shot migrations |

Stop and clean up with `docker compose down -v`.

### The judge path (free, no keys)

1. Sign in with any handle. Home shows **60 free** credits in the account dock.
2. Click the **Practice** tile (**Vs Greedy bot**, Copper Hollow, Easy). The crew screen opens with **Vs Greedy bot** on and Rook in the crew.
3. Click **Start practice**. The match opens at once: **Accept**, then **Lock in**. The hold reads **Free practice · nothing is held or charged**.
4. Watch the crews play out on the shared map, then read the verdict, the match log hash and the comms transcript in the debrief.

The stack runs the offline greedy brain by default, so nothing calls a model and practice costs nothing. The [walkthrough](docs/walkthrough.md) covers this and every other flow (ranked in two browsers, spectating, the Exchange proof and trials, cosmetics, credits and profile) with the `data-testid` to look for at each step, plus an [API-only path](docs/walkthrough.md#api-only-path-for-agents) with `curl` and a WebSocket client.

## Configuration

The defaults run fully offline:

| Variable | Default | Effect |
| --- | --- | --- |
| `AUTH_MODE` | `dev` | Sign in with any handle, no password. Never use it in a deployed environment. |
| `V2_BRAIN` | `greedy` | The offline greedy brain plays every agent: no model calls, no spend, practice is free. It ignores skills and talk, so benchmarks and trials end **needs model** with no score. |
| `V2_TICK_MS` | 2000 | Tick length in ms (at least 50). `200` plays a match in under a minute. |

### Real models

To have Haiku 5.5 plan, act and talk for every agent (through OpenRouter, `anthropic/claude-haiku-5.5`), add a key to a `.env` file next to `docker-compose.yml` (see [`.env.example`](.env.example)) and restart. No rebuild is needed.

```sh
echo 'V2_BRAIN=haiku'                >> .env
echo 'OPENROUTER_API_KEY=sk-or-...'  >> .env
docker compose up -d
```

With a model, skills change how agents play, the worker runs real benchmarks and trials, and practice is charged at the normal rates (it fits in the free 60). Results vary from match to match.

### Serving on another host

Next.js bakes public URLs into the bundle at build time, so set all three variables and rebuild:

```sh
PUBLIC_API_URL=http://myhost:4000 PUBLIC_WS_URL=ws://myhost:4001/ws \
CORS_ORIGINS=http://myhost:3000 docker compose up --build
```

## Economy

Credits are integers, $0.001 each at an assumed $1 NEAR (1,000 credits per NEAR).

- **Talk tiers.** Quiet 20, Standard 20, Open 40 credits per 100 agent-ticks, so 0.20 / 0.20 / 0.40 credits per agent-tick. Quiet makes the same model calls as Standard; it buys stealth, not a discount. Ranked plays every agent at Standard.
- **Holds.** At lock-in a crew holds the whole match, `ceil(150 ticks × Σ rate / 100)`: 30 for one agent, 60 for a 2-agent ranked crew, 90 for three, 120 for two Open agents. Each tick charges only the whole credits its running total crosses, and the rest comes back at the end (all of it on a void match).
- **Free allowance.** 60 credits a day (reset 00:00 UTC), spent before paid credits: one 2-agent ranked match or two 1-agent matches. All free allowances together are capped at 4,126 credits a day (about 68 free 60-credit players).
- **Quests.** A reward (10 daily, 25 weekly) refills free credits already spent today, never past 60, and holds still stop at the global cap, so quests never raise free spend above 4,126 a day; a player who claims everything can use up to 140 free in a day. Some achievements grant a premium cosmetic.
- **Practice.** The bot never pays. On the greedy brain the player pays nothing either.
- **Margin.** The modeled cost is about $0.000168 per agent-tick, so Quiet and Standard earn about 1.19× and Open about 2.4×. Standard 30 / Open 60 with a 100-credit allowance is a single config edit (`DEFAULTS.talk.ratePer100`, `DEFAULTS.free.dailyCredits` in `packages/shared/src/config.ts`).
- **Paid credits** come from NEAR deposits to the `deposits` contract. They also buy premium cosmetics; the free allowance never does.

## Architecture

```
browser ── Next.js web (:3000)
   │  REST                       │  WebSocket
   ▼                             ▼
 api (NestJS, :4000)         realtime (:4001/ws) ── matchmaking, accept, lock-in, 2 s tick loop,
   │  BullMQ jobs                │                   brains (Haiku 5.5 | greedy), talk filter,
   ▼                             │                   holds and charges, settlement, live frames
 worker ── benchmarks and trials (headless v2 runner), season tick, registry writes, skills seed
   │                             │  Redis pub/sub: spectating across instances
 Postgres (accounts, Elo, credits ledger, skills, v2 matches, messages, seasons, proof)   Redis (queues, pub/sub, frames)
   │
 NEAR adapters (skills, market, registry, deposits, seasons): no-op locally, contract calls when a signer is set
```

- **Engine** (`packages/engine/src/v2`): the shared-map tick (act, resolve together, environment, deliver messages, goal), fog, knock-downs, waves, switches and supply drops, the ten maps and the hash-chained match log.
- **Brains** (`packages/decision-engine/src/v2`): Haiku 5.5 through OpenRouter acts and speaks in one call per agent per tick under a 1.5 s deadline and rewrites the crew plan every 25 ticks; the greedy brain plays without keys. `playHeadless` runs a whole match off the clock for benchmarks and trials.
- **Skill vault** (`packages/server`): prompts are encrypted at rest (Cloud KMS in deployments) and never returned to anyone but their creator.
- **Credits** (`packages/ledger`): hold, charge and settle, with the free daily allowance spent first.

Routes, WebSocket messages, queues and environment variables are in [docs/backend-contract.md](docs/backend-contract.md). Deployment (Compose and GCP Cloud Run) is in [docs/deploy.md](docs/deploy.md).

### Tech stack

**Frontend:** Next.js 16, React 19, `@skirm/ui` design system, isometric canvas arena, Playwright
**Backend:** NestJS, BullMQ, WebSocket, Drizzle ORM, PostgreSQL, Redis
**AI:** Claude Haiku 5.5 through OpenRouter
**Chain:** NEAR (Rust, near-sdk 5), NEP-171 / NEP-199 / NEP-297
**Tooling:** Turborepo, TypeScript, Vitest, Docker, GitHub Actions, Google Cloud Run

## Where NEAR fits

Only what needs trust or ownership goes onchain: skill ownership, trades, royalties, ranked match results with per-player Elo, deposits and season prize pools. Prompts, the simulation and match logs stay offchain. The log hash in the registry lets anyone check a match against its record.

| Contract | Testnet account | Responsibility |
| --- | --- | --- |
| `skills` | `skills.playskirm.testnet` | NEP-171 skill NFTs (one token per version) with NEP-199 royalties |
| `market` | `market.playskirm.testnet` | List, delist, reprice and buy. Pays the 5 % platform fee, creator royalty and seller; sends 30 % of each fee to the season pool. Fee changes wait 24 h under a 10 % cap |
| `registry` | `registry.playskirm.testnet` | Ranked v2 match records (`MatchRecordV2`): log hash, per-player Elo, per-season standings |
| `deposits` | `deposits.playskirm.testnet` | `deposit()` top-ups that emit a NEP-297 event for the credits ledger |
| `seasons` | `seasons.playskirm.testnet` | One NEAR pool per 14-day season, paid to the top 10 by pull (`claim`) |
| `badges` | `badges.playskirm.testnet` (not deployed yet) | Soulbound achievement badges (NEP-171 shape, never transferable), minted by the ops account |

### Status

| Area | State |
| --- | --- |
| Contracts | ✅ Unit-tested (`cd contracts && cargo test`) · ✅ skills, market, registry, deposits and seasons deployed on testnet ([contracts/README.md](contracts/README.md#deployed-on-testnet-2026-11-01)) |
| Signer path (`nft_mint`, `record_match`, season writes) | ✅ Unit-tested · ⏳ goes live once a deployment sets `NEAR_OPS_ACCOUNT` / `NEAR_OPS_KEY` |
| Local stack | No-op adapters. Ranked results show registry status `local` with a `noop:` hash; season pools read `local` |
| Deposits and purchases | Accept `dev:<yocto>` hashes in dev mode only. Otherwise verified through NEAR RPC |
| Wallets | NEAR Connect (HOT, Meteor, MyNearWallet, …) outside dev mode; dev mode trusts the typed account id |

## Repository layout

```
apps/
  web/              Next.js 16 app: sign-in, Command deck, crew, match, debrief, Exchange, hub, ladder, account; Playwright e2e
  api/              NestJS REST API
  worker/           Benchmarks and trials, season tick, registry consumer, official skills seed
  realtime/         WebSocket hub: matchmaking, practice, the match loop, settlement, spectating relay
packages/
  engine/           v2 shared-map engine, maps, match log, practice data
  decision-engine/  v2 brains (Haiku 5.5 via OpenRouter, greedy), speech filter, headless runner
  ledger/           Credits ledger state machine
  db/               Drizzle schema, migrations, repositories, starter account, official skills
  server/           Config, auth, skill vault, queues, channels, v2 message types, NEAR adapters
  shared/           Shared types, talk rates, Elo, seasons, market split, appearance palettes
  ui/               @skirm/ui design system components
contracts/          NEAR contracts: skills, market, registry, deposits, seasons
spec/               The ten v2 maps (maps/v2/*.json), written by scripts/export-v2-maps.ts
docker/             One Dockerfile for every service (--build-arg APP=api|worker|realtime|migrate|web)
scripts/            smoke.sh end-to-end check, ws-v2.cjs match client, v2 map export, GCP deploy, testnet contract deploy
docs/               Walkthrough, backend contract, deploy guide, benchmarks
```

## Testing

```sh
npm ci
npm test                          # every workspace through Turborepo (Vitest)
npm run typecheck && npm run build
cd contracts && cargo test        # the NEAR contracts
```

`npm ci` also enables a pre-push hook ([`.githooks/pre-push`](.githooks/pre-push)) that runs typecheck and test, plus `cargo test` when `contracts/` changed, for the commits being pushed. Don't skip it; fix what it finds.

| Suite | How to run |
| --- | --- |
| Postgres and Redis integration | Opt-in: set `TEST_DATABASE_URL` (a throwaway database) and `TEST_REDIS_URL` |
| Browser e2e | `V2_TICK_MS=200 apps/web/scripts/dev-backend.sh start`, then `npm run e2e -w @skirm/web` |
| Full stack smoke | `npm run smoke` (Docker; builds and starts the stack, runs `scripts/smoke.sh`, tears it down). Against a stack you started yourself: `V2_TICK_MS=200 docker compose up -d --build && scripts/smoke.sh` |

`scripts/smoke.sh` prints PASS or FAIL per check: the web app (and with `WEB_BROWSER=1` a headless sign-in that sees **60 free** and the Practice tile), health and sign-in, the new-account defaults, a practice match against the greedy bot over WebSocket that ends with a log hash, the stored match (ended, practice, same hash), its messages, credits untouched, and a two-client ranked match with Elo +24 / −24 (placement K-factor) and both players in the current season.

**CI** ([`ci.yml`](.github/workflows/ci.yml)) runs on every pull request and every push to `main`: typecheck and unit tests for every workspace, and the contracts (`cargo test` and the wasm build). The pre-push hook runs the same checks locally; browser e2e and the full stack smoke are run by hand (table above). [`deploy.yml`](.github/workflows/deploy.yml) deploys what changed to staging on every push to `main` without waiting for CI; the Cloud Build image build, which runs each app's build, is its only check.

### Full stack smoke

`npm run smoke` builds the five images, starts them as a separate compose project (`skirm-smoke`) with `V2_BRAIN=greedy` and `V2_TICK_MS=200`, runs the smoke with the headless browser sign-in, and removes that project's containers, volumes and images. Your own `docker compose up` data is left alone, but the ports (3000, 4000, 4001) are shared, so stop dev servers and your own stack first. It needs Docker running and, once, `npx playwright install chromium` in `apps/web`. `WEB_BROWSER=0` skips the browser check and `SKIP_PVP=1` skips the two-client ranked match.

Run it before pushing, or before merging a PR, when a change is big or crosses services:

- it touches two or more of `apps/api`, `apps/worker`, `apps/realtime`, `apps/web`, or a shared package they all use (`packages/shared`, `packages/engine`, `packages/server`, `packages/db`);
- it adds a migration (`packages/db/migrations`), or changes `docker/`, `docker-compose.yml`, dependencies (`package-lock.json`) or configuration (`packages/server/src/config.ts`, `.env.example`);
- it changes the REST or WebSocket contract, matchmaking, practice, the match loop, credits or settlement;
- it is a release, or a merge of several PRs at once, about to reach staging.

To run it on every push from your machine, opt in once with `git config skirm.smoke true`. The pre-push hook then runs it after typecheck and test, and blocks the push if Docker isn't running. `SKIRM_SMOKE=0 git push` skips it for one push, and `git config --unset skirm.smoke` turns it off.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/walkthrough.md](docs/walkthrough.md) | "Do X, see Y" tour with testids, and an API-only path |
| [docs/backend-contract.md](docs/backend-contract.md) | REST routes, WebSocket messages, queues, pub/sub, credits rule, environment |
| [docs/deploy.md](docs/deploy.md) | Docker Compose and GCP Cloud Run deployment |
| [docs/benchmarks.md](docs/benchmarks.md) | The skill benchmark gauntlet and trials |
| [contracts/README.md](contracts/README.md) | Contract build, tests, deploy and sandbox integration tests |
| [apps/web/README.md](apps/web/README.md) | Web app development and e2e |
