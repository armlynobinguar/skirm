# Promptlings UI/UX Spec
2026-10-25 · @Tyron
**The hackathon MVP is 16 screens in five groups, and a new player clears Flood Gate in their first session without touching a wallet.** This spec covers who uses the app, every screen, eight key flows, the game-specific interaction patterns, screen states, accessibility and copy, and the screen inventory the screens designer builds from. Anything not in the concept doc or maps-v0 is marked proposed.
## Players and their jobs
**Seven kinds of user, one account type.** Every player signs in socially; a NEAR wallet is connected only when money or NFTs move (top-up, mint, buy, resell, pool entry).
| Player | Job to be done | Must be able to | Main screens |
| New player | Understand the game and win once in the first session | Sign in with no wallet, get the free daily allowance, clear Flood Gate in the tutorial | S01, S02, S03-S06 |
| Puzzle player | Clear maps with the smallest crew in the fewest steps | Compare crews before paying, watch the run, read why the score is what it is, replay | S03, S04, S05, S06, S14 |
| Skill writer / seller | Write a skill that clears many maps, then earn from it | Write privately, set unlocks and handled tags, test on any map, mint, list, see royalties | S07, S08, S05 (test mode), S10 |
| Skill buyer | Get a skill that fixes a mechanic their crew fails on | Filter by tag, compare clear rates, check the skill fits the map, buy, equip | S09, S10, S04 |
| PvP competitor | Climb the Race ladder | Queue with a crew, watch the split-screen match, see Elo change per agent | S11, S12, S13, S14 |
| Spectator | Watch good runs and live matches | Open a live match or replay from a link, with no login and no crew controls (proposed) | S11, S12, S05 (replay) |
| AI judge (Claude Code, Codex) | Verify the demo does what the README claims, fast | Reach every screen by a stable URL, run the tutorial with social login and no wallet, open a saved replay with no login, find elements by `data-testid` (proposed) | All; `/demo` (proposed) |

