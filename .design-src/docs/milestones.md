# Promptlings Milestones
2026-10-25 · @Tyron
**Seven milestones take Promptlings from prep to a submitted entry: code starts 1 Nov 00:00 UTC (08:00 Manila) and the entry goes in by 14 Nov 23:59 UTC (07:59 on Sun 15 Nov in Manila).** Target submission is 14 Nov 12:00 UTC (20:00 Manila), leaving 12 hours of buffer (proposed).
## Plan and critical path
**Week one proves the game works without a browser; week two puts it in a browser, onchain and live.** Person 1 builds the TypeScript engine from the v0 rules, matches the Python simulator's results on all three maps by 5 Nov, then puts LLM agents behind the `DecisionEngine` interface and settles the actor model with the benchmark by 6 Nov. Person 2 builds the NEAR contracts and the credits ledger in parallel (testnet by 8 Nov) and the web app against the engine's state JSON from day 2. The two tracks join at M4 on 11 Nov, when a new player can go from login to buying a skill on staging. Race mode, the README for the AI judges and the demo video fill 12–13 Nov, and 14 Nov is for submitting only.
**Critical path** (a slip here moves the end date; everything else has slack):
1. Map JSON schema and skill format, proposed v0 (M0, 31 Oct)
2. Engine clears Flood Gate headless with scripted agents (M1, 3 Nov)
3. LLM agents clear Flood Gate; actor model chosen (M2, 6 Nov)
4. Run orchestrator charges credits per turn and streams the run (7–8 Nov)
5. Web app end to end on staging (M4, 11 Nov)
6. README, one-command local run and demo video (M5, 13 Nov)
7. Repo public, X post up, submission sent (M6, 14 Nov)
The contracts (M3) and Race mode run beside this chain. Contracts have about 3 days of slack before M4 needs a testnet purchase. Race has none left after 13 Nov, so it is the first thing cut to recorded replays.
## Milestones
**Each milestone is done only when every exit check below passes; a milestone that is half done counts as missed and triggers the cut list.**
### M0 · Prep complete
Due 2026-10-31 · Owner: Both
- Map JSON schema and skill format written as proposed v0 and agreed by both; the three maps from maps-v0.md written out in that schema as design data.
- API keys work for Jev (TypeSafe or OpenRouter), the Decisions API beta and Claude; one call to each timed from Manila, median and p95 written down.
- Proposed tick length and per-action time limit written down from those timings.
- NEAR testnet accounts exist for the platform and both developers; a sample NFT minted from a throwaway repo; NEP-171 or NEP-245 chosen.
- GCP or AWS chosen, project created with a billing alert; a spend cap set on every model API key.
- Repo layout and the engine-to-web-app state JSON agreed on paper.
**Unblocks:** coding from 1 Nov 00:00 UTC with no design question left open.
### M1 · Engine runs Flood Gate headless
Due 2026-11-03 · Owner: Person 1
- A test loads Flood Gate from map JSON and runs scripted agents with these results, the same as the Python simulator:
  - one Builder agent on the winning line clears in 27 steps, score 2,325
  - a Builder plus a plain collector clear in 23 steps, score 1,213
  - doing nothing fails; an agent without the Builder unlock fails
