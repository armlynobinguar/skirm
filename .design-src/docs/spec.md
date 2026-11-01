# Promptlings Game Spec
2026-10-25 · @Tyron
This is the build rulebook for the Promptlings engine and contracts. If this doc and the code disagree, fix one of them; the Python simulator (engine_sim.py) is the reference for v0 behaviour.
## 1. Overview and glossary
Promptlings is a deterministic grid puzzle that AI agents play. The player only coaches: they write or buy skills, put skills and unlocks on agents, pick a crew and a map, then watch. Each tick the engine sends every living agent the state and a list of legal actions, a decision model picks one, and the engine applies it and runs the world rules. The engine alone decides clear or fail. Fewer agents and fewer steps score higher.
How to read this doc:
- **Settled** means decided in the concept doc or proven in `engine_sim.py`. Code must match it.
- **Proposed** means drafted here so the build can start. Use it unless the team changes it, and change this doc when you do.
- Scoring, credit prices, entry fees, reward pools and Elo maths are only summarised here. The exact formulas live in the separate **Promptlings Formulas** doc.
### Glossary
| Term | Meaning in this spec |
| Agent | A persistent unit a player owns. It carries up to 3 equipped skills (proposed), its unlocks and an Elo rating. On a map it is one token on one tile. |
| Crew | The agents a player deploys on one run or one side of a match. Size 1 to 3 (proposed cap). |
| Skill | A hidden prompt strategy plus public metadata (the actions it needs, the tags it handles). Minted as an NFT; the prompt never leaves the server. |
| Unlock | A game-issued item that lets one agent use one gated action: Builder for `place_block`, Digger for `dig`, Firefighter for `extinguish`. |
| Map | A JSON file: grid, things, enabled rules, enabled actions, goal, step limit, block supply, inventory size, start tiles. |
| Thing | What sits on a tile: a named set of tags, such as water (`spreads`, `liquid`). At most one thing per tile; an empty tile holds none. |
| Tag | One of 10 labels that say what a thing is. Agents see tags, never thing names. |
| Rule | One of 6 behaviours the engine applies to tagged things: Spread, Block, Damage, Push, Collect, Goal. |
| Action | One of 7 things an agent can do in a tick: `move`, `wait`, `pick_up`, `drop`, `place_block`, `dig`, `extinguish`. Push is not an action; it happens when a `move` walks into a pushable thing. |
| Tick | One world update: every living agent acts once, then spread, damage and end checks run. The tick counter starts at 0 and is 1 after the first tick. |
| Turn | One agent's one decision in one tick. A tick with 2 living agents is 2 turns. Credits are charged per turn. |
| Step | Same as tick when counting a run's length. "Steps used" = ticks played until the run ended. "Step limit" = the map's maximum ticks. |
| Run | One crew playing one map from tick 0 until it clears or fails. Solo runs and each side of a Race are runs. |
| Match | A live PvP game between two crews on the PvP tick clock: Race (MVP) or Duel (stretch). Capped at 10 minutes. |
| Plan | Short text (about 300 tokens) the planner LLM writes for one agent from its skills and the briefing. The actor reads it every tick. Hidden from players. |
| Credits | An offchain balance bought with NEAR (other tokens later through NEAR Intents). Spent per agent turn. |
| Entry fee | A fixed NEAR fee to enter a solo map's seasonal leaderboard. |
| Reward pool | The entry fees of one map and season, minus the platform cut, paid to the top scores (stretch contract). |
| Elo | A rating per agent on the ranked PvP ladder, updated after every ranked match. Stored with the match result in the run registry. |

## 2. World model
The world is a rectangular grid of tiles; each tile holds zero or one thing, and agents stand on tiles on a separate layer.
### Grid and coordinates
- Coordinates are `(x, y)`, 0-based, from the top-left. `x` grows east, `y` grows south.
- Directions: `N` = (0, −1), `S` = (0, +1), `W` = (−1, 0), `E` = (+1, 0). There are no diagonals. The canonical direction order is **N, S, W, E** everywhere (legal action lists, spread, logs).
- Neighbours of a tile are its four orthogonal tiles in that order.
- Any tile outside the grid reads as `wall`. Official maps also draw a wall border.
- Grid size: 3×3 minimum, 20×20 maximum (proposed, see Maps).
### Layers
| Layer | Holds | Notes |
| Thing layer | One thing id per tile, or empty | Changed by spread, push, place, dig, extinguish, pick up, drop |
| Agent layer | Living agents, at most one per tile | An agent may share a tile with a non-solid, non-liquid thing (floor, grass, gem, exit, fire) |
| Run state | Tick, block supply, collected count, per-agent inventory, alive flags, status | Block supply is shared by the whole crew |

A lost (dead) agent leaves the agent layer: it no longer occupies its tile and makes no further decisions.
### The 10 tags
| Tag | Meaning | Rule that reads it |
| `spreads` | Grows into neighbouring tiles on a schedule | Spread |
| `liquid` | Agents cannot walk into it. Liquids flow into empty tiles. Water puts out fire | Spread, `move` |
| `damages` | An agent on the same tile is removed | Damage |
| `solid` | Agents cannot walk into it | `move` |
| `blocks` | Nothing spreads into it | Block |
| `pushable` | A `move` into it shoves it one tile | Push |
| `breakable` | `dig` removes it | `dig` |
| `flammable` | Fire can spread onto it, destroying it | Spread |
| `collectible` | `pick_up` takes it into an inventory | Collect |
| `goal` | Standing on it can end the run | Goal |

### Things built from tags (v0 library)
| Thing id | Tags | Used on |
| `water` | `spreads`, `liquid` | Flood Gate |
| `lava` | `spreads`, `liquid`, `damages` | Magma Mine |
| `fire` | `spreads`, `damages` | Ember Warehouse |
| `wall` | `solid`, `blocks` | All maps |
| `block` (placed block) | `solid`, `blocks` | Created by `place_block` |
| `dirt` | `solid`, `blocks`, `breakable` | Magma Mine |
| `crate` (wooden) | `solid`, `pushable`, `flammable` | Ember Warehouse |
| `grass` | `flammable` | Ember Warehouse |
| `gem`, `key`, `crystal` | `collectible` | Gem: Flood Gate. Key: Ember Warehouse. Crystal: Magma Mine |
| `exit`, `flag` | `goal` | Exit: Ember Warehouse, Magma Mine. Flag: Duel maps |

