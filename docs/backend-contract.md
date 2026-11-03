# Backend contract

The single reference for `apps/api`, `apps/worker`, `apps/realtime` and `apps/web`. If you change a shape, change it here first. The types it names live in `@skirm/server` (`queues.ts`, `v2.ts`, `v2-channels.ts`), `@skirm/engine/v2` and `@skirm/shared`.

## Runtime

- Node ESM. `api` and `realtime` are NestJS 12 apps bundled with tsup (decorator metadata from SWC; tests use Vitest with `unplugin-swc`). `worker` is a plain composition root.
- Postgres via Drizzle (schema and migrations in `@skirm/db`; PGlite in tests). Redis drives BullMQ queues, pub/sub and short-lived keys. Shared server code (env config, auth, skill vault, queue and channel names, NEAR adapters, the v2 message types) is in `@skirm/server`.
- Money: credits are integers. NEAR amounts are yoctoNEAR strings in JSON.
- One game: a v2 match. Two crews of 1 to 3 agents share one mirrored map; each crew's model brain acts and talks every tick; the first crew to deliver the goal wins, else the score at 150 ticks decides.

## Environment (`.env.example`)

`loadConfig()` in `@skirm/server` parses these for api, worker and realtime, refuses to start on an invalid value and names the variable (never its value). An empty value means unset.

| Var | Default | Use |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://skirm:skirm@localhost:5432/skirm` | all |
| `REDIS_URL` | `redis://localhost:6379` | all |
| `AUTH_MODE` | `dev` | `dev`: trust the `x-dev-user: <handle>` header (local and judges only). `privy`: verify the Privy JWT (`Authorization: Bearer`) with `PRIVY_APP_ID` and `PRIVY_VERIFICATION_KEY` |
| `V2_BRAIN` | unset (compose: `greedy`) | realtime and worker. `greedy` forces the offline greedy brain: no model calls, no spend, practice is free. Anything else plays Haiku 5.5 through OpenRouter when `OPENROUTER_API_KEY` is set, and greedy without it. Not part of `loadConfig()`: each app reads it from the environment |
| `V2_TICK_MS` | unset = 2000 | realtime: tick length in whole ms, at least 50. The smoke and e2e use 200 so a match plays in seconds |
| `OPENROUTER_API_KEY` | unset | the v2 brain's key (`anthropic/claude-haiku-5.5`). Without it the server plays greedy, benchmarks and trials end `needs_model` |
| `BENCH_SECRET` | `skirm-bench` | worker: HMAC key that picks the hidden benchmark seeds. Set a private one in any shared environment |
| `SKILL_KEK` | unset → `SKILL_KEK_KMS`, else the dev key | base64 32-byte local key-encryption key. When set it seals new skill versions; rows it sealed open only while it is set |
| `SKILL_KEK_KMS` | unset | Cloud KMS key `projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/skill-prompt-kek` (ADC). Seals data keys when `SKILL_KEK` is unset and always opens rows it sealed (`key_id` `gcp-kms:<name>`); unwrapped keys are cached (LRU 256, 5 min). `NODE_ENV=production` with the dev key and no KMS logs a warning but starts |
| `NEAR_NETWORK` | `testnet` | |
| `NEAR_RPC_URL`, `NEAR_RPC_FALLBACK_URL` | fastnear, then dRPC testnet | |
| `NEAR_OPS_ACCOUNT`, `NEAR_OPS_KEY` | unset | the platform signer (set both or neither). Unset → `NoopRegistry` / `NoopMinter` / `NoopSeasons`: registry status `local`, season pools `local` |
| `NEAR_CONTRACT_SKILLS` / `_MARKET` / `_REGISTRY` / `_DEPOSITS` / `_SEASONS` | `skills.playskirm.testnet` … `seasons.playskirm.testnet` | |
| `CREDITS_PER_NEAR` | `1000` (`DEFAULTS.credits.perNear`) | credits one NEAR buys: $0.001 a credit at an assumed $1 NEAR |
| `API_PORT` / `REALTIME_PORT` | `4000` / `4001` | |
| `PUBLIC_API_URL` / `PUBLIC_WS_URL` | `http://localhost:4000` / `ws://localhost:4001/ws` | web (inlined at build time) |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | api: browser origins it accepts |
| `COST_ALERT_DAILY_USD` | `10` | worker, realtime: daily model spend (USD, summed across instances in Redis `cost:usd:<UTC day>`) that logs `cost_alert` at 50 % / 80 % (warn) and 100 % (error); `0` = off |
| `OPS_TOKEN` | unset | api: bearer token (≥ 32 characters) for `GET /ops/stats` and `GET /ops/talk-rates`; unset turns the route off (404) |
| `SEED_OFFICIAL_SKILLS` | on | worker: `0` skips the official skills seed at boot |