- 10 repeated runs of the same input give the same replay log and the same replay hash.
- The engine emits the state JSON the web app renders, one frame per tick.
**Unblocks:** the decision engine (Person 1); map view and replay viewer on real state (Person 2).
### M2 · LLM agents clear a map; actor model chosen
Due 2026-11-06 · Owner: Person 1
- Haiku 5.5 planner plus Jev actor, behind `DecisionEngine`, with one starter skill, clears Flood Gate with one agent in at least 7 of 10 runs (threshold proposed).
- Ember Warehouse (29 steps, 2,130) and Magma Mine (57 steps, 1,779) match the Python simulator with scripted agents.
- Benchmark done: Jev, Decisions API and Haiku as actor, on the three maps, 10 runs each (proposed): clear rate, median and p95 latency per pick, tokens per turn, cost per run. The actor choice is written in the benchmark result.
- Tick length and per-action time limit fixed from the measured p95.
**Unblocks:** real runs in the run orchestrator, checking credit prices against measured cost, the Race tick clock.
### M3 · Contracts on testnet and credits ledger
Due 2026-11-08 · Owner: Person 2
- Skill NFT contract on testnet mints a skill with a creator royalty.
- Marketplace contract lists, buys and resells from the NEAR CLI; after a resale, account balances show the royalty paid to the creator and the platform fee to the platform.
- Run and match registry stores score, agents used and replay hash, and a match result with Elo.
- A testnet NEAR deposit to the platform account turns into credits in the ledger.
- Credits ledger handles balance, top-up, a hold of step limit × crew price factor (1, 2.5 or 4.5 for 1 to 3 agents) before a run, a per-turn charge, refund of unused credits and the daily free allowance, each with a unit test.
**Unblocks:** the buy and top-up flows in the web app; the backend writing run results onchain.
### M4 · Playable end to end
Due 2026-11-11 · Owner: Person 2, with Person 1 on backend APIs
- On the staging URL a brand-new account can: sign in socially, see the free allowance, build a crew (agents, skills, unlocks), start a solo run on Flood Gate, watch it live, see the score and where it sits among other scores, open the replay, buy a skill on the testnet marketplace, and find the run's result and replay hash in the registry.
- All three maps are playable; a run the balance cannot cover is refused before it starts.
**Unblocks:** the demo recording, Race on top of the same views, the README's steps.
### M5 · Race, polish and README; feature freeze
Due 2026-11-13 · Owner: Both
- Two browsers join a Race on mirrored Flood Gate; the split screen updates every tick over WebSockets; the match ends on a clear, at the map's step limit or at 10 minutes; result and Elo land in the registry.
- README states what Promptlings is, the problem it solves, and "do X, see Y" steps against staging; the one-command local run works from a fresh clone on the other person's machine.
- Demo video recorded, 2–3 minutes (proposed).
- Feature freeze at end of day: bug fixes only after this.
**Unblocks:** submission.
### M6 · Submitted
Due 2026-11-14 · Owner: Both
- Every item in the Submission checklist below is ticked, and the submission is sent once, by 12:00 UTC (20:00 Manila) as the target and 23:59 UTC at the latest.
**Unblocks:** judging, 16–18 Nov.
## Schedule
<embed {'caption': 'Promptlings schedule · Person 1, Person 2 and shared lanes, M0 to M6', 'ref': 'node/7d777ea1-c641'}>
Person 1 front-loads the engine and agents in week one; Person 2's contracts and web app run across both weeks and meet Person 1's run loop at M4 on 11 Nov, leaving one day of buffer before the 14 Nov close.
## Day by day, 1–14 Nov
**46 tasks over 14 days, about 1–2 a day per person; a row marked with a milestone must be Done that day.** Pick a Status as you go. Systems are named as in the concept's System index.
| Date | Owner | Task | System | Status |
| Sun 1 Nov | Both | Create the monorepo (NestJS api, Next.js web, engine package, contracts), CI, Docker Compose; deploy a hello-world to staging | Hosting and data | [{'id': '.6634', 'enum': '560e776b-4562', 'index': '0'}] |
| Sun 1 Nov | Person 1 | Tag, rule and action definitions v0 as versioned data | Mechanics library | [{'id': '.6733', 'enum': '560e776b-4562', 'index': '0'}] |
| Sun 1 Nov | Person 2 | Skill NFT contract scaffold with creator royalty, unit tests | Skill NFT contract | [{'id': '.6840', 'enum': '560e776b-4562', 'index': '0'}] |
| Mon 2 Nov | Person 1 | Grid, fixed tick order, Spread, Block, Damage, Push, Collect and Goal rules | Simulation engine | [{'id': '.6961', 'enum': '560e776b-4562', 'index': '0'}] |
| Mon 2 Nov | Person 1 | Load and validate map JSON (size and hazard caps); write the three maps | Map format and validator | [{'id': '.7085', 'enum': '560e776b-4562', 'index': '0'}] |
| Mon 2 Nov | Person 2 | Next.js shell; map view drawing a state JSON frame of Flood Gate | Web app | [{'id': '.7185', 'enum': '560e776b-4562', 'index': '0'}] |
| Mon 2 Nov | Person 2 | Social login wired to the backend | Login and wallets | [{'id': '.7264', 'enum': '560e776b-4562', 'index': '0'}] |
| Tue 3 Nov · M1 | Person 1 | Scripted-agent runner; Flood Gate checks (27 steps 2,325; 23 steps 1,213; do-nothing fails) | Simulator and map tests | [{'id': '.7412', 'enum': '560e776b-4562', 'index': '0'}] |
| Tue 3 Nov · M1 | Person 1 | Action log per run, replay from the log, stable log hash | Replay log | [{'id': '.7512', 'enum': '560e776b-4562', 'index': '0'}] |
| Tue 3 Nov · M1 | Person 2 | List, buy, resell; royalty and platform fee payouts | Marketplace contract | [{'id': '.7617', 'enum': '560e776b-4562', 'index': '0'}] |
| Wed 4 Nov | Person 1 | DecisionEngine interface, legal action list in canonical order, Haiku planner, Jev actor | Agent decision engine | [{'id': '.7755', 'enum': '560e776b-4562', 'index': '0'}] |
| Wed 4 Nov | Person 1 | Provider clients for Jev, Decisions API and Haiku with token and output caps | LLM providers | [{'id': '.7873', 'enum': '560e776b-4562', 'index': '0'}] |
| Wed 4 Nov | Person 2 | Registry for run results, agents used, replay hash, match result and Elo | Run and match registry | [{'id': '.7996', 'enum': '560e776b-4562', 'index': '0'}] |
| Wed 4 Nov | Person 2 | Replay viewer playing a log from the engine | Web app | [{'id': '.8075', 'enum': '560e776b-4562', 'index': '0'}] |
| Thu 5 Nov | Person 1 | Ember Warehouse and Magma Mine checks against the Python simulator | Simulator and map tests | [{'id': '.8193', 'enum': '560e776b-4562', 'index': '0'}] |
| Thu 5 Nov | Person 1 | Encrypted skill storage, server-side injection, starter skills | Skill vault | [{'id': '.8295', 'enum': '560e776b-4562', 'index': '0'}] |
| Thu 5 Nov | Person 2 | Testnet NEAR deposit to platform account detected by the backend | Deposit handling | [{'id': '.8404', 'enum': '560e776b-4562', 'index': '0'}] |
| Thu 5 Nov | Person 2 | Ledger: balance, top-up, hold, per-turn charge, refund | Credits ledger | [{'id': '.8501', 'enum': '560e776b-4562', 'index': '0'}] |
| Fri 6 Nov · M2 | Person 1 | Benchmark Jev, Decisions API and Haiku on three maps; pick the actor; fix tick length and time limit | Provider benchmark | [{'id': '.8653', 'enum': '560e776b-4562', 'index': '0'}] |
| Fri 6 Nov · M2 | Person 1 | Score formula and per-map score spread | Scoring and leaderboards | [{'id': '.8749', 'enum': '560e776b-4562', 'index': '0'}] |
| Fri 6 Nov · M2 | Person 2 | Daily free allowance; refuse runs the balance cannot cover | Credits ledger | [{'id': '.8855', 'enum': '560e776b-4562', 'index': '0'}] |
| Fri 6 Nov · M2 | Both | Provider spend caps, per-player rate limits, global daily free budget | Cost guardrails | [{'id': '.8969', 'enum': '560e776b-4562', 'index': '0'}] |
| Sat 7 Nov | Person 1 | Run queue and turn loop that checks, charges and refunds credits | Run orchestrator | [{'id': '.9078', 'enum': '560e776b-4562', 'index': '0'}] |
| Sat 7 Nov | Person 1 | Simultaneous-move mode for two crews (two agents into one tile both stay put) | Simulation engine | [{'id': '.9201', 'enum': '560e776b-4562', 'index': '0'}] |
| Sat 7 Nov | Person 2 | Deploy all contracts to testnet; CLI run of mint, list, buy, resell | Marketplace contract | [{'id': '.9317', 'enum': '560e776b-4562', 'index': '0'}] |
| Sat 7 Nov | Person 2 | Crew builder: pick agents, equip skills and unlocks | Web app | [{'id': '.9404', 'enum': '560e776b-4562', 'index': '0'}] |
| Sun 8 Nov · M3 | Person 1 | Live solo run stream over WebSockets | Run orchestrator | [{'id': '.9490', 'enum': '560e776b-4562', 'index': '0'}] |
| Sun 8 Nov · M3 | Person 1 | Tokens, cost and latency per turn logged; cost alert | Observability | [{'id': '.9589', 'enum': '560e776b-4562', 'index': '0'}] |
| Sun 8 Nov · M3 | Person 2 | Backend writes each run's result and replay hash to the registry | Run and match registry | [{'id': '.9709', 'enum': '560e776b-4562', 'index': '0'}] |
| Sun 8 Nov · M3 | Person 2 | Skill editor: prompt, tags, required actions, test on a map, mint | Skill editor | [{'id': '.9820', 'enum': '560e776b-4562', 'index': '0'}] |
| Mon 9 Nov | Person 1 | Clear rate per skill per tag; leaderboard API | Scoring and leaderboards | [{'id': '.9918', 'enum': '560e776b-4562', 'index': '0'}] |
| Mon 9 Nov | Person 1 | Match server: pair two players, tick clock, 10-minute cap, missed action becomes wait | PvP match server | [{'id': '.10048', 'enum': '560e776b-4562', 'index': '0'}] |
| Mon 9 Nov | Person 2 | Browse skills by clear rate per tag, buy, resell | Marketplace UI | [{'id': '.10139', 'enum': '560e776b-4562', 'index': '0'}] |
| Mon 9 Nov | Person 2 | Wallet connect for trading only | Login and wallets | [{'id': '.10216', 'enum': '560e776b-4562', 'index': '0'}] |
| Tue 10 Nov | Person 1 | Match result and Elo sent to the registry | PvP match server | [{'id': '.10303', 'enum': '560e776b-4562', 'index': '0'}] |
| Tue 10 Nov | Person 2 | Live run view, score screen with score spread, top-up screen | Web app | [{'id': '.10400', 'enum': '560e776b-4562', 'index': '0'}] |
| Tue 10 Nov | Both | Seed the marketplace with official starter skills on testnet | Marketplace contract | [{'id': '.10506', 'enum': '560e776b-4562', 'index': '0'}] |
| Wed 11 Nov · M4 | Both | End-to-end pass on staging with a new account; fix blockers | Web app | [{'id': '.10603', 'enum': '560e776b-4562', 'index': '0'}] |
| Wed 11 Nov · M4 | Person 1 | Tune starter skills until each map clears with one agent | Skill vault | [{'id': '.10705', 'enum': '560e776b-4562', 'index': '0'}] |
| Wed 11 Nov · M4 | Person 2 | Leaderboard page | Web app | [{'id': '.10763', 'enum': '560e776b-4562', 'index': '0'}] |
| Thu 12 Nov | Person 1 | Race on mirrored maps end to end with Person 2 | PvP match server | [{'id': '.10855', 'enum': '560e776b-4562', 'index': '0'}] |
| Thu 12 Nov | Person 2 | Race split-screen live view | Web app | [{'id': '.10919', 'enum': '560e776b-4562', 'index': '0'}] |
| Thu 12 Nov | Both | Draft README for the AI judges; one-command local run | Hosting and data | [{'id': '.11014', 'enum': '560e776b-4562', 'index': '0'}] |
| Fri 13 Nov · M5 | Both | Bug bash; README verified from a fresh clone; feature freeze at end of day | Hosting and data | [{'id': '.11135', 'enum': '560e776b-4562', 'index': '0'}] |
| Fri 13 Nov · M5 | Both | Record the 2–3 minute demo video | Submission (no system) | [{'id': '.11220', 'enum': '560e776b-4562', 'index': '0'}] |
| Sat 14 Nov · M6 | Both | Repo public, X post up, submission sent by 12:00 UTC (20:00 Manila) | Submission (no system) | [{'id': '.11340', 'enum': '560e776b-4562', 'index': '0'}] |

