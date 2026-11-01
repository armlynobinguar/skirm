# Promptlings — Game Concept
2026-10-25 · @Tyron
## The pitch
**Promptlings is a puzzle game where your AI agents solve the level, not you.** You write skills (hidden prompt strategies), equip them on agents, and send the smallest crew you can onto maps full of mechanics like flowing water, spreading fire and pushable crates. Fewer agents means a higher score. That makes generalist skills the most valuable, and skills are tradable NFTs.
**Two ways to play:** solo puzzle runs, and live PvP where two crews race on mirrored maps or fight on the same map.
Why AI agents: a traditional game would need code for every skill-and-map combination. An LLM can apply a general strategy such as "contain spreading hazards" to a map it has never seen. That is what lets players write skills, trade them, and build new maps freely.
Working title. Built for NEAR HACKATHON, 1–14 Nov 2026.
## Design pillars
Five rules every feature should pass.
1. **You coach, the agent plays.** The player's skill shows in writing strategies, picking a crew and choosing maps. Once a run starts, the player only watches.
2. **Efficiency is the score.** Clearing a map is the baseline. Clearing it with one agent in few steps is mastery.
3. **Write once, works anywhere.** Skills target shared mechanics (tags), never a specific map.
4. **The engine is the referee.** A deterministic simulation decides success. The models only plan and pick actions.
5. **Players never notice the chain.** Social login and an in-game shop up front, with NFTs and royalties handled underneath.
## System index
**Running Promptlings takes 27 systems; 24 are in the hackathon MVP, most of them thin.** Person 1 owns the game core and AI layers; Person 2 owns the onchain, economy and client layers. Owner and scope are dropdowns, so change them as the plan moves.
Companion docs: [Promptlings Game Spec](https://claude.ai/artifact/SoDsx1deNGMkh4iskJq4sy), [Promptlings UI/UX Spec](https://claude.ai/artifact/267kvVM55hjgwQ3WG8Xzyn), [Promptlings Formulas](https://claude.ai/artifact/14sDQJK9TdYyan5aGfog7y), [Promptlings Milestones](https://claude.ai/artifact/QBJF3BZCZ3XPfsJYRTtUMV), [Promptlings Design System](https://claude.ai/artifact/Min655MxghPZs5tDwBwNMk).
Screens: [Promptlings Screens](https://claude.ai/artifact/H5vUH42LAWdYYbPkBzKH9E), 22 artboards built on the design system, one per screen ID in the UI/UX Spec. Hosting and data flows: Promptlings System Architecture, https://claude.ai/artifact/HcjhXWULUoWDZZkDFd2xLG.
| System | Layer | What it does | Owner | Scope | Details in section |
| Simulation engine | Game core | Grid, tags, rules, fixed tick order, step limits | [{'id': '.34537', 'enum': 'faa9d957-1fdc', 'index': '0'}] | [{'id': '.34540', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Tags and rules |
| Mechanics library | Game core | Versioned tag, rule and action definitions; adding one never changes the others | [{'id': '.34671', 'enum': 'faa9d957-1fdc', 'index': '0'}] | [{'id': '.34674', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Tags and rules |
| Map format and validator | Game core | Map JSON schema, size and hazard caps, loading | [{'id': '.34779', 'enum': 'faa9d957-1fdc', 'index': '0'}] | [{'id': '.34782', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Maps |
| Run orchestrator | Game core | Queues runs, checks credits, drives the turn loop, refunds unused credits | [{'id': '.34896', 'enum': 'faa9d957-1fdc', 'index': '0'}] | [{'id': '.34899', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Run loop |
| Replay log | Game core | Records every action, replays runs, hashes logs for the registry | [{'id': '.35002', 'enum': 'faa9d957-1fdc', 'index': '0'}] | [{'id': '.35005', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Run loop |
| Scoring and leaderboards | Game core | Score formula, per-map score spread, skill clear rates by tag | [{'id': '.35119', 'enum': 'faa9d957-1fdc', 'index': '0'}] | [{'id': '.35122', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Scoring |
| PvP match server | Game core | Matchmaking, tick clock, simultaneous moves, live stream over WebSockets; Race in MVP, Duel later | [{'id': '.35263', 'enum': 'faa9d957-1fdc', 'index': '0'}] | [{'id': '.35266', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | PvP modes |
| Agent decision engine | AI | Planner LLM and actor decision model behind one interface; builds the legal action list | [{'id': '.35397', 'enum': 'faa9d957-1fdc', 'index': '0'}] | [{'id': '.35400', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Agent decision engine |
| Skill vault | AI | Stores skill prompts encrypted, injects them server-side, never returns them | [{'id': '.35522', 'enum': 'faa9d957-1fdc', 'index': '0'}] | [{'id': '.35525', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Core concepts |
| LLM providers | AI | Claude Haiku 5.5 as planner, Jev as actor, Decisions API as backup | [{'id': '.35631', 'enum': 'faa9d957-1fdc', 'index': '0'}] | [{'id': '.35634', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Agent decision engine |
| Credits ledger | Economy | Balances, top-ups, per-turn charges, refunds, daily free budget | [{'id': '.35751', 'enum': 'faa9d957-1fdc', 'index': '1'}] | [{'id': '.35754', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Credits and payments |
| Cost guardrails | Economy | API spend caps, rate limits, global free-play budget, cost alerts | [{'id': '.35873', 'enum': 'faa9d957-1fdc', 'index': '2'}] | [{'id': '.35876', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Unit economics |
| Skill NFT contract | Onchain | Mints skills (NEP-171 or NEP-245) with a creator royalty | [{'id': '.35983', 'enum': 'faa9d957-1fdc', 'index': '1'}] | [{'id': '.35986', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Economy loop |
| Marketplace contract | Onchain | List, buy and resell skills; pays royalties and the platform fee | [{'id': '.36101', 'enum': 'faa9d957-1fdc', 'index': '1'}] | [{'id': '.36104', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Economy loop |
| Run and match registry | Onchain | Stores results, Elo and replay hashes | [{'id': '.36194', 'enum': 'faa9d957-1fdc', 'index': '1'}] | [{'id': '.36197', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | System architecture |
| Deposit handling | Onchain | Receives NEAR top-ups on testnet; other tokens through NEAR Intents later | [{'id': '.36324', 'enum': 'faa9d957-1fdc', 'index': '1'}] | [{'id': '.36327', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Credits and payments |
| Reward pool contract | Onchain | Holds solo entry fees and pays the top scores each season | [{'id': '.36443', 'enum': 'faa9d957-1fdc', 'index': '1'}] | [{'id': '.36446', 'enum': 'c41fbd0d-04a9', 'index': '1'}] | Credits and payments |
| Web app | Client | Map view, crew builder, live and replay viewer, leaderboards | [{'id': '.36551', 'enum': 'faa9d957-1fdc', 'index': '1'}] | [{'id': '.36554', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | System architecture |
| Skill editor | Client | Write a skill, set its tags and unlocks, test it on a map, mint it | [{'id': '.36669', 'enum': 'faa9d957-1fdc', 'index': '1'}] | [{'id': '.36672', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Core concepts |
| Marketplace UI | Client | Browse skills by clear rate per tag, buy and resell | [{'id': '.36768', 'enum': 'faa9d957-1fdc', 'index': '1'}] | [{'id': '.36771', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Economy loop |
| Login and wallets | Client | Social login first; wallet connect only for trading | [{'id': '.36869', 'enum': 'faa9d957-1fdc', 'index': '1'}] | [{'id': '.36872', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Credits and payments |
| Map editor and clear-check | Content | Tile painter; publishes a map only after its creator clears it | [{'id': '.36999', 'enum': 'faa9d957-1fdc', 'index': '2'}] | [{'id': '.37002', 'enum': 'c41fbd0d-04a9', 'index': '1'}] | Player-made maps |
| Anti-abuse rules | Content | No rewards on your own maps, anti-farming weights, no free text in maps | [{'id': '.37124', 'enum': 'faa9d957-1fdc', 'index': '2'}] | [{'id': '.37127', 'enum': 'c41fbd0d-04a9', 'index': '1'}] | Player-made maps |
| Hosting and data | Infra | NestJS backend, database, job queue and replay storage on GCP, us-central1 (proposed; see System Architecture) | [{'id': '.37255', 'enum': 'faa9d957-1fdc', 'index': '2'}] | [{'id': '.37258', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | System architecture |
| Observability | Infra | Tokens and cost per turn, latency, errors and alerts | [{'id': '.37359', 'enum': 'faa9d957-1fdc', 'index': '2'}] | [{'id': '.37362', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Unit economics |
| Simulator and map tests | Dev tools | Rule simulator (a Python version exists) and solvability tests for every map | [{'id': '.37496', 'enum': 'faa9d957-1fdc', 'index': '0'}] | [{'id': '.37499', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Maps |
| Provider benchmark | Dev tools | Week-one comparison of actor models on clear rate, latency and cost | [{'id': '.37609', 'enum': 'faa9d957-1fdc', 'index': '0'}] | [{'id': '.37612', 'enum': 'c41fbd0d-04a9', 'index': '0'}] | Agent decision engine |

The System architecture diagram shows how these connect.
## Core concepts
Everything in the game is built from eight parts. The game team owns the mechanics library (tags, rules, actions). Players own the content (skills, and later maps).
| Concept | What it is | Made by | Ownership |
| Agent | The unit deployed on a map. Runs a planner LLM and a decision model, and carries skills | Game | Player-owned (several per player) |
| Skill | Hidden prompt strategy, plus the unlocks it needs and the tags it handles | Players | NFT, creator royalty; prompt never leaves the server |
| Unlock | Gives an agent access to a gated action, e.g. `place_block` | Game, kept scarce | In-game item |
| Map | A JSON file: grid, entities, enabled rules, enabled actions, goal, step limit | Game team, players later | Official, or map NFT (stretch) |
| Tag | Label on a tile or entity (full list in Tags and rules); 10 in v0: `spreads`, `liquid`, `damages`, `solid`, `blocks`, `pushable`, `breakable`, `flamm``able`, `collectible`, `goal` | Game team | Engine library |
| Rule | Behavior tied to tags: `spreads` grows each N ticks, `blocks` stops `spreads`, `damages` removes an agent on contact | Game team | Engine library |
| Action | What an agent can do (7 in v0): `move`, `wait`, `pick_up`, `drop`, `place_block`, `dig`, `extinguish`; pushing happens through `move` | Game team | Engine library |
| Match | A live PvP game between two crews, played in ticks of 1–3 seconds | Game | Result, Elo and replay hash onchain; free to play |

**Tags are what make skills portable.** Water is `spreads` + `liquid`, lava is `spreads` + `liquid` + `damages`, fire is `spreads` + `damages`. A skill written to contain `spreads` hazards therefore works on all three.
A skill as stored:
```
{
  "name": "Flood Warden",
  "requires_actions": ["place_block"],
  "handles_tags": ["spreads", "liquid"],
  "prompt": "<encrypted, runs server-side only>"
}
```
The marketplace reads `requires_actions` to flag a skill as unusable on maps without those actions, before a player wastes a run.
## Tags and rules (v0)
**Ten tags and six rules build every hackathon map.** Tags say what a thing is; rules are the physics the engine applies to tagged things every tick. Agents see tags, never names, so a skill written for "anything that spreads" works on water, lava and fire alike.
### Tags
| Tag | Meaning | Examples |
| `spreads` | Grows into neighbouring tiles over time | Water, lava, fire |
| `liquid` | Agents cannot walk into it; water puts out fire | Water, lava |
| `damages` | Removes an agent on the same tile | Lava, fire, spikes |
| `solid` | Agents cannot walk into it | Walls, crates, dirt |
| `blocks` | Stops anything that spreads | Walls, placed blocks, dirt |
| `pushable` | Moves one tile when an agent walks into it | Crates |
| `breakable` | Removed by `dig` | Dirt, weak walls |
| `flammable` | Fire can spread onto it, destroying it | Wooden crates, grass |
| `collectible` | Can be picked up into an agent's inventory | Gems, keys |
| `goal` | Reaching or collecting it can end the run | Exit door, flag |

### Things built from tags
| Thing | Tags |
| Water | `spreads`, `liquid` |
| Lava | `spreads`, `liquid`, `damages` |
| Fire | `spreads`, `damages` |
| Stone wall, placed block | `solid`, `blocks` |
| Dirt | `solid`, `blocks`, `breakable` |
| Wooden crate | `solid`, `pushable`, `flammable` |
| Grass | `flammable` |
| Gem, key | `collectible` |
| Exit door, flag | `goal` |

### Rules
| # | Rule | Applies to | Effect | Set per map |
| 1 | Spread | `spreads` | Every N ticks, water and lava grow into every empty neighbouring tile. Fire grows only onto `flammable` tiles, destroying them. Water that reaches fire puts it out. A hazard that covers a goal tile floods it and fails the run | N for each thing, e.g. water every 2 ticks |
| 2 | Block | `blocks` | Nothing spreads into it | — |
| 3 | Damage | `damages` | An agent on the same tile is removed | — |
| 4 | Push | `pushable` | Walking into it shoves it one tile if the far tile is empty | — |
| 5 | Collect | `collectible` | `pick_up` adds it to the agent's inventory; `drop` places it back | Inventory size |
| 6 | Goal | `goal` | The run clears when the map's goal is met | Goal type: reach, collect N, or collect N then reach; Duel maps add capture the flag and most collected |

### Actions and the tags they touch
| Action | Effect | Unlock needed |
| `move` | One tile in four directions; stopped by `solid`; walking into `pushable` pushes it | No |
| `wait` | Does nothing this tick | No |
| `pick_up` / `drop` | Takes or places a `collectible` on the agent's tile | No |
| `place_block` | Puts a placed block on an adjacent empty tile, from the map's block supply | Builder |
| `dig` | Removes an adjacent `breakable` tile | Digger |
| `extinguish` | Removes adjacent fire | Firefighter |

### Tick order
Every tick resolves in the same order, so the same moves always give the same result.
1. Agents act: in a fixed order in solo runs, all at once in PvP. In PvP, two agents moving into one tile both stay put; in solo runs agents act in order, so an agent cannot enter a tile another agent already holds.
2. Pushes and pickups resolve.
3. Spread runs, stopped by `blocks`.
4. Damage is checked.
5. Goal and step limit are checked.
### How a map uses them
```
"things": {
  "water": { "tags": ["spreads", "liquid"], "spreadEvery": 2 },
  "crate": { "tags": ["solid", "pushable", "flammable"] },
  "exit":  { "tags": ["goal"] }
},
"rules": ["spread", "block", "damage", "push", "goal"],
"actions": ["move", "wait", "place_block"],
"goal": { "type": "reach", "thing": "exit" }
```
This shows only how tags and rules plug into a map; the full map JSON schema is still open. New tags and rules come only from the game team, and adding one never changes how existing ones behave, so old skills keep working.
## Maps (v0)
**Three themed maps, each with more mechanics than the last, and each proven solvable in a test simulator.** A Python version of the engine ran every map: doing nothing fails, the obvious wrong approach fails, one agent with the right unlocks clears it, and two agents clear it with less planning but a lower score.
|  | Flood Gate | Ember Warehouse | Magma Mine |
| Theme | Sunken canal village | Burning warehouse | Volcanic mine |
| Hazard | Water, spreads every 2 ticks | Fire, spreads every 2 ticks along fuel | Lava, spreads every 5 ticks |
| Mechanics in play | 4: spread, no wading, place block, collect | 5: fire on fuel, damage, push, collect, exit | 7: spread, no wading, damage, dig, place block, collect, exit |
| Unlocks offered | Builder (2 blocks) | None | Builder (1 block), Digger |
| Goal | Collect 3 gems | Collect the key, then reach the exit | Collect 2 crystals, then reach the exit |
| Step limit | 60 | 50 | 70 |
| Best solo | 27 steps, score 2,325 | 29 steps, score 2,130 | 57 steps, score 1,779 |
| Two agents | 23 steps, score 1,213 | 29 steps, score 1,065 | 32 steps, score 1,157 |

Scores use the Scoring formula without skill upkeep, rounded half up. Race mode plays the same maps mirrored side by side.
### Map 1: Flood Gate
<embed {'caption': 'Map 1 Flood Gate · 15 × 9 tiles', 'ref': 'node/35387149-97a0'}>
**Seal the spillway first, then collect.** A canal along the top leaks through a one-tile spillway into a village. Agents cannot wade through water, so once the village floods the gems are cut off.
- **Winning line (one agent, Builder):** two steps north, place a block in the spillway on or before tick 6, then collect all three gems. 27 steps.
- **Two agents:** a Builder seals the spillway in 4 actions and steps aside; a plain collector gathers the gems. 23 steps.
- **What fails:** doing nothing, and any agent without the Builder unlock.
- **What it teaches:** spot the threat and act on it before the task.
### Map 2: Ember Warehouse
<embed {'caption': 'Map 2 Ember Warehouse · 15 × 8 tiles', 'ref': 'node/e845c8c2-4205'}>
**Break the fuel line before the key run.** Fire starts in the stockroom and burns along a grass carpet and a wooden crate toward the vault holding the key. Fire only travels along fuel, so bare floor is safe.
- **Winning line (one agent, no unlocks):** push the crate in the fuel line north into the empty pocket. The gap stops the fire. Then walk the corridor, take the key, come back and exit. 29 steps.
- **The trap:** going straight in by the side entrance gets the key, but the fire crosses the corridor behind the agent, which is caught at tick 24.
- **Two agents:** one pushes the crate in 9 actions while the other takes the direct route. 29 steps.
- **What it teaches:** plan the way back, and use firebreaks.
### Map 3: Magma Mine
<embed {'caption': 'Map 3 Magma Mine · 15 × 9 tiles', 'ref': 'node/d02a0f49-7dc5'}>
**Dam the lava shaft, then dig for crystals.** A lava pool drains down a shaft into the only tunnel to the exit. One crystal sits behind dirt near the start, the other behind dirt beside the exit. Lava that reaches the exit floods it.
- **Winning line (one agent, Builder and Digger):** run to the shaft and block it on or before tick 15, walk back to dig out the first crystal, then cross the tunnel, dig out the second and exit. 57 steps.
- **What fails:** a Digger alone (taking the first crystal before damming lets the lava cut the tunnel first), and a Builder alone (it cannot dig).
- **Two agents:** the Builder dams the shaft and parks in a side niche while the Digger takes both crystals. 32 steps.
- **What it teaches:** priority under pressure. This is the closest call of the three: one agent with both unlocks beats two specialists by 622 points, so skills that cover more of the job are worth more.
### How the maps were tested
- A Python version of the v0 rules and tick order ran each map. A search found the shortest one-agent win, with block placement limited to the marked dam spots to keep the search fast. Two-agent routes were scripted and run.
- Testing settled four rule details, now written into Tags and rules: fire spreads only onto flammable tiles; water and lava spread into every open neighbouring tile; agents cannot walk into liquid; a hazard covering a goal tile floods it and fails the run.
## Core game loop
<embed {'caption': 'Core game loop · 5 steps', 'ref': 'node/98fbecdf-5f74'}>
**Every choice the player makes happens before the run starts.** The player picks a map, builds a crew, watches the run, reads the score, then improves the crew and goes again. Money moves at two points: buying skills while building the crew, and selling them while improving.
## Run loop
<embed {'caption': 'Run loop · one turn, repeated until the run ends', 'ref': 'node/3e3aa8f3-8709'}>
**A decision model picks one legal**** action per turn; everything else is the engine's job.** The engine checks each action against the agent's unlocks, applies it, then runs world rules such as water spreading. Because the engine alone decides success and logs every action, runs are fair and every run can be replayed. With several agents, each one takes its turn in a fixed order.
## Agent decision engine
**Plan with an LLM, act with a decision model.** A general LLM reads the skills and briefing and writes a short plan. A fast decision model then picks each turn's action from the engine's list of legal moves. This keeps skills meaningful, makes PvP ticks safe, and cuts inference cost by about a third.
<embed {'caption': 'Agent decision engine · plan once, pick every tick', 'ref': 'node/d1622dbf-6528'}>
The planner runs when a run starts, then again every ~20 turns or after a big change, such as a wall breaking or an agent being lost. Between plans, every tick is one fast pick.
### Why split it
- **Decision models are fast reflexes.** They are built for routing and classification, and open-ended planning is a stated weak spot. The puzzles need planning, so the planner is what keeps skills worth buying.
- **No invalid moves.** The engine sends only legal actions, so agents never waste a turn on a locked or impossible action.
- **Confidence comes free.** Choices return with probabilities, which can show in the spectator view and in skill stats.
- **More repeatable replays.** Taking the top option is steadier than free text. Neither vendor promises determinism, and Jev's probabilities reportedly shift when options are reordered, so the engine always sends options in a fixed order.
### Providers
|  | TypeSafe Jev | OpenAI Decisions API | Claude Haiku 5.5 |
| Role here | Actor | Actor, second option | Planner; fallback actor |
| Status | Generally available since 15 Sep 2026, also on OpenRouter | Public beta since 6 Oct 2026 | Generally available |
| Price per MTok | $0.042 input; output free | $0.10 input (reported); output price not published | $0.10 input, $0.01 cache hit, $0.50 output |
| Latency | 0.21 s median, 0.34 s p95 (OpenRouter) | Up to 10× faster than the Responses API (vendor claim) | To measure in week one |
| Inputs | Text; 32K context on OpenRouter | Text and up to 128 inline images; user messages only | Text and images |
| Output | Choice, score or yes/no, with probabilities | Choice, score or predicate, with probabilities | Structured JSON action |

**Pick for the hackathon: Jev as actor, Haiku 5.5 as planner.** Jev is generally available and has measured latency. The Decisions API is the backup once it leaves beta.
### One interface
```
interface DecisionEngine {
  plan(briefing: Briefing, skills: SkillPrompt[], state: GameState): Promise<Plan>;
  chooseAction(
    state: GameState,
    plan: Plan,
    legal: Action[],
  ): Promise<{ action: Action; probabilities: number[] }>;
}
```
Every provider sits behind this interface, so week one can benchmark Jev, the Decisions API and Haiku on the same maps and keep the best.
### Cost
| Engine | Cost per agent turn, planning included |
| Haiku 5.5 for every turn | $0.000155 |
| Haiku planner + Jev actor | about $0.000100 |
| Haiku planner + Decisions API actor | about $0.000215 |

This assumes a 2,000-token actor prompt (plan, state, legal actions, short skill rules) and a 300-token plan per replan. The plan replaces the full skill prompts in each actor call, which is where Jev's saving comes from. Costs per activity are in Unit economics.
Sources: [Firecrawl comparison](https://www.firecrawl.dev/blog/openai-decisions-api-vs-jev), [Decisions API public beta](https://letsdatascience.com/news/openai-opens-decisions-api-public-beta-b69a1e40), [Jev for agents](https://www.stork.ai/en/jevforagents), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).
## Economy loop
<embed {'caption': 'Economy loop · who makes, buys and earns', 'ref': 'node/8e1140e3-7084'}>
**Skill prices rest on proof, not promises.** Every run records clear rate and score per skill and per mechanic tag, so a buyer can see that a skill clears 9 of 10 `spreads` maps before paying. Writers earn a royalty on every resale. Buyers get the right to use a skill, never its prompt text.
## Credits and payments (proposed)
**Proposed: players top up credits, and every agent turn spends them.** This covers LLM costs directly and matches the scoring: a leaner crew scores higher and also costs less.
- **Top up with crypto.** Players deposit NEAR, or tokens from other chains through NEAR Intents, and receive an in-game credit balance. Credits stay an offchain ledger backed by deposits; no game token for the hackathon.
- **Credits pay for runs.** A run costs turns used × the crew's price factor (1, 2.5 or 4.5 credits per tick for one, two or three agents; proposed), which turns Option A's extra-agent cost into a real price.
- **Free daily allowance.** New players sign in socially and get a few free runs before they ever touch a wallet.
- **Platform fees fund free play.** A cut of each skill sale and of each solo reward pool pays for free ranked PvP and the daily allowance.
- **No bring-your-own API key.** Running agents on a player's key would pass hidden skill prompts through their account.
| Money flow | Paid in | Goes to |
| Credit top-up | NEAR, or other tokens via NEAR Intents | Platform, to cover inference |
| Skill purchase | NEAR | Seller and creator royalty, minus platform fee |
| Solo entry fee | NEAR | The map's reward pool for the season, minus platform cut |
| Ranked PvP | Free | Inference paid from platform fees |

## Unit economics
**Paid play is profitable; free play is the only thing that can burn money.** With the recommended engine (Claude Haiku 5.5 planner, Jev actor), one agent turn costs about $0.0001, so a solo run costs 1–3 cents. Sold at 0.1 cent per agent turn, paid runs carry about a 10× markup, or 6.5× if Haiku makes every move. The danger is free play: if a free ranked match every day ran the full 10 minutes, 1,000 daily players would cost up to $3,450–5,600 a month (an upper bound; v0 Races end at the step limit, by tick 70).
### Cost per agent turn, Haiku for every move
| Part of the call | Tokens | Price per MTok (Haiku 5.5) | Cost per turn |
| Static: system prompt, map briefing, skill prompts (cached) | 2,500 | $0.01 cache hit | $0.000025 |
| Dynamic: grid observation, recent actions | 1,000 | $0.10 input | $0.000100 |
| Output: one structured action, no reasoning text | 60 | $0.50 output | $0.000030 |
| **Total** |  |  | **$0.000155** |

Token counts are estimates to replace with measurements in the first build week. The grid observation is the largest cost, so a compact state encoding matters most. Without caching a turn costs $0.00038; letting the model write 300 tokens of reasoning raises it to $0.000275. Other budget models price similarly (GPT-6 Luna is also $0.10 in, $0.50 out), so the model can be chosen on quality.
### Cost per activity
| Activity | Agent turns | Haiku every turn | Haiku planner + Jev | Haiku planner + Decisions API |
| Solo run, 2 agents × 50 turns | 100 | $0.016 | $0.010 | $0.022 |
| Solo run, 3 agents × 80 turns | 240 | $0.037 | $0.025 | $0.053 |
| Ranked match, 3 s ticks, 1 agent a side, full 10 min | 400 | $0.062 | $0.038 | $0.085 |
| Ranked match, 2 s ticks, 2 agents a side, full 10 min | 1,200 | $0.19 | $0.12 | $0.25 |

### How much free play the game can afford
Break-even free agent turns per daily player per day, assuming 1,000 daily players, $150 a month of fixed infrastructure, and $200 a month in marketplace and pool fees:
| Paying players | Haiku only, $5/month | Haiku only, $10/month | Planner + Jev, $5/month | Planner + Jev, $10/month |
| 3% | 38 | 65 | 59 | 103 |
| 5% | 56 | 102 | 88 | 160 |
| 8% | 83 | 156 | 132 | 247 |

The planner + Jev engine raises the free budget by about 60%. That pays for the 60-credit daily free solo allowance (one worst-case one-agent Flood Gate run) at 5% paying, or at 3% if they spend $10, and a short daily ranked match (about 3 minutes, 120 turns, about 1.2 cents) once 5% of players pay $10 a month. A daily match that ran the full 10 minutes would still cost up to about $3,450 a month per 1,000 daily players, so free ranked stays capped.
### Guardrails
1. **Price above cost.** 5× inference cost is the target floor. At 0.1 cent per agent turn the markup is about 9.7× with planner + Jev, 6.5× with Haiku only and 4.6× with planner + Decisions API; reprice whenever it falls below 5×, such as when model prices move.
2. **Prepaid only.** A run starts only if the balance covers its worst case (step limit × crew price factor); unused credits return when it ends. Nothing runs on debt.
3. **One fixed daily free budget.** All free play draws from a global daily budget. When it runs out, free play pauses until the next day, so the bill cannot grow with traffic.
4. **Cheap free ranked.** Free matches use 3 s ticks, 1 agent a side, and end as soon as a side wins. Ranked matches beyond the daily free one cost credits (proposed).
5. **Token caps on every call.** Structured action output, a 60–100 token output cap, no reasoning text, a cached static prompt, and a compact grid encoding.
6. **Entry fees cover their own inference.** A solo entry fee is at least 3× the run's inference cost, before the pool's platform cut.
7. **Hard limits at the provider.** A monthly spend limit on the API key, per-player rate limits, and an alert when inference cost per daily player passes revenue per daily player.
8. **Measure in week one.** Log tokens per turn from the first playable build and replace these estimates.
Prices as of October 2026: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [geotoolbox model price comparison](https://geotoolbox.ai/blog/ai-token-cost).
## Retention flywheel
<embed {'caption': 'Retention flywheel · 5 stages, one direction', 'ref': 'node/1b9693ed-8a37'}>
**The game never reaches a point where the best skills are done.** Train-then-watch games tend to stall once the player's AI is tuned. Here, each new mix of mechanics lowers the clear rates of existing skills, which creates demand for new ones and income for their writers. The game team seeds the first maps; player-made maps take over as creators join.
PvP adds a second pull. When one skill dominates the ranked ladder, players write counters to it, so the top strategies keep changing even without new maps.
## Scoring
**No clear, no score. After that, fewer agents and fewer steps win.** A run scores only if the goal is reached before the step limit.
```
\text{score} = 1000 \times M_{\text{agents}} \times \left(1 - 0.5 \cdot \frac{\text{steps used}}{\text{step limit}}\right) - \text{skill upkeep}
```
| Agents deployed | Multiplier |
| 1 | ×3.0 |
| 2 | ×1.5 |
| 3 or more | ×1.0 |

The weights are starting values, to be tuned in playtesting. Skill upkeep is a small cost per equipped skill, so stacking every skill on one agent is not free.
Each map shows where a player's score sits among everyone else's, as Opus Magnum does with its histograms. That gives players a reason to replay a map they have already cleared, and it gives skill writers proof their skill is better.
PvP matches skip this formula. The mode's goal decides the winner, and each agent gains or loses Elo (see PvP modes).
## Player-made maps
**Player maps keep the game going after skills are tuned, but only behind three guardrails.** Each new map with an unfamiliar mix of mechanics sends players back to write or buy skills. This is a stretch goal for the hackathon.
Publishing flow:
1. Paint the grid with tiles and entities from the library.
2. Turn on rules and actions, and set the goal and step limit.
3. Clear the map with your own agents (the clear-check).
4. Publish. The clearing run is saved as proof the map can be solved.
| Guardrail | Stops |
| Must clear it before publishing | Impossible maps that drain other players' entry fees or time |
| No rewards for runs on your own map; points weighted by distinct players and failure rate | Easy maps built to farm points |
| No custom code and no free text; only library tags, rules and actions | Engine exploits, and prompt injection through map text such as a sign saying "ignore your instructions" |

New mechanics come only from the game team adding to the library, which keeps every existing skill compatible.
## PvP modes
**Live PvP works as fast ticks, not twitch action.** A general LLM needs roughly 0.5–3 seconds per decision, but a decision model like Jev answers in about 0.3 s, so ticks of 1–3 seconds (2 s for paid ranked, 3 s for the free match) leave headroom. Each tick both crews act, the engine resolves every move at once, and the match streams live to players and spectators over WebSockets. The same engine runs solo puzzles and PvP.
<embed {'caption': 'PvP match tick · both crews, one resolution', 'ref': 'node/e17b7d11-b95a'}>
Neither crew moves first, so a slower model never loses just by thinking longer. An agent that misses the time limit waits that tick.
### Formats
| Mode | How it works | Build cost | Hackathon |
| Race | Both crews play mirrored copies of one map side by side; first to clear, or highest score, wins | Low: two runs at once plus a split-screen view | MVP |
| Duel | One shared map with competing goals, set by each map: capture the flag, most resources collected, or first to the exit | Medium: interaction rules and balancing | Stretch |
| Siege | Asymmetric: one side builds hazards, the other has to get through | High: two roles to balance | Roadmap |

**In Duel, the mechanics become weapons.** A blocking skill that protects your agent from water can also redirect the water toward your opponent. A fire-containment skill doubles as defense. Players write counter-skills, so the strongest strategies keep shifting, with no new mechanics needed.
### Fairness
- Both sides use the same model, so the match is skill against skill, not a bigger model winning.
- Every agent gets the same token budget per turn and the same time limit.
- Observations stay structured with no free-text channel between agents, so one agent cannot prompt-inject the other.
- The deterministic engine decides the result and logs every action, so any match can be replayed and checked.
### Ranking and stakes
- **Elo per agent** on a ranked ladder, as AI Arena does for its ranked mode.
- **Free ranked play****:** no stakes in ranked PvP; staked matches stay on the roadmap.
- **Result and replay hash** recorded in the run registry.
- **No betting on matches.** Wagering raises gambling-regulation issues the hackathon build does not need.
### Cost
Matches are capped at 10 minutes. A match that ran the full 10 minutes at 2-second ticks would be 300 ticks, so two agents a side would make about 1,200 LLM calls. That is an upper bound: step limits also apply in PvP, so a v0 Race ends by tick 70 (at most 280 actor calls with two a side). The platform pays for free ranked matches. Matches end as soon as a side wins, free ranked matches get a daily cap per player, and agents run on a small, fast model.
## Decision: agents per player
**Decided 25 Oct 2026: Option A, players own several agents****.** The original idea gives each player one agent, but the water example needs two.
|  | A. Own several | B. Rent other players' agents |
| How it works | A player owns or spawns several agents; each extra one deployed costs more | Each player owns one agent and rents others for a run; the reward is split onchain |
| Strength | Simple, single-player, easy to scope | Multiplayer economy; adds the AI Swarms track |
| Cost | Little interaction between players | Rental escrow, reward split and matchmaking to build |

Each extra agent deployed costs more, and the fewer-agents multiplier still lowers the score. Rentals (Option B) stay on the roadmap.
## System architecture
<embed {'caption': 'System architecture · client, backend, inference, NEAR', 'ref': 'node/1a105906-a6f7'}>
**Only what needs trust or ownership goes onchain.** Skill ownership, trades, royalties and run results live in NEAR contracts. Prompts, the simulation and replays stay on the backend, because prompts must stay secret and LLM calls happen every turn. The replay hash in the run registry lets anyone check that a replay matches its recorded score.
PvP uses the same parts. The simulation engine runs both crews' ticks, and the backend streams each tick to the web app over WebSockets. Onchain, the run registry also stores match results and Elo, and a reward-pool contract holds solo entry fees and pays the top scores each season.
## Comparable games and positioning
**No existing game combines tradable prompt skills, mixable mechanics and efficiency scoring.** Each piece has worked on its own.
| Game | What we borrow | How we differ |
| [AI Arena](https://decrypt.co/236491/ethereum-fighting-game-ai-arena-token-launch) | Train an AI fighter, then watch it compete; fighters are tradable NFTs on Arbitrum | Players teach by writing prompts, not by imitation learning; solo puzzles plus PvP races and duels where the mechanics act as weapons |
| Lemmings | Assign roles (blocker, digger) to get the group through a hazard | Roles are player-written skills, not fixed jobs |
| Opus Magnum / Zachtronics | Every solution counts; score histograms on cost and cycles drive replays | Efficiency is measured in agents and steps |
| Super Mario Maker | Player-made levels with a clear-check before upload | Maps are built from mechanic tags so skills transfer between them |
| Screeps | Program your units, then watch them act | Prompts instead of JavaScript, so non-coders can play |

**The lesson from AI Arena:** a [reviewer noted](https://whatsyourgam3.beehiiv.com/p/whats-gam3-13) the game loses its pull once your model is trained and you stop tweaking it. Promptlings avoids that because new maps keep breaking old skills (see Retention flywheel).
## Hackathon plan
**Ship one engine, three official maps****, a working skill market and a live Race mode**** by 14 Nov 2026, 23:59 UTC.** Development runs 1–14 Nov; judging runs 16–18 Nov. Submission needs a public repo and a public demo post on X ([HACKATHON.md](https://nearhackathon.com/HACKATHON.md)).
| Track | Why it fits |
| Games With Real Economies (`games`), primary | Judged on the game loop, not the token; agent NPCs and NEP-245 are named hints |
| NFTs That Do Something (`nfts`) | Skills are assets that run, earn royalties and gate access |
| Agent Economy (`agents`) | Agents equipped, hired and paid for |
| AI Swarms (`swarms`), with Duel | Agents competing head to head on shared maps |
| Privacy & Private AI (`privacy`), stretch | Skill prompts run on private inference |

### MVP scope
- Grid engine with tags, rules and a water-spread rule
- Three official maps on different mechanics: water, fire, lava
- Seven actions, three behind unlocks (Builder, Digger, Firefighter)
- Agent runner: briefing, equipped skills and state in; one action out, per turn
- Skill NFT contract with creator royalty, plus list/buy/resell
- Run registry: score, agents used, replay hash
- Next.js app: map view, replay viewer, marketplace, leaderboard, social login
- README written for the AI judges, with "do X, see Y" steps and a one-command local run
- Demo video and X post
- Race mode: two crews on mirrored maps at once, live split-screen over WebSockets
- Match results and Elo in the run registry
- Credits: top up with NEAR on testnet, spent per agent turn, with a free daily allowance
- Decision engine behind one interface: Haiku planner, Jev actor, engine-built legal action list
- Week-one benchmark of Jev, Decisions API and Haiku on the three maps: clear rate, latency, cost per run
Stretch: Duel mode first, then solo reward pools, then the map editor with clear-check. Roadmap only: Siege mode, map NFTs, creator payouts, agent rentals.
### Team split
| Person | Owns |
| Person 1 | Engine, mechanics library, maps, agent runner and decision engine, scoring, replays, PvP tick resolution |
| Person 2 | NEAR contracts (including credits, reward pools and Elo), marketplace, frontend with live match view, login |

### Before 1 Nov
- Option A chosen
- Write the tag and rule list: done, 10 tags and 6 rules (see Tags and rules)
- Design the three maps on paper and check each can be cleared with one agent
- Fix the skill format and the map JSON schema
- Read the NEP-171, NEP-245 and NEAR AI Cloud docs
- Title: Promptlings for now
- List the goal types a Duel map can choose from: capture the flag, most resources, first to the exit
- Set the tick length and per-action time limit for 10-minute matches, then test model latency against them
- Get API access for Jev (TypeSafe or OpenRouter), the Decisions API beta and Claude, and test latency from the Philippines
## Risks and open questions
**The biggest risk is scope. LLM cost and prompt leakage come next.**
| Risk | Mitigation |
| Two weeks is short | Engine and three maps first; editor and rentals only if time allows |
| LLM cost and latency per turn | Low step limits, a small fast model, compact state encoding |
| Different results on each run | Engine scores, seeded world rules, every action logged |
| Skill prompt leaks through the agent's reasoning | Replays show actions only, never the model's text |
| Prompt injection through maps | Maps hold tags only, no free text |
| Empty marketplace at launch | Seed it with official starter skills |
| Wallet setup scares players off | Social login first; wallet only when trading |
| LLM too slow for live play | Ticks of 1–3 s, a per-action time limit, a decision model at about 0.3 s per pick; a missed action becomes a wait |
| Duel balance in two weeks | Ship Race first; Duel only as a stretch goal |
| Free PvP inference, up to about 1,200 calls if a match ran the full 10 minutes (at most 280 on v0 maps) | Matches end on a win; daily cap on free ranked matches; platform fees cover the rest |
| Stakes read as gambling | Ranked PvP is free; solo pools pay on skill-based scores with fixed entry fees; no betting; check paid-contest rules before mainnet |
| Decision model too shallow to follow skills | Planner LLM turns skills into a plan; Haiku can take over as actor behind the same interface |
| Decisions API still in beta; pricing and limits may change | Jev first; swap providers through the interface |
| Option order changes the decision model's pick | Engine always sends legal actions in a fixed, canonical order |

### Decisions, 25 Oct 2026
| Question | Decision |
| Agents per player | Option A: own several; each extra agent deployed costs more |
| Solo mode | Entry fees with a reward pool |
| Ranked PvP | Free |
| Duel goal | Set by each map |
| Match length | Capped at 10 minutes |
| Tag and rule list | Done: 10 tags, 6 rules (v0) |
| Name | Promptlings, tentative |

### Still open
- Who pays for inference? Proposed: credits topped up with crypto (see Credits and payments).
- Skill format and map JSON schema: draft a first version before 1 Nov.
- Actor model: Jev or the Decisions API, settled by the week-one benchmark (planner: Claude Haiku 5.5, proposed).
- Per-action time limit, in seconds, inside the 10-minute cap.
- Ranked PvP stays free of stakes, but a free ranked match every day costs more than the game earns (see Unit economics). Proposed: one short free match a day, then ranked matches cost credits.