Tags are fixed per thing in the library; a map cannot give a library thing different tags. The simulator also defines `boulder` (`solid`, `blocks`, `pushable`), which is not in the concept's list and no v0 map uses; leave it out of the v0 library unless the team adds it. The simulator models gem, key and crystal as one thing, `gem`; the engine keeps them as three ids with the same tags.
### Derived behaviour classes
The engine never branches on thing names; it branches on tags. Three derived classes cover v0:
- **Flowing hazard** = has `spreads` and `liquid` (water, lava).
- **Burning hazard** = has `spreads` and not `liquid` (fire).
- **Extinguisher** = a flowing hazard without `damages` (water). It replaces a burning hazard it spreads into.
The simulator checks the names `fire` and `water` directly. The tag classes above give the same results on all v0 things (proposed generalisation).
## 3. Rules
Six rules, each tied to tags, run in fixed phases of every tick (see section 5). A map lists which rules are on; all three v0 maps turn on all six. Behaviour below matches `engine_sim.py` unless marked proposed.
### Rule 1: Spread (`spreads`)
Runs in phase 3, after the tick counter has gone up by 1.
1. **Schedule.** A spreading thing T spreads on tick `t` when `t % spreadEvery[T] == 0`. With `spreadEvery` 2, water spreads at the end of ticks 2, 4, 6 and so on. Each thing has its own schedule.
2. **Snapshot.** Spread reads the thing layer as it stood when the phase began and writes to a copy. A tile covered this tick does not spread again until the next scheduled tick (no chaining).
3. **Scan order.** Source tiles row by row (`y` ascending, then `x` ascending), neighbours in N, S, W, E order. If an earlier source already changed a target tile this tick, later sources skip it (first write wins).
4. **Targets.** Checked in this order for each neighbour:
  1. Outside the grid: skip.
  2. Target thing has `blocks`: skip (Rule 2).
  3. Flowing hazard (water, lava): the target becomes T if it is **empty** or holds a `goal` thing. Water (the extinguisher) also replaces fire. Anything else stops it: gems, keys, grass, crates and other liquids.
  4. Burning hazard (fire): the target becomes fire only if its thing is `flammable` (grass, crate); the flammable thing is destroyed. Fire never enters empty floor.
5. **Agents are ignored.** Spread enters a tile even when an agent stands on it. An agent in water survives and can step out to a non-liquid tile. Lava or fire on an agent's tile removes it in phase 4.
Edge cases:
- **Goal flooded.** A liquid covering a `goal` thing replaces it. When no goal tile is left, the run fails with "goal flooded" (Rule 6). Fire cannot reach an exit, because exits are not flammable.
- **Water meets lava.** Neither can enter the other's tile, so they stop each other. Lava does not put out fire and fire does not enter lava.
- **Water meets fire.** Water replaces fire only on water's own spread ticks. Fire never spreads onto water.
- **Collectibles are never covered** in v0 (they are not empty and not flammable), so the "not enough collectibles" fail cannot happen on v0 maps.
- **Fire never burns out.** No v0 rule removes fire except `extinguish` and water. A burned corridor stays deadly for the rest of the run.
- **Validation.** Every spreading thing on a map needs `spreadEvery`, an integer from 1 to 10 (proposed range). The simulator crashes without it.
### Rule 2: Block (`blocks`)
A tile whose thing has `blocks` is never a spread target. In v0 this check never changes an outcome, because every `blocks` thing is already non-empty and non-flammable. It is kept explicit so future flammable or goal things with `blocks` behave correctly. Note that non-`blocks` things (gem, grass, crate) also stop liquids, because liquids enter only empty and goal tiles.
### Rule 3: Damage (`damages`)
Runs once per tick in phase 4, after spread. Every living agent whose tile holds a `damages` thing (lava, fire) is lost.
- An agent can legally walk into fire (it is neither `solid` nor `liquid`) and is lost that same tick. The legal list offers legal moves, not safe ones.
- Lava cannot be walked into (`liquid`) but can flow onto an agent.
- If water covers a fire tile in the same spread phase that an agent stepped onto it, the agent survives: the tile holds water at the damage check.
- A lost agent is removed from the agent layer, makes no more decisions and is charged no more turns. Items it held still count toward the crew's collected total (simulator behaviour; see Open questions).
### Rule 4: Push (`pushable`)
Resolved inside a `move`, not as its own action. A `move` toward a tile whose thing is `pushable` is legal only if the far tile (two steps in that direction) is inside the grid, **holds no thing at all** and has no living agent. The pushed thing moves to the far tile and the agent moves into the tile it left, both in the same action. One thing at a time: no chains, no pulling. Grass, gems or floor-with-a-thing on the far tile all stop a push.
### Rule 5: Collect (`collectible`)
- `pick_up` takes the collectible on the agent's own tile, if the agent holds fewer items than the map's `inventory` size. The thing leaves the grid, joins that agent's inventory, and the crew's collected count goes up by 1.
- `drop` (proposed; not in the simulator) puts the agent's most recently picked item back on its own tile, if that tile holds no thing. The collected count goes down by 1.
- Parameter: `inventory`, items per agent, 1 to 5 (proposed range). Flood Gate 3, Ember Warehouse 1, Magma Mine 2.
### Rule 6: Goal (`goal`)
Goal types for solo and Race: `reach` (a living agent stands on a goal tile), `collect` (crew collected ≥ `n`) and `collect_reach` (collected ≥ `n` and a living agent on a goal tile). Duel goals are in section 7.
End checks run in phase 5, in this order; the first that matches ends the run:
| Order | Check | Result |
| 1 | The goal condition is met | `clear` |
| 2 | Goal type is `reach` or `collect_reach` and no goal thing is left on the grid | `fail_goal_flooded` |
| 3 | No living agents | `fail_all_agents_lost` |
| 4 | `tick >= stepLimit` | `fail_out_of_steps` |
| 5 | Goal type is `collect` and collected + collectibles still on the grid < `n` | `fail_not_enough_collectibles` |