## New account defaults

- Three agents, Rook, Wren and Moss, each with a role, vision 3, comms 3 and the Standard talk tier.
- A Builder, a Digger and a Firefighter unlock. Builder is attached to Rook.
- The starter skill **Flood Warden**, account-bound and never onchain, equipped on Rook.
- The player's own Elo 1200 (Elo is per player, `accounts.elo`), no ranked matches.
- 60 free credits a day (`DEFAULTS.free.dailyCredits`, reset 00:00 UTC), spent before the paid balance; paid balance 0.
- Practice against the greedy bot is the free way in.

## Credits

Talk tiers are priced in whole credits per 100 agent-ticks (`DEFAULTS.talk.ratePer100`): **Quiet 20, Standard 20, Open 40**, so 0.20 / 0.20 / 0.40 credits per agent-tick. Quiet costs the same as Standard because it makes the same model calls; its value is stealth. Ranked plays every agent at Standard.

- **Hold.** At the end of lock-in each paying crew holds `ceil(ticks × Σ rate / 100)` credits on the ledger (`holdFor` in `@skirm/engine/v2`; ticks = 150), free allowance first, then paid credits. Over 150 ticks: 1 agent 30, 2 Standard (ranked) 60, 3 Standard 90, 2 Open 120. A crew that cannot cover its hold voids the match (`v2_end` reason `credits`) and nothing is charged.
- **Charge.** Each tick adds the crew's rate to a running total in hundredths of a credit; the whole credits it newly crosses are charged (`chargeDue` in `@skirm/shared`), so every ledger call is in whole credits and the total never exceeds the hold.
- **Settle.** At the end the rest of the hold is returned. A void match returns all of it.
- **Free.** The greedy brain makes no model calls, so on a greedy server a practice crew holds and pays nothing (`v2_found.free`). The bot never holds. With a model brain the practice player pays the normal rates; ranked and casual always hold.
- Ledger rows of a match are keyed by its hold `<matchId>-A` / `-B`; `/credits` rows carry that `matchId`.
- The global free budget (`free_budget_days`) caps all free allowances on a day; it is 4,126 credits a day (`v2GlobalFreeBudget()`, `DEFAULT_LEDGER_CONFIG.globalFreeBudget`).

## REST (`apps/api`, JSON, no prefix)

Auth: every route needs a session except `GET /health`, `POST /auth/session`, `GET /leaderboards/players`, `GET /v2/matches/*`, `GET /seasons*` and `GET /ops/stats` / `GET /ops/talk-rates` (their own token). The public routes add the caller's own rows when a session is sent. Errors are `{ error: { code, message, details? } }`.