## Prep checklist, 25–31 Oct
**Prep is design, accounts, access and throwaway spikes; no project code before 1 Nov 00:00 UTC (08:00 Manila).** HACKATHON.md does not mention code written before the start, so this team rule is the safe reading: spikes live in throwaway repos and nothing from them is copied into the project repo.
From the concept's Before 1 Nov list:
- Option A chosen: players own several agents
- Tag and rule list written: 10 tags, 6 rules, 7 actions (v0)
- Title: Promptlings for now
- Three maps designed and each cleared by one agent in the Python simulator (maps-v0.md)
- Skill format and map JSON schema written as proposed v0 and agreed (Person 1 drafts the map schema, Person 2 the skill format; by Wed 28 Oct)
- Read the NEP-171, NEP-245 and NEAR AI Cloud docs; pick NEP-171 or NEP-245 for skills (Person 2, by Wed 28 Oct)
- List the goal types a Duel map can choose from: capture the flag, most resources, first to the exit (Both, 15 minutes; Duel stays stretch)
- Draft the tick length and per-action time limit for 10-minute matches, then test model latency against them (Person 1, by Fri 30 Oct)
- Get API access for Jev (TypeSafe or OpenRouter), the Decisions API beta and Claude, and time calls from the Philippines (Person 1, by Tue 27 Oct)
Added for the schedule:
- Create NEAR testnet accounts for the platform and both developers; install the NEAR CLI; mint a sample NFT from a throwaway repo (Person 2)
- Pick the social login provider and confirm it can create or link a NEAR account (Person 2)
- Spike in a throwaway repo: one Jev call that returns a choice and probabilities from a fixed list of legal actions (Person 1)
- Read engine_sim.py end to end and list what the TypeScript engine needs; record the expected steps and scores per map as test targets (Person 1)
- Pick GCP or AWS; create the project with a billing alert; pick the database, job queue and replay storage (Both)
- Set a monthly spend cap on every model API key (Both)
- Agree the repo layout and the state JSON the engine sends the web app, on paper (Both)
- Wireframe six screens: login, crew builder, live run, score, replay, marketplace (Person 2)
- Re-read the live HACKATHON.md for rule changes (Both, 31 Oct)
- Set a daily 15-minute sync, proposed 09:00 Manila (Both)
## Cut list
**Never start a stretch item, and cut from the top of the list when a milestone misses its day.** Duel, solo reward pools and the map editor with clear-check are already stretch: none of them starts before M5 is done. The order below protects the judged loop (map, crew, run, score, skill trade) and drops spectacle first.
| If this slips | Cut, in this order | What still ships |
| M1 engine (3 Nov) | 1. Magma Mine (7 mechanics, the hardest map) to post-MVP  2. Person 2 builds the map view from hand-written state JSON instead of waiting | Flood Gate and Ember Warehouse, scripted runs |
| M2 agents (6 Nov) | 1. Decisions API from the benchmark (Jev against Haiku only)  2. Jev: Haiku plays every move behind the same interface ($0.000155 a turn instead of about $0.0001)  3. Fewer benchmark runs per map | LLM runs on every map that M1 delivered |
| M3 contracts (8 Nov) | 1. Marketplace UI becomes a simple list with a Buy button  2. Resell: buy only, resale shown from the CLI  3. Match results and Elo in the registry: run results only  4. Onchain top-up: credits come from the free allowance, deposit shown from the CLI | Skill NFT with royalty, one purchase, run registry with replay hash |
| M4 end to end (11 Nov) | 1. Live PvP becomes recorded Race replays shown side by side  2. Skill editor minting: official starter skills only, editor saves offchain  3. Wallet connect: trading done for the player by the backend on testnet (proposed)  4. Leaderboard page: score spread on the score screen only | Login, crew, solo run, score, replay, buy a skill |
| M5 Race and README (13 Nov) | 1. Race entirely; mention it in the README as next  2. Video polish: a screen recording with captions is enough | README, one-command run, demo video |

