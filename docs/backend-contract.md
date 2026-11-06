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
| `V2_BRAIN` | unset (compose: `greedy`) | realtime, worker and the api's replay caster: `model` \| `greedy` (`haiku` is the old name of `model`). `greedy` forces the offline greedy brain: no model calls, no spend, practice is free. Anything else plays the configured model (`LLM_*` below) when a model key is set, and greedy without it; `model` with a non-OpenRouter `LLM_BASE_URL` also plays a keyless local server (Ollama, LM Studio, vLLM). Not part of `loadConfig()`: each app reads it from the environment |
| `V2_TICK_MS` | unset = 2000 | realtime: tick length in whole ms, at least 50. The smoke and e2e use 200 so a match plays in seconds |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | the model provider: any OpenAI-compatible chat-completions API (`<base>/chat/completions`), e.g. OpenRouter, OpenAI `https://api.openai.com/v1`, Anthropic's OpenAI-compatible `https://api.anthropic.com/v1`, Groq `https://api.groq.com/openai/v1`, Together `https://api.together.xyz/v1`, Ollama `http://localhost:11434/v1`. OpenRouter-only request fields (`usage: {include: true}`, `reasoning: {enabled: false}`, the `X-Title` header) go to OpenRouter only |
| `LLM_API_KEY` | unset → `OPENROUTER_API_KEY` | the v2 brain's bearer key. Without it (and without a keyless local `LLM_BASE_URL` and `V2_BRAIN=model`) the server plays greedy, benchmarks and trials end `needs_model` |
| `OPENROUTER_API_KEY` | unset | old name of `LLM_API_KEY`, still read; `LLM_API_KEY` wins when both are set |
| `LLM_MODEL` | `anthropic/claude-haiku-5.5` | the default model id as the provider names it: it plays every agent in ranked and every agent without another pick from `LLM_MODELS`, and casts replays |
| `LLM_PLANNER_MODEL` | `LLM_MODEL` | the crew planner's model |
| `LLM_MODELS` | unset (`LLM_MODEL` alone) | models players may pick per agent outside ranked, JSON `[{"id", "label"?, "rateMultiplierBps"}]` (1000 to 100000; `LLM_MODEL` is always first at 10000); a malformed value fails at boot |
| `LLM_PRICE_INPUT_USD`, `LLM_PRICE_OUTPUT_USD` | unset | USD per million prompt / completion tokens, for the daily cost monitor when the provider returns no cost (OpenRouter's `usage.cost` wins). Unset: the default model keeps its built-in prices (`DEFAULT_MODEL_PRICES`), any other model records its tokens at cost 0 and logs that once. Credit prices to players do not change (`DEFAULTS.price` in `@skirm/shared`) |
| `BENCH_SECRET` | `skirm-bench` | worker: HMAC key that picks the hidden benchmark seeds. Set a private one in any shared environment |
| `SKILL_KEK` | unset → `SKILL_KEK_KMS`, else the dev key | base64 32-byte local key-encryption key. When set it seals new skill versions; rows it sealed open only while it is set |
| `SKILL_KEK_KMS` | unset | Cloud KMS key `projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/skill-prompt-kek` (ADC). Seals data keys when `SKILL_KEK` is unset and always opens rows it sealed (`key_id` `gcp-kms:<name>`); unwrapped keys are cached (LRU 256, 5 min). `NODE_ENV=production` with the dev key and no KMS logs a warning but starts |
| `NEAR_NETWORK` | `testnet` | |
| `NEAR_RPC_URL`, `NEAR_RPC_FALLBACK_URL` | fastnear, then dRPC testnet | |
| `NEAR_OPS_ACCOUNT`, `NEAR_OPS_KEY` | unset | the platform signer (set both or neither). Unset → `NoopRegistry` / `NoopMinter` / `NoopSeasons`: registry status `local`, season pools `local` |
| `NEAR_CONTRACT_SKILLS` / `_MARKET` / `_REGISTRY` / `_DEPOSITS` / `_SEASONS` / `_BADGES` | `skills.playskirm.testnet` … `badges.playskirm.testnet` | `badges` is not deployed yet |
| `CREDITS_PER_NEAR` | `1000` (`DEFAULTS.credits.perNear`) | credits one NEAR buys: $0.001 a credit at an assumed $1 NEAR |
| `NEAR_RENTALS_ONCHAIN` | `false` | api: `true` takes agent rentals through `market.rent` from the renter's wallet (needs the market redeployed with `rent`, contracts/market/README.md); off, rentals are paid in paid credits |
| `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY` | unset | gasless onboarding's relayer (set both or neither; [gasless.md](gasless.md)). Unset → `/relay` is off and nothing else changes |
| `RELAYER_FREE_TXS` | `3` | relayed (gas-free) transactions per player |
| `API_PORT` / `REALTIME_PORT` | `4000` / `4001` | |
| `PUBLIC_API_URL` / `PUBLIC_WS_URL` | `http://localhost:4000` / `ws://localhost:4001/ws` | web (inlined at build time) |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | api: browser origins it accepts |
| `COST_ALERT_DAILY_USD` | `10` | worker, realtime: daily model spend (USD, summed across instances in Redis `cost:usd:<UTC day>`) that logs `cost_alert` at 50 % / 80 % (warn) and 100 % (error); `0` = off |
| `OPS_TOKEN` | unset | api: bearer token (≥ 32 characters) for `GET /ops/stats` and `GET /ops/talk-rates`; unset turns the route off (404) |
| `SEED_OFFICIAL_SKILLS` | on | worker: `0` skips the official skills seed at boot |
| `RANKED_DECAY_DAYS` / `RANKED_DECAY_AMOUNT` | `14` / `25` (`DEFAULTS.ranked.decay`) | worker, api: days without a ranked match before an inactive Diamond+ player loses `amount` Elo (again every `days`); `0` turns decay off. Not part of `loadConfig()`: `rankedDecayFromEnv` in `@skirm/shared` |
| `BENCH_RUNS_PER_HOUR` | `20` (`DEFAULTS.bench.runsPerHour`) | api: test-bench runs per account per rolling hour |
| `DAILY_ATTEMPTS` | `3` (`DEFAULTS.daily.attemptsPerDay`) | api: daily challenge attempts per account per UTC day |
| `RATE_LIMIT_STRICT` / `RATE_LIMIT_GENERAL` | `20` / `300` | api: requests per client per minute to the strict routes (NEAR RPC, paid work, sign-in, `/relay`; `apps/api/src/rate-limit.ts`) and to every other route. Not part of `loadConfig()` |
| `TRUSTED_PROXY_HOPS` | `1` | api: proxies in front of the api that append to `X-Forwarded-For`; the rate limiter counts the entry that many places from the end as the client (1 on plain Cloud Run, 2 behind an external HTTPS load balancer). Not part of `loadConfig()` |
| `WORKER_SHUTDOWN_GRACE_MS` | `30000` | worker: on SIGTERM/SIGINT, how long to wait for active jobs before forcing the connections closed. Not part of `loadConfig()` |
| `BACKING_CONTRACT` | unset | api: the writer backing contract account (`contracts/backing`, not deployed yet). Set: backing writes answer wallet calls and `/backing/sync` mirrors them. Unset: backing runs on paid credits with `AUTH_MODE=dev` (the keyless local stack) and is off otherwise. Not part of `loadConfig()` |

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
- **Quest rewards** refill the day's free allowance, never past the daily 60 and only by free credits already charged today (credits still held by an open match come back on settle). They are not paid credits and never new budget: holds still draw free credits only while the global budget has room, so quests reshare G, they never raise it. A player who claims everything can use at most 60 + 3 × 10 + 2 × 25 = 140 free credits in a day, about 97 a day averaged over a week, so G covers about 42 such players instead of 68 (`questBudgetCost()` in `@skirm/shared`). A claim is stored in `quest_claims` (`credited`), not as a ledger row.

## REST (`apps/api`, JSON, no prefix)

Auth: every route needs a session except `GET /health`, `POST /auth/session`, `GET /leaderboards/*`, `GET /v2/matches/*` (but `/v2/matches/:id/shares` and `/v2/matches/:id/decisions`), `GET /replays/:shareId`, `GET /seasons*`, `GET /ops/stats` / `GET /ops/talk-rates` (their own token) and `/agent/v1/*` (an external agent token). The public routes add the caller's own rows when a session is sent. Errors are `{ error: { code, message, details? } }`.

### Account

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/health` | | `{ ok: true }` |
| POST | `/auth/session` | `{ token?, nearAccountId?, nearProof? }`, or the `x-dev-user` header in dev | `{ account: {id, handle, nearAccountId, createdAt}, created }`, creating the account with the defaults on first sign-in. `nearAccountId` links a NEAR account (dev trusts it; otherwise a full-access key signs `skirm:link-near:<accountId>:<nearAccountId>`, raw or NEP-413); `409 near_account_taken` when another player holds it |
| GET | `/me` | | `{ account, rank: {elo, rankedMatches, wins, losses, draws, title, position, tier, decayAt}, credits: {balance, held, allowanceLeft, allowanceResetAt, available}, agents: Agent[], unlocks: UnlockItem[], creditsPerNear, royaltiesYocto, cosmetics: string[] }`. `title` is `rankTitle(elo)`; `position` is the place on `/leaderboards/players`, null before the first ranked match; `tier` is a `PlayerTier` (below); `decayAt` is when inactivity next costs Elo, null when decay does not apply; `cosmetics` are the premium item ids owned |
| GET | `/me/matches` | `?limit=` (≤ 50, default 20) | the caller's matches, newest first: `{ id, mapId, ranked, practice, result: 'win'\|'loss'\|'draw'\|'void'\|'live', score: {you, rival} \| null, endedAt, eloDelta \| null }` |
| GET | `/me/earn-back` | | `{ royaltiesYocto, salesNetYocto, spentCredits, creditsPerNear, prizesYocto, rentalsYocto }`: creator royalties, sales as the seller after fee and royalty, paid credits charged on matches (the free allowance left out), season prizes won, agent rentals earned after the platform fee |
| PUT | `/agents/:id/rental` | ✓ | `{ priceYocto \| null }` → `{ offer: { offerId, agentId, priceYocto, active } \| null }`: offer the agent at a price per match, or stop. Needs a linked NEAR account (renters pay it). 404 for another player's agent |
| GET | `/rentals` | ✓ | Other players' active offers, cheapest first: `{ offerId, agentId, name, role, vision, comms, tier, ownerId, ownerHandle, ownerNearAccountId, priceYocto, payWith: 'near' \| 'credits', priceCredits }[]`. `payWith` follows `NEAR_RENTALS_ONCHAIN`; `priceCredits` is the price at `CREDITS_PER_NEAR`, rounded up |
| GET | `/rentals/mine` | ✓ | `{ offers, passes }`: the caller's active offers and unused one-match passes (each with the rented agent's public stats and owner handle) |
| POST | `/rentals/:offerId` | ✓ | `{ txHash }` → `{ pass }`. A `market.rent` transaction from the caller's linked account whose `rental` event names this offer (`rental_id` = `<offerId>:<nonce>`), pays the owner's linked account and covers the price (422 `wrong_rental`, `wrong_owner`, `underpaid`, `wrong_sender`; 409 `own_agent`, `duplicate_tx`). Dev mode: `dev:<yocto>[:<nonce>]`. A replay returns the same pass. A verified NEAR payment is honoured whatever `NEAR_RENTALS_ONCHAIN` says. `{ credits: true, key }` (key `[A-Za-z0-9_-]{1,64}`, one per click) → `{ pass, credits }` pays in paid credits while `NEAR_RENTALS_ONCHAIN` is off (409 `rentals_onchain` when on): the renter spends `priceCredits` (ledger `spend`, note `rental`), the owner is credited it minus the 5% fee (`topup`, note `rental`), in one transaction. The same key again returns the same pass with `credits: 0`; 402 `insufficient_credits` `{ need, have }`, 409 `not_offered` (offer ended), `own_agent`, `duplicate_tx` (another player's key). Credit rentals are not in earn-back's `rentalsYocto` The pass is used up when a match with that agent ends (a void match keeps it); the agent plays with its owner's skills and its plans are withheld from the renter |
| DELETE | `/me/near` | | `{ account }` with `nearAccountId: null`. `409 listing_active` while the player has an active listing |
| GET | `/me/export` | ✓ | Everything skirm holds about the caller, one table per key (account, agents, skills created, ownership, listings, sales, rental offers and passes, ledger, matches with only the caller's debrief side, messages their agents said, standings, prizes, trials, cosmetics, onboarding progress, campaign progress and rewards, community maps, puzzle runs and bests), plus `skillPrompts`: the caller's own skill prompts decrypted, and `playbookTexts`: their crew playbooks decrypted |
| DELETE | `/me` | ✓ | `{ confirm }` (the current handle; 422 `confirm_mismatch`) → `{ deleted: true }`. 409 `agent_busy` mid-match, 409 `listing_active` with an open listing. Clears the Privy id, NEAR link, system prompts and crew playbooks, ends rental offers, sets the handle to `~deleted-<id>` and `deleted_at`; the account never signs in again. Agents, match history, sales and the ledger stay (other players' records and paid rental passes depend on them); credits are forfeited |
| GET | `/agents` | | `Agent[]`: `{ id, name, elo, matchesPlayed, wins, losses, draws, skills: [{id, version, name}], unlocks, role, vision, comms, tier, systemPrompt, appearance, progression }`; `progression` is `{ xp, level, levelXp, nextLevelXp \| null, maxLevel, traits, traitSlots, nextTraitLevel \| null }` |
| GET | `/agents/:id/record` | | `{ allTime: AgentRecord, season: (AgentRecord & { number, endsAt }) \| null }`, `AgentRecord` = `{ matches, wins, losses, draws, delivered, bluffsTold, bluffsLanded, seenThrough }`: the caller's agent's record from its v2 matches (practice against the bot left out), all time and in the current season (null while none is open). 404 for another player's agent |
| GET | `/agents/:id/progression` | ✓ | `{ agentId, progression, traits: {id, name, effect}[], traitLevels, maxTraits, rankedTraits }`: the caller's agent's XP, level and traits with the trait catalogue (`DEFAULTS.progression`). 404 for another player's agent |
| POST | `/agents/:id/traits` | `{ trait: 'keen'\|'clear'\|'steady'\|'calm'\|'quick'\|'strong' }` | `Agent`. One pick per trait level reached (3 and 6), each trait once, at most 2: `422 no_trait_slot`, `422 trait_taken`, `409 agent_busy` mid-match, 404 for another player's agent. Traits play in casual and practice matches (recorded in the match log header, `crews[].traits`); ranked plays every agent on base stats |
| PATCH | `/agents/:id` | `{ name?, skills?: {id, version}[] (≤ 3, owned), unlocks?, role?, vision? (1-5), comms? (1-5), tier?, systemPrompt?: string \| null (≤ 600 characters; null or blank clears), appearance? }` | `Agent`. Gameplay fields are refused (`409 agent_busy`) while the agent is in a live match. `appearance` can change any time; a premium colour needs the cosmetic bought first (`403 cosmetic_not_owned`, `details.items`). Every equipped skill must be for the agent's (new) role or `any`: an equip or role change that breaks this is `422 skill_role_mismatch` (`details: {skillId, version, roles, role}`) |

### Matches

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/v2/models` | | the models a crew may pick per agent outside ranked: `{ default, models: {id, label, rateMultiplierBps}[] }`, the default first at 10000 (1.0x). An agent's rate is `ceil(tier ratePer100 × rateMultiplierBps / 10000)`; ranked always plays `default`. Realtime prices every pick from its own catalog and refuses an unlisted `crew[].model` with `invalid_crew` |
| GET | `/v2/matches/live` | | matches being played now, newest first: `{ id, mapId, difficulty, ranked, practice, startedAt, teams: {A, B}: {handle, size} }`. Crews stay hidden; the bot side of a practice match is `Greedy bot` |
| GET | `/v2/matches/:id` | | `{ id, mapId, ranked, practice, status: 'live'\|'ended'\|'void', difficulty, teams: {A, B}: {accountId, handle, crew[]}, winner, reason, decidedBy, score: {A, B} \| null, ticks, elo: {accountId, team, before, delta, after}[], stats, logHash, registry: {status, txHash?}, createdAt, endedAt, you?, debrief? }`. While live the rival side is blank and only a player sees their own crew. `you` and `debrief` (that crew's, as sent with `v2_end`) only for a player. `logHash` is the final hash of the match log (served by `/log` below once the match ends). `registry.status` is `none` for casual, practice and void matches |
| GET | `/v2/matches/:id/messages` | `?afterTick=&limit=` (≤ `MATCH_MESSAGES_MAX_LIMIT`, default 200) | `{ messages: {tick, team, agent: {id, name}, channel, text, heardBy, overheardBy}[], next? }`: the lines realtime saw delivered. `409 match_live` until the match ends. Page with `next` as the following `afterTick` |
| GET | `/v2/matches/:id/log` | | `{ matchId, logHash, log: {header, ticks, hashes, result} }`: the hash-chained match log (@skirm/engine/v2 `MatchLog`) so anyone can recompute it (the web's "Verify on NEAR" and `/verify` do it in the browser, then read the registry's `get_match` over NEAR RPC). A tick that carried live crew commands is served without `commands` and marked `redacted: true`; a verifier takes that link on its logged hash. `409 match_live` until it ends; 404 when no log was kept (void) |
| GET | `/v2/matches/:id/decisions` | ✓ | `{ matchId, you, ticks, crews: {team, own, brain, agents: {id, name, role, skills}[], plans: {tick, text, why, hidden?}[], decisions: {tick, agentId, observed, action, reason, outcome?, effect?, said?, thought?, skill: {id, version, by: 'model'\|'inferred'} \| null}[], moments: {tick, kind: 'hazard_breach'\|'switch'\|'supply_drop'\|'goal', team, agentId, text}[]}[], skills: {id, version, name, mine, prompt?}[] }`: the debrief's decision timeline (`match_timelines`, written by realtime at the end). Players only (403 otherwise), each their own crew; practice adds the bot's. `409 match_live` until it ends; a void match has no crews. `skill` is the one the agent's model named (a `SKILL:` line), else, on a model brain, the only equipped skill whose required action is the verb that resolved. Plans shaped by a bought skill are kept as `hidden`, and an agent on a bought or rented skill keeps no `thought`. `prompt` only for skills the caller wrote |
| GET | `/leaderboards/players` | `?limit=` (≤ 200, default 100) | `{ rows: {rank, account: {id, handle}, elo, title, tier, rankedMatches, wins, losses, draws}[], you? }`: players with a ranked match by Elo (ties share a rank) |
| GET | `/leaderboards/tiers` | | `{ tiers: {name, min, nextAt}[], placementMatches, kPlacement, decay: {fromTier, days, amount}, skillMinMatches }` |
| GET | `/leaderboards/maps/:mapId` | `?limit=` (≤ 200, default 100) | `{ mapId, rows: {rank, account, elo, rankedMatches, tier, matches, wins, losses, draws, winRate}[] }`: players by ranked results on one map, most wins then win rate (ties share a rank). 404 for an unknown map |
| GET | `/leaderboards/skills` | `?limit=&mapId=` | `{ minMatches, mapId?, rows: {rank, skill: {id, name}, creator: {id, handle}, matches, wins, losses, draws, winRate}[] }`: skills (all versions) with at least `minMatches` ranked matches by win rate (wins / matches; a crew carrying a skill counts once per match) |

**Ranked tiers** (`DEFAULTS.ranked`, `@skirm/shared` `tier.ts`): Bronze 0, Silver 1,100, Gold 1,300, Platinum 1,500, Diamond 1,700, Master 1,900 Elo. A `PlayerTier` is `{ tier: name \| null, placementsPlayed, placementMatches, nextAt }`: `tier` is null until the player's first 5 ranked matches (placements, K 48) are played. Decay: the worker's `ranked` job takes `RANKED_DECAY_AMOUNT` Elo from a placed Diamond or Master player with no ranked result for `RANKED_DECAY_DAYS` days, then again each further period, never below the floor of the tier they are in (`elo_decays` keeps each step).

### Replays and highlights

Frames are read from realtime's `v2:match:<id>:frames:watch` key (6 h); only the watch view is ever served, stripped again of plans, planner reasons, inner voice and live commands. Highlights are worked out once per match from those frames and cached in `replay_casts` (they outlive the frames).

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/v2/matches/:id/highlights` | | `{ matchId, highlights: {id, kind: 'goal'\|'switch_flood'\|'drop_fight'\|'lead_change', tick, start, end, team, title, facts, weight, score, line}[] (≤ 8, oldest first), caster: 'model'\|'template'\|null, framesKept }`. `409 match_live`. `line` is the caster's: the configured model (`LLM_MODEL`) when the environment plays the model brain (`V2_BRAIN` above) (one call per match, platform spend added to `cost:usd:<day>`, never charged to a player), else the deterministic template caster |
| POST | `/v2/matches/:id/shares` | ✓ `{ clip?: {start, end} \| null }` | `201 { share: {id, matchId, clip, createdAt, path} }`: a player's public link (`rps_` + 16 base64url). `403 forbidden` (not a player), `409 match_live`, `not_ended` (void), `replay_expired` (frames no longer kept), `share_limit` (20 live links per player per match), `422 bad_clip` (needs 0 ≤ start < end ≤ ticks) |
| GET | `/v2/matches/:id/shares` | ✓ | `{ shares }`: the caller's live links to the match, newest first |
| GET | `/replays/:shareId` | `?frames=0` | `{ share: {…, by}, match (as GET /v2/matches/:id with no `you` or debrief, whoever asks), highlights (inside the clip), caster, framesKept, frames: V2Frame[] (watch view, the clip's ticks) \| null }`; `frames` absent with `?frames=0` (link previews). 404 for an unknown or ended link |
| DELETE | `/replays/:shareId` | ✓ | `{ revoked: true }`: the creator ends the link (404 otherwise) |

The web page `/replays/<shareId>` sets Open Graph metadata and a generated preview image from `GET /replays/:shareId?frames=0`, read server side at `API_INTERNAL_URL` (compose: `http://api:4000`) or the public api URL.

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
| POST | `/skills` | `{ name, summary?, prompt (≤ 1200), reflexes? (≤ 400), requires_actions, handles_tags, royalty_bps, trigger?, roles? }` | `SkillPublic` (draft, version 1). The text goes encrypted into the vault. `trigger` (`@skirm/shared` `SkillTrigger`, null or absent: always) is one of `always`, `hazard_within {tiles 1-10}`, `behind_on_score`, `ahead_on_score`, `rival_near_switch {tiles 1-10}`, `carrying_item`, `time_left_under {seconds 10-300}`: the skill joins its agent's prompt only on ticks the condition holds on that agent's own view. Public on every `SkillPublic` (Exchange included); the prompt stays sealed. `roles` (default `["any"]`): `["any"]` or 1-6 of Builder, Digger, Firefighter, Scout, Runner, Hauler, the agent roles that may equip the version; public on every `SkillPublic`; versions from before roles are `any` |
| PUT | `/skills/:id` | same fields | the next version as a draft (minted versions are immutable). Creator only |
| GET | `/skills/:id` | `?version=` | `SkillPublic`; the creator alone also gets `{ prompt, reflexes }` |
| POST | `/skills/:id/mint` | `{ version? }` | `{ tokenId, status: 'minted'\|'pending', txHash?, benchmark: {status} }`. Never gated on a test: the hidden benchmark is queued first, then `nft_mint`. `409 mint_in_progress`, `422 near_account_required` (NEAR minter), `502 mint_failed`, `503 queue_unavailable` |
| GET | `/market` | `?tag=&role=&sort=winrate\|benchmark\|price\|new` | `MarketCard[]`: `{ skill, creator, priceYocto, listing?, rankedWinRate, rankedMatches, benchmarkScore, owned }`. `benchmarkScore` is null until a benchmark finished with a model (offline: `needs_model`); `benchmark` sorts nulls last. `role` keeps versions that agent role may equip (its role or `any`) |
| GET | `/market/:skillId` | `?version=` | `{ skill, benchmark, ranked: {matches, wins, losses, draws, perMap[]}, counters: {vs: {skillId, version, matches, wins, losses, draws}[]}, trials: {used, left}, sales[], listing?, owned, pinned: {version, promptSha256, tokenId, mintedAt} }`. `benchmark` is `{ status: queued\|running\|done\|needs_model\|failed, brain, seeds, matches, wins, losses, draws, deliveries, leakRate, manipulationRate, score, needsModel }` or null |
| POST | `/market/:skillId/trial` | `{ agentId, version? }` | `202 { trialId, status }`: a buyer's trial of the version with one of their agents. `409 skill_owned`, `422 skill_role_mismatch` (the agent's role cannot equip it), `429 trial_limit` (3 per version; `needs_model` trials do not count), `503 queue_unavailable` |
| GET | `/market/:skillId/trials` | `?version=` | the caller's trials, newest first: `{ id, skillId, version, agentId, status, needsModel, results, createdAt, finishedAt }` |
| POST | `/market/:skillId/listing` | `{ priceYocto, txHash?, version? }` | the listing, with `split: {primary, feeYocto, royaltyYocto, sellerYocto}` (no royalty on a primary sale). `422 not_minted` |
| POST | `/market/:skillId/purchase` | `{ txHash, version? }` | `{ owned: true, sale }` once the NEAR owner is the buyer (dev mode: `dev:<yocto>[:<nonce>]`). `409 not_listed`, `own_listing`, `duplicate_tx`; `422 underpaid`, `purchase_unverified`, `near_account_required`. A bought skill grants use, never its text; a sold skill is unequipped from the seller's agents |

### Skill test bench

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/bench` | | `{ brain: 'greedy'\|'model', free, costCredits, limit: {perHour, used, left} }`. Free on the greedy brain; with a model a run holds one Standard agent (30) |
| POST | `/bench/runs` | `{ skillId, version?, mapId, difficulty, prompt? (≤ 1200), reflexes? (≤ 400) }` | `202 BenchRun`: one headless match of a draft the caller wrote or a version they hold, against the greedy bot, queued as `benchmarks` `{ kind: 'bench', runId }`. `prompt` plays an edited draft (sealed on the run like a version; the writer's own skills only, else 403). `429 bench_limit` past `BENCH_RUNS_PER_HOUR` (details `limit`, `used`, `retryAt`), `503 queue_unavailable` |
| GET | `/bench/runs` | `?skillId=` | the caller's runs, newest first: `{ id, skillId, version, skillName, mapId, difficulty, seed, status: queued\|running\|done\|failed\|insufficient_credits, brain, credits, edited, promptSha256, result, shortfall, error, createdAt, finishedAt }`. `result` once done: `{ seed, outcome, reason, decidedBy, score: {you, bot}, ticks, logHash, talk, calls, events[] (≤ 80, no speech text), debrief (crewReport) }` |
| GET | `/bench/runs/:id` | | one of the caller's runs plus `{ prompt, reflexes, promptHidden }`: the text that played, only when it is the caller's own (a draft they typed or a version they wrote). 404 for another player's run |
| GET | `/bench/compare` | `?a=&b=` | `{ a, b, prompt }`: two of the caller's runs and a word diff of their prompts (`{ hidden: false, same, diff: {op: same\|del\|add, text}[] }`, or `{ hidden: true }` when either text is not theirs) |

### Daily challenge

One challenge per UTC day, derived from the date alone (`@skirm/engine` `dailyChallenge(date)`, FNV-1a over `skirm.daily/v1:<date>`): a map from `PRACTICE_MAPS`, a difficulty (Easy to Agentic), the bot's crew size (`practiceRival`) and a twist from existing knobs (`none`, `short_clock`: the clock × 0.8, `sly_bot`: bot bluff cap + 3, `eager_bot`: no extra bot start ticks). Points (`dailyPoints`): win 10 000 / draw 5 000 / loss 0, + 100 × (your score − bot score, clamped ±20), + ticks left on the clock on a win (≤ 99). Board order (`compareDaily`): points, then fewer ticks, then finished first. On the greedy brain the same crew on the same day replays to the stored log hash.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/daily` | | `{ challenge: {date, seed, mapId, mapName, difficulty, twist, twistName, twistLine, crewSize, ticks, bot: {tier, hold, lieCap}}, brain, free, costCredits, attempts: {perDay, used, left}, msLeft, endsAt, mine: DailyAttempt[] }` (today's, newest first) |
| POST | `/daily/attempts` | `{ agentIds? }` (1 to `crewSize` of your own agents; default your first `crewSize`) | `202 DailyAttempt` `{ id, date, status: queued\|running\|done\|failed\|insufficient_credits, brain, credits, crew: {name, role, skills[]}[], points, outcome, ticks, logHash, result, shortfall, error, createdAt, finishedAt }`, queued as `benchmarks` `{ kind: 'daily', attemptId }`. The crew is snapshotted (skill keys, never text). `400 invalid_crew` (not yours, listed twice, too many, or played by an external agent), `429 daily_limit` past `DAILY_ATTEMPTS` (failed and unpaid attempts do not count), `503 queue_unavailable` |
| GET | `/daily/leaderboard` | `?date=YYYY-MM-DD` (default today; not a future day) `&limit=` (≤ 100, default 50) | `{ date, challenge, players, top: Row[], me: Row \| null }`, Row `{ rank, attemptId, handle, you, points, outcome, ticks, logHash, crew, finishedAt }`: each player's best finished attempt of the day |

### Crew playbooks

A player's crew-level strategy (who hauls, who scouts and calls hazards, who blocks; when to regroup; the goal or denying the rival), separate from any agent's skills. Sealed in the vault like a skill prompt (its own AAD); only the owner reads it back. Limits in `DEFAULTS.playbooks`: text ≤ 800 characters, name ≤ 32, at most 5 kept. Realtime puts the one selected (or picked at lock-in) into the crew planner's prompt whole and each actor's as one line (≤ 160), adds it to the speech filter's secrets, and names it (never the text) on the player's own frames (`V2Frame.playbook`); the rival, spectators, the match log and shared replays never see it. The greedy brain ignores it.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/playbooks` | | `{ playbooks: { id, name, selected, createdAt, updatedAt }[], max, maxChars }` (never the text) |
| POST | `/playbooks` | `{ name, text }` | the playbook (the first one is selected). `422 playbook_limit` at the cap, `422 playbook_refused` when the speech filter calls the text abusive |
| GET | `/playbooks/:id` | | the playbook with `text`, owner only (404 otherwise) |
| PUT | `/playbooks/:id` | `{ name?, text? }` | the playbook. Owner only |
| DELETE | `/playbooks/:id` | | `{ deleted: true }`. Owner only |
| POST | `/playbooks/select` | `{ id \| null }` | `{ selected }`: the playbook lock-in starts with (null: none) |

### Community maps

Players' own v2 maps from the web map editor (`/maps/editor`), stored in `community_maps` (`cmp_` + ULID; `map` is the skirm.map/v2 JSON). A draft is its author's alone and may hold anything the editor saves (≤ 32 KB, at most 20 drafts). Publishing runs `validateCommunityMap` (@skirm/engine/v2: parseMapV2 plus a walled border, a tile-for-tile mirrored layout, starts, switch lanes, the delivery point, switches and drops on the centre column, a source tile for every hazard, enough items for the goal, size 11–55 × 9–25) on the map with the server's `id`, `code` (`CM-xxxx`), `label: 'Community'` and the row's name, screens every player-written text with the speech filter, and runs `balanceCheck` (@skirm/decision-engine/v2): 4 seeds (difficulty × crew size), each played greedy vs greedy both ways round, the right-half crew on a mirrored view; it must be fair (neither half wins more than a quarter of the runs over the other) and playable (somebody scores in at least half, no crew wiped out). A published map never changes and cannot be deleted; names are unique among published maps (any case). At most 3 publishes per player per 24 h; `test-play` and `publish` are in the strict rate-limit bucket. Published maps play in practice and casual (`v2_queue { mapId: 'cmp_…' }`), never ranked or in lobbies; each match started counts a play. Account deletion removes drafts; published maps stay.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/community-maps` | `?sort=new\|popular` (popular: plays + 3 × likes) `&limit=` (≤ 48, default 24) `&offset=` | public. `{ sort, maps: CommunityMap[] }`, published only; signed in, each has `liked` |
| GET | `/community-maps/mine` | | `{ maps: CommunityMap[], maxDrafts, publishPerDay }`: the caller's drafts and published maps |
| GET | `/community-maps/:id` | | public. A published map, or the caller's own draft (404 otherwise) |
| POST | `/community-maps` | `{ name, theme?, map }` | the draft (`theme`: an official map id whose look the board borrows). `422 map_limit` at the cap |
| PUT | `/community-maps/:id` | `{ name?, theme?, map? }` | the draft. Author only (404); `409 map_published` once published |
| DELETE | `/community-maps/:id` | | `{ deleted: true }`. Author only; `409 map_published` |
| POST | `/community-maps/test-play` | `{ map }` | `{ valid: false, issues: { message, at? }[] }` or `{ valid: true, issues: [], balance: BalanceReport }`; nothing is saved |
| POST | `/community-maps/:id/publish` | | the published map. Author only; `422 map_invalid` (`details.issues`), `422 map_refused` (filter), `422 map_unbalanced` (`details.problems`, `details.wins`), `409 name_taken`, `409 map_published`, `429 publish_limit` |
| POST / DELETE | `/community-maps/:id/like` | | `{ likes, liked }`; published maps only, once per player |

`CommunityMap`: `{ id, name, theme, author, status: 'draft'\|'published', plays, likes, liked?, map, balance?, createdAt, updatedAt, publishedAt }`. `BalanceReport`: `{ runs: { seed, difficulty, size, swapped, winner, side, reason, decidedBy, score, ticks }[], wins: { left, right, draw }, fair, playable, ok, problems }`.

### Writer backing

Players back a skill writer up front for a capped share of the writer's future royalties (`contracts/backing`, the same arithmetic in `@skirm/shared` `backing.ts`). A writer opens a round with fixed terms: `shareBps` (1–5,000) of every royalty routed to the round goes to the backers until they together received `capMultipleBps / 10⁴` (1×–10×) times the raise, `maxRaiseYocto` bounds the stakes. One open round per writer; `skillId` null covers every skill the writer sells. Closing pays the raise to the writer and fixes the stakes; cancelling (while open) returns them. A backer's entitlement is `floor(stake × backersEarned / raised)`, so all backers reach the cap together. Tables: `backing_rounds` (`brd_`), `backings` (`bkg_`), `backing_payouts` (`bpo_`).

Modes (`GET /backing/config` `mode`): `near` when `BACKING_CONTRACT` is set: every write answers `{ wallet: { contractId, methodName, args, depositYocto, gas } }` for the player's wallet, and the web posts the tx hash to `/backing/sync`, which reads it through RPC (receiver, signer = the caller's linked account, success) and mirrors the contract's `skirm_backing` events. Royalties reach a round through `distribute(round_id)`: the skills contract pays NEP-199 royalties to the creator account fixed at mint, so the writer forwards them (the api shows what a round is owed from mirrored resales). `credits` (no contract, `AUTH_MODE=dev`): stakes are spent from paid credits (ledger note `backing`), the raise and payouts are credited, and every resale of a covered skill after the round closed routes its royalty to the oldest closed round with room under the cap. `off` otherwise: reads work, writes answer `503 backing_disabled`.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/backing/config` | | public. `{ mode, contractId, creditsPerNear, maxShareBps, minCapMultipleBps, maxCapMultipleBps, minStakeYocto, maxRaiseYocto, openRoundStorageYocto }` |
| GET | `/backing/rounds` | `?writer=<handle>&skill=<skl_…>&status=open\|closed\|cancelled` | public. `{ rounds: BackingRound[] }`, newest first; `skill` includes its writer's all-skill rounds |
| GET | `/backing/rounds/:id` | | public. `{ round, payouts (latest 20), position (signed in, if backed), owedYocto (near, the writer) }` |
| GET | `/backing/mine` | | `{ mode, positions: BackingPosition[], rounds: (BackingRound & { owedYocto })[] }` |
| POST | `/backing/rounds` | `{ skillId?, shareBps, capMultipleBps, maxRaiseYocto }` | credits: `{ round }` (`409 round_open`); near: `{ wallet }` for `open_round` (0.01 NEAR storage attached, excess refunded). `403` on another writer's skill |
| POST | `/backing/rounds/:id/back` | `{ amountYocto }` | credits: `{ position, stakedYocto }` in whole credits, cut to what is left of the raise (`402 insufficient_credits`, `409 round_full`, `own_round`, `round_not_open`, `422 stake_too_small` under 0.1 NEAR); near: `{ wallet }` for `back` |
| POST | `/backing/rounds/:id/close` / `cancel` | | the writer. credits: `{ round }`; near: `{ wallet }` |
| POST | `/backing/rounds/:id/claim` | | a backer: earnings in whole credits `{ position, claimedCredits }` (`409 nothing_to_claim`, `round_not_closed`); near: `{ wallet }` for `claim` (or `refund` on a cancelled round) |
| POST | `/backing/rounds/:id/distribute` | `{ amountYocto? }` (default: owed) | near, the writer: `{ wallet }` for `distribute` (`409 nothing_owed`) |
| POST | `/backing/sync` | `{ txHash }` | near: `{ rounds }` touched. `409 not_onchain` otherwise; `422 wrong_sender` / `wrong_receiver` / `failed` / `no_events`, `404`, `503 rpc_unavailable` |

`BackingRound`: `{ id, writerId, writerHandle, writerNearAccountId, skillId, skillName, shareBps, capMultipleBps, maxRaiseYocto, raisedYocto, backers, status, mode, chainRoundId, royaltiesInYocto, backersEarnedYocto, capYocto, createdAt, closedAt }`. `BackingPosition`: `{ backingId, round, stakeYocto, earnedYocto, claimedYocto, claimableYocto, capYocto, refunded }`.

### Cosmetics and credits

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/cosmetics` | | `{ items: {id, kind: 'outfit'\|'hair', name, index, priceCredits, color}[], owned: string[] }`. Premium palette entries appended after the free ones; purely visual |
| POST | `/cosmetics/:id/buy` | | `{ owned }`. Paid credits only, never the free allowance: `402 insufficient_credits` with `need`, `have`. Buying an owned item is a no-op 200 |
| GET | `/credits` | | `{ balance, held, allowanceLeft, allowanceResetAt, available, creditsPerNear, rows: {id, type, amount, source, note, matchId, txHash, createdAt}[] }` (latest 100) |
| POST | `/credits/deposits` | `{ txHash }` | `{ credited, balance, amountYocto }`: a `deposits.deposit()` tx verified through RPC (dev mode: `dev:<yocto>`), credited once (`409 duplicate_receipt`) |
| GET | `/relay` | | `{ enabled, freeTxs, used, remaining }`: gasless onboarding for the caller ([gasless.md](gasless.md)); `enabled: false` without a relayer |
| POST | `/relay` | `{ signedDelegate }` (base64 borsh NEP-366 SignedDelegate) | `{ txHash, remaining }`: the relayer's transaction. `404 relay_disabled`, `409 near_not_linked` / `relay_duplicate`, `403 wrong_signer` / `relay_quota`, `422` for a refused delegate (`receiver_not_allowed`, `method_not_allowed`, `action_not_allowed`, `too_many_actions`, `gas_too_high`, `bad_signature`, `delegate_expired`, `delegate_too_far_ahead`, `unknown_key`, `stale_nonce`, `relay_tx_failed`), `502 relay_failed`, `503 rpc_unavailable`. Strict rate-limit bucket |

### Quests and achievements

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/quests` | | `{ daily, weekly: {key, endsAt, quests: Quest[]}, streak: {current, best, playedToday}, allowanceLeft }`. 3 daily quests per UTC day and 2 weekly per UTC week (Monday 00:00), drawn deterministically from the pools in `@skirm/shared` (`drawQuests`). `Quest` is `{ id, period, title, target, progress, done, claimed, claimable, rewardCredits, credited }`; progress counts ended (not void) matches that ended in the window. The streak counts consecutive UTC days with an ended match, up to today (or yesterday until today is played) |
| POST | `/quests/:id/claim` | | `{ quest, credited, allowanceLeft }`: refills up to `rewardCredits` (daily 10, weekly 25) of the free credits spent today. 404 when the quest is not drawn now; 409 `quest_incomplete`, `already_claimed`, `allowance_full` (nothing spent today to refill: the claim stays open) |
| GET | `/achievements` | | `{ streak, achievements: {id, title, detail, target, progress, unlocked, unlockedAt, cosmetic: {id, name} \| null, badge: {status: pending\|minted\|local\|failed, tokenId, txHash, owner, mintedAt} \| null}[] }`. Records achievements newly met (first seen = `unlockedAt`) and grants their premium cosmetic (`cosmetics_owned.source` `achievement:<id>`) |
| POST | `/achievements/:id/badge` | | `{ badge }`: mints the unlocked achievement as a soulbound badge (`nft_mint` on `badges`, token `<achievementId>:<accountId>`) to the linked NEAR account. Without a signer it is `local` with a `noop:` hash. Once per player and achievement (a minted badge is returned as is; a failed one can be retried). 404, 409 `not_unlocked`, `mint_in_progress`, 422 `near_account_required` (NEAR signer only), 502 `mint_failed` |
### Lobbies and tournaments

A **lobby** is a private match between two players: the host picks the map, difficulty, talk rule (`any`, or every agent on `quiet`, `standard` or `open`) and crew size (1-3, capped by the map) and shares a 6-character code (link `/lobbies/join/<code>`). It is unranked (no Elo, season or registry) and both crews hold and pay credits as in a casual match. Each player readies a crew over realtime (`v2_lobby_ready`); the match starts once both have, the host as crew A, then plays through the usual accept and lock-in. A friend lobby opens again after each match (`winnerId` is the last winner). A **tournament** is a single-elimination bracket of 4, 8 or 16 players built from lobbies: it starts by itself when full, seeded by Elo (best first, earlier joiner on a tie; 1 v N, seeds 1 and 2 only meet in the final), and each round's lobby is made once both of its feeders are decided. A bracket match always has a winner: a draw goes to the better seed, a void to the crew not at fault (a void nobody caused is played again), and a match nobody starts within 15 minutes of opening (`TOURNAMENT.noShowMs`) goes to the player who readied, else the better seed. The optional prize pool is the creator's paid credits, spent when the tournament is made (ledger `spend`, note `prize_pool`), paid at the end to the top four, 60 / 25 / 7.5 / 7.5 % with the dust to the champion (`topup`, note `prize`, each once), and returned to the creator if it is cancelled before it starts (`topup`, note `prize_pool`). All offchain.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| POST | `/lobbies` | `{ mapId, difficulty?, talk?, crewSize? }` | `Lobby`: `{ id, code, host: {id, handle}, guest \| null, mapId, difficulty, talk, crewSize, status: 'open'\|'playing'\|'done'\|'cancelled', matchId, winnerId, tournamentId, round, slot, ready: {host, guest}, openedAt, createdAt }` |
| GET | `/lobbies` | | the caller's lobbies still to play (open or playing), bracket matches included |
| GET | `/lobbies/code/:code` | | the friend lobby with this code (the invite preview); 404 for a bracket match |
| POST | `/lobbies/join` | `{ code }` | `Lobby` with the caller as guest (again: the same). `409 own_lobby`, `lobby_full`, `lobby_closed`, `tournament_match` |
| GET | `/lobbies/:id` | | `Lobby`; 404 unless the caller is in it |
| PATCH | `/lobbies/:id` | `{ mapId?, difficulty?, talk?, crewSize? }` | `Lobby`. Host only (`403`), friend lobbies only (`409 tournament_match`), while open and nobody has a crew readied (`409 lobby_ready`) |
| DELETE | `/lobbies/:id` | | `Lobby`: a guest leaves (the seat opens), the host cancels it. `409 match_live`, `tournament_match` |
| GET | `/tournaments` | `?status=open\|running\|done\|cancelled` | `TournamentSummary[]` newest first (public): `{ id, name, creator, size, entrants, mapId, difficulty, talk, crewSize, prizePool, status, champion \| null, createdAt, startedAt, endedAt, joined }` |
| POST | `/tournaments` | `{ name (≤ 40), size: 4\|8\|16, mapId, difficulty?, talk?, crewSize?, prizePool? (paid credits, ≤ 100,000), join? (default true) }` | `TournamentDetail`. `402 insufficient_credits` (`need`, `have`) when the paid balance is short |
| GET | `/tournaments/:id` | | `TournamentDetail` (public): the summary plus `rounds`, `entries: {account, seed, elo, place, prize}[]`, `matches: {lobbyId, code, round, slot, hostId, guestId, status, matchId, winnerId}[]` and, signed in, `you: {joined, creator, place, prize, lobbyId}` (`lobbyId`: the bracket match to play now) |
| POST | `/tournaments/:id/join` · `/leave` · `/cancel` | | `TournamentDetail`. Join and leave while open (`409 not_open`, `tournament_full`); the last place starts the bracket. Cancel: the creator (`403`), while open; the pool comes back |

### Onboarding

The tips, checklist items and templates are static (`TUTORIAL_STEPS`, `FIRST_STEPS`, `SKILL_TEMPLATES` in `@skirm/shared`); `onboarding_progress` stores only how far each player got. The guided match is ordinary practice against the greedy bot on `TUTORIAL_MATCH` (Copper Hollow, Easy, one agent); nothing in realtime knows it is a tutorial.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/onboarding` | | `{ tutorial: {status: 'new'\|'in_progress'\|'done'\|'skipped', step, steps, match: {mapId, difficulty, crewSize}, completedAt, skippedAt}, checklist: {items: {id: 'tutorial'\|'practice'\|'skill'\|'equip'\|'pvp', done}[], done, dismissed}, showChecklist }`. `step` is the number of tips seen. `tutorial` is done once the tutorial is finished or skipped; the others are read from the player's rows: an ended practice match, a skill they wrote, an agent of theirs carrying a skill they wrote, an ended casual or ranked match. `showChecklist` until every item is done or it is dismissed |
| PUT | `/onboarding/tutorial` | `{ step? (0..steps), status?: 'done'\|'skipped'\|'restart' }` (one at least) | the same view. `step` only grows; the first `done` or `skipped` time sticks; `restart` sets the step to 0 and clears a skip (a finished tutorial stays finished) |
| POST | `/onboarding/checklist/dismiss` | | the same view, `checklist.dismissed: true` |
| GET | `/onboarding/templates` | | `{ id, name, summary, bestFor, lesson, prompt, reflexes, requires_actions, handles_tags }[]`: starter strategies, full text (they are examples, not secret) |
| POST | `/onboarding/templates/:id/copy` | | `201 SkillPublic`: a new draft skill of the caller's (version 1, sealed into the vault like `POST /skills`). 404 for an unknown template |

### Campaign

Chapters and missions are static (`CAMPAIGN_CHAPTERS` in `@skirm/shared`): each mission is practice against the greedy bot on a fixed map, difficulty and largest crew, with a briefing and an objective (`win`, `win_within` a tick, or `shutout`: the bot delivers nothing). The engine is deterministic, so the map and difficulty are the whole setup. Missions open in order, a chapter after the one before. `campaign_progress` stores attempts, the first clear and the fastest clearing tick per mission; `campaign_rewards` keys on (account, chapter), so a chapter's rewards are granted once: its account-bound starter skill (a `skill_ownership` row with no token, never minted or listed; the system account writes it, sealed by the api on first use) and, for the last chapter, a cosmetic. Free on the greedy brain; with a model the player's crew holds and pays as in any practice match.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/campaign` | | `{ brain, free, progress: {cleared, total}, chapters: {id, index, title, blurb, unlocked, complete, cleared, missions, rewards: {skill: {id, version, name, summary, requires_actions, handles_tags}, cosmetic: {id, name, kind}\|null, granted, grantedAt}}[] }`; a mission is `{ id, title, briefing, mapId, mapName, difficulty, crewSize, objective: {kind, ticks?, label}, rival: {handle, size, tier}, costCredits, status: 'locked'\|'open'\|'cleared', attempts, bestTicks, clearedAt }`. Also grants any complete chapter's missing rewards (idempotent) |
| POST | `/campaign/missions/:id/start` | | `{ mission, queue }`: `queue` is the `v2_queue` to send over the socket (add `crew`). 403 `mission_locked` until the missions before it are cleared; 404 for an unknown mission |

### Puzzles

Puzzle mode: small hand-made boards (`PUZZLES` in `@skirm/engine/v2`, six of them) with fixed hazards, solved by the caller's own crew (1 to the puzzle's crew size, with the skills they carry) in as few ticks as possible. A puzzle plays on the ordinary v2 engine: its board is a v2 map whose right half is rock with the rival crew sealed in one-tile pockets (an inert crew as large as the player's that holds all run, speaks on Quiet and tells no bluffs). Goals: `deliver` items, `reach` a tile (any standing agent on it), or `survive` (hold out N ticks). A run ends on the puzzle's own check after every tick (solved, the whole crew removed, or the tick cap). Score (lower is better) is the solving tick; a hold-out scores its length + 4 per knock-down − 5 per item delivered. Medals are per-puzzle thresholds (`gold` is par). The engine and the greedy brain are deterministic, so the same crew always scores the same and leaves the same log hash. Runs play headless on the worker (`benchmarks` job `{ kind: 'puzzle', runId }`); the greedy brain walks to a reach tile, a model brain reads the objective ahead of each agent's instructions. Free on the greedy brain; with a model a run holds the crew for the tick cap at its talk rate (`puzzle-<runId>-<attempt>`) and pays the ticks it played. `puzzle_runs` keeps each run; `puzzle_bests` each player's best per puzzle (lowest score, earlier on a tie, with the run id and log hash), which the leaderboard reads. Both tables are in `/me/export`.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/puzzles` | | `{ brain, free, limit: {perHour, used, left}, medals: {gold, silver, bronze, solved, total}, puzzles: PuzzleView[] }`; a puzzle is `{ id, n, title, briefing, goal: {kind:'deliver', count}\|{kind:'reach', at:[x,y]}\|{kind:'survive', ticks}, crewSize, cap, par, medals: {gold, silver, bronze}, item, deliverTo, costCredits, best: {score, ticks, medal, runId, logHash, brain, solves, achievedAt}\|null }` |
| GET | `/puzzles/:id` | | `PuzzleView` plus `board: { layout (left half, centre column last: '1'..'3' starts, 'X' a reach tile, else v2 tiles), w, h, hazards, blockSupply }` and `runs` (the caller's last 10). 404 for an unknown puzzle |
| POST | `/puzzles/:id/runs` | `{ crew: {agentId, tier?}[] (1..crewSize) }` | `202 PuzzleRun` queued. 403 for an agent that is not the caller's, 400 `invalid_crew` for too many or a duplicate, `429 puzzle_limit` past 30 runs an hour (details `limit`, `used`, `retryAt`), `503 queue_unavailable` |
| GET | `/puzzles/:id/runs/:runId` | | `{ id, puzzleId, crew, status: queued\|running\|done\|failed\|insufficient_credits, brain, credits, result, shortfall, error, createdAt, finishedAt }`; `result` once done: `{ puzzleId, solved, reason: goal\|time\|eliminated, ticks, score, medal, delivered, knockdowns, logHash, best, crew, calls, events[] (≤ 80, no speech text), eventsDropped }`. 404 for another player's run |
| GET | `/puzzles/:id/leaderboard` | public | `{ puzzleId, par, medals, entries: {rank, account: {id, handle}, score, ticks, medal, logHash, brain, achievedAt}[] }`, lowest score first (ties share a rank), top 50 |

### External agents (bring your own agent)

A player's own program plays one of their agents in casual and practice matches, by webhook or by pulling turns. The versioned contract (`skirm.agent/v1`), signatures, SSRF rules and the MCP server are in [external-agents.md](external-agents.md).

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/external-agents` | | `ExternalAgent[]`: `{ id, name, agentId, mode: 'webhook'\|'pull', webhookUrl, calls, misses, lastError, lastSeenAt, rotatedAt, createdAt }` |
| POST | `/external-agents` | `{ name (1-40), agentId?, webhookUrl? (https, public host) }` | `201 { externalAgent, secret, token }`, the secret and token shown this once. `409 agent_bound` (another external agent plays that agent), `409 external_limit` (`DEFAULTS.external.perAccount`, 5), `422 invalid_webhook` |
| PATCH | `/external-agents/:id` | `{ name?, agentId? \| null, webhookUrl? \| null }` | `ExternalAgent` |
| POST | `/external-agents/:id/rotate` | | `{ externalAgent, secret, token }`; the old secret and token stop working |
| POST | `/external-agents/:id/ping` | | webhook: a signed `ping`, `{ ok: true, mode, status, latencyMs }` or `{ ok: false, mode, error, message }`; pull: `{ ok, mode, lastSeenAt }` |
| DELETE | `/external-agents/:id` | | `{ deleted: true }` |
| GET | `/agent/v1/me` | `Authorization: Bearer <token>` | the external agent, its player and the agent it plays |
| GET | `/agent/v1/turn` | token; `?waitMs=&after=` | `{ contract, turn \| null }` (long poll ≤ 25 s) |
| POST | `/agent/v1/action` | token; `{ turnId, action, say?, thought? }` | `{ accepted, turnId, action }`. `409 stale_turn`, `too_late`, `already_answered`; `422 invalid_action`; `503 relay_unavailable` |
| GET | `/agent/v1/matches` | token; `?limit=` | `{ matches }` as `/me/matches` |

### Operations

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/ops/stats` | header `Authorization: Bearer <OPS_TOKEN>` | totals for the skirm-ops dashboard, no per-player data: `{ at, engine: 'model'\|'greedy', model: string \| null, ai: {dailyBudgetUsd, spend: {day, usd}[3] \| null, matchCostUsd30d}, players: {total, new1d, new7d, withNear}, credits: {balance, held, fundedAccounts, freeBudgetUsedToday, creditsPerNear, flow30d[]}, matches: {live, last1d, last7d, last30d, void30d, costUsd30d, charged30d, daily[] (14 UTC days)} }`. `model` is the `LLM_MODEL` id the v2 brain plays, null for greedy. `404` while `OPS_TOKEN` is unset, `401 unauthenticated` for a wrong token |
| GET | `/ops/talk-rates` | ops token | `{ days, margin, creditUsd, engine, model, tiers: { quiet, standard, open } }` (`engine` and `model` as in `/ops/stats`), each `{ crews, agentTicks, costPerAgentTickUsd, suggestedRatePer100, currentRatePer100, enough }`: talk-tier rates from measured model spend over `?days=` (default 30) of ended matches, single-tier crews with model spend only. Apply a suggestion in `DEFAULTS.talk.ratePer100` |

### Error codes

Besides `bad_request` (400), `unauthenticated` / `no_session` / `invalid_agent_token` (401), `forbidden` (403), `not_found` (404) and `internal` (500):

| Status | Codes |
| --- | --- |
| 402 | `insufficient_credits` (with `need`, `have`) |
| 403 | `dev_disabled`, `cosmetic_not_owned`, `mission_locked` |
| 409 | `agent_busy`, `agent_bound`, `external_limit`, `stale_turn`, `too_late`, `already_answered`, `match_live`, `not_ended`, `replay_expired`, `share_limit`, `mint_in_progress`, `quest_incomplete`, `already_claimed`, `allowance_full`, `not_unlocked`, `skill_owned`, `near_account_taken`, `listing_active`, `duplicate_receipt`, `duplicate_tx`, `not_listed`, `own_listing`, `conflict`, `invalid_transition`, `hold_mismatch`, `own_lobby`, `lobby_full`, `lobby_closed`, `lobby_ready`, `tournament_match`, `tournament_full`, `not_open` |
| 422 | `bad_clip`, `invalid_webhook`, `invalid_action`, `near_account_required`, `near_proof_required`, `near_proof_invalid`, `not_minted`, `invalid_hash`, `underpaid`, `purchase_unverified` |
| 429 | `trial_limit`, `bench_limit`, `daily_limit` |
| 502 | `mint_failed` |
| 503 | `relay_unavailable`, `queue_unavailable`, `rpc_unavailable`, `near_unavailable`, `ownership_unavailable` |

## WebSocket (`apps/realtime`, path `/ws`)

One JSON object per text frame (at most 16 KiB). A client signs in once, then sends `v2_*` messages; watching needs no sign-in. Messages of one socket are handled in order.

Client → server (`WsClientMessage`):

| Message | Meaning |
| --- | --- |
| `{type:'auth', token?, devUser?, agentToken?}` | sign in (dev: `devUser` is the handle). On reconnect during a match the server re-sends where it stands (found, lock-in or the latest frame). `agentToken` (an external agent's token, alone) signs in as its player for casual and practice with the agent it plays only ([external-agents.md](external-agents.md)) |
| `{type:'v2_queue', crew: {agentId, tier}[] (1-3), ranked, mapId?, difficulty?, opponent?: 'bot', draft?, mission?}` | search for a match. Casual pairs only with the same `mapId` (or any) and `difficulty`; ranked ignores both (any fitting map, Normal). `opponent: 'bot'` is practice: casual only (`practice_unranked`), no matchmaking, starts at once on `mapId`/`difficulty` or `DEFAULT_PRACTICE` (Copper Hollow, Easy). `draft: true` is draft mode: casual against a player only (`draft_casual`), pairs only with other draft searches, and adds a ban phase after accept. `mission` (with `opponent: 'bot'` only) plays a campaign mission: its map and difficulty win, the crew is at most its crew size, a mission not yet unlocked is refused with `mission_locked`, and the result is recorded for the player when the match ends |
| `{type:'v2_cancel_queue'}` | stop searching |
| `{type:'v2_accept', matchId}` / `{type:'v2_decline', matchId}` | answer `v2_found` (10 s) |
| `{type:'v2_ban', matchId, skillId}` | draft mode, on your step: ban one skill from your `v2_draft` pool, or pass with `skillId: null` (`not_your_turn`, `invalid_ban`) |
| `{type:'v2_lock_in', matchId, tiers, crew?, playbookId?}` | lock the crew in (30 s): a talk tier per agent in slot order; `crew` swaps, removes or adds agents up to `crewLimit` and its tiers win; `playbookId` plays one of the player's crew playbooks this match (null: none; absent: the selected one; another player's: `not_found`) |
| `{type:'v2_watch', matchId}` / `{type:'v2_unwatch', matchId}` | spectate: the latest whole-board frame now, then every one after, and `v2_end`. Released on `v2_end`, unwatch or disconnect; at most 8 per socket |
| `{type:'v2_replay', matchId}` | every stored frame of an ended match, for replay at another speed (kept 6 h) |
| `{type:'v2_lobby_ready', lobbyId, crew: {agentId, tier}[]}` | ready a crew in a private lobby you are in (open, with a guest): at most its crew size, every agent on its tier when the talk rule forces one. The match starts once both players have; readying again replaces the crew, `v2_cancel_queue` (or the last socket closing) steps back. Both players must reach the same realtime instance |
| `{type:'v2_command', matchId, agentId?, preset?, text?}` | a live command to the player's own crew (`agentId` absent: all of it): a preset (`hold_gate`, `go_drop`, `regroup`, `block_flow`) and/or free text (≤ `DEFAULTS.commands.maxChars`, through the leak and abuse filter). `DEFAULTS.commands.perMatch` (3) per crew, one every `cooldownTicks` (5), one waiting at a time. Applied on the next tick: in the targeted agents' prompts (and the greedy brain's moves) for `activeTicks` (10), in that tick's log entry (`commands`, hash-chained), in the crew's own frames (`frame.commands: {left, log}`) and debrief (`debrief.commands`); never in the rival's frames, the watch view or `/v2/matches/:id/messages` |
| `{type:'v2_control', matchId, agentId \| null}` | hybrid control: steer one of your own agents still playing by hand (`null` hands it back to the brain). One at a time (taking another hands the first back). **Casual and practice only**: a ranked match refuses with `control_casual` (ranked results are the brains' alone). Answered with `v2_control_ok`. Spectators and the rival get `not_found`. The steered agent goes back to the brain when it is out or its player's last socket closes. The crew planner is told who is steered (by name) and replans at once |
| `{type:'v2_steer', matchId, input}` | hybrid control: input for the agent you steer (`not_controlling` without one). `input` is one tick's action, `{kind:'move', dir}`, `{kind:'wait'}` or `{kind:'use', dir?}` (the role's verb toward `dir`, else the first that fits, else a switch), the latest replacing any earlier; or a standing order walked each tick until done, `{kind:'take'}` (nearest seen item, until full), `{kind:'deliver'}` (until empty) or `{kind:'goto', to:[x, y]}` (that tile, or next to it when solid); `{kind:'stop'}` drops both. Anything not legal that tick is a wait, and with no input by the action deadline the agent waits (not counted as a timeout). The steered agent never speaks. No answer; it counts toward the socket's message budget, so clients send at most one per key press and one per tick for a held key. Each tick it is steered is listed in that tick's log entry (`controlled: [agentId]`, hash-chained, absent when none); every view's frames mark the agent (`agent.controlled: true`) and the player's own frames carry `frame.steer: {agentId, standing}` |

Server → client (`WsServerMessage`):

| Message | Meaning |
| --- | --- |
| `{type:'queue_status', searchingMs, eloRange}` | every second while searching; the Elo window widens from ±100 by 50 every 5 s up to ±1000 |
| `{type:'v2_found', matchId, team, mapId, ranked, acceptMs, difficulty, practice?, free?, rivalHandle?, tiers?}` | a match: accept within `acceptMs`. `practice` and `rivalHandle` ('Greedy bot') for practice; `free` when this crew holds nothing; `tiers: {you, rival}` (`PlayerTier`) on ranked matches, as both players queued |
| `{type:'v2_accepted', matchId, team}` | a crew accepted |
| `{type:'v2_draft', matchId, turn, step, steps, stepMs, pool: {skillId, name, agents}[], bans: {team, step, skillId, name, timedOut?}[]}` | draft mode (`v2_found` carries `draft: true`): after accept, crews ban in turn, A first, `DEFAULTS.draft.bansPerSide` each; `turn` bans within `stepMs` (`DEFAULTS.draft.stepMs`, 15 s) or the step passes (`timedOut`). `pool` is the rival's equipped skills you may still ban, by id and public name only (never the prompt). Sent at each step and once more with `turn: null` when the draft is over; then `v2_lockin`. A banned skill is unequipped from the rival crew for that match (also from a crew swapped in at lock-in) and every ban is in both debriefs (`debrief.draft.bans`) |
| `{type:'v2_lockin', matchId, lockMs, rival: {agents}, crewLimit, headStartTicks, free?}` | lock-in started (the rival's crew size only). Re-sent when a crew changes its roster |
| `{type:'v2_locked', matchId, team}` | a crew locked in |
| `{type:'v2_start', matchId, team, rival: {handle}, tickMs, holdTicks}` | live: the rival is named, holds are placed |
| `{type:'v2_frame', matchId, frame}` | one tick: each crew gets its own fogged view (its own plans only), watchers the whole board. On maps with gas vents or sparking cables the frame adds `gas` and `shock` (tile indexes `y * w + x` in that view's sight); ice is the `=` tile in `rows`. Their events: `gas_vent {at}`, `choked {agent}` (lost the action in gas), `slid {agent, from, to}` (ice), `sparked {name, at, until, tiles}` and `shocked {agent, by}` (stunned on or next to live water) |
| `{type:'v2_end', matchId, result, reason, logHash, debrief?}` | the end. `result` is `{winner: 'A'\|'B'\|'draw', reason: 'goal'\|'time'\|'eliminated', decidedBy, score, ticks}` or null for a void match (`reason` `declined`, `accept_timeout`, `credits`, `error`, `aborted`); `logHash` is the sha256 chain head of the match log; `debrief` is this crew's (Elo delta, MVP, goals, talk counts, credits held / used / returned, registry line, per-agent tally, `xp` each agent earned) |
| `{type:'v2_frames', matchId, frames}` | answer to `v2_replay` |
| `{type:'v2_lobby', lobbyId, ready: {host, guest}}` | a lobby's player readied a crew or stepped back (sent to both players this instance serves) |
| `{type:'v2_command_ok', matchId, tick, left}` | answer to `v2_command`: it lands on `tick`; `left` remain |
| `{type:'v2_control_ok', matchId, agentId}` | answer to `v2_control`: the agent you now steer (`null`: the brain runs the whole crew) |
| `{type:'error', code, message}` | see below |

WS error codes: `bad_json`, `bad_message`, `unknown_type`, `too_large`, `unauthenticated`, `auth_failed`, `already_authenticated`, `already_queued`, `not_queued`, `in_match`, `invalid_crew`, `not_in_lockin`, `practice_unranked`, `external_unranked`, `draft_casual`, `lobby_closed`, `not_your_turn`, `invalid_ban`, `agent_busy`, `not_found`, `not_live`, `no_commands`, `rate_limited`, `invalid_command`, `command_refused`, `control_casual`, `not_controlling`, `too_many_subscriptions`, `unavailable`, `internal`.

`scripts/ws-v2.cjs` is a ready client: it signs in, queues, accepts, locks in and waits for `v2_end` (README of the script at its top).

## Match flow

- Found → accept (10 s; a decline or no answer voids it, naming the crew) → lock-in (30 s; the rival hidden, ranked forces Standard) → live: holds placed, up to 150 ticks of `V2_TICK_MS` (2 s) → end.
- Each tick every agent's brain acts and may speak under a 1.5 s deadline (late, failed or illegal is a wait); the crew plan is rewritten every `V2_REPLAN_EVERY` (25) ticks. Speech passes the leak and abuse filter before anyone hears it, then goes by range (team, or overheard by the rival).
- Supply tools (`packages/engine/src/v2/tools.ts`): a supply drop on a water map can carry a tool beside its item (drop table `SUPPLY_TOOLS`: Copper Hollow sandbags; Monsoon Terraces bridge then pump; Sunken Metro pump then bridge; Blackout Harbor sandbags then pump; or a map drop's own `tool`). An agent with an empty tool slot takes it by stepping on the drop and carries at most one. The action is `{type:'use', tool:'sandbag'|'pump'|'bridge', dir}` (text `use <tool> <dir>`, also in the external-agent reply schema). Sandbags on open floor or grass stop water spreading there (switch floods too); a bridge on a water tile is walkable and water there never knocks anyone down; a pump drains water within 2 tiles over 3 ticks, then is spent. Events `tool_dropped`, `tool_picked`, `tool_used`, `pumped`. `V2Frame.tools` (ground) and `V2Frame.placed` (sandbags, bridges, pumps with `ticksLeft`) are public and absent when empty; `FrameAgent.tool` and the observation's `me.tool` and `gear` carry the rest.
- One `realtime` instance holds each match in memory and serves its players. A live row no instance holds (crash) is voided by the orphan sweep and its holds released; shutdown voids live matches with credits returned.
- Practice: the player is crew A; crew B is `SYSTEM_ACCOUNT_ID` with a Standard crew the player's size on the greedy brain, accepting and locking in by itself. Casual only, no Elo, no registry write, `v2_matches.practice = true`.
- Lobby: no matchmaking; the lobby's map, difficulty, talk rule (`V2Setup.talk`) and crew size (`V2Setup.crewMax`). Casual, no Elo, no registry. After the result is written the lobby is settled (`LobbiesRepo.settleMatch`), which moves a bracket on; the `tournaments` tick settles any lobby that was missed.
- Settlement (`V2MatchesRepo.finish`, one transaction): the result, both players' Elo (ranked; start 1200, K 48 for the 5 placement matches, 32 up to the 20th ranked match, then 16, floor 100) and their last ranked result time, season points (ranked), the skill versions' ranked records, the delivered lines (`match_messages`), each crew's debrief, and each agent's XP (ranked and casual matches that end with a result: base 40 / 25, +20 win or +10 draw, +2 per item delivered up to 10; practice and void none), listed in its crew's debrief as `debrief.xp: {agentId, name, gained, xp, level, leveledUp, traitReady}[]`. Each crew's decision timeline (`match_timelines`) is written right after, before `v2_end`. Then a ranked result is queued for the registry, and the frames are kept for replay.

## Queues (BullMQ, names in `@skirm/server`)

| Queue | Job data | Consumer (worker) |
| --- | --- | --- |
| `registry` | `{ kind: 'v2_match', id, seasonId? }` | `record_match` on the registry contract as a `MatchRecordV2` with per-player Elo and the season number, then the row's registry status and tx; retried 10 times |
| `benchmarks` | `{ kind: 'mint', skillId, version }`, `{ kind: 'trial', trialId }`, `{ kind: 'bench', runId }`, `{ kind: 'daily', attemptId }` or `{ kind: 'puzzle', runId }` | the hidden gauntlet of a minted version, one buyer's trial, one writer's test-bench run (held and charged on the ledger as `bench-<runId>-<attempt>` with a model brain, free on greedy), one player's daily challenge attempt (the crew's talk rate held as `daily-<attemptId>-<attempt>` with a model, free on greedy), on the headless match runner (`playHeadless`) against the greedy bot (below), or one puzzle run (the player's crew against the inert rock crew, held as `puzzle-<runId>-<attempt>` with a model, free on greedy) |
| `seasons` | `{ kind: 'tick' }`, repeatable every 10 min | opens the current season, locks ended ones, writes payouts, posts the top 10 to the seasons contract |
| `tournaments` | `{ kind: 'tick' }`, repeatable every minute | settles lobbies whose match ended without realtime settling them; decides bracket matches nobody started within 15 minutes |
| `ranked` | `{ kind: 'decay' }`, repeatable every hour | the Elo decay pass (ranked tiers above); safe to repeat, a player decays at most once per period |

**Benchmark.** 6 (map, difficulty) picks from `PRACTICE_MAPS` × Easy / Normal, drawn from HMAC-SHA256(`BENCH_SECRET`, `<skillId>:<version>`). The tested crew is one Standard agent carrying the skill; every second pick also feeds it hijack lines. score = wins / matches × (1 − share of matches with a leak). With the greedy brain (no model key) a benchmark or trial plays nothing and ends `needs_model` with no score: greedy ignores skills, so it would prove nothing. See [benchmarks.md](benchmarks.md).

## Pub/sub (Redis)

| Name | Content |
| --- | --- |
| channel `v2match:<id>` | every watch-view message of a live match (`v2_frame`, then `v2_end`), published by the instance running it |
| key `v2match:<id>:last` | the latest of those, 120 s TTL: a watcher on another instance reads it first, then follows the channel |
| key `v2:match:<id>:frames:<A\|B\|watch>` | the frames of an ended match per view, 6 h TTL, for `v2_replay`; the api reads the `watch` key for shared replays and highlights |
| key `cost:usd:<UTC day>` | model spend across worker and realtime, for `cost_alert` and `/ops/stats` |
| keys `ext:turn:<externalAgentId>` / `ext:reply:<turnId>` | an external agent's open turn (realtime writes, `/agent/v1/turn` reads) and its first answer (`/agent/v1/action` writes once, realtime reads) |

Frames carry each crew's own plan text only to that crew, and never the plan of an agent running a bought (encrypted) skill. Skill text never leaves the vault except into the agent's model call.

## Seasons contract

`seasons.playskirm.testnet` (`contracts/seasons`, NEP-297 standard `skirm_seasons`). One NEAR pool per 14-day season, paid to the top 10 by pull:

1. `open_season(id, name, starts_at_ms, ends_at_ms)` (owner or ops) once the previous season is `paid`; the carry becomes the new pool.
2. `#[payable] fund(season_id: Option<u32>) -> U128`: anyone; the market sends 30 % of each sale fee as `fund(None)`. It panics when no season is open, and the market's callback then forwards that share to the treasury.
3. `lock_season(id)` after `ends_at_ms`; `post_standings(id, rows ≤ 10)` with points non-increasing; place i gets `floor(pool × SPLIT_BPS[i] / 10⁴)`, `SPLIT_BPS = [3000, 2000, 1500, 500 × 7]`. Rows without a NEAR account, empty places and dust go to the carry.
4. `claim(id)` by each winner's NEAR account, once; `close_season(id)` moves unclaimed shares to the carry.

The ops writes are idempotent, so the worker's season tick can resend one whose answer was lost. `packages/server/src/near/seasons.ts` wraps them (`NoopSeasons` without a signer). Full interface: [contracts/seasons/README.md](../contracts/seasons/README.md).

## NEAR adapters (`@skirm/server`)

- `Registry.recordMatch(MatchRecordV2)`: `NoopRegistry` stores `local` with a `noop:` hash; `NearRegistry` calls `registry` with the ops key (`NEAR_OPS_KEY`).
- `Minter.mint(skillVersion)`: `nft_mint` on `skills` (one token per version, NEP-171 + NEP-199 royalties).
- `SeasonsChain`: the seasons calls above.
- `BadgeMinter.mint(badge)`: `nft_mint` on `badges` (soulbound, one token per player and achievement); `NoopBadges` stores `local` with a `noop:` hash.
- `DepositVerifier.verify(txHash)`: reads the tx through RPC and checks the receiver (`deposits`), the amount and that the receipt is new. Dev accepts `dev:<yocto>`. With a relayer configured, a meta-transaction it sent counts as the player's own (deposits and rentals).
- `MetaTxRelayer` (`NearMetaTxRelayer`, only with `RELAYER_*`): final block height, access-key nonces, and `relay(SignedDelegate)` from the relayer account ([gasless.md](gasless.md)).
- `OwnershipReader.ownerOf(tokenId)`: purchases and the mint fallback.
- Market fee governance (contract side): a `governance_id` (defaults to the owner) proposes a fee and applies it after 24 h, capped at 10 %; every setter emits a NEP-297 event.

## Official skills seed (worker boot)

So the Exchange is never empty, every worker seeds `OFFICIAL_SKILLS` from `@skirm/db` at boot, in the background, under a Postgres advisory lock and with fixed ids (safe to repeat and to run concurrently). Each skill is sealed into the vault, its hidden benchmark is queued (offline it ends `needs_model`), then it is minted through the configured `Minter` and listed by the system account (`@skirm`, never signs in). A version that has been sold is not relisted. `SEED_OFFICIAL_SKILLS=0` turns it off.