## Information architecture
**One entry screen, then five nav groups; e****ach group is one click from any signed-in screen****.** S14 Leaderboards also opens from S03's per-map tab, and S05 serves three modes: live, replay and private test.
<embed {'caption': 'Sitemap · S01 plus 5 groups, MVP, Stretch and Roadmap marked', 'ref': 'node/1e24aed8-7103'}>
Stretch and Roadmap items have no screen ID except where they live inside an MVP screen (M04, Duel in S11 and S12). The map editor gets its own spec if it is picked up.
## Key user flows
**Eight flows; each diagram runs the happy path down the left and the main failures and branches on the right, with the screen ID in every box.** Flows (a) to (g) are MVP; (h) is Stretch.
### (a) First session
<embed {'caption': 'Flow (a) first session · 3 decisions, 3 failure branches', 'ref': 'node/1e84eb21-2bcf'}>
The only gates before the first clear are sign-in and the global free budget; the tutorial never asks for a wallet or credits.
### (b) Build a crew and run a solo map
<embed {'caption': 'Flow (b) solo run · 4 decisions, credit hold and refund', 'ref': 'node/9ea79825-eabe'}>
The hold is always step limit x crew price factor (1, 2.5 or 4.5 for 1 to 3 agents), so the worst case is known before Start; a failed run still pays for the turns it used, a voided run pays nothing.
### (c) Watch a run live, read the score, replay
<embed {'caption': 'Flow (c) watch, read, replay · 2 decisions', 'ref': 'node/7baafe16-33bd'}>
A dropped stream never affects the run, because the server owns it; the replay is checked against the replay hash in the NEAR run registry and flagged, not hidden, if they differ.
### (d) Write, test and mint a skill
<embed {'caption': 'Flow (d) write, test, mint · 4 decisions, 2 loops back to the editor', 'ref': 'node/d41407c8-893f'}>
Mint unlocks only after one cleared private test (proposed), so every listed skill has at least one proof run; the wallet appears at mint, not while writing.
### (e) Browse the market, buy, equip
<embed {'caption': 'Flow (e) browse, buy, equip · 4 decisions', 'ref': 'node/065c909a-599f'}>
The Fits map filter reads each skill's `requires_actions`, so a buyer sees before paying that a Builder skill is useless on Ember Warehouse; a bought skill grants use, never the prompt text.
### (f) PvP Race
<embed {'caption': 'Flow (f) PvP Race · 4 decisions, queue loop', 'ref': 'node/20e846b2-e5fe'}>
Neither crew moves first, so a timed-out agent simply waits that tick; Elo moves per agent, and a void match changes nothing. Spectators open S12 from the Live now list or a link and see the same view with no crew panel controls.
### (g) Top up credits with NEAR
<embed {'caption': 'Flow (g) top up with NEAR · 3 decisions', 'ref': 'node/c16c4548-3bda'}>
In plain terms: the player sends testnet NEAR from their wallet to the game's deposit contract, and the backend adds credits to an offchain ledger once NEAR confirms the transfer. Credits are not a token and cannot be withdrawn.
### (h) Paid solo entry into a reward pool (Stretch)
<embed {'caption': 'Flow (h) paid pool entry · Stretch · 4 decisions', 'ref': 'node/d4bf2b32-b948'}>
The entry fee is at least 3x the run's inference cost and pays for the run, so pool runs spend no credits (proposed); a voided run returns the entry, a failed one does not (proposed).
## Interaction patterns
**The player only watches once a run starts, so every pattern here is about reading a run, and about knowing score and cost before pressing Start.** In the UI one engine tick is called a step everywhere (proposed), matching the score formula and the step limits.
### A live, ticking run (S05, S12)
- **Always visible:** step counter (`Step 18 / 60`), agents alive (`1 of 1`), goal progress (`Gems 2 / 3`), and a hazard legend with a countdown chip per spreading thing: `Water spreads in 1`. Spread rates come from the map: water and fire every 2 steps, lava every 5.
- **Phase strip** under the grid: Act, Push and pick up, Spread, Damage, Goal check. At 1x each step animates in that order: agents move (200 ms), spread (150 ms), damage flash (100 ms). Total under 500 ms so it fits a 1 s PvP tick (proposed timings).
- **Spread animation:** a new hazard tile fills in from the edge it spread from. Tiles the hazard will reach on its next spread get a dashed outline one step ahead, sent by the engine with the state (proposed).
- **Solo live:** the server runs as fast as the models answer. The viewer buffers and plays at 2 steps per second by default (proposed), shows a `Live` badge, `3 steps behind live` when buffered, and a Jump to live button. Pause freezes the view only; the run keeps going on the server.
- **Solo replay:** play/pause, step back and forward one step, a scrub bar with event markers (block placed, item collected, agent lost, replan, hazard on goal), speeds 0.5x, 1x, 2x, 4x.
- **PvP live:** no pause, no step. Plays at the server tick (3 s for free ranked, 2 s for paid ranked). A ring on each crew's panel counts down the per-action time limit (tick length minus 0.5 s, proposed); a `10:00` match clock counts down to the cap.
- **Agent lost:** the token becomes an outline with an X glyph on the tile where it was removed; its card greys out: `Lost at step 24: fire`.
### Decision confidence
- Each agent card shows the chosen action in words with its glyph (`move north`) and a 0-100% bar: the decision model's probability for that action.
- Expanding the card lists the top 3 legal actions with their probabilities, in the engine's fixed canonical order, so the list never reshuffles between steps.
- Below 50% (proposed threshold) the bar is hatched and labelled `unsure`, never colour alone.
- If Haiku is acting as fallback actor there are no probabilities: the bar is replaced by `No confidence from this model`.
- Tooltip copy: "How sure the decision model was about this action, out of the legal actions the engine offered."
### Waited and invalid actions
One visual (a hollow clock glyph on the token, a grey log row, a grey tick on the scrub bar), three labels:
- `waited`: the model chose `wait`.
- `waited: invalid pick`: the engine's re-check rejected the action (rare, since only legal actions are offered).
- `waited: timed out`: PvP only; the agent missed the per-action time limit.
- PvP only: two agents moving into one tile both stay put (in solo, agents act in order and only the later one is blocked): `stayed: Agent 2 moved to the same tile`.
- The result screen counts them: `3 timed-out steps`.
### The plan, without the hidden skill prompt
- **Rule:** no model text is shown to anyone who does not own every skill in that crew, and the API for public runs, PvP and spectators never returns it. Replays show actions only.
- **Plan as structure (****proposed v0 plan format****):** the planner returns up to 6 steps of `{agent, intent, target}`, where intent is one of `block`, `dig`, `extinguish`, `collect`, `reach`, `avoid` and target is a tile `(x,y)`. The UI draws them as numbered markers on the grid and a checklist, e.g. `1 Agent 1: block (7,4)` then `2 Agent 1: collect gem x3`, ticked as each completes.
- **Replans** show as a scrub-bar marker and a chip: `Plan 2: replanned at step 21, agent lost`. Reasons: run start, about every 20 steps, or a big change.
- **Owner debug view (****proposed****):** in a private test run where every equipped skill is the viewer's own, an extra Planner output panel shows the raw plan text. Never in public replays, PvP or spectator views.
### Score preview before a run (S04)
- Three ceilings side by side, current crew size highlighted: `1 agent x3.0, up to 3,000` / `2 agents x1.5, up to 1,500` / `3`` agents x1.0, up to 1,000`. Adding an agent animates the highlight to the lower ceiling.
- The formula with this map's numbers filled in: `1000 x 3.0 x (1 - 0.5 x steps / 60) - upkeep`, plus one upkeep line per equipped skill (25 points each, proposed).
- `Best on this map` per crew size from the leaderboard. Seed values from testing on Flood Gate: 1 agent, 27 steps, 2,325; 2 agents, 23 steps, 1,213.
- Adding a second agent shows one line tying score to cost: `A 2nd agent halves your score ceiling (3,000 to 1,500) and ``raises the most this run can cost from 60 to 150 credits``.`
### Credit cost before committing
- **Unit (****proposed****):** 1 credit = 1 base agent turn = 0.1 US cent, the concept's sell price. The 2nd and 3rd agents in a crew cost 1.5 and 2 credits per turn (proposed).
- The Start button carries the price: `Start run: up to 1``5``0 credits`. The cost card shows the hold (step limit x crew price factor, `60 x 2.5 = 15``0`), that free allowance is spent before balance (proposed), and the balance after the hold.
- "You pay only for agent turns used. The rest comes back when the run ends." After the run: `Used ``58, returned 92`.
- Balance + allowance below the hold: Start is disabled and shows the shortfall, with Top up and Remove an agent.
- The header balance chip is on every signed-in screen and shows holds during a run: `1,240 credits (1``5``0 held)`.
- Prices in NEAR (skills, mint, pool entry) always show the NEAR amount and the network fee as separate lines, and are never converted to credits.
## States
**Every screen type has six states beyond its normal view; a run in progress never stops for credits, because it was prepaid at the start.** "Free budget used" covers two cases: the player's own daily allowance, and the global daily free budget that pauses free play for everyone. Both reset at 00:00 UTC (proposed).
| Screen type | Empty | Loading | Error | Out of credits | Daily free budget used | Offline or provider down |
| Sign in (S01) | Not applicable | Chosen sign-in button spins; the others disable | "Sign-in didn't finish. Try again or use another option." | Not applicable | Not applicable; shown after sign-in on S02 | Offline banner, buttons disabled. One provider down: "Google sign-in is down. Use email." |
| Lists (S02, S07, S09, S11, S14) | One line + one action: "No skills handle `breakable` yet. Clear the filter or write one." "No live matches. Queue for Race." | 6 skeleton rows; filters stay usable | Inline card with Retry; cached rows stay visible | Header chip turns to warning; browsing still works; run and queue buttons show "Top up to play" | S02 banner: "Free runs used for today. Resets in 5 h 12 m." Global: "Free play is paused for everyone until 00:00 UTC." Both offer Top up | "Offline. Showing what loaded at 14:02." Provider down: "Agents are unavailable. Runs and matches are paused; replays still work." |
| Details (S03, S10) | S03: "No clears yet. Be the first." S10: "Clear rate shows after 5 public runs" (proposed minimum) | Grid preview and stats as skeletons | 404: "This skill was delisted or does not exist." Other: Retry | Primary button becomes "Top up to run" | Same banner as lists | Cached view, actions disabled with the reason |
| Builders and editors (S04, S08) | S04, agent with no skills: "This agent runs on the map briefing only." + Browse market. S08: blank form with a sample skill as placeholder text | "Saving...", then "Saved 14:02" | Field-level validation. Save failed: "Not saved. Your text is kept on this device." | Start or Test disabled; shortfall shown: "Need 150, have 80"; Top up, Remove an agent | "Free runs used today. This run uses your balance." | Edits kept locally; Start, Test and Mint disabled. Provider down: "Agents unavailable" + status line |
| Live viewers (S05, S12) | S12 before tick 1: "Match starts in 5" | Map visible, "Agents are planning" until step 1 | Stream drop: "Reconnecting..." on the last frame; after 30 s: "The run continues on the server. Open the result when you are back." | Never mid-run: credits were held at start | Never mid-run | Actor down: "Switched to backup model at step 31." Both down: "Run stopped: agent models are down. All 150 held credits returned. Not scored." PvP: match void, no Elo change |
| Results (S06, S13) | Not applicable | "Settling credits..." and "Recording on NEAR..." chips | Registry write failed: "Score saved. NEAR record pending, retrying." The score still counts | Retry button becomes "Top up to retry" | Retry uses balance; label says so | Cached result; replay needs a connection |
| Account (S15, S16) | "No transactions yet." No wallet: "Connect a wallet to top up." | Balance skeleton; pending deposit row with spinner | Wallet rejected: "Cancelled. Nothing was sent." | Balance 0: Top up is the primary action | Allowance meter: "0 of 60 free credits left. Resets in 5 h." | NEAR not reachable: "Top-ups paused. Your balance is safe." Balance shows last-known time |