## Schedule risks
**The two risks most likely to move the end date are LLM agents that cannot follow skills (M2) and NEAR contracts taking longer than planned for a first-time blockchain builder (M3).** Check the early-warning signs at the daily sync.
| Risk | Early-warning sign | Fallback |
| LLM agents cannot clear maps reliably | Fewer than 5 of 10 Flood Gate clears by end of Thu 5 Nov | Haiku as actor through the same interface; a more explicit starter skill; demo on the maps that clear |
| Engine port runs long | No Flood Gate parity with the Python simulator by end of Tue 3 Nov | Cut Magma Mine; Person 2 keeps building on hand-written state JSON |
| NEAR contracts take longer than planned | No testnet mint by end of Thu 5 Nov | Start from a standard NEP-171 implementation instead of custom code; apply the M3 cuts |
| Model latency too high for live ticks | Benchmark p95 per pick above the draft per-action limit, or calls from Manila far slower than published figures | 3-second ticks (already planned for free matches); host the backend in the region nearest the providers (proposed) |
| API access or quota blocks work | Any provider key not working by Tue 27 Oct; rate-limit errors in the benchmark | Haiku for both roles; the Decisions API is already the backup, not the plan |
| Integration crunch at M4 | Any step of the end-to-end path not demoable on staging by end of Tue 10 Nov | Freeze new systems on 10 Nov; apply the M4 cuts |
| Social login does not fit NEAR accounts | Login cannot create or link a testnet account by Mon 2 Nov | The backend holds a testnet account per player for the demo (proposed); wallet connect only for trading |
| Test runs burn the API budget | Daily spend above the cap set in prep | Scripted agents for every test that does not need a model; cap runs per day |
| One person blocked or ill | A milestone task a day late at the sync | The other picks it up from the day table; cut from the list |
| Late submission across time zones | Anything on the submission checklist open on the morning of Sat 14 Nov Manila time | Submission target is 12:00 UTC (20:00 Manila), 12 hours before the 23:59 UTC close (07:59 Sun Manila) |