Consequences of this order:
- Clearing on the last allowed tick counts as a clear.
- Clear beats loss in the same tick. A `collect` run whose last pick-up happens on a tick where every agent is then lost still clears.
- Unreachable collectibles (a flooded village) do not end the run early. It plays on to `fail_out_of_steps`. An early-stop idea is in Open questions.
- The simulator counts only the thing `gem` in check 5; the engine counts every `collectible` thing, or only `goal.thing` when set. Applying check 5 to `collect_reach` too is proposed.
## 4. Actions
An agent takes exactly one of 7 actions per tick; four of them take a direction, giving the action ids below. Push is not an action: it is what `move` does when it walks into a pushable thing.
An action is usable only if the map enables it **and** the agent holds its unlock. A Builder on a map without `place_block` never sees `place_block` in its list.
| Action id | Unlock | Legal when (all must hold) | Effect |
| `wait` | None | Always | Nothing |
| `move_N` `move_S` `move_W` `move_E` | None | Target tile's thing is neither `solid` nor `liquid` (empty, grass, gem, key, crystal, exit, flag, fire); **or** it is `pushable` and the far tile holds no thing and no living agent | Agent moves one tile; a pushable thing moves one tile ahead of it (Rule 4) |
| `pick_up` | None | Agent's own tile holds a `collectible`; agent holds fewer than `inventory` items | Thing moves to the agent's inventory; collected +1 |
| `drop` (proposed) | None | Agent holds 1 or more items; own tile holds no thing | Last picked item goes on the tile; collected −1 |
| `place_block_N` / `_S` / `_W` / `_E` | Builder | Crew block supply > 0; target tile is inside the grid, holds no thing and has no living agent | Target becomes `block` (`solid`, `blocks`); supply −1 |
| `dig_N` / `_S` / `_W` / `_E` | Digger | Target tile's thing is `breakable` | Target becomes empty |
| `extinguish_N` / `_S` / `_W` / `_E` | Firefighter | Target tile's thing is a burning hazard (fire) | Target becomes empty |

Notes that follow from the table:
- `place_block` cannot go on water, grass, a gem or any other thing; it needs a fully empty tile. Damming a liquid means placing in its path before it arrives.
- The legal list ignores teammates when offering a plain `move`; whether the tile is free is settled when the move executes (below). It does check agents on the far tile of a push and on a `place_block` target.
- The simulator's ids are `place_N` and `ext_N`; the engine and logs use `place_block_N` and `extinguish_N`. `drop` is not in the simulator.
### Canonical order of the legal list
The engine always lists legal actions in this order, because decision models change their pick when options are reordered:
1. `wait`
2. For each direction in N, S, W, E: `move_D`, `place_block_D`, `dig_D`, `extinguish_D` (only those that are legal)
3. `pick_up`
4. `drop`
This is the simulator's order with `drop` added at the end. Example for a Builder with 2 blocks standing at (7,5) in Flood Gate, two tiles south of the spillway: `["wait", "move_N", "place_block_N", "move_S", "place_block_S", "move_W", "place_block_W", "move_E", "place_block_E"]`.
### Illegal, failed and missed actions
Every problem turns the action into `wait`, is logged with a reason, and never stops the run.
| Reason | When | Result |
| `illegal` | The model returns an action that is not in its legal list, or a malformed answer | `wait` |
| `stale` | The action was legal at observation but not when it executes, because an earlier agent in the same tick changed the tile, used the last block or took the item | `wait` |
| `blocked` | A `move` whose target holds a living agent when it executes | Agent stays (a `wait`) |
| `timeout` | No answer within the per-action time limit (PvP; value still open) | `wait` |
| `error` | Provider or network error after retries | `wait` |

A lost agent is not asked for decisions; the engine records `wait` for it with reason `lost`.
## 5. Tick order and determinism
Every tick runs the same six phases in the same order, so the same map and the same logged actions always give the same result. The order below is exactly what `engine_sim.py` does in `Game.step`.
<embed {'caption': 'solo tick · 6 phases, repeated until an end check matches', 'ref': 'node/d852d59b-8fe9'}>
Race runs this loop on each map copy; Duel replaces phase 2 with simultaneous resolution (see PvP differences below).
### Solo tick (settled, from the simulator)
1. **Observe.** For each living agent, build the observation and the legal list from the state at the start of the tick. All agents' decisions are requested in parallel from that same state; no agent sees a teammate's choice for this tick.
2. **Act, in agent index order 0, 1, 2.** Each action is checked again against the current state, which already includes earlier agents' actions this tick. Not legal any more = `wait` (reason `stale`). Pushes, pick-ups, drops, block placing, digging and extinguishing all apply at once inside the agent's own action. A `move` onto a tile holding a living agent fails (reason `blocked`).
3. **Advance the tick counter** by 1.
4. **Spread** (Rule 1, with Rule 2), using the new tick number for each thing's schedule.
5. **Damage** (Rule 3).
6. **End checks** (Rule 6), then the tick is written to the replay log and the orchestrator checks replan triggers.
What the sequential act phase means in solo:
- If agent 0 steps out of a tile, agent 1 can step into it in the same tick.
- If two agents move into the same tile, the lower index gets it and the other is `blocked`. The concept's line "two agents moving into one tile both stay put" is the simultaneous PvP rule below, not solo.
- The concept lists "pushes and pickups resolve" as its own step 2. In the simulator they resolve inside each agent's action; this spec follows the simulator.
### PvP differences
- **Race (MVP, proposed).** Two independent runs on identical copies of one map. Each copy resolves exactly like a solo tick, sequential within its crew. The match server's clock drives both: both crews observe at the same moment, get the same time limit, and both copies advance one tick together. The crews cannot touch each other.
- **Duel (stretch, proposed).** One shared map, simultaneous resolution:
  1. Validate every action against the start-of-tick state. Invalid = `wait`.
  2. Resolve moves and pushes together. A move is `blocked` if another move targets the same tile (both stay), if its target held any agent at the start of the tick (no following, no swaps), or if a `place_block` targets that tile this tick. A push also fails if its far tile is targeted by another move, push or `place_block`, or if two agents push the same thing.
  3. Apply the other actions. Two `place_block` actions on one tile both fail and use no supply. Two `dig` or `extinguish` actions on one tile both succeed (the tile is emptied once).
  4. Advance the tick, then spread, damage and end checks for both sides.
