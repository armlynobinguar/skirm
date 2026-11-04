<div align="center">

# skirm

**Two crews of AI agents, one shared map, five minutes. You write the strategy; they play it.**

[![CI](https://github.com/TyronVT/skirm/actions/workflows/ci.yml/badge.svg)](https://github.com/TyronVT/skirm/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![NEAR](https://img.shields.io/badge/NEAR-testnet-00C08B?logo=near&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

[Quick start](#quick-start) · [Try it](#try-it-in-two-minutes) · [How it works](#how-it-works) · [NEAR](#where-near-fits) · [Docs](#documentation)

<img src="docs/media/gameplay.gif" alt="A live skirm match in third person: an agent moves across the shared map while its crew talks" width="820">

</div>

## What is skirm?

In skirm you don't move the pieces. You build a **crew** of up to three AI agents and give them **skills**: plain-language strategies such as *"find the one gap a spreading liquid needs and block it first"*. Two crews drop onto the same mirrored map, with water, fire and lava that spread in waves, switches that flood the rival's lane and supply drops worth fighting over. Every tick each agent's model acts and may speak, to its crew or loud enough for the rival to overhear. The first crew to deliver the goal wins.

Skills are **NFTs on NEAR**. A strategy can be minted, proven on hidden benchmark seeds, and sold on the **Exchange**, and its writer earns a royalty on every resale. Buyers get the right to *use* a skill, never to read its prompt.

> Built for **NEAR Hackathon 2026**: *Games With Real Economies*, *NFTs That Do Something*, *Agent Economy*.

<table>
  <tr>
    <td><img src="docs/media/home.png" alt="Command deck"></td>
    <td><img src="docs/media/live-overview.png" alt="Live match, overview"></td>
  </tr>
  <tr>
    <td align="center"><sub>Command deck</sub></td>
    <td align="center"><sub>Live match on a shared map</sub></td>
  </tr>
  <tr>
    <td><img src="docs/media/live-third-person.png" alt="Third person with the agent's mind"></td>
    <td><img src="docs/media/debrief.png" alt="Debrief"></td>
  </tr>
  <tr>
    <td align="center"><sub>Third person: the agent's plan and inner voice</sub></td>
    <td align="center"><sub>Debrief with the verifiable match log hash</sub></td>
  </tr>
</table>

## Features

**Play**
- **Ranked and casual** matches with Elo matchmaking, ranked tiers from Bronze to Master, and 14-day seasons with a NEAR prize pool
- **Practice** against the Greedy bot, free and instant, plus a guided first match for new players
- **Private lobbies and tournaments**: challenge a friend with a code, or run a 4 to 16 player bracket
- **Draft mode**: each crew bans one of the rival's skills before the match
- **Live commands**: three orders a match to steer your crew without taking control

**Strategy**
- **Skills** are sealed prompts injected server-side; only their writer ever sees the text
- **Skill triggers** make a skill play only when its condition holds (hazard close, behind on score, time running out)
- **Talk**: agents coordinate every tick, and the rival overhears what is said in range. A leak and abuse filter checks every line
- **"Why did it do that?"**: after a match, a per-agent, per-tick timeline of what it saw, planned and did, and which skill drove it

**Watch and share**
- **Spectate** any live match, or follow one agent in third person
- **Shareable replays**: public links and clips with highlights and a one-line caster

**Own and trade**
- **Exchange**: mint, list and buy skills as NEAR NFTs, with creator royalties on every resale
- **Proof**: every minted version gets a hidden benchmark (win, leak and manipulation rates), ranked stats per map, and 3 free trials for buyers

## Quick start

Requires **Docker** with Compose v2. No API keys or wallet needed.

```sh
git clone https://github.com/TyronVT/skirm.git && cd skirm
docker compose up --build
```

Open **http://localhost:3000** and sign in with any handle. For quick matches, start with `V2_TICK_MS=200 docker compose up --build`. Stop with `docker compose down -v`.

### Try it in two minutes

1. Sign in with any handle. Home shows **60 free** credits.
2. Click **Practice** (Vs Greedy bot, Copper Hollow, Easy), then **Start practice**.
3. **Accept**, then **Lock in**. Practice is free.
4. Watch the match. Press **V** for third person and **←/→** to switch agents.
5. Read the verdict, the match log hash and the comms transcript in the debrief.

The stack runs the offline **greedy brain** by default, so nothing calls a model. The [walkthrough](docs/walkthrough.md) covers every other flow, including ranked play in two browsers, spectating, the Exchange and an API-only path.

### Real models

To have Claude Haiku 5.5 plan, act and talk for every agent through OpenRouter:

```sh
echo 'V2_BRAIN=haiku'               >> .env
echo 'OPENROUTER_API_KEY=sk-or-...' >> .env
docker compose up -d
```

With a model, skills change how agents play and benchmarks run for real. See [`.env.example`](.env.example) for every setting.

## How it works

```
browser ── Next.js web (:3000)
   │ REST                         │ WebSocket
   ▼                              ▼
 api (NestJS, :4000)          realtime (:4001) ── matchmaking, tick loop, brains, talk filter, settlement
   │ BullMQ                       │
   ▼                              │ Redis pub/sub (spectating across instances)
 worker ── benchmarks, trials, seasons, registry writes
   │
 Postgres · Redis · NEAR contracts (skills, market, registry, deposits, seasons)
```

- **Engine**: a deterministic shared-map tick with fog, hazards in waves, switches and supply drops. Every match writes a **hash-chained log** of every action and every delivered line; its hash is the proof of the result.
- **Brains**: Claude Haiku 5.5 acts and speaks in one call per agent per tick and replans the crew every 25 ticks. A greedy brain plays without keys.
- **Skill vault**: prompts are encrypted at rest and only decrypted for the agent's model call.
- **Credits**: a ledger that holds credits at lock-in and charges per tick, with a free daily allowance. See [docs/economy.md](docs/economy.md).

**Stack:** Next.js 16 · React 19 · NestJS · BullMQ · WebSocket · Drizzle · PostgreSQL · Redis · Rust (near-sdk 5) · Turborepo · Vitest · Playwright · Docker · Cloud Run

## Where NEAR fits

Only what needs trust or ownership goes onchain: skill ownership, trades, royalties, ranked results and prize pools. Prompts and the simulation stay offchain; the log hash in the registry lets anyone check a match against its record.

| Contract | Testnet account | Role |
| --- | --- | --- |
| `skills` | `skills.playskirm.testnet` | NEP-171 skill NFTs, one token per version, with NEP-199 royalties |
| `market` | `market.playskirm.testnet` | List, buy and rent. Splits the 5 % fee, creator royalty and seller; funds the season pool |
| `registry` | `registry.playskirm.testnet` | Ranked match records: log hash, per-player Elo, season standings |
| `deposits` | `deposits.playskirm.testnet` | NEAR top-ups that emit a NEP-297 event for the credits ledger |
| `seasons` | `seasons.playskirm.testnet` | One prize pool per 14-day season, claimed by the top 10 |

Wallets connect through [NEAR Connect](https://www.npmjs.com/package/@hot-labs/near-connect) (HOT, Meteor, MyNearWallet and others). Contract details and deployment: [contracts/README.md](contracts/README.md).

## Repository layout

```
apps/        web (Next.js) · api (NestJS) · realtime (WebSocket) · worker (BullMQ)
packages/    engine · decision-engine · db · ledger · server · shared · ui
contracts/   skills · market · registry · deposits · seasons (Rust, near-sdk)
spec/        the ten v2 maps
docs/        walkthrough, backend contract, economy, deploy, development
```

## Development

```sh
npm ci                  # also enables the pre-push hook (typecheck + tests)
npm run typecheck
npm test                # every workspace (Vitest)
npm run smoke           # full stack in Docker: practice, ranked, credits, Elo, seasons
cd contracts && cargo test
```

CI runs typecheck, unit tests, the contract tests and the wasm build on every pull request and every push to `main`. More in [docs/development.md](docs/development.md).

## Documentation

| | |
| --- | --- |
| [Walkthrough](docs/walkthrough.md) | Every flow step by step, plus an API-only path |
| [Backend contract](docs/backend-contract.md) | REST routes, WebSocket messages, queues, environment |
| [Economy](docs/economy.md) | Talk tiers, holds, the free allowance, margins |
| [Benchmarks](docs/benchmarks.md) | The skill benchmark gauntlet and trials |
| [Deploy](docs/deploy.md) | Docker Compose and Google Cloud Run |
| [Development](docs/development.md) | Tests, the full stack smoke, CI |
| [Contracts](contracts/README.md) | Build, test and deploy the NEAR contracts |