## Submission checklist
**A submission cannot be edited, so send it once, only after the repo is public and the X post is up.** Submissions are accepted from 1 Nov to 14 Nov 23:59 UTC; outside that window the API refuses them.
- Re-read the live HACKATHON.md on the day; dates and rules may change
- README for human and AI judges: what Promptlings is, the problem it solves, how to try it as "do X, see Y" steps, one-command local run
- Staging URL works from a fresh browser; testnet accounts funded for judges to try a purchase
- Repository made public (judges cannot open a private repo)
- Demo video uploaded
- A human on the team posts publicly on X that the project was built at NEAR HACKATHON, with the demo video attached (an agent may draft the text, the human posts)
- One submission for the team, through nearhackathon.com/#apply or the submission API
- Tracks set in the `tracks` array, each once: `games`, `nfts`, `agents`; add `swarms` only if Race shipped live (or Duel did); add `privacy` only if skill prompts run on private inference, which the MVP does not plan
- Team size set to `2 - 4`
- The full payload printed and approved by a human on the team before it is sent
- The human agrees to the consent notice, read verbatim: "I agree that the organizers may use these details to review our submission and contact us about this hackathon."
- Sent by 12:00 UTC on 14 Nov (20:00 Manila) as the target; 23:59 UTC (07:59 Sun 15 Nov Manila) is the hard close
## Open questions
- May the Python simulator (engine_sim.py), written before 1 Nov, sit in the project repo as a dev tool, or only serve as a source of expected results? This plan assumes the second.
- Which social login provider, and does it create a NEAR account for the player or does the backend hold one?
- NEP-171 or NEP-245 for skill NFTs (decided in prep).
- Per-action time limit and tick length (drafted in prep, fixed at M2).
- The M2 clear-rate threshold (7 of 10) and the 12:00 UTC submission target are proposed; change them if the team prefers.
## Sources
- [HACKATHON.md](https://nearhackathon.com/HACKATHON.md): dates, submission rules, track ids, consent notice; opened 25 Oct 2026
- Promptlings concept doc and maps-v0.md: systems, MVP scope, team split, Before 1 Nov list, map results