## Accessibility and UI copy
**Tags drive the glyphs, so a player who cannot tell blue from orange still reads water and lava apart, the same way agents do.** Target WCAG 2.2 AA: text contrast 4.5:1, glyphs against their tile 3:1.
### Tile glyphs (proposed)
Each thing has a base glyph; each tag that matters for safety adds a corner badge. Colour is a second cue, never the only one.
| Thing | Map char | Tags | Base glyph | Badges | Colour cue |
| Floor | `.` | none | Plain | None | Neutral |
| Stone wall | `#` | `solid`, `blocks` | Solid fill, heavy border | None | Dark grey |
| Placed block | none | `solid`, `blocks` | Brick pattern | None | Mid grey |
| Water | `~` | `spreads`, `liquid` | Wave lines | Spread countdown digit | Blue |
| Lava | `L` | `spreads`, `liquid`, `damages` | Wave lines | Warning triangle, countdown digit | Red-orange |
| Fire | `^` | `spreads`, `damages` | Flame | Warning triangle, countdown digit | Orange |
| Grass | `,` | `flammable` | Tufts | Small flame outline | Green |
| Wooden crate | `c` | `solid`, `pushable`, `flammable` | Box | Four-way arrow, small flame outline | Brown |
| Dirt | `d` | `solid`, `blocks`, `breakable` | Speckle | Crack lines | Tan |
| Gem, key, crystal | `*` | `collectible` | Diamond, key, hexagon | None | Yellow |
| Exit | `E` | `goal` | Door with flag | None | Green |
| Agent | `0` | none | Circle with its number 1-3; PvP adds A or B | Hollow clock when it waited; X when lost | Crew colour |