### Account

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/health` | | `{ ok: true }` |
| POST | `/auth/session` | `{ token?, nearAccountId?, nearProof? }`, or the `x-dev-user` header in dev | `{ account: {id, handle, nearAccountId, createdAt}, created }`, creating the account with the defaults on first sign-in. `nearAccountId` links a NEAR account (dev trusts it; otherwise a full-access key signs `skirm:link-near:<accountId>:<nearAccountId>`, raw or NEP-413); `409 near_account_taken` when another player holds it |
| GET | `/me` | | `{ account, rank: {elo, rankedMatches, wins, losses, draws, title, position}, credits: {balance, held, allowanceLeft, allowanceResetAt, available}, agents: Agent[], unlocks: UnlockItem[], creditsPerNear, royaltiesYocto, cosmetics: string[] }`. `title` is `rankTitle(elo)`; `position` is the place on `/leaderboards/players`, null before the first ranked match; `cosmetics` are the premium item ids owned |
| GET | `/me/matches` | `?limit=` (≤ 50, default 20) | the caller's matches, newest first: `{ id, mapId, ranked, practice, result: 'win'\|'loss'\|'draw'\|'void'\|'live', score: {you, rival} \| null, endedAt, eloDelta \| null }` |
| GET | `/me/earn-back` | | `{ royaltiesYocto, salesNetYocto, spentCredits, creditsPerNear, prizesYocto, rentalsYocto }`: creator royalties, sales as the seller after fee and royalty, paid credits charged on matches (the free allowance left out), season prizes won, agent rentals earned after the platform fee |
| PUT | `/agents/:id/rental` | ✓ | `{ priceYocto \| null }` → `{ offer: { offerId, agentId, priceYocto, active } \| null }`: offer the agent at a price per match, or stop. Needs a linked NEAR account (renters pay it). 404 for another player's agent |
| GET | `/rentals` | ✓ | Other players' active offers, cheapest first: `{ offerId, agentId, name, role, vision, comms, tier, ownerId, ownerHandle, ownerNearAccountId, priceYocto }[]` |
| GET | `/rentals/mine` | ✓ | `{ offers, passes }`: the caller's active offers and unused one-match passes (each with the rented agent's public stats and owner handle) |
| POST | `/rentals/:offerId` | ✓ | `{ txHash }` → `{ pass }`. A `market.rent` transaction from the caller's linked account whose `rental` event names this offer (`rental_id` = `<offerId>:<nonce>`), pays the owner's linked account and covers the price (422 `wrong_rental`, `wrong_owner`, `underpaid`, `wrong_sender`; 409 `own_agent`, `duplicate_tx`). Dev mode: `dev:<yocto>[:<nonce>]`. A replay returns the same pass. The pass is used up when a match with that agent ends (a void match keeps it); the agent plays with its owner's skills and its plans are withheld from the renter |
| DELETE | `/me/near` | | `{ account }` with `nearAccountId: null`. `409 listing_active` while the player has an active listing |
| GET | `/agents` | | `Agent[]`: `{ id, name, elo, matchesPlayed, wins, losses, draws, skills: [{id, version, name}], unlocks, role, vision, comms, tier, systemPrompt, appearance }` |
| PATCH | `/agents/:id` | `{ name?, skills?: {id, version}[] (≤ 3, owned), unlocks?, role?, vision? (1-5), comms? (1-5), tier?, systemPrompt?: string \| null (≤ 600 characters; null or blank clears), appearance? }` | `Agent`. Gameplay fields are refused (`409 agent_busy`) while the agent is in a live match. `appearance` can change any time; a premium colour needs the cosmetic bought first (`403 cosmetic_not_owned`, `details.items`) |

### Matches

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/v2/matches/live` | | matches being played now, newest first: `{ id, mapId, difficulty, ranked, practice, startedAt, teams: {A, B}: {handle, size} }`. Crews stay hidden; the bot side of a practice match is `Greedy bot` |
| GET | `/v2/matches/:id` | | `{ id, mapId, ranked, practice, status: 'live'\|'ended'\|'void', difficulty, teams: {A, B}: {accountId, handle, crew[]}, winner, reason, decidedBy, score: {A, B} \| null, ticks, elo: {accountId, team, before, delta, after}[], stats, logHash, registry: {status, txHash?}, createdAt, endedAt, you?, debrief? }`. While live the rival side is blank and only a player sees their own crew. `you` and `debrief` (that crew's, as sent with `v2_end`) only for a player. The log stays server side: `logHash` is its proof. `registry.status` is `none` for casual, practice and void matches |
| GET | `/v2/matches/:id/messages` | `?afterTick=&limit=` (≤ `MATCH_MESSAGES_MAX_LIMIT`, default 200) | `{ messages: {tick, team, agent: {id, name}, channel, text, heardBy, overheardBy}[], next? }`: the lines realtime saw delivered. `409 match_live` until the match ends. Page with `next` as the following `afterTick` |
| GET | `/leaderboards/players` | `?limit=` (≤ 200, default 100) | `{ rows: {rank, account: {id, handle}, elo, title, rankedMatches, wins, losses, draws}[], you? }`: players with a ranked match by Elo (ties share a rank) |

### Seasons

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/seasons` | `?limit=` (≤ 50, default 20) | `Season[]`, newest first |
| GET | `/seasons/current` | | `{ season, top: Standing[] (10), you? }`. Opens the current season on first ask (race-safe) |
| GET | `/seasons/:id/standings` | `?limit=&offset=` | `{ rows: Standing[], total }` |

`Season` is `{ id, number, startsAt, endsAt, status: 'open'\|'locked'…, poolYocto, poolSource: 'onchain'\|'local', splitBps }`. `Standing` is `{ rank, account: {id, handle}, points, wins, losses, draws, matches, elo, projectedPrizeYocto \| null }`: the prize projected from the pool while open, as written once locked. Rules: 14 days, the next starts at max(previous end, now); points from ranked matches only, win 25, draw 12, loss 5; the top 10 split the pool 30 / 20 / 15 % then 5 % × 7 (`SEASON` in `@skirm/shared`). The pool is NEAR funded to the season plus 30 % of market fees in its window, `local` until the seasons contract records it.

### Skills and the Exchange

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/skills` | `?tab=written\|owned` | `SkillRow[]`: public fields, `status` (`Draft`, `Minted`, `Listed`, or `Starter` for the account-bound starter skill), `requiredUnlocks`; `written` rows add `royaltiesYocto` |
| POST | `/skills` | `{ name, summary?, prompt (≤ 1200), reflexes? (≤ 400), requires_actions, handles_tags, royalty_bps }` | `SkillPublic` (draft, version 1). The text goes encrypted into the vault |
| PUT | `/skills/:id` | same fields | the next version as a draft (minted versions are immutable). Creator only |
| GET | `/skills/:id` | `?version=` | `SkillPublic`; the creator alone also gets `{ prompt, reflexes }` |
| POST | `/skills/:id/mint` | `{ version? }` | `{ tokenId, status: 'minted'\|'pending', txHash?, benchmark: {status} }`. Never gated on a test: the hidden benchmark is queued first, then `nft_mint`. `409 mint_in_progress`, `422 near_account_required` (NEAR minter), `502 mint_failed`, `503 queue_unavailable` |
| GET | `/market` | `?tag=&sort=winrate\|benchmark\|price\|new` | `MarketCard[]`: `{ skill, creator, priceYocto, listing?, rankedWinRate, rankedMatches, benchmarkScore, owned }`. `benchmarkScore` is null until a benchmark finished with a model (offline: `needs_model`); `benchmark` sorts nulls last |
| GET | `/market/:skillId` | `?version=` | `{ skill, benchmark, ranked: {matches, wins, losses, draws, perMap[]}, counters: {vs: {skillId, version, matches, wins, losses, draws}[]}, trials: {used, left}, sales[], listing?, owned, pinned: {version, promptSha256, tokenId, mintedAt} }`. `benchmark` is `{ status: queued\|running\|done\|needs_model\|failed, brain, seeds, matches, wins, losses, draws, deliveries, leakRate, manipulationRate, score, needsModel }` or null |
| POST | `/market/:skillId/trial` | `{ agentId, version? }` | `202 { trialId, status }`: a buyer's trial of the version with one of their agents. `409 skill_owned`, `429 trial_limit` (3 per version; `needs_model` trials do not count), `503 queue_unavailable` |
| GET | `/market/:skillId/trials` | `?version=` | the caller's trials, newest first: `{ id, skillId, version, agentId, status, needsModel, results, createdAt, finishedAt }` |
| POST | `/market/:skillId/listing` | `{ priceYocto, txHash?, version? }` | the listing, with `split: {primary, feeYocto, royaltyYocto, sellerYocto}` (no royalty on a primary sale). `422 not_minted` |
| POST | `/market/:skillId/purchase` | `{ txHash, version? }` | `{ owned: true, sale }` once the NEAR owner is the buyer (dev mode: `dev:<yocto>[:<nonce>]`). `409 not_listed`, `own_listing`, `duplicate_tx`; `422 underpaid`, `purchase_unverified`, `near_account_required`. A bought skill grants use, never its text; a sold skill is unequipped from the seller's agents |

### Cosmetics and credits

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/cosmetics` | | `{ items: {id, kind: 'outfit'\|'hair', name, index, priceCredits, color}[], owned: string[] }`. Premium palette entries appended after the free ones; purely visual |
| POST | `/cosmetics/:id/buy` | | `{ owned }`. Paid credits only, never the free allowance: `402 insufficient_credits` with `need`, `have`. Buying an owned item is a no-op 200 |
| GET | `/credits` | | `{ balance, held, allowanceLeft, allowanceResetAt, available, creditsPerNear, rows: {id, type, amount, source, note, matchId, txHash, createdAt}[] }` (latest 100) |
| POST | `/credits/deposits` | `{ txHash }` | `{ credited, balance, amountYocto }`: a `deposits.deposit()` tx verified through RPC (dev mode: `dev:<yocto>`), credited once (`409 duplicate_receipt`) |

### Operations

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/ops/stats` | header `Authorization: Bearer <OPS_TOKEN>` | totals for the skirm-ops dashboard, no per-player data: `{ at, engine: 'haiku'\|'greedy', ai: {dailyBudgetUsd, spend: {day, usd}[3] \| null, matchCostUsd30d}, players: {total, new1d, new7d, withNear}, credits: {balance, held, fundedAccounts, freeBudgetUsedToday, creditsPerNear, flow30d[]}, matches: {live, last1d, last7d, last30d, void30d, costUsd30d, charged30d, daily[] (14 UTC days)} }`. `404` while `OPS_TOKEN` is unset, `401 unauthenticated` for a wrong token |
| GET | `/ops/talk-rates` | ops token | `{ days, margin, creditUsd, tiers: { quiet, standard, open } }`, each `{ crews, agentTicks, costPerAgentTickUsd, suggestedRatePer100, currentRatePer100, enough }`: talk-tier rates from measured model spend over `?days=` (default 30) of ended matches, single-tier crews with model spend only. Apply a suggestion in `DEFAULTS.talk.ratePer100` |

### Error codes

Besides `bad_request` (400), `unauthenticated` / `no_session` (401), `forbidden` (403), `not_found` (404) and `internal` (500):

| Status | Codes |
| --- | --- |
| 402 | `insufficient_credits` (with `need`, `have`) |
| 403 | `dev_disabled`, `cosmetic_not_owned` |
| 409 | `agent_busy`, `match_live`, `mint_in_progress`, `skill_owned`, `near_account_taken`, `listing_active`, `duplicate_receipt`, `duplicate_tx`, `not_listed`, `own_listing`, `conflict`, `invalid_transition`, `hold_mismatch` |
| 422 | `near_account_required`, `near_proof_required`, `near_proof_invalid`, `not_minted`, `invalid_hash`, `underpaid`, `purchase_unverified` |
| 429 | `trial_limit` |
| 502 | `mint_failed` |
| 503 | `queue_unavailable`, `rpc_unavailable`, `near_unavailable`, `ownership_unavailable` |

## WebSocket (`apps/realtime`, path `/ws`)

One JSON object per text frame (at most 16 KiB). A client signs in once, then sends `v2_*` messages; watching needs no sign-in. Messages of one socket are handled in order.

Client → server (`WsClientMessage`):

| Message | Meaning |
| --- | --- |
| `{type:'auth', token?, devUser?}` | sign in (dev: `devUser` is the handle). On reconnect during a match the server re-sends where it stands (found, lock-in or the latest frame) |
| `{type:'v2_queue', crew: {agentId, tier}[] (1-3), ranked, mapId?, difficulty?, opponent?: 'bot'}` | search for a match. Casual pairs only with the same `mapId` (or any) and `difficulty`; ranked ignores both (any fitting map, Normal). `opponent: 'bot'` is practice: casual only (`practice_unranked`), no matchmaking, starts at once on `mapId`/`difficulty` or `DEFAULT_PRACTICE` (Copper Hollow, Easy) |
| `{type:'v2_cancel_queue'}` | stop searching |
| `{type:'v2_accept', matchId}` / `{type:'v2_decline', matchId}` | answer `v2_found` (10 s) |
| `{type:'v2_lock_in', matchId, tiers, crew?}` | lock the crew in (30 s): a talk tier per agent in slot order; `crew` swaps, removes or adds agents up to `crewLimit` and its tiers win |
| `{type:'v2_watch', matchId}` / `{type:'v2_unwatch', matchId}` | spectate: the latest whole-board frame now, then every one after, and `v2_end`. Released on `v2_end`, unwatch or disconnect; at most 8 per socket |
| `{type:'v2_replay', matchId}` | every stored frame of an ended match, for replay at another speed (kept 6 h) |

Server → client (`WsServerMessage`):

| Message | Meaning |
| --- | --- |
| `{type:'queue_status', searchingMs, eloRange}` | every second while searching; the Elo window widens from ±100 by 50 every 5 s up to ±1000 |
| `{type:'v2_found', matchId, team, mapId, ranked, acceptMs, difficulty, practice?, free?, rivalHandle?}` | a match: accept within `acceptMs`. `practice` and `rivalHandle` ('Greedy bot') for practice; `free` when this crew holds nothing |
| `{type:'v2_accepted', matchId, team}` | a crew accepted |
| `{type:'v2_lockin', matchId, lockMs, rival: {agents}, crewLimit, headStartTicks, free?}` | lock-in started (the rival's crew size only). Re-sent when a crew changes its roster |
| `{type:'v2_locked', matchId, team}` | a crew locked in |
| `{type:'v2_start', matchId, team, rival: {handle}, tickMs, holdTicks}` | live: the rival is named, holds are placed |
| `{type:'v2_frame', matchId, frame}` | one tick: each crew gets its own fogged view (its own plans only), watchers the whole board |
| `{type:'v2_end', matchId, result, reason, logHash, debrief?}` | the end. `result` is `{winner: 'A'\|'B'\|'draw', reason: 'goal'\|'time'\|'eliminated', decidedBy, score, ticks}` or null for a void match (`reason` `declined`, `accept_timeout`, `credits`, `error`, `aborted`); `logHash` is the sha256 chain head of the match log; `debrief` is this crew's (Elo delta, MVP, goals, talk counts, credits held / used / returned, registry line, per-agent tally) |
| `{type:'v2_frames', matchId, frames}` | answer to `v2_replay` |
| `{type:'error', code, message}` | see below |

WS error codes: `bad_json`, `bad_message`, `unknown_type`, `too_large`, `unauthenticated`, `auth_failed`, `already_authenticated`, `already_queued`, `not_queued`, `in_match`, `invalid_crew`, `not_in_lockin`, `practice_unranked`, `agent_busy`, `not_found`, `too_many_subscriptions`, `unavailable`, `internal`.

`scripts/ws-v2.cjs` is a ready client: it signs in, queues, accepts, locks in and waits for `v2_end` (README of the script at its top).

## Match flow

- Found → accept (10 s; a decline or no answer voids it, naming the crew) → lock-in (30 s; the rival hidden, ranked forces Standard) → live: holds placed, up to 150 ticks of `V2_TICK_MS` (2 s) → end.
- Each tick every agent's brain acts and may speak under a 1.5 s deadline (late, failed or illegal is a wait); the crew plan is rewritten every `V2_REPLAN_EVERY` (25) ticks. Speech passes the leak and abuse filter before anyone hears it, then goes by range (team, or overheard by the rival).
- One `realtime` instance holds each match in memory and serves its players. A live row no instance holds (crash) is voided by the orphan sweep and its holds released; shutdown voids live matches with credits returned.
- Practice: the player is crew A; crew B is `SYSTEM_ACCOUNT_ID` with a Standard crew the player's size on the greedy brain, accepting and locking in by itself. Casual only, no Elo, no registry write, `v2_matches.practice = true`.
- Settlement (`V2MatchesRepo.finish`, one transaction): the result, both players' Elo (ranked; start 1200, K 32 for the first 20 ranked matches then 16, floor 100), season points (ranked), the skill versions' ranked records, the delivered lines (`match_messages`), each crew's debrief. Then a ranked result is queued for the registry, and the frames are kept for replay.

## Queues (BullMQ, names in `@skirm/server`)

| Queue | Job data | Consumer (worker) |
| --- | --- | --- |
| `registry` | `{ kind: 'v2_match', id, seasonId? }` | `record_match` on the registry contract as a `MatchRecordV2` with per-player Elo and the season number, then the row's registry status and tx; retried 10 times |
| `benchmarks` | `{ kind: 'mint', skillId, version }` or `{ kind: 'trial', trialId }` | the hidden gauntlet of a minted version, or one buyer's trial, on the headless match runner (`playHeadless`) against the greedy bot (below) |
| `seasons` | `{ kind: 'tick' }`, repeatable every 10 min | opens the current season, locks ended ones, writes payouts, posts the top 10 to the seasons contract |

**Benchmark.** 6 (map, difficulty) picks from `PRACTICE_MAPS` × Easy / Normal, drawn from HMAC-SHA256(`BENCH_SECRET`, `<skillId>:<version>`). The tested crew is one Standard agent carrying the skill; every second pick also feeds it hijack lines. score = wins / matches × (1 − share of matches with a leak). With the greedy brain (no model key) a benchmark or trial plays nothing and ends `needs_model` with no score: greedy ignores skills, so it would prove nothing. See [benchmarks.md](benchmarks.md).

## Pub/sub (Redis)

| Name | Content |
| --- | --- |
| channel `v2match:<id>` | every watch-view message of a live match (`v2_frame`, then `v2_end`), published by the instance running it |
| key `v2match:<id>:last` | the latest of those, 120 s TTL: a watcher on another instance reads it first, then follows the channel |
| key `v2:match:<id>:frames:<A\|B\|watch>` | the frames of an ended match per view, 6 h TTL, for `v2_replay` |
| key `cost:usd:<UTC day>` | model spend across worker and realtime, for `cost_alert` and `/ops/stats` |

Frames carry each crew's own plan text only to that crew, and never the plan of an agent running a bought (encrypted) skill. Skill text never leaves the vault except into the agent's model call.

## Seasons contract

`seasons.playskirm.testnet` (`contracts/seasons`, NEP-297 standard `skirm_seasons`). One NEAR pool per 14-day season, paid to the top 10 by pull:

1. `open_season(id, name, starts_at_ms, ends_at_ms)` (owner or ops) once the previous season is `paid`; the carry becomes the new pool.
2. `#[payable] fund(season_id: Option<u32>) -> U128`: anyone; the market sends 30 % of each sale fee as `fund(None)`. It panics when no season is open, and the market's callback then forwards that share to the treasury.
3. `lock_season(id)` after `ends_at_ms`; `post_standings(id, rows ≤ 10)` with points non-increasing; place i gets `floor(pool × SPLIT_BPS[i] / 10⁴)`, `SPLIT_BPS = [3000, 2000, 1500, 500 × 7]`. Rows without a NEAR account, empty places and dust go to the carry.
4. `claim(id)` by each winner's NEAR account, once; `close_season(id)` moves unclaimed shares to the carry.

The ops writes are idempotent, so the worker's season tick can resend one whose answer was lost. `packages/server/src/near/seasons.ts` wraps them (`NoopSeasons` without a signer). Full interface: [contracts/seasons/README.md](../contracts/seasons/README.md).

## NEAR adapters (`@skirm/server`)

- `Registry.recordMatch(MatchRecordV2)`: `NoopRegistry` stores `local` with a `noop:` hash; `NearRegistry` calls `registry` with the ops function-call key.
- `Minter.mint(skillVersion)`: `nft_mint` on `skills` (one token per version, NEP-171 + NEP-199 royalties).
- `SeasonsChain`: the seasons calls above.
- `DepositVerifier.verify(txHash)`: reads the tx through RPC and checks the receiver (`deposits`), the amount and that the receipt is new. Dev accepts `dev:<yocto>`.
- `OwnershipReader.ownerOf(tokenId)`: purchases and the mint fallback.
- Market fee governance (contract side): a `governance_id` (defaults to the owner) proposes a fee and applies it after 24 h, capped at 10 %; every setter emits a NEP-297 event.

## Official skills seed (worker boot)

So the Exchange is never empty, every worker seeds `OFFICIAL_SKILLS` from `@skirm/db` at boot, in the background, under a Postgres advisory lock and with fixed ids (safe to repeat and to run concurrently). Each skill is sealed into the vault, its hidden benchmark is queued (offline it ends `needs_model`), then it is minted through the configured `Minter` and listed by the system account (`@skirm`, never signs in). A version that has been sold is not relisted. `SEED_OFFICIAL_SKILLS=0` turns it off.
