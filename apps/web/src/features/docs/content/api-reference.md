---
title: API reference
description: The REST endpoints, WebSocket messages and match flow of the skirm api and realtime servers.
section: builders
order: 2
---
This page is a map of the skirm backend for builders. The full reference, with every field and edge case, is [docs/backend-contract.md](https://github.com/armlynobinguar/skirm/blob/main/docs/backend-contract.md) in the repo. If the two ever differ, the repo file wins.

## The basics

- **Two servers.** `apps/api` serves REST (JSON, no path prefix). `apps/realtime` serves the match WebSocket at path `/ws`. Locally they are `http://localhost:4000` and `ws://localhost:4001/ws`.
- **Auth.** In dev mode (`AUTH_MODE=dev`), send the header `x-dev-user: <handle>`. In `privy` mode, send `Authorization: Bearer <Privy JWT>`. External agents use their own token on `/agent/v1/*`.
- **Public routes.** Every route needs a session except `GET /health`, `POST /auth/session`, `GET /leaderboards/*`, most of `GET /v2/matches/*`, `GET /replays/:shareId`, `GET /seasons*`, the ops routes (own token) and `/agent/v1/*`. Public routes add your own rows when you send a session.
- **Errors.** Every error is `{ error: { code, message, details? } }`.
- **Money.** Credits are integers. On-chain amounts are yoctoNEAR strings.

## Account

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/health` | `{ ok: true }` |
| POST | `/auth/session` | Signs in, creating the account with the defaults on first sign-in. Can link a NEAR account with a signed proof |
| GET | `/me` | Your account, rank, credits, agents, unlocks, royalties and cosmetics |
| GET | `/me/matches` | Your matches, newest first (`?limit=`, up to 50) |
| GET | `/me/earn-back` | Royalties, sales, credits spent, season prizes and rentals earned |
| GET | `/me/export` | Everything skirm holds about you, including your own skill prompts |
| DELETE | `/me` | Deletes your account. Body `{ confirm }` with your current handle |
| DELETE | `/me/near` | Unlinks your NEAR account |
| GET | `/agents` | Your agents |
| PATCH | `/agents/:id` | Name, skills (up to 3, owned), role, vision, comms, tier, system prompt (up to 600 characters), appearance |
| GET | `/agents/:id/record` | The agent's record, all time and this season |
| GET | `/agents/:id/progression` | XP, level and traits |
| POST | `/agents/:id/traits` | Pick a trait |

New accounts get three agents (Rook, Wren and Moss), the starter skill Flood Warden on Rook, Elo 1200 and 60 free credits a day.

## Rentals

| Method | Path | What it does |
| --- | --- | --- |
| PUT | `/agents/:id/rental` | Offer your agent at a price per match, or stop (`{ priceYocto }`, null to stop) |
| GET | `/rentals` | Other players' active offers, cheapest first |
| GET | `/rentals/mine` | Your offers and unused one-match passes |
| POST | `/rentals/:offerId` | Pay for a rental with `{ txHash }`, or in paid credits with `{ credits: true, key }`, and get a pass |

## Matches

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/v2/models` | Models a crew may pick per agent outside ranked |
| GET | `/v2/matches/live` | Matches being played now |
| GET | `/v2/matches/recorded` | The latest ranked matches recorded on-chain (up to 5) |
| GET | `/v2/matches/:id` | A match: status, teams, winner, score, Elo changes, log hash, registry status |
| GET | `/v2/matches/:id/messages` | The delivered lines of an ended match, paged with `?afterTick=` |
| GET | `/v2/matches/:id/log` | The hash-chained match log, so anyone can recompute it |
| GET | `/v2/matches/:id/decisions` | The debrief's decision timeline (players only) |
| GET | `/v2/matches/:id/highlights` | Up to 8 highlights with caster lines |
| POST | `/v2/matches/:id/shares` | Make a public replay link, optionally a clip |
| GET | `/v2/matches/:id/shares` | Your live links to that match |
| GET | `/replays/:shareId` | A shared replay (`?frames=0` for link previews) |
| DELETE | `/replays/:shareId` | Revoke your link |

Routes on a match that is still live answer `409 match_live`.

## Leaderboards and seasons

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/leaderboards/players` | Players by Elo |
| GET | `/leaderboards/tiers` | Tier thresholds, placements and decay rules |
| GET | `/leaderboards/maps/:mapId` | Players by ranked results on one map |
| GET | `/leaderboards/skills` | Skills by ranked win rate (`?mapId=` to narrow) |
| GET | `/seasons` | Seasons, newest first |
| GET | `/seasons/current` | The current season, its top 10 and your standing |
| GET | `/seasons/:id/standings` | A season's standings, paged |

## Skills and the Exchange

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/skills` | Your skills (`?tab=written` or `?tab=owned`) |
| POST | `/skills` | Create a draft, version 1 |
| PUT | `/skills/:id` | Save the next version as a draft (creator only) |
| GET | `/skills/:id` | A skill's public fields; the creator alone also gets `prompt` and `reflexes` |
| POST | `/skills/:id/mint` | Mint a version. Queues the hidden benchmark first |
| GET | `/market` | Exchange cards (`?tag=&role=&sort=`, sort is `winrate`, `benchmark`, `price` or `new`) |
| GET | `/market/:skillId` | A skill's proof: benchmark, ranked record, counters, trials left, sales, listing, pinned hash |
| POST | `/market/:skillId/trial` | Start a trial with one of your agents (`202`) |
| GET | `/market/:skillId/trials` | Your trials of that skill |
| POST | `/market/:skillId/listing` | List a version at `priceYocto` |
| DELETE | `/market/:skillId/listing` | Cancel your listing |
| POST | `/market/:skillId/purchase` | Record a purchase from its `txHash` |

The `POST /skills` body:

```json
{
  "name": "Flood Warden",
  "summary": "Seals the leak before it spreads, then does the job.",
  "prompt": "<up to 1200 characters>",
  "reflexes": "<up to 400 characters, optional>",
  "requires_actions": ["place_block"],
  "handles_tags": ["spreads", "liquid"],
  "royalty_bps": 500,
  "trigger": { "kind": "hazard_within", "tiles": 3 },
  "roles": ["Builder"]
}
```

`trigger` is optional (absent means always). Its kinds are `always`, `hazard_within` (tiles 1 to 10), `behind_on_score`, `ahead_on_score`, `rival_near_switch` (tiles 1 to 10), `carrying_item` and `time_left_under` (seconds 10 to 300). `roles` defaults to `["any"]`.

## Skill test bench

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/bench` | The brain, cost and your hourly limit |
| POST | `/bench/runs` | Queue one headless run: `{ skillId, version?, mapId, difficulty, prompt?, reflexes? }` (`202`) |
| GET | `/bench/runs` | Your runs, newest first (`?skillId=`) |
| GET | `/bench/runs/:id` | One run, with the text that played when it is yours |
| GET | `/bench/compare` | Two runs and a word diff of their prompts (`?a=&b=`) |

## Daily, campaign and puzzles

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/daily` | Today's challenge and your attempts |
| POST | `/daily/attempts` | Queue an attempt with `{ agentIds? }` |
| GET | `/daily/leaderboard` | Best attempt per player (`?date=`) |
| GET | `/campaign` | Chapters, missions and your progress |
| POST | `/campaign/missions/:id/start` | Returns the `v2_queue` message to send over the socket |
| GET | `/puzzles` | Puzzles, your medals and bests |
| GET | `/puzzles/:id` | One puzzle with its board and your last runs |
| POST | `/puzzles/:id/runs` | Queue a run with `{ crew }` |
| GET | `/puzzles/:id/runs/:runId` | One run |
| GET | `/puzzles/:id/leaderboard` | Top 50, lowest score first |

## Crew playbooks and community maps

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/playbooks` | Your playbooks, never the text |
| POST | `/playbooks` | Create one: `{ name, text }` (text up to 800 characters) |
| GET | `/playbooks/:id` | One playbook with its text (owner only) |
| PUT | `/playbooks/:id` | Edit it |
| DELETE | `/playbooks/:id` | Delete it |
| POST | `/playbooks/select` | Pick the one lock-in starts with: `{ id }` or null |
| GET | `/community-maps` | Published maps (`?sort=new` or `popular`) |
| GET | `/community-maps/mine` | Your drafts and published maps |
| GET | `/community-maps/:id` | A published map, or your draft |
| POST | `/community-maps` | Create a draft |
| PUT | `/community-maps/:id` | Edit a draft |
| DELETE | `/community-maps/:id` | Delete a draft |
| POST | `/community-maps/test-play` | Validate and balance-check a map without saving |
| POST | `/community-maps/:id/publish` | Publish a draft |
| POST | `/community-maps/:id/like` | Like a published map (DELETE to unlike) |

## Writer backing

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/backing/config` | Mode (`near`, `credits` or `off`) and limits |
| GET | `/backing/rounds` | Rounds (`?writer=&skill=&status=`) |
| GET | `/backing/rounds/:id` | One round, its latest payouts and your position |
| GET | `/backing/mine` | Your positions and your own rounds |
| POST | `/backing/rounds` | Open a round: `{ skillId?, shareBps, capMultipleBps, maxRaiseYocto }` |
| POST | `/backing/rounds/:id/back` | Back a round: `{ amountYocto }` |
| POST | `/backing/rounds/:id/close` | Close your round |
| POST | `/backing/rounds/:id/cancel` | Cancel your open round |
| POST | `/backing/rounds/:id/claim` | Claim your earnings |
| POST | `/backing/rounds/:id/distribute` | Forward royalties to your round (on-chain mode) |
| POST | `/backing/sync` | Mirror a backing transaction from its `txHash` (on-chain mode) |

In `near` mode, writes answer `{ wallet: { contractId, methodName, args, depositYocto, gas } }` for your wallet to sign.

## External agents

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/external-agents` | Your external agents |
| POST | `/external-agents` | Register one: `{ name, agentId?, webhookUrl? }`. Returns the secret and token once |
| PATCH | `/external-agents/:id` | Rename, rebind or change the webhook |
| POST | `/external-agents/:id/rotate` | New secret and token; the old ones stop working |
| POST | `/external-agents/:id/ping` | A signed test ping |
| DELETE | `/external-agents/:id` | Remove it |

The `/agent/v1/*` routes your program calls are in [bring your own agent](/docs/bring-your-own-agent).

## Common error codes

| Status | Examples |
| --- | --- |
| 400 | `bad_request` |
| 401 | `unauthenticated`, `no_session`, `invalid_agent_token` |
| 402 | `insufficient_credits` (with `need`, `have`) |
| 403 | `forbidden`, `cosmetic_not_owned`, `mission_locked` |
| 404 | `not_found` |
| 409 | `agent_busy`, `match_live`, `mint_in_progress`, `skill_owned`, `listing_active`, `not_listed`, `duplicate_tx` |
| 422 | `invalid_webhook`, `invalid_action`, `near_account_required`, `not_minted`, `underpaid`, `purchase_unverified` |
| 429 | `trial_limit`, `bench_limit`, `daily_limit` |
| 503 | `queue_unavailable`, `rpc_unavailable`, `relay_unavailable` |

## WebSocket

Connect to `/ws` on the realtime server. Send one JSON object per text frame, at most 16 KiB. Sign in once, then send `v2_*` messages. Watching needs no sign-in.

Client to server:

| Message | Meaning |
| --- | --- |
| `{type:'auth', token?, devUser?, agentToken?}` | Sign in. In dev, `devUser` is the handle |
| `{type:'v2_queue', crew, ranked, mapId?, difficulty?, opponent?, draft?, mission?}` | Search for a match. `crew` is 1 to 3 of `{agentId, tier}`. `opponent: 'bot'` is practice |
| `{type:'v2_cancel_queue'}` | Stop searching |
| `{type:'v2_accept', matchId}` | Accept a found match (10 s) |
| `{type:'v2_decline', matchId}` | Decline it |
| `{type:'v2_ban', matchId, skillId}` | Draft mode: ban one rival skill, or pass with null |
| `{type:'v2_lock_in', matchId, tiers, crew?, playbookId?}` | Lock in your crew (30 s) |
| `{type:'v2_watch', matchId}` | Spectate a live match (`v2_unwatch` to stop) |
| `{type:'v2_replay', matchId}` | Every stored frame of an ended match |
| `{type:'v2_lobby_ready', lobbyId, crew}` | Ready a crew in a private lobby |
| `{type:'v2_command', matchId, agentId?, preset?, text?}` | A live command to your crew (3 per match) |
| `{type:'v2_control', matchId, agentId}` | Hybrid control: steer one of your agents by hand (casual and practice only) |
| `{type:'v2_steer', matchId, input}` | Input for the agent you steer |

Server to client:

| Message | Meaning |
| --- | --- |
| `queue_status` | Every second while searching, with the Elo window |
| `v2_found` | A match: accept within `acceptMs` |
| `v2_accepted` | A crew accepted |
| `v2_draft` | Draft mode: the ban step |
| `v2_lockin` | Lock-in started; the rival's crew size only |
| `v2_locked` | A crew locked in |
| `v2_start` | Live: the rival is named and holds are placed |
| `v2_frame` | One tick. Each crew gets its own fogged view; watchers get the whole board |
| `v2_end` | The end: result, reason, log hash and your crew's debrief |
| `v2_frames` | The answer to `v2_replay` |
| `v2_lobby` | A lobby player readied or stepped back |
| `v2_command_ok` | Your command lands on `tick`; `left` remain |
| `v2_control_ok` | The agent you now steer |
| `error` | `{type:'error', code, message}` |

A practice queue looks like this:

```json
{ "type": "v2_queue", "crew": [{ "agentId": "agt_…", "tier": "standard" }], "ranked": false, "opponent": "bot" }
```

`scripts/ws-v2.cjs` in the repo is a ready client. It signs in, queues, accepts, locks in and waits for `v2_end`.

## Match flow

1. **Found.** Both crews get `v2_found`. Each must accept within 10 seconds. A decline or no answer voids the match.
2. **Lock-in.** 30 seconds. The rival's crew stays hidden. Ranked plays every agent at Standard.
3. **Live.** Holds are placed. Up to 150 ticks of `V2_TICK_MS` (2 seconds by default). Each tick every agent acts and may speak, under a 1.5 second deadline; late, failed or illegal is a wait. The crew plan is rewritten every 25 ticks. Speech passes the leak and abuse filter before anyone hears it.
4. **End.** The first crew to deliver the goal wins. Otherwise the score at 150 ticks decides. `v2_end` carries the result and the log hash.
5. **Settle.** One transaction writes the result, Elo and season points (ranked), the skills' ranked records, delivered lines, debriefs and agent XP. A ranked result is then queued for the on-chain registry.

**Practice** pairs you with the greedy bot at once: no matchmaking, no Elo, no registry write. With no `mapId`, it starts on Copper Hollow, Easy.

**Credits.** At lock-in each paying crew holds `ceil(150 × sum of rates / 100)` credits. Each tick charges only the whole credits its running total crosses, and the rest comes back at the end. A void match returns all of it. See [comms and talk tiers](/docs/comms-and-talk-tiers).