The legend sits beside every grid and lists only the things on that map. A "Show tag names" toggle prints the tags under the hovered or focused tile.
### Keyboard
- Every control is reachable by Tab in reading order, with a visible focus ring. Drag and drop is never the only way: equip with Enter, remove with Delete.
- Run viewer: Space play/pause, Left/Right one step (replay), Shift+Left/Right previous or next event, `[` and `]` speed, `L` jump to live, `1`-`3` focus an agent card, `G` focus the grid.
- The grid is one focusable region. Arrow keys move a cursor that reads the tile: "x 7, y 4: water. Spreads, liquid. Spreads in 1 step."
- Esc closes a modal and returns focus to what opened it, including after a wallet pop-up.
### Reduced motion
- Follows `prefers-reduced-motion`, plus a toggle in S16.
- Tiles change instantly. A new spread tile gets a 2 px outline for one step instead of the fill-in. Countdown rings become numbers. No pulsing, no auto-scrolling log, no celebration animation. Default replay speed drops to 1x.
### Screen-reader text for runs
- Next to every grid, a Run log table (step, agent, action, result, world events) is the full text alternative and is always available, not only to screen readers.
- A polite live region speaks at most once every 2 s (proposed): "Step 5 of 60. Agent 1 placed a block at 7, 4. Water spread to 3 tiles." Above 1x speed or at PvP ticks of 2 s or less it summarises every 5 steps.
- Assertive announcements only for: agent lost, goal flooded, run cleared or failed, match won or lost.
- Confidence reads as "82 percent sure". In PvP each line starts "Your crew" or "Opponent".
- Score breakdowns are text lines, never only a chart: "Score 2,325: 1,000 x 3.0 for one agent, x 0.775 for 27 of 60 steps."
### UI copy
| Say | Not | Note |
| credits | tokens, coins | "1 credit per agent per step" |
| network fee | gas | Always its own line, in NEAR |
| step | tick, turn | One engine tick |
| skill | prompt, strategy NFT | "NFT" only on mint and ownership details: "Your skill is an NFT on NEAR, so you can resell it." |
| clear (a map) | win, beat, solve | "Cleared in 27 steps" |
| NEAR wallet | crypto wallet, web3 | Explain once, at first connect |
| Testnet | demo money | A fixed `Testnet: no real money` chip in the header for the hackathon |