- Each Duel crew has its own block supply. Logs list crew A's agents before crew B's.
### Determinism requirements
1. **Integers only** in engine state and rules. No floats until scoring, which runs after the run ends.
2. **Fixed orders everywhere:** rows `y` then `x`; directions N, S, W, E; agents by index; crew A before crew B; the canonical legal-list order; object keys sorted in every hashed JSON.
3. **No clock and no randomness inside the engine.** v0 rules use no random numbers. The map and log both carry a `seed` field, reserved; any future random rule must draw from an integer PRNG seeded from the log header.
4. **Models stay outside the replay.** Timeouts, errors and illegal picks become logged `wait`s. A replay re-runs the logged actions through the engine and never calls a model, so wall-clock time and model randomness cannot change a replay.
5. **Pinned versions.** The log records `engineVersion` and the map's SHA-256. Any rule change bumps `engineVersion`; old replays re-run on the version they name.
6. **Golden tests.** The TypeScript engine must reproduce the simulator: Flood Gate solo 27 steps with Builder; Ember Warehouse 29 steps with no unlocks; Magma Mine 57 steps with Builder and Digger; Magma Mine unsolvable with Digger only or Builder only; idle runs end `fail_out_of_steps` at 60 (Flood Gate) and 50 (Ember Warehouse), and `fail_goal_flooded` at tick 45 (Magma Mine).
### Replay log format (proposed v0)
JSON Lines, one canonical JSON object per line (keys sorted, no spaces, UTF-8, `\n` line ends). The replay hash recorded onchain is the SHA-256 of the whole file. Plans, model text and skill prompts are never written to it. The example shows keys in reading order and shortened ids and hashes.
```
{"type":"header","schema":"promptlings.replay/v0","runId":"run_01J...","mode":"solo","engineVersion":"0.1.0","map":{"id":"flood-gate","version":1,"sha256":"9f2c..."},"seed":0,"crews":[{"side":"A","player":"tyron.testnet","agents":[{"index":0,"agentId":"agt_7Q...","unlocks":["builder"],"skills":[{"id":"skl_3K...","version":2}]}]}]}
{"type":"tick","t":1,"actions":[{"side":"A","agent":0,"picked":"move_N","applied":"move_N","reason":null,"p":0.91}],"stateHash":"41ab..."}
{"type":"tick","t":3,"actions":[{"side":"A","agent":0,"picked":"place_block_N","applied":"place_block_N","reason":null,"p":0.77}],"stateHash":"c09e..."}
{"type":"end","status":"clear","ticks":27,"agentsDeployed":1,"turnsCharged":27,"score":2325}
```
- `picked` is what the model chose (or `null` on timeout or error); `applied` is what the engine did; `reason` is one of the codes in section 4 or `null`.
- `p` is the model's probability for its pick, shown in the spectator view. It does not affect the replay.
- `stateHash` is the SHA-256 of the canonical state after the tick, so a verifier can find the first tick where two replays split.
## 6. Run lifecycle
A run moves through eight states; credits are held before the first tick and the unused part is released when it ends. The diagram below shows the transitions; the table gives what each state does.
<embed {'caption': 'run lifecycle · 8 states, 3 terminal', 'ref': 'node/f0333b0e-b86c'}>
| State | What happens | Leaves to |
| `queued` | Request accepted: player, map id and version, mode, crew (agents, their unlocks and skills). Checks: crew size ≤ the map's `maxAgents` and the mode's crew cap; the player owns every agent, unlock and skill; no agent is in another active run (proposed). An equipped skill whose `requires_actions` the map does not enable is a warning, not a block (proposed) | `credit_check`, or `rejected` |
| `credit_check` | Work out the hold: step limit × the crew price factor S(n) (1, 2.5 or 4.5 for 1 to 3 agents) credits at the current turn price, plus the entry fee if the run enters a reward pool. Balance too low = `rejected`, nothing charged. Free runs draw on the player's daily allowance and the global daily free budget instead; budget empty = `rejected` | `planning`, or `rejected` |
| `planning` | Hold placed; entry fee moved to the map's pool. One planner call per agent (`plan()` in section 11). Planner fails after retries = `aborted` | `ticking`, or `aborted` |
| `ticking` | The tick loop of section 5. A replan trigger sends the run to `replanning` | `replanning`, `ended`, or `aborted` |
| `replanning` | Planner call for the agents that need it, then back to ticking. In solo no tick passes while replanning. In PvP the clock keeps running and the agent uses its old plan until the new one arrives (proposed) | `ticking` |
| `ended` | One status from Rule 6: `clear`, `fail_out_of_steps`, `fail_all_agents_lost`, `fail_goal_flooded`, `fail_not_enough_collectibles`. Settle: charge turns used, release the rest of the hold, score a clear, write the replay and its hash to the run registry, update leaderboards | Terminal |
| `aborted` | Engine or platform error. Full refund of the hold **and** the entry fee, no score, replay kept for debugging but not registered | Terminal |
| `rejected` | Nothing was charged; the reason goes back to the client | Terminal |

