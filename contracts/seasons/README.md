# skirm seasons contract

[`seasons.playskirm.testnet`](https://testnet.nearblocks.io/address/seasons.playskirm.testnet), built as `skirm_seasons.wasm`. One NEAR prize pool per 14-day season,
paid to the top 10 of the ranked v2 standings. Standings are computed offchain (win 25, draw 12,
loss 5 points) and posted by the platform signer; winners pull their prize with `claim`.

## Lifecycle

1. `open_season(id, name, starts_at_ms, ends_at_ms)`: owner or ops. The previous season must be
   `paid` (or there is none). The carry becomes the new season's starting pool.
2. `fund(season_id?)`: anyone, with NEAR attached. The market sends 30% of each sale fee as
   `fund(None)`. Panics when the season is not open, so the market's callback forwards that share
   to the treasury.
3. `lock_season(id)`: owner or ops, once block time reaches `ends_at_ms`. Funding stops.
4. `post_standings(id, standings)`: owner or ops, on a locked season. At most 10 rows
   `{player, near?, points}`, best first (points non-increasing, no duplicate player or NEAR
   account); rank = index + 1. Place i gets `floor(pool * SPLIT_BPS[i] / 10^4)` with
   `SPLIT_BPS = [3000, 2000, 1500, 500 x 7]`. Shares of rows without a NEAR account, empty places
   and the rounding dust go to the carry. Posting the same rows again is a no-op; different rows
   panic.
5. `claim(id)`: the winner's NEAR account, once, while the season is locked. Sends its share.
6. `close_season(id)`: owner or ops, after standings are posted. Unclaimed shares go to the carry
   and the season becomes `paid`.

The ops writes are idempotent, so the worker can resend a write whose response was lost:
re-opening the current season with the same args, locking a locked or paid season and closing a
paid season return the season unchanged, with no event. Different `open_season` args panic.

## Interface

| Method                                                              | Who          | Deposit | Notes                    |
| ------------------------------------------------------------------- | ------------ | ------- | ------------------------ |
| `new(owner_id, ops_id)`                                             | deployer     |         |                          |
| `open_season(id, name, starts_at_ms, ends_at_ms)` → `Season`        | owner or ops |         | ids increase             |
| `fund(season_id?)` → `U128` pool                                    | anyone       | > 0     | open season only         |
| `lock_season(id)` → `Season`                                        | owner or ops |         | after `ends_at_ms`       |
| `post_standings(id, standings)` → `Season`                          | owner or ops |         | locked season, ≤ 10 rows |
| `claim(id)` → `U128` amount                                         | winner       |         | once                     |
| `close_season(id)` → `Season`                                       | owner or ops |         | standings posted         |
| `set_ops`, `set_owner`                                              | owner        | 1 yocto |                          |
| `get_season(id)`, `current_season()`, `get_config()`, `get_carry()` | view         |         |                          |

`Season` is `{id, name, starts_at_ms, ends_at_ms, status: "open" | "locked" | "paid", pool,
standings: [{rank, player, near, points, share, claimed}], standings_posted, paid_total}`; amounts
are yoctoNEAR strings.

## Events

NEP-297, standard `skirm_seasons`, version `1.0.0`: `season_opened`, `season_funded`,
`season_locked`, `standings_posted` (with `to_carry`), `prize_claimed`, `season_closed` (with
`unclaimed` and `carry`), `carry_rolled` (carry moved into a newly opened season), `ops_updated`,
`owner_updated`.

## Server

`packages/server/src/near/seasons.ts` wraps the ops calls (`SeasonsChain`); `NoopSeasons` stands
in when `NEAR_OPS_*` is unset. The contract account is `NEAR_CONTRACT_SEASONS`
(default `seasons.playskirm.testnet`), deployed on testnet:
[seasons.playskirm.testnet](https://testnet.nearblocks.io/address/seasons.playskirm.testnet).