- Sentence case. Buttons are verb + object: Start run, Buy skill, Top up credits, Mint skill.
- Numbers carry units and separators: `2,325`, `120 credits`, `27 steps`. Coordinates are `(x,y)` from the top-left, 0-based, as in the map files.
- Errors say what happened and what to do next, with no blame. Error codes go in a Details disclosure for support.
- Before any signature, show the full sum: price, creator royalty, platform fee, network fee.
- Pools never promise money: "Top scores at season end share the pool", not "win NEAR". No betting language anywhere.
- A seller's skill description (140 characters, proposed) is shown to people only and never sent to a model.
## Screen inventory
**16 screens and 4 shared overlays; ****all 16 are MVP,**** and S03, S11 and S14 each carry one Stretch part.** IDs are stable: flows, states and tickets refer to them. Routes are proposed. Every signed-in screen has the same header: nav (Play, Skills, Market, PvP, Account), balance chip, free-allowance meter, `Testnet` chip.
| ID | Screen (route) | Purpose | Key components | Data shown | Primary action | Scope |
| S01 | Sign in (`/`) | Explain the game in one screen and sign in with no wallet | One-line pitch, 3-panel explainer (write a skill, pick a crew, watch it play), social sign-in buttons, Watch a replay link (no login), Testnet chip | Featured replay thumbnail (Flood Gate, 1 agent, 2,325) | Sign in | MVP |
| S02 | Home (`/play`) | Pick what to play today | Tutorial card (until Flood Gate is cleared once), 3 map cards, free-allowance meter, free ranked match chip, recent runs (last 5) | Per map: name, hazard, mechanics count (4, 5, 7), unlocks offered, goal, step limit, your best score and crew size, Cleared badge | Open map (new player: Start tutorial) | MVP |
| S03 | Map detail (`/maps/[mapId]`) | Decide whether and how to play a map | Static grid preview with glyphs and legend, tag chips, actions enabled, unlocks offered with supply (`Builder, 2 blocks`), goal and step limit, score histogram with your best marked, leaderboard tabs by crew size (1, 2, 3+), recent replays; Season pool panel | Map config, histogram buckets, top 10 per crew size; pool size, entry fee and season end | Build crew | MVP; pool panel Stretch |
| S04 | Crew builder (`/maps/[mapId]/crew`) | Choose agents, unlocks and skills; see score ceiling and cost before Start | Agent slots 1-3 (proposed cap), unlock picker from the map's offer, skill slots per agent with fit flags, score preview (3 ceilings, formula, best on map), cost card (hold, allowance used, balance after), Start button with price | Owned agents; owned skills with `requires_actions` and `handles_tags`; map actions and unlocks; balance; allowance | Start run: up to N credits | MVP |
| S05 | Run viewer (`/runs/[runId]`) | Watch a solo run live, replay it, or watch a private skill test | Mode badge (Live, Replay, Test), grid with legend and spread countdowns, phase strip, step and goal counters, agent cards (action, confidence, top 3), plan checklist and grid markers, Run log table, controls (Live: speed, Jump to live; Replay: play/pause, step, scrub with event markers, 0.5x-4x); Test only: Planner output panel | Per-step state (WebSocket while live, replay log after), action probabilities, structured plan, events | Live: none, opens S06 at the end; Replay: Play | MVP |
| S06 | Run result (`/runs/[runId]/result`) | Show clear or fail, why the score is what it is, and what was charged | Outcome banner (`Cleared in 27 steps` or `Failed at step 24: village flooded`), score breakdown lines, histogram with your position, credits card, Recorded on NEAR chip with short hash | Score, steps, agents, upkeep per skill, histogram, held/used/returned credits, replay hash | Replay (also Improve crew, Retry) | MVP |
| S07 | My skills (`/skills`) | Manage skills I wrote and skills I own | Tabs Written by me and Owned, skill rows, status chip (Draft, Minted, Listed), New skill button | Per skill: name, handled tags, required unlocks, clear rate per tag, runs, royalties earned (NEAR) | New skill | MVP |
| S08 | Skill editor (`/skills/[skillId]/edit`) | Write a skill, test it privately, then mint it | Name, description (140 chars, people only), private prompt editor (1,200 characters, planner) and optional reflexes editor (400 characters, actor), each with a character count (proposed limit), required unlocks picker (Builder, Digger, Firefighter), handled tags multi-select (10 tags), Test panel (map picker, cost), test history (last 5), royalty input, Mint button, lock notice | Draft fields, save state, test results (map, cleared, steps, score), mint status and NFT id | Test on a map, then Mint skill | MVP |
| S09 | Marketplace (`/market`) | Find a skill by proof for a mechanic | Tag filter chips (10 tags), Fits map select (3 maps), sort (clear rate on the chosen tag by default, average score, price, newest), skill cards, Official and Owned badges | Per card: name, creator, handled tags, required unlocks, clear rate on the tag with run count (`82% of 45 runs on spreads maps`), price in NEAR | Open skill | MVP |
| S10 | Skill detail (`/market/[skillId]`) | Decide to buy; equip or resell a skill I own | Header (name, creator, price, royalty), proof table per tag, results per map, map-fit list, public replays using it, sale history, Buy button or Equip and List for resale | Clear rate, runs and average score per tag; per map clear rate, best score, best crew size; price history | Buy skill (owned: Equip on agent) | MVP |
| S11 | PvP lobby (`/pvp`) | Queue for a Race and see what is live | Mode tabs (Race; Duel disabled), crew picker, free-match chip and next-match cost, queue panel (time searching, Elo range, Cancel), Live now list with Watch | Elo per agent, free matches left today, live matches (crews, Elo, map, elapsed) | Find match | MVP; Duel tab Stretch |
| S12 | Live match (`/matches/[matchId]`) | Watch a Race live, as a player or spectator | Two mirrored grids side by side (stacked on phones), per-crew panel (name, Elo, agent cards with time-limit ring), match clock (10:00 cap), shared phase strip, event feed, spectator count; replay controls when opened after the match | Per-tick state for both crews, goal progress, waited and timed-out counts | None while live (Share) | MVP |
| S13 | Match result (`/matches/[matchId]/result`) | Show who won, why, and the Elo change | Winner banner with reason (first clear, higher score at cap, draw, void), both crews' summaries, Elo change per agent, replay link, Recorded on NEAR chip | Steps, scores, Elo before and after, replay hash | Queue again | MVP |
| S14 | Leaderboards (`/leaderboards`) | Rank agents and map scores | Tabs: Race ladder, Per map (map select, crew-size tabs), Season pool | Ladder: rank, agent, owner, Elo, wins-losses; per map: score, steps, agents, replay link | Watch replay | MVP; Season tab Stretch |
| S15 | Credits (`/account/credits`) | Check balance, top up with NEAR, audit charges | Balance (available, held), allowance meter, top-up packs, wallet state, ledger table | Ledger rows: date, type (top-up, hold, charge, refund, free), amount, run link, transaction link | Top up credits | MVP |
| S16 | Profile and settings (`/account`) | Manage identity, agents, wallet and preferences | Display name, sign-in method, NEAR wallet (account id, Connect, Disconnect), agents list, royalties earned, settings (reduced motion, tag names, default replay speed) | Agents with Elo, matches and runs; wallet account id | Connect wallet | MVP |