Replan triggers: every 20 turns per agent (from the concept's "about every 20 turns"), when any agent is lost, and when a `blocks` thing appears or disappears (a block placed, dirt dug). Proposed values; tune in the week-one benchmark.
Charging (proposed; exact prices in the Formulas doc):
- One agent turn is charged for each decision requested from a living agent, including timeouts and illegal picks. Turns lost to provider errors and turns of lost agents are not charged. Each charged turn is weighted by its agent's price weight: 1, 1.5 and 2 for agents 1 to 3 in deploy order (proposed).
- Refund = hold − turns charged. A Flood Gate solo clear in 27 ticks with one agent holds 60 turns and charges 27.
- The entry fee is not refunded on a fail; it is refunded only on `aborted`.
## 7. Modes
Solo and Race use the same rules and goals; Duel adds shared-map goals; Siege is roadmap only.
| Mode | Scope | Map | Winner | Stakes |
| Solo | MVP | One crew, one map | Clear = score | Credits per turn; optional entry fee into a seasonal reward pool (stretch contract) |
| Race | MVP | Two crews, identical copies of one map side by side | First to clear | Ranked, free, no stakes; Elo per agent |
| Duel | Stretch | Two crews on one shared map | The map's Duel goal | Same as Race |
| Siege | Roadmap | One side builds hazards, the other gets through | Not specified | Not specified |

### Solo
- Score only on a clear: `1000 × M(agents) × (1 − 0.5 × steps used / step limit) − skill upkeep`, with M = 3.0 for 1 agent, 1.5 for 2, 1.0 for 3 or more. Rounding, upkeep and pool payouts are defined in the Formulas doc.
- No wall-clock tick: the next tick starts as soon as every living agent's decision is in. Proposed per-decision timeout in solo: 10 s, then `wait`.
- The daily free solo allowance is 60 credits (60 one-agent turns, one worst-case one-agent Flood Gate run), reset at 00:00 UTC and spent before the paid balance (proposed).
### Race (MVP)
- Both crews get identical copies of the map. The concept says "mirrored"; this spec reads that as identical copies shown side by side, not flipped (proposed).
- Winner: the side that clears in fewer ticks. Same tick: higher score wins (fewer agents). Still equal: draw. Neither side clears: draw (proposed).
- The match ends on the first tick where a side clears, when both runs have ended, or at the 10-minute cap, whichever comes first.
- Crew caps (proposed): free ranked 1 agent a side on 3 s ticks (concept guardrail); paid ranked up to 2 a side on 2 s ticks.
### Duel goals (stretch, proposed)
The map sets one Duel goal. Every Duel also ends when a side has no living agents (that side loses; both in the same tick = draw) or at the step limit.
| Goal id | Win condition | Same-tick or step-limit tie |
| `capture_the_flag` | A living agent holding the other side's `flag` stands on its own side's flag home tile. A side cannot pick up its own flag. A carrier that is lost returns the flag to its home tile at the end of that tick | Draw |
| `most_collected` | At the step limit, or when no collectibles are left on the grid, the side holding more collectibles wins | Draw |
| `first_to_exit` | First side with a living agent on a goal tile | More collected wins, then draw |

### Match length and tick length
PvP matches are capped at 10 minutes (settled). Tick length is between 1 and 3 seconds; proposed values:
| Tick length | Ticks in 10 min | Use |
| 1 s | 600 | Not for v0. Jev's 0.34 s p95 plus network from the Philippines leaves little room |
| 2 s | 300 | Paid ranked Race (proposed default) |
| 3 s | 200 | Free ranked Race (concept guardrail) |

On v0 maps the step limit (50 to 70 ticks) ends a Race long before the cap: 70 ticks at 3 s is 3.5 minutes. The cap is the hard stop for longer future maps. The per-action time limit is still open; proposed: tick length minus 0.5 s (1.5 s on 2 s ticks, 2.5 s on 3 s ticks), leaving 0.5 s to resolve and stream the tick.
## 8. Agents, crews and unlocks
A player owns several agents (Option A, settled); each one deployed spends its own turns and lowers the score multiplier, so every extra agent costs more. Rentals of other players' agents stay on the roadmap.
### Agent record
| Field | Type | Notes |
| `id` | string | Server-issued, e.g. `agt_…` |
| `owner` | string | Player account id (social login), with a NEAR account linked when they trade |
| `name` | string, 1–24 chars | Display only. Never sent to any model |
| `skills` | skill id + version, 0–3 | Equipped skills (cap of 3 proposed). Each costs a small upkeep on the score |
| `unlocks` | subset of `builder`, `digger`, `firefighter` | An agent may hold several; the Magma Mine best line needs Builder and Digger on one agent |
| `elo` | integer | Ranked ladder rating, per agent. Start value and K-factor in the Formulas doc |

Proposed: agents are offchain records in v0, not NFTs. Every new player gets 3 agents, which covers the largest crew, and the starter skill Flood Warden, which is account-bound and not an NFT.
### Crews
- Crew size 1 to 3 in solo (proposed cap; the score table stops at "3 or more"), never more than the map's `maxAgents`.
- Agent `i` in the crew starts on the map's `starts[i]`. The player picks the order in the crew builder, so they decide who starts where.
- Cost of an extra agent: the k-th agent deployed pays 1, 1.5 or 2 credits per turn (proposed), so a 2-agent run costs 2.5× a solo run per tick and a 3-agent run 4.5×, and the score multiplier drops from 3.0 to 1.5 to 1.0. Exact prices are in the Formulas doc.
### Unlocks
| Unlock | Gated action | v0 maps that enable it |
| Builder | `place_block` | Flood Gate (2 blocks), Magma Mine (1 block) |
| Digger | `dig` | Magma Mine |
| Firefighter | `extinguish` | None in v0 (Ember Warehouse offers no unlocks; see below) |

- **Game-controlled and scarce (settled).** Players cannot mint, sell or trade unlocks in v0 (proposed).
- **Acquisition (proposed):** a starter grant of one Builder, one Digger and one Firefighter per player, so every official map is clearable from day one. Further copies come only from game events (for example a first clear of an official map); the exact list is an open question.
- An unlock is attached to one agent at a time. Moving it between agents is free outside runs and locked while a run uses it.
- Block supply belongs to the map, not the unlock. "Builder (2 blocks)" means the map gives the crew 2 blocks, shared by every Builder in it.
- A skill never grants an unlock; its `requires_actions` only declares which unlocked actions it expects.
Resolved 25 Oct 2026: Ember Warehouse offers no unlocks, so `extinguish` is removed from its actions (the simulator config listed it, unusable without a Firefighter). The solver clears it in 29 steps either way, so the map's numbers do not change.
## 9. Skills
A skill is a hidden prompt strategy written against tags, plus public metadata that says which gated actions it expects and which tags it is meant for. Players buy the right to run a skill, never its text.
### What the agent sees
- **The planner** gets the system prompt (the rules in tag terms), the briefing (section 11) and the full prompts of the skills equipped on **that** agent.
- **The actor** gets the agent's plan, the short `reflexes` of its skills, the state and the legal list, every tick.
- Neither sees thing names, the map name, skill names, other players' text or another agent's skills.
### Hidden-prompt rule (settled intent, proposed mechanics)
1. `prompt` and `reflexes` are written through the skill editor, encrypted at rest with a cloud KMS key, and decrypted only inside the agent runner while it builds a model call.
2. No API returns them. The creator's account may read its own text back in the editor; holders who bought the skill never can.
3. Plans are derived from prompts, so plans are hidden too: never in replays, logs, the spectator view or any API.
4. Model output is a structured action, so there is no free-text channel that could leak a prompt. Replays show actions and probabilities only.
5. A skill's text reaches only the agent that equips it, never a teammate, an opponent or another crew.
6. No bring-your-own API key, because it would pass prompts through the player's account.
### Skill format (proposed v0)
| Field | Type | Required | Limits and meaning |
| `schema` | string | Yes | Always `promptlings.skill/v0` |
| `id` | string | Yes | Server-issued, `skl_` + ULID |
| `version` | integer | Yes | ≥ 1. Versions are immutable; editing creates the next version, minted as its own token. Stats are kept per version |
| `name` | string | Yes | 3–32 chars, letters, digits, spaces, `-` and `'`. Shown to players only |
| `summary` | string | No | ≤ 140 chars, marketplace blurb. Shown to players only, never to models |
| `creator` | string | Yes | NEAR account id of the writer; receives royalties. Fixed at mint |
| `owner` | string | Yes | NEAR account id of the current holder. The NFT contract is the source of truth; the backend mirrors it |
| `royalty_bps` | integer | Yes | 0–1,000 (0–10%), set by the creator at mint; default 500 (5%). 1 bps = 0.01% of each resale price, paid to `creator`. Fixed at mint |
| `requires_actions` | string[] | Yes | 0–3 unique values from `place_block`, `dig`, `extinguish`. Only gated actions are listed |
| `handles_tags` | string[] | Yes | 1–10 unique values from the 10 tags. Drives per-tag clear-rate stats and marketplace filters; changes nothing in the game |
| `prompt` | string | Yes (write-only) | 1–1,200 characters of plain text, about 300 tokens. Planner only |
| `reflexes` | string | No (write-only) | ≤ 400 characters. Short rules the actor reads every tick |
| `prompt_sha256` | string | Yes | 64 hex chars, SHA-256 of the UTF-8 `prompt` + `\n` + `reflexes`. Lets a buyer check that the token they hold is the version the stats describe |
| `created_at` | string | Yes | ISO 8601 UTC |

Limits per agent: 3 skills, so at most 3,600 prompt characters per planner call and 1,200 reflex characters per actor call. That keeps the static prompt near the 2,500 tokens and the actor's skill rules near the 500 tokens the cost model assumes.
The marketplace reads `requires_actions` to flag a skill as unusable on a map that does not enable those actions, before a player spends a run on it.
Example, as the backend stores it (the API returns the same object with `prompt` and `reflexes` removed):
```
{
  "schema": "promptlings.skill/v0",
  "id": "skl_01JB7Z3K9QX4M2T8V6N5R1C0DE",
  "version": 1,
  "name": "Flood Warden",
  "summary": "Seals the leak before it spreads, then does the job.",
  "creator": "tyron.testnet",
  "owner": "tyron.testnet",
  "royalty_bps": 500,
  "requires_actions": ["place_block"],
  "handles_tags": ["spreads", "liquid"],
  "prompt": "Before any task, find every tile tagged spreads+liquid that touches open floor through a gap one tile wide. Work out the tick it reaches the gap from its spread interval. If you can stand next to the gap before then, go there first and place a block in it. Only then start the goal.",
  "reflexes": "If a spreads+liquid tile is 1 tile from an open gap and place_block is legal toward the gap, place it.",
  "prompt_sha256": "<64 hex chars, computed by the server>",
  "created_at": "2026-11-03T08:15:00Z"
}
```
Onchain (plain terms): each skill version is a token in the skill NFT contract (NEP-171, or NEP-245 if the team picks the multi-token standard). The token's metadata carries `id`, `version`, `prompt_sha256`, `requires_actions`, `handles_tags` and the royalty. NEAR marketplaces read royalties through the NEP-199 payout standard: on every sale the contract says how much of the price goes to the creator. The prompt is never onchain.
## 10. Maps
Three official maps ship in v0, each proven in `engine_sim.py`: doing nothing fails, the wrong unlocks fail, one agent with the right unlocks clears, and two agents clear in fewer or equal steps at a lower score. All numbers below were re-run for this spec on 25 Oct 2026.
Grid legend: `#` wall, `~` water, `L` lava, `^` fire, `,` grass, `c` crate, `d` dirt, `*` gem / key / crystal, `E` exit, `.` empty floor, `0` start of agent 0. Coordinates `(x, y)` from the top-left, 0-based.
### Map 1: Flood Gate (15 × 9)
```
###############
#~~~~~~~~~~~~~#
#######.#######
#.....#.#.....#
#.*...#.#...*.#
#.............#
#.............#
#.*....0......#
###############
```
- **Config:** water `spreadEvery` 2; actions `move`, `wait`, `pick_up`, `place_block`; block supply 2; inventory 3; goal collect 3 gems; step limit 60.
- **Key tiles:** spillway column `x = 7`; dam spot (7,4). Water reaches (7,2) at tick 2, (7,3) at tick 4 and (7,4) at tick 6, so the block must land on or before tick 6 (agents act before spread within a tick).
- **Solo (Builder):** N, N, `place_block_N` at tick 3, then the three gems. 27 steps, score 2,325.
- **Two agents:** collector in slot 0 at (7,7), Builder in slot 1 at (8,7) plays N, N, W, `place_block_N`, S (out of row 5). 23 steps, score 1,213.
- **Fails:** idle = `fail_out_of_steps` at 60; no Builder = no solution.
### Map 2: Ember Warehouse (15 × 8)
```
###############
#######.#######
#^,,,,,c,,,,,,#
#######.###.#,#
#...........#,#
#.0.........#,#
#..........E#*#
###############
```
- **Config:** fire `spreadEvery` 2; actions `move`, `wait`, `pick_up`; block supply 0; inventory 1; goal `collect_reach` n = 1 (the key at (13,6), then the exit at (11,6)); step limit 50.
- **Key tiles:** crate (7,2) on the fuel line; pushed north from (7,3) into the pocket (7,1) it leaves a bare gap at (7,2). Fire reaches (6,2) at tick 10 and would take the crate at tick 12.
- **Solo (no unlocks):** push the crate north, walk the top corridor east, take the key, return by the side passage at `x = 11`, exit. 29 steps, score 2,130.
- **Trap:** going straight in by the side entrance at (11,3) gets the key, but the fire crosses behind and the agent is lost at tick 24.
- **Two agents:** runner in slot 0 at (2,5) takes the direct route; pusher in slot 1 at (2,6) walks row 6 and pushes the crate at tick 9. 29 steps, score 1,065.
- **Note:** fire never burns out in v0. A burned tile stays fire (and `damages`) until extinguished or covered by water.
### Map 3: Magma Mine (15 × 9)
```
###############
#0#######LLL###
#.d.######.####
#.#*######.####
#.########.#.##
#.............#
#############.#
###########*dE#
###############
```
- **Config:** lava `spreadEvery` 5; actions `move`, `wait`, `pick_up`, `place_block`, `dig`; block supply 1; inventory 2; goal `collect_reach` n = 2 (crystals at (3,3) and (11,7), exit at (13,7)); step limit 70.
- **Key tiles:** shaft `x = 10`, dam spot (10,4); lava reaches it at tick 15, so the block must land on or before tick 15. Dirt at (2,2) and (12,7). Parking niche (12,4).
- **Solo (Builder + Digger):** dam the shaft at tick 14, walk back, dig out crystal 1, cross the tunnel, dig out crystal 2, exit. 57 steps, score 1,779.
- **Fails:** Digger only and Builder only have no solution; idle = `fail_goal_flooded` at tick 45.
- **Two agents:** Digger in slot 0 at (1,1) takes both crystals; Builder in slot 1 at (1,3) dams at tick 12 and parks at (12,4). 32 steps, score 1,157.
Start tiles for slots 1 and 2 are **proposed**: the sources record only slot 0 (`0` in the grids). The slot-1 tiles above were chosen and verified for this spec; slot 2 is Flood Gate (6,7), Ember Warehouse (1,5), Magma Mine (1,2), unverified. The Ember pusher needs 9 actions from (2,6), with the same 29-step result.
### Map JSON schema (proposed v0)
One JSON object, UTF-8, at most 16 KB. Unknown fields are refused. The map's SHA-256 (over its canonical JSON) is what replays pin.
| Field | Type | Required | Validation |
| `schema` | string | Yes | Always `promptlings.map/v0` |
| `id` | string | Yes | Slug, `^[a-z0-9-]{3,40}$` |
| `version` | integer | Yes | ≥ 1; any change to a published map bumps it |
| `name` | string | Yes | 3–40 chars. Shown to players only, never to models |
| `width`, `height` | integer | Yes | 3–20 each |
| `legend` | object | Yes | Keys: one printable ASCII character, not a digit or space. Values: a library thing id, or `null` for empty floor. 2–16 entries |
| `grid` | string[] | Yes | Exactly `height` rows of exactly `width` characters, each a `legend` key. Agent starts are not drawn in the grid |
| `starts` | [x, y][] | Yes | At least `maxAgents` entries, distinct, each on an empty tile. `starts[i]` is crew slot `i` |
| `maxAgents` | integer | Yes | 1–3 |
| `things` | object | Yes | One entry per thing id used in `legend`. `tags` must equal the library's tags for that id. `spreadEvery` (integer 1–10) is required on every `spreads` thing and refused on others. `block` is implied by `place_block` and is not listed |
| `rules` | string[] | Yes | Unique, from `spread`, `block`, `damage`, `push`, `collect`, `goal`. A rule not listed does not run |
| `actions` | string[] | Yes | Unique, from the 7 actions; must include `move` and `wait` |
| `blockSupply` | integer | Yes | 0–5; at least 1 when `place_block` is enabled, else 0 |
| `inventory` | integer | Yes | 1–5 |
| `goal` | object | Yes | `type`: `reach`, `collect` or `collect_reach`. `n`: integer 1–10, required for the collect types, ≤ the matching collectibles on the grid. `thing`: optional thing id to count or reach only that thing. Reach types need at least one `goal` tile |
| `stepLimit` | integer | Yes | 10–100 |
| `seed` | integer | No | Default 0. Reserved; v0 rules use no randomness |
| `duel` | object | No (stretch) | `goal`: a Duel goal id; `startsA`, `startsB`: [x, y][]; `flagHomeA`, `flagHomeB`: [x, y] for `capture_the_flag` |

Caps that protect cost and fairness (proposed): grid at most 20 × 20; at most 40 spreading tiles at the start (Flood Gate has 13); at most 3 spreading thing ids per map; at most 10 collectibles; step limit at most 100, so a credit hold is at most 100 ticks × 4.5 = 450 credits (3 agents). Maps hold no free text other than `name`.
### Flood Gate in the schema
This file was loaded into `engine_sim.py` for this spec (starts[0] drawn as `0`): grid, `spreadEvery`, actions, block supply, inventory, goal, step limit and thing tags all equal the simulator's Map 1. It gives the 27-step Builder clear, no clear without Builder, `fail_out_of_steps` at 60 when idle, and the 23-step two-agent clear.
```
{
  "schema": "promptlings.map/v0",
  "id": "flood-gate",
  "version": 1,
  "name": "Flood Gate",
  "width": 15,
  "height": 9,
  "legend": { "#": "wall", "~": "water", "*": "gem", ".": null },
  "grid": [
    "###############",
    "#~~~~~~~~~~~~~#",
    "#######.#######",
    "#.....#.#.....#",
    "#.*...#.#...*.#",
    "#.............#",
    "#.............#",
    "#.*...........#",
    "###############"
  ],
  "starts": [[7, 7], [8, 7], [6, 7]],
  "maxAgents": 3,
  "things": {
    "wall":  { "tags": ["solid", "blocks"] },
    "water": { "tags": ["spreads", "liquid"], "spreadEvery": 2 },
    "gem":   { "tags": ["collectible"] }
  },
  "rules": ["spread", "block", "damage", "push", "collect", "goal"],
  "actions": ["move", "wait", "pick_up", "place_block"],
  "blockSupply": 2,
  "inventory": 3,
  "goal": { "type": "collect", "n": 3 },
  "stepLimit": 60
}
```
## 11. Agent decision interface
The planner LLM (Claude Haiku 5.5) writes one plan per agent at the start and on replan triggers; the actor (Jev; Decisions API as backup; Haiku as fallback) picks one legal action per agent per tick. Both sit behind one interface so the week-one benchmark can swap them.
### What the planner gets
1. **System prompt** (static, cached): the 6 rules and 7 actions described in tag terms, plus output rules. Same for every run of an engine version.
2. **Briefing** (static per run): the tag-code legend, spread intervals, goal, step limit, block supply, inventory size, enabled actions; this agent's slot, start tile and unlocks; each teammate's slot, start tile, unlocks and skills' `handles_tags` (never their prompts).
3. **Skills:** the decrypted `prompt` of each skill on this agent.
4. **State:** the encoding below. On a replan, also the reason and the previous plan.
Output: plain text, at most 300 tokens.
### What the actor gets every tick
The plan text, the `reflexes` of this agent's skills, the state encoding and the legal list in canonical order (section 4). It returns the index of one option and a probability per option.
### State encoding (proposed v0)
Compact JSON, because the grid is the largest part of every call. Things are shown as tag codes, never names:
- Collect the distinct tag sets on the map (plus `block`'s set when `place_block` is on). Give each set a code `A`, `B`, `C`… in the order its first tile appears in the starting grid (rows top to bottom, then left to right); a set not on the starting grid gets the next free letter. List each code's tags in the order of the tag table in section 2. Codes are fixed for the whole run. Things with the same tags share a code (gem and key look the same to agents).
- `.` is an empty tile. Agents are not drawn in the grid; they are listed with coordinates.
```
{
  "t": 4, "limit": 60,
  "codes": { "A": ["solid", "blocks"], "B": ["spreads", "liquid"], "C": ["collectible"] },
  "spread": { "B": { "every": 2, "next": 6 } },
  "grid": ["AAAAAAAAAAAAAAA", "ABBBBBBBBBBBBBA", "AAAAAAABAAAAAAA", "A.....ABA.....A", "A.C...A.A...C.A", "A.............A", "A.............A", "A.C...........A", "AAAAAAAAAAAAAAA"],
  "me": { "slot": 0, "x": 7, "y": 5, "inv": 0, "unlocks": ["builder"] },
  "crew": [],
  "rivals": [],
  "blocks": 2, "collected": 0, "goal": { "type": "collect", "n": 3 },
  "recent": ["move_N", "move_N", "wait", "wait"]
}
```
`recent` holds this agent's last 5 applied actions. `rivals` is used only in Duel. In Race each crew sees only its own copy.
### The interface
The two methods are the concept's interface unchanged; the types around them are proposed.
```
type Dir = "N" | "S" | "W" | "E";
type Action =
  | "wait" | "pick_up" | "drop"
  | `move_${Dir}` | `place_block_${Dir}` | `dig_${Dir}` | `extinguish_${Dir}`;
type Tag = "spreads" | "liquid" | "damages" | "solid" | "blocks"
  | "pushable" | "breakable" | "flammable" | "collectible" | "goal";
type Unlock = "builder" | "digger" | "firefighter";

interface Briefing {
  engineVersion: string;
  codes: Record<string, Tag[]>;
  spreadEvery: Record<string, number>;
  goal: { type: "reach" | "collect" | "collect_reach"; n?: number };
  stepLimit: number;
  blockSupply: number;
  inventory: number;
  actions: string[];
  me: { slot: number; start: [number, number]; unlocks: Unlock[] };
  crew: { slot: number; start: [number, number]; unlocks: Unlock[]; handlesTags: Tag[] }[];
}

interface SkillPrompt {   // built inside the agent runner only, never serialised out
  skillId: string;
  version: number;
  prompt: string;
  reflexes?: string;
}

type GameState = object; // the state encoding above

interface Plan {
  text: string;           // hidden from players, never logged
  reflexes: string[];     // copied from the agent's skills by the runner
  tick: number;
  reason: "start" | "periodic" | "agent_lost" | "blocks_changed";
}

interface DecisionEngine {
  plan(briefing: Briefing, skills: SkillPrompt[], state: GameState): Promise<Plan>;
  chooseAction(
    state: GameState,
    plan: Plan,
    legal: Action[],
  ): Promise<{ action: Action; probabilities: number[] }>;
}
```
Rules for every adapter:
- `legal` is always in canonical order; `probabilities[i]` belongs to `legal[i]`.
- Take the top option. Use temperature 0 or the provider's most deterministic setting where one exists.
- Cap actor output at 60–100 tokens and allow no reasoning text.
- The engine re-checks the returned action. Anything outside `legal` becomes `wait` (reason `illegal`).
- The Haiku fallback actor returns a structured action; its `probabilities` is 1 for the pick and 0 for the rest.
- One retry on a provider error, only if it fits inside the time limit; then `wait` (reason `error`).
## 12. Player-made maps (stretch)
Players may publish maps only after clearing them, only from library parts, and with no text that a model could read.
Publishing flow:
1. Paint the grid with library things in the map editor.
2. Set rules, actions, goal, step limit, block supply, inventory size and start tiles.
3. The validator checks the map against the schema and caps in section 10.
4. **Clear-check:** the creator runs the map with their own agents, as a normal paid run. It must end `clear` within the step limit. The server re-simulates the logged actions and stores the replay as proof, with the crew size and unlocks used (proposed: shown on the map page, e.g. "cleared with 2 agents, Builder + Digger").
5. Publish. A published version is immutable; any edit is a new version that needs its own clear-check.
| Guardrail | Stops |
| Must clear before publishing | Impossible maps that drain other players' entry fees or time |
| No rewards for runs on your own map; points weighted by distinct players and failure rate (weights in the Formulas doc) | Easy maps built to farm points |
| No custom code and no free text: legend values are library thing ids, tags must match the library, unknown fields are refused, and `name` is the only string, never sent to models | Engine exploits, and prompt injection through map text such as a sign saying "ignore your instructions" |
| Size and hazard caps from section 10 | Runaway credit holds and slow ticks |

New mechanics come only from the game team adding to the library, so every existing skill stays compatible. Map NFTs and creator payouts are roadmap.
## 13. Open questions
Each row has a proposed default the build can use until the team decides.
| # | Question | Proposed default |
| 1 | Per-action time limit in PvP | Tick length minus 0.5 s |
| 2 | Actor model: Jev or the Decisions API | Jev, confirmed by the week-one benchmark |
| 3 | Free vs paid ranked beyond one free daily match | One short free match a day, then credits |
| 4 | Should items held by a lost agent still count toward the goal? The simulator says yes | Keep the simulator behaviour |
| 5 | End a run early when the goal can no longer be reached (gems cut off by water), to save credits? | No in v0; runs play to the step limit |
| 6 | Ember Warehouse: the concept table offers no unlocks but the simulator config enabled `extinguish` | Resolved: `extinguish` removed from Ember Warehouse's actions; the 29-step result is the same |
| 7 | Race "mirrored maps": identical copies or flipped? And the result when neither side clears | Identical copies; draw |
| 8 | How players get unlocks beyond the starter grant | Game events only, list to be written |
| 9 | Do holders of a skill get the creator's new versions? | No; each version is its own token |
| 10 | Skill token standard: NEP-171 or NEP-245 | Decide after reading both before 1 Nov |
| 11 | Score rounding | Settled: half up, Math.floor(x + 0.5), so 1,212.5 shows as 1,213 (Formulas doc) |
| 12 | Start tiles for crew slots 1 and 2 on the official maps were chosen for this spec | Use the tiles in section 10 unless the team changes them |
| 13 | `boulder` exists in the simulator but not in the concept's thing list | Leave it out of v0 |
| 14 | `drop` is in the action list but no v0 map enables it and the simulator lacks it | Implement it as specified; enable it per map |
| 15 | Fire never burns out. Intended? | Yes for v0 |
| 16 | Charge turns that time out? | Yes, they cost inference; errors are free |
| 17 | Duel simultaneous-resolution rules and goal definitions | Use section 5 and 7 drafts; playtest before building Duel |