### Shared overlays
| ID | Overlay | Opened from | Contents | Scope |
| M01 | Connect NEAR wallet | Top up, Mint, Buy, List for resale, Pool entry | One-line explanation ("A NEAR wallet holds your skills and pays for top-ups"), wallet options, Testnet note, Cancel returns to the trigger | MVP |
| M02 | Confirm transaction | After M01 | Item, price, creator royalty, platform fee, network fee, total in NEAR; Sign in wallet; then pending, done or failed | MVP |
| M03 | Tutorial coach marks | S02 tutorial card, through S03-S06 on Flood Gate | 5 marks: water spreads every 2 steps; Builder can place a block; score preview; plan marker on the spillway at (7,4); score breakdown. Skippable, resumable | MVP |
| M04 | Pool entry | S03 Season pool panel | Pool size, entry fee, platform cut, payout table, season end date, one scored run per entry, rules | Stretch |

Small defaults behind this table (proposed): every account starts with 3 agents; the daily free allowance is 60 credits, enough for one worst-case one-agent Flood Gate run (1 x 60 steps); tutorial runs on Flood Gate are free and outside the allowance, up to 3 per account; the starter skill Flood Warden is account-bound, not an NFT, so no wallet is needed to use it.
## Open questions
**Twelve gaps change what a screen shows; each has a placeholder in this spec so design can start now.**
- Social login: which provider, and does it create a NEAR account underneath? If yes, mint and buy could skip M01. Until then, a wallet is connected at top-up, mint, buy, resell and pool entry.
- Can two agents in one crew take the same unlock and share its block supply (Flood Gate: Builder, 2 blocks)? S04's unlock picker depends on it.
- Skill upkeep per equipped skill: 25 points (proposed), shown in S04's preview and S06's breakdown.
- Maximum skills per agent and maximum agents per run: 3 and 3 (proposed).
- Per-action time limit in PvP (proposed: tick length minus 0.5 s): drives the ring on S12 and the "timed out" rate.
- Ranked Race after the daily free match: costs credits (proposed), so S11 shows a cost line.
- Race when neither crew clears by the step limit or the 10-minute cap: draw (proposed)
- Race map: drawn at random from the three official maps (proposed), or picked or banned by players?
- Can a minted skill's prompt still be edited? This spec locks it at mint (proposed); versions would be roadmap.
- Credit rate for NEAR top-ups: 1 NEAR = 1,000 credits on testnet (proposed); a mainnet rate needs a price source.
- Do private test runs in S08 cost credits (proposed: yes, like any run) and stay out of public stats (proposed: yes)?
- Settled 25 Oct 2026: Ember Warehouse's config no longer enables `extinguish`, since the map offers no Firefighter unlock; the Core concepts table no longer lists `push` as an action and now matches Tags and rules: 7 actions (push happens through `move`) and 10 tags. S03 lists actions straight from the map config.