# Promptlings Formulas
2026-10-25 · @Tyron
Paid play earns a 9.7× markup with the planner + Jev engine, and on the v0 maps a Race match ends at the step limit for at most 2.7 cents; free play is the only cost that can outgrow revenue, so it draws on one global daily budget. Each formula has a variables table and a worked example, with every number recomputed in Python from the concept, maps-v0.md, the econ scripts and engine_sim.py. Values marked proposed are new; section 10 lists every default and section 11 the conflicts found.
## 1. Run score
One agent beats two on all three maps; the closest gap is 622 points, on Magma Mine. The concept's six scores reproduce from the step counts and limits, with one rounding difference: Flood Gate with two agents is 1,212.5, which is 1,213 under the half-up rounding proposed here (the concept's first 1,212 came from Python's round-half-to-even; it now shows 1,213).
```
S = \begin{cases} \max\left(0,\ \left\lfloor 1000 \cdot M(n) \cdot E + 0.5 \right\rfloor - U \cdot k\right) & \text{if the goal is met within } L \\ 0 & \text{otherwise} \end{cases}
```
```
E = 1 - 0.5 \cdot \frac{s}{L}
```
| Symbol | Meaning | Unit | Default | Source |
| S | Run score | points | none | concept |
| n | Agents deployed | agents | 1 to 3 | concept; cap of 3 proposed (section 3) |
| M(n) | Agent multiplier | factor | 3.0, 1.5, 1.0 | concept |
| s | Steps used: ticks on the shared clock until the goal is met, not agent turns | ticks | none | concept |
| L | Map step limit | ticks | 60, 50, 70 | maps-v0.md |
| E | Step efficiency, from 1.0 at 0 steps down to 0.5 at the limit | ratio | none | concept |
| U | Skill upkeep | points per equipped skill | 25 | proposed |
| k | Skills equipped, summed over all agents (one skill on two agents counts twice) | skills | none | proposed |

| Agents deployed | M(n) | Best possible score (s near 0) | Slowest clear (s = L) |
| 1 | 3.0 | 3,000 | 1,500 |
| 2 | 1.5 | 1,500 | 750 |
| 3 or more | 1.0 | 1,000 | 500 |

Crew size outweighs step count: the slowest one-agent clear (1,500) ties the fastest possible two-agent clear. One step costs 1,500 / L points for a solo agent: 25 on Flood Gate, 30 on Ember Warehouse, 21.4 on Magma Mine.
**Skill upkeep, proposed U = 25.** That is one solo step on Flood Gate: a useless extra skill costs about one step, and it can never flip the agent-count order, because the one-to-two-agent gap is 622 points or more.
**Worked example.** Magma Mine, one agent with a Builder skill and a Digger skill (k = 2), 57 steps: E = 1 − 0.5 × 57 / 70 = 0.5929; 3,000 × 0.5929 = 1,778.6, rounded 1,779; minus 2 × 25 gives **1,729**. The two-agent crew (one skill each, k = 2, 32 steps): 1,500 × 0.7714 = 1,157.1, rounded 1,157, minus 50 gives 1,107. The gap stays 622 because both crews carry two skills.
<embed {'caption': 'Recomputed from the step limits in maps-v0.md and the step counts in the concept; no skill upkeep', 'ref': 'node/afd9c9f2-9ab2'}>
Solo step counts were re-run with the BFS solver in engine_sim.py and match (27, 29, 57). The two-agent counts (23, 29, 32) are taken from the concept: maps-v0.md marks only one start tile per map, so those scripted routes could not be re-run. In TypeScript, round with Math.floor(x + 0.5) so the backend and any replay checker agree.
## 2. Run cost and price
With a Haiku 5.5 planner and a Jev actor, an agent turn costs $0.0001035 with planning included, so a 0.1-cent credit carries a 9.7× markup (89.6% gross margin). Haiku for every move gives 6.5× and the Decisions API backup 4.6×. All four activity costs in the concept reproduce exactly.
### Cost per call
```
c_H = T_s \, p_c + T_d \, p_i + T_o \, p_o
```
```
c_P = T_s \, p_c + T_{dP} \, p_i + T_{oP} \, p_o \qquad c_A = T_A \, p_A
```
| Symbol | Meaning | Unit | Default | Source |
| c_H | Haiku actor turn | USD | 0.000155 | econ.py |
| c_P | Planner call (one plan) | USD | 0.000325 | engine.py |
| c_A | Decision-model actor turn | USD | 0.000084 Jev, 0.000200 Decisions | engine.py |
| T_s | Static prompt: system, briefing, skill prompts (cached) | tokens | 2,500 | concept, estimate |
| T_d | Dynamic: grid observation, recent actions | tokens | 1,000 | concept, estimate |
| T_o | Output: one structured action | tokens | 60 | concept, estimate |
| T_dP | Planner dynamic input | tokens | 1,500 | engine.py |
| T_oP | Plan length | tokens | 300 | concept |
| T_A | Actor prompt: plan 300 + state 1,000 + legal actions 200 + skill rules 500 | tokens | 2,000 | engine.py |
| p_c, p_i, p_o | Haiku 5.5 cache hit, input, output | USD per MTok | 0.01, 0.10, 0.50 | concept (Anthropic pricing) |
| p_A | Actor input price | USD per MTok | 0.042 Jev, 0.10 Decisions | concept; Decisions output price unpublished |

Worked example: c_H = 2,500 × 0.01 + 1,000 × 0.10 + 60 × 0.50, all over 10^6, = $0.000025 + $0.000100 + $0.000030 = **$0.000155**. Without caching it is $0.00038; 300 tokens of reasoning output raise it to $0.000275.
### Cost per run or match
```
P = n \left(1 + \left\lfloor \frac{t}{R} \right\rfloor\right) \qquad C_{\text{split}} = P \, c_P + n \, t \, c_A \qquad C_{\text{Haiku}} = n \, t \, c_H \qquad c_{\text{eff}} = \frac{C}{n \, t}
```
| Symbol | Meaning | Unit | Default | Source |
| P | Planner calls in the run | calls | none | engine.py |
| n | Agents (both sides in PvP) | agents | none | concept |
| t | Ticks played | ticks | none | concept |
| R | Replan interval | ticks | 20 solo, 30 PvP | engine.py |
| C | Inference cost of the run | USD | none | engine.py |
| c_eff | Cost per agent turn, planning included | USD | 0.0001035 Jev, 0.0002195 Decisions (solo 2 × 50) | recomputed |

| Activity | Agent turns | Plans | Haiku every turn | Planner + Jev | Planner + Decisions |
| Solo run, 2 agents × 50 ticks | 100 | 6 | $0.0155 | $0.0103 | $0.0219 |
| Solo run, 3 agents × 80 ticks | 240 | 15 | $0.0372 | $0.0250 | $0.0529 |
| Ranked, 3 s ticks, 1 a side, full 10 min | 400 | 14 | $0.0620 | $0.0381 | $0.0845 |
| Ranked, 2 s ticks, 2 a side, full 10 min | 1,200 | 44 | $0.1860 | $0.1151 | $0.2543 |

Planning is 19% of the Jev run cost in the 2 × 50 solo run (6 plans × $0.000325 = $0.00195 of $0.0103). Section 7 shows that on the v0 maps a ranked match ends at the step limit long before 10 minutes, so the last two rows are bounds for longer future maps.
### Price, markup, pre-authorization and refund
```
\mu = \frac{p}{c_{\text{eff}}} \qquad g = 1 - \frac{1}{\mu}
```
```
Q = \left\lceil \sum_{k=1}^{n} m_k \, t_k \right\rceil \qquad H = \left\lceil L \cdot S(n) \right\rceil \qquad \text{refund} = H - Q
```
```
\text{credits from a top-up} = \left\lfloor \frac{D_{\text{NEAR}} \cdot X}{p} \right\rfloor
```
| Symbol | Meaning | Unit | Default | Source |
| p | Price of one credit = one base agent turn | USD | 0.001 | concept |
| μ | Markup on inference | factor | 9.66 Jev, 6.45 Haiku, 4.56 Decisions | recomputed |
| g | Gross margin per turn | % | 89.6 Jev, 84.5 Haiku, 78.0 Decisions | recomputed |
| m_k | Price weight of the k-th agent | factor | 1 + 0.5(k − 1) | proposed (section 3) |
| t_k | Ticks agent k was alive and acting; a lost agent stops charging | ticks | none | proposed |
| Q | Credits charged for the run | credits | none | proposed |
| S(n) | Sum of m_k for k = 1..n | factor | 1, 2.5, 4.5 | proposed (section 3) |
| H | Credits held before the run: worst case, every agent to the step limit | credits | none | concept rule, weighted by S(n) |
| D_NEAR | NEAR deposited | NEAR | none | concept |
| X | USD per NEAR at deposit time | USD | live rate | proposed; source is an open question |

| Map, crew | Ticks | Inference, Jev | Charged Q | Held H | Refund | Markup |
| Flood Gate, 1 agent | 27 | $0.00292 | 27 cr | 60 cr | 33 cr | 9.3× |
| Flood Gate, 2 agents | 23 | $0.00516 | 58 cr | 150 cr | 92 cr | 11.1× |
| Ember Warehouse, 1 agent | 29 | $0.00309 | 29 cr | 50 cr | 21 cr | 9.4× |
| Ember Warehouse, 2 agents | 29 | $0.00617 | 73 cr | 125 cr | 52 cr | 11.8× |
| Magma Mine, 1 agent | 57 | $0.00576 | 57 cr | 70 cr | 13 cr | 9.9× |
| Magma Mine, 2 agents | 32 | $0.00668 | 80 cr | 175 cr | 95 cr | 12.0× |

**Worked example.** Magma Mine, two agents, cleared in 32 ticks. Hold H = 70 × (1 + 1.5) = 175 credits; the run starts only if the balance covers it. Charged Q = 32 × 1 + 32 × 1.5 = 80 credits ($0.080); refund 95 credits. Inference was 2 × (1 + ⌊32/20⌋) = 4 plans × $0.000325 + 64 turns × $0.000084 = $0.00668, a 12.0× markup. A wait still calls the model, so it is charged like any other turn.
## 3. Extra-agent cost under Option A
Proposed: the k-th agent in a crew costs 1 + 0.5(k − 1) credits per turn, so a crew of 2 pays 2.5× a solo run per tick and a crew of 3, the cap, pays 4.5×. Inference grows only linearly with agents, so each extra agent raises the markup, from 9.7× solo to 14.5× for three.
```
m_k = 1 + a \, (k - 1) \qquad S(n) = \sum_{k=1}^{n} m_k = n + a \, \frac{n (n - 1)}{2} \qquad \text{price} = p \cdot t \cdot S(n)
```
| Symbol | Meaning | Unit | Default | Source |
| m_k | Price weight of the k-th agent deployed | factor | 1, 1.5, 2 | proposed |
| a | Step added per extra agent | factor | 0.5 | proposed |
| S(n) | Crew price factor | factor | 1, 2.5, 4.5 | proposed |
| n_max | Most agents in one solo run | agents | 3 | proposed |
| t | Ticks played | ticks | none | concept |
| p | Credit price | USD per credit | 0.001 | concept |

**Worked example.** Three agents, 50 ticks: S(3) = 3 + 0.5 × 3 = 4.5, so the run costs 50 × 4.5 = 225 credits ($0.225). Inference is 3 × (1 + ⌊50/20⌋) = 9 plans × $0.000325 + 150 turns × $0.000084 = $0.0155, a 14.5× markup. With a flat price the same run would cost 150 credits at 9.7×.
<embed {'caption': 'Proposed curve m_k = 1 + 0.5(k − 1); costs from engine.py token and price assumptions', 'ref': 'node/f1e64b18-8f9c'}>
Weights follow deploy order (agent 1 pays m_1); when an agent is lost, its own weight stops and the others keep theirs. The price curve and the score multiplier push the same way on purpose: a second agent halves the score multiplier and costs 1.5× the first.
## 4. Free-play budget
With planner + Jev, 1,000 daily players can get 59 to 247 free agent turns each per day before the game loses money, depending on payer share and spend. The Haiku-only figures reproduce the concept exactly; the planner + Jev figures (59, 88, 160, 247) are up to 1 turn below the concept's first draft (60, 89, 161, 248), which rounded the turn cost to $0.000103; this doc uses $0.0001035, and the concept now uses these figures.
```
B = N \varphi A + F - \frac{N \varphi A}{p} \, c - X_{\text{fix}}
```
```
f^{*} = \frac{B}{N \cdot D \cdot c} \qquad G = \left\lfloor \sigma \cdot \frac{B}{D \cdot c} \right\rfloor
```
| Symbol | Meaning | Unit | Default | Source |
| B | Monthly money left for free play | USD per month | none | econ2.py |
| N | Daily active players | players | 1,000 | concept |
| φ | Share of players who pay | ratio | 3%, 5%, 8% | concept |
| A | Spend per paying player | USD per month | 5 or 10 | concept |
| F | Marketplace fees + pool rake (5% of $2,000 sales + 10% of $1,000 entries) | USD per month | 200 | econ2.py |
| p | Credit price | USD per turn | 0.001 | concept |
| c | Cost per agent turn | USD | 0.0001035 Jev, 0.000155 Haiku | recomputed |
| X_fix | Fixed infrastructure | USD per month | 150 | concept |
| D | Days per month | days | 30 | econ2.py |
| f* | Break-even free agent turns per daily player per day | turns | none | econ2.py |
| G | Global daily free budget | agent turns per day | none | proposed |
| σ | Safety factor on G | ratio | 0.8 | proposed |
| f_solo | Free solo allowance per player | credits (= agent turns) per day | 60 | proposed |
| f_match | Free ranked matches per player | matches per day | 1 | concept proposal |

**Worked example.** 1,000 players, 5% pay $10 a month, planner + Jev: credit revenue $500, paid inference 500 / 0.001 × 0.0001035 = $51.75, so B = 500 + 200 − 51.75 − 150 = **$498.25** a month. f* = 498.25 / (1,000 × 30 × 0.0001035) = 160.5 turns per player per day. The global daily budget is G = 0.8 × 498.25 / (30 × 0.0001035) = 128,374 agent turns a day; when it runs out, free play pauses until 00:00 UTC.
<embed {'caption': "Recomputed with econ2.py's assumptions; planner + Jev at $0.0001035 per turn, Haiku at $0.000155", 'ref': 'node/f7840e11-6ae4'}>
The paid-inference term counts every paid credit as one turn, so the extra-agent weights of section 3 only add margin: these break-even figures are conservative. The proposed free solo allowance of 60 credits (60 one-agent turns) covers one worst-case one-agent run on Flood Gate (step limit 60); it fits under break-even at 5% payers and above, and also at 3% if they spend $10.
### Cost of the daily free ranked match
```
C_{\text{match}} = 2 n_s \left(1 + \left\lfloor \frac{t}{R} \right\rfloor\right) c_P + 2 n_s \, t \, c_A \qquad t = \min\left(L, \left\lfloor \frac{600}{\tau} \right\rfloor, t_{\text{win}}\right)
```
| Map (Race, 3 s ticks, 1 agent a side, to the step limit) | Ticks | Agent turns | Plans | Planner + Jev | Haiku only | Per 1,000 players per month |
| Flood Gate | 60 | 120 | 6 | $0.0120 | $0.0186 | $361 |
| Ember Warehouse | 50 | 100 | 4 | $0.0097 | $0.0155 | $291 |
| Magma Mine | 70 | 140 | 6 | $0.0137 | $0.0217 | $411 |

**Worked example.** Flood Gate, n_s = 1, R = 30, t = min(60, 200, no win) = 60: 6 plans × $0.000325 + 120 turns × $0.000084 = **$0.0120**. The concept's first “about 1.1 cents” for 120 turns (now corrected) used the per-turn rate of a full 10-minute match, where planning is spread over 400 turns; this short match pays its own 6 plans, so it is 1.2 cents. The monthly column assumes every player's free match is a separate match; when both sides are on their free match they share one, which halves it to $146–206. On its own, the match fits under break-even on all three maps when 5% or 8% of players pay $10 (160 or 247 turns). With the 60-credit free solo allowance on top (up to 200 turns a day), only 8% paying $10 covers both, which is why the global budget G, not the allowances, is the real cap.
## 5. Entry fees and reward pools
Proposed: a pool entry costs 100 credits' worth of NEAR per crew-price unit (100 for one agent, 250 for two), which is at least 3× the worst-case inference of every v0 map and crew up to three agents, even if Haiku has to take over as actor. Ten percent goes to the platform, the run's inference comes out next, and the rest pays the top 10% of players each season.
### Minimum entry fee
```
C_{\text{worst}} = n \left(1 + \left\lfloor \frac{L}{R} \right\rfloor\right) c_P + n \, L \, c_A \quad \text{(or } n \, L \, c_H \text{ for Haiku)} \qquad E_{\min} = \left\lceil \frac{k_E \, C_{\text{worst}}}{p} \right\rceil
```
```
E(n) = \max\left(E_{\text{base}} \cdot S(n),\ E_{\min}\right) \qquad E_{\text{NEAR}} = \frac{E(n) \cdot p}{X_{\text{season}}}
```
| Symbol | Meaning | Unit | Default | Source |
| C_worst | Inference if every agent plays to the step limit | USD | none | recomputed |
| k_E | Fee-to-inference floor | factor | 3 | concept |
| E_min | Lowest allowed entry fee | credits | none | concept rule |
| E_base | Entry fee for one agent | credits | 100 ($0.10) | proposed |
| E(n) | Entry fee for a crew of n | credits | 100, 250, 450 | proposed |
| X_season | USD per NEAR, fixed when the season opens | USD | live rate | proposed |
| E_NEAR | Fee in NEAR, rounded up to 0.01 NEAR, fixed for the season | NEAR | none | proposed |

The entry fee includes the run: a pool run is not also charged per-turn credits (proposed). Fees are paid in NEAR into the reward-pool contract, as the concept's money-flow table says.
| Map | E_min, 1 agent (Jev / Haiku) | E_min, 3 agents (Jev / Haiku) | Proposed E(1) / E(3) |
| Flood Gate | 20 / 28 cr | 58 / 84 cr | 100 / 450 cr |
| Ember Warehouse | 16 / 24 cr | 47 / 70 cr | 100 / 450 cr |
| Magma Mine | 22 / 33 cr | 65 / 98 cr | 100 / 450 cr |

**Worked example.** Magma Mine, one agent, Haiku fallback: C_worst = 70 × $0.000155 = $0.01085; E_min = ⌈3 × 0.01085 / 0.001⌉ = 33 credits, so the proposed 100 credits passes with 3× room. Section 9 shows when it stops passing.
### Pool and platform cut
```
\Pi = \sum_{i} \left[ E_i \, (1 - r) - \min\left(C_i, \frac{E_i}{k_E}\right) \right] \qquad \text{platform} = \sum_{i} \left[ r \, E_i + \min\left(C_i, \frac{E_i}{k_E}\right) \right]
```
| Symbol | Meaning | Unit | Default | Source |
| Π | Season pool for one map | NEAR | none | proposed |
| E_i | Fee paid for entry i | NEAR | none | concept |
| r | Platform cut of each entry | bps | 1,000 (10%) | concept model assumed 10%; final value proposed |
| C_i | Measured inference of entry i, at cost, converted at X_season | NEAR | none | proposed |

The contract caps the inference claim at E_i / 3, so a player's entry always puts at least 56.7% of its fee into the pool; with E ≥ 3 × C_worst the cap never binds. Season length is 14 days (proposed); a map with fewer than 5 distinct entrants rolls its pool into the next season.
### Payout across the top scores
```
N_w = \max\left(1, \lceil q \, D \rceil\right) \qquad w_j = \frac{1 / j}{\sum_{i=1}^{N_w} 1 / i} \qquad \text{payout}_j = \Pi \cdot w_j
```
| Symbol | Meaning | Unit | Default | Source |
| D | Distinct players with at least one entry this season | players | none | proposed |
| q | Share of players paid | ratio | 10% | proposed |
| N_w | Players paid | players | none | proposed |
| j | Rank by each player's best score of the season | rank | none | proposed |
| w_j | Share of the pool for rank j (harmonic weights) | ratio | none | proposed |
| D_min | Fewest entrants for a payout; below it the pool rolls over | players | 5 | proposed |

Each player is ranked once, by their best score. Players tied on score split the summed shares of the ranks they occupy equally (two players tied for ranks 2 and 3 get 14.23% each).
**Worked example.** 100 players make 400 one-agent entries averaging 40 ticks. Each entry adds $0.10 × 0.9 = $0.090 and claims $0.0043 of inference, so Π = 400 × (0.090 − 0.0043) = **$34.27**. N_w = 10, harmonic sum 2.929: rank 1 gets 34.1% ($11.70) and rank 10 gets 3.4% ($1.17).
<embed {'caption': 'Proposed payout weights; pool from the worked example above (400 entries, 100 players)', 'ref': 'node/2eecb4e2-4d32'}>
### Anti-farming weight for community maps
```
\hat{f} = \frac{F + 1}{R_m + 2} \qquad W = \min\left(1, \frac{D_m}{D_0}\right) \cdot \min\left(1, \frac{\hat{f}}{f_0}\right) \qquad \text{ladder points} = W \cdot S
```
| Symbol | Meaning | Unit | Default | Source |
| F | Failed runs on the map this season | runs | none | concept (failure rate) |
| R_m | All runs on the map this season | runs | none | concept |
| f̂ | Failure rate, smoothed so a new map starts at 50% | ratio | none | proposed |
| D_m | Distinct players who ran the map, creator excluded | players | none | concept |
| D_0 | Players needed for full weight | players | 50 | proposed |
| f_0 | Failure rate needed for full weight | ratio | 0.5 | proposed |
| W | Weight on season ladder points from this map; official maps are 1, the creator's own runs 0 | ratio | none | proposed |

**Worked example.** A community map with 20 distinct players, 120 runs and 30 failures: f̂ = 31 / 122 = 0.254, so W = (20 / 50) × (0.254 / 0.5) = 0.4 × 0.508 = **0.203**, and a 2,000-point clear counts as 406 ladder points. A farm map played by 3 accounts with 2 failures in 200 runs gets f̂ = 3 / 202 = 0.0149 and W = 0.06 × 0.0297 = 0.0018. Runs by the creator are left out of F, R_m and D_m.
## 6. Marketplace
Proposed: a 500 bps (5%) platform fee on every skill sale and a creator royalty on resales that the creator sets at mint from 0 to 1,000 bps, default 500 bps (5%), so at the default a reseller keeps 90% and a creator selling a fresh mint keeps 95%. The 5% fee and 10% pool rake match what the concept's cost model assumed; both are still proposed. The royalty range and default are new.
### Fees, royalty and seller proceeds
```
\text{fee} = \left\lfloor \frac{P \cdot b_f}{10^4} \right\rfloor \qquad \text{royalty} = \begin{cases} 0 & \text{primary sale (creator sells)} \\ \left\lfloor \frac{P \cdot b_r}{10^4} \right\rfloor & \text{resale} \end{cases} \qquad \text{seller} = P - \text{fee} - \text{royalty}
```
| Symbol | Meaning | Unit | Default | Source |
| P | Sale price | yoctoNEAR | none | concept (paid in NEAR) |
| b_f | Platform fee | bps | 500 | concept model assumed 5%; final value proposed |
| b_r | Creator royalty on resale, set by the creator at mint (0 to 1,000) | bps | 500 | proposed |
| b_pool | Platform cut of solo entry fees (section 5) | bps | 1,000 | concept model assumed 10%; final value proposed |

Contracts do this in integers: 1 NEAR = 10^24 yoctoNEAR, and amounts are whole yoctoNEAR. Rounding down fee and royalty and giving the seller the remainder means the three parts always add up to P exactly. On NEAR, royalties for NEP-171 NFTs are usually paid through the NEP-199 payout methods: the marketplace asks the NFT contract who gets what and pays each account; check this against the NEP text before building, and for NEP-245 tokens the marketplace contract applies the royalty itself.
**Worked example.** A skill resold for 5 NEAR: fee = 5 × 500 / 10,000 = 0.25 NEAR, royalty at the default = 5 × 500 / 10,000 = 0.25 NEAR, seller gets **4.****5 NEAR**. The same skill sold by its creator the first time: fee 0.25 NEAR, creator gets 4.75 NEAR.
### Skill price signal: clear rate per tag
```
\hat{p} = \frac{c + \kappa \, \mu_{\text{tag}}}{n + \kappa}
```
```
\text{Wilson}_{95} = \frac{\bar{p} + \frac{z^2}{2n} \pm z \sqrt{\frac{\bar{p}(1 - \bar{p})}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}} \qquad \bar{p} = \frac{c}{n}
```
| Symbol | Meaning | Unit | Default | Source |
| c | Clears by runs that had this skill equipped on a map containing a thing with this tag | runs | none | concept (clear rate per tag) |
| n | All such runs | runs | none | concept |
| μ_tag | Season-to-date clear rate of all skills on that tag; 0.4 until a tag has 100 runs | ratio | 0.4 | proposed |
| κ | Prior strength: how many average runs a new skill starts with | runs | 10 | proposed |
| p̂ | Smoothed clear rate shown on the listing | ratio | none | proposed |
| z | Normal quantile for a 95% range | none | 1.96 | standard |
| Wilson lower bound | Default marketplace sort key per tag | ratio | none | proposed |

Runs on a creator's own maps, and community-map runs with W below 0.1, are left out of c and n (proposed). The concept's example says “clears 9 of 10 spreads maps”; this formula counts runs, so a skill run many times on one map counts each run.
**Worked example.** A skill with 9 clears in 10 runs on `spreads` maps, tag mean 0.4: p̂ = (9 + 10 × 0.4) / (10 + 10) = **0.650**, Wilson range 59.6% to 98.2%. A skill with 90 of 100 shows 0.855 with range 82.6% to 94.5%, so it lists above the 9-of-10 skill even though both raw rates are 90%.
<embed {'caption': 'Illustrative counts; proposed prior 0.4 with strength 10 and Wilson 95% range', 'ref': 'node/a19762d7-ada6'}>
## 7. PvP
On the v0 maps a Race ends at the map's step limit (50 to 70 ticks), so a match lasts at most 140 s at 2 s ticks or 210 s at 3 s ticks and costs at most 2.7 cents with planner + Jev. The concept's 10-minute, 1,200-call match is only reachable on future maps with step limits above 300 ticks.
### Elo per agent
```
E_A = \frac{1}{1 + 10^{(R_B - R_A)/400}} \qquad R_A' = R_A + K \, (S_A - E_A) \qquad R_{\text{crew}} = \frac{1}{n_s} \sum_{i=1}^{n_s} R_i
```
| Symbol | Meaning | Unit | Default | Source |
| R_A, R_B | Crew ratings: mean Elo of each side's agents | Elo | none | concept (Elo per agent) |
| E_A | Expected score of side A | ratio | none | standard Elo |
| S_A | Result: 1 win, 0.5 draw, 0 loss | none | none | standard Elo |
| K | Step size; every agent in the crew gets the same change | Elo | 32 for an agent's first 20 ranked matches, then 16 | proposed |
| R_0 | Starting rating of a new agent | Elo | 1,200 | proposed |
| R_floor | Lowest rating | Elo | 100 | proposed |

Ratings are stored as integers, changes rounded half up, and the winner's gain equals the loser's loss when both crews use the same K.
**Worked example.** A new agent (1,200) beats a 1,300 crew: E_A = 1 / (1 + 10^(100/400)) = 0.360; with K = 32 it gains 32 × 0.640 = 20.5, rounded **+21**, to 1,221. Had it lost, the change would be 32 × (0 − 0.360) = −11.5, rounded half up (Math.floor(x + 0.5)) to −11. With K = 16 the win is worth +10.
### Win conditions
**Race** (both crews on mirrored copies, step limit and 10-minute cap both apply), checked at step 5 of every tick:
1. One side clears on an earlier tick: it wins.
2. Both clear on the same tick: the higher run score (section 1) wins; equal scores draw.
3. One side fails (all agents lost, goal flooded, out of steps) while the other is still running: the other side plays on and wins if it clears; if it also fails, rule 4.
4. Neither clears: draw.
**Duel** (one shared map; the map's goal type decides, as already agreed):
| Goal type | Win | Draw |
| Capture the flag | First side to carry the other side's flag onto its own base tile | Neither captures by the step limit or cap |
| Most collected | More collectibles held when the step limit or cap is reached | Equal counts |
| First to the exit | First agent to stand on the exit with the map's collect condition met | Same tick, or nobody by the limit |
| Any | A side with every agent lost loses at once | Both lose their last agent on the same tick |

### Tick budget
```
a = \tau - t_{\text{rb}} \qquad \text{requires } \ \ell_{95} + t_{\text{net}} \le a \qquad t_{\text{match}} = \tau \cdot \min\left(L, \left\lfloor \frac{T_{\max}}{\tau} \right\rfloor, t_{\text{win}}\right)
```
| Symbol | Meaning | Unit | Default | Source |
| τ | Tick length | s | 2 paid ranked, 3 free ranked | concept (1–3 s ticks: 2 s paid, 3 s free) |
| a | Per-action time limit; a missed action becomes wait | s | τ − 0.5: 1.5 at 2 s, 2.5 at 3 s | proposed (still open in the concept) |
| t_rb | Resolve, broadcast and client render | s | 0.5 | proposed |
| ℓ_95 | Actor decision latency, p95 | s | 0.34 Jev on OpenRouter | concept |
| t_net | Network round trip from the backend to the model provider | s | measure in week one | open |
| T_max | Match cap | s | 600 | concept |
| t_win | Tick on which the match is decided | ticks | none | concept |
| t_pre | Pre-match planning countdown; the first plans are made here | s | 10 | proposed |

With τ = 2 s, Jev's 0.34 s p95 leaves 1.16 s of the 1.5 s limit for the network. Replans (every 30 ticks) run in the background; an agent keeps following its old plan until the new one arrives, so a slow Haiku call never costs a tick.
### Calls and cost per match
```
N_{\text{calls}} = 2 n_s \, t + 2 n_s \left(1 + \left\lfloor \frac{t}{R} \right\rfloor\right) \qquad C_{\text{match}} = 2 n_s \left(1 + \left\lfloor \frac{t}{R} \right\rfloor\right) c_P + 2 n_s \, t \, c_A
```
| Map, played to the step limit | 1 a side: calls | 1 a side: cost | 2 a side: calls | 2 a side: cost |
| Flood Gate (60 ticks) | 120 + 6 plans | $0.0120 | 240 + 12 plans | $0.0241 |
| Ember Warehouse (50 ticks) | 100 + 4 plans | $0.0097 | 200 + 8 plans | $0.0194 |
| Magma Mine (70 ticks) | 140 + 6 plans | $0.0137 | 280 + 12 plans | $0.0274 |

Costs are planner + Jev; tick length changes the duration, not the count. A match that ends at best-solo pace is cheaper: Flood Gate with one agent a side ends at tick 27 after 54 actor calls, $0.0052. A paid ranked match charges each player for their own side like a solo run: Q = t × S(n_s) credits.
**Worked example.** Magma Mine, 2 agents a side, played to the limit: t = min(70, ⌊600 / 2⌋, none) = 70 ticks, 140 s. Calls = 2 × 2 × 70 = 280 actor calls + 2 × 2 × (1 + ⌊70/30⌋) = 12 plans; cost = 12 × $0.000325 + 280 × $0.000084 = **$0.0274**. Each player pays 70 × 2.5 = 175 credits.
## 8. Engine timing
A thing with spreadEvery N grows on ticks where tick mod N = 0, after agents act, so a tile d steps from the hazard is reached on tick N × d and a block placed on that same tick still stops it. The real dam deadlines are therefore tick 6 on Flood Gate and tick 15 on Magma Mine, one tick later than the concept's first “by tick 5” and “by tick 14” (now corrected); engine_sim.py confirms both (a block placed on tick 7 or 16 is too late).
```
\text{spread on tick } t \iff t \bmod N = 0 \qquad t_{\text{reach}}(x) = N \cdot d(x) \qquad t_{\text{last block}}(x) = N \cdot d(x)
```
| Symbol | Meaning | Unit | Default | Source |
| t | Tick number, counted from 1 and advanced after agents act | ticks | none | engine_sim.py |
| N | spreadEvery of the thing | ticks | water 2, fire 2, lava 5 | maps-v0.md |
| d(x) | Shortest path from the nearest source tile to x, through tiles the thing may enter | tiles | none | engine_sim.py |
| t_reach(x) | Tick on which the hazard covers x, with no blocks in the way | ticks | none | recomputed |
| t_last block(x) | Last tick on which a block placed on x still stops it | ticks | none | recomputed |

Water and lava may enter empty tiles and goal tiles; fire may enter only flammable tiles. In the simulator, liquids never cover a collectible: a gem is lost by being cut off, not covered.
**Worked example.** Magma Mine: the dam spot (10,4) is 3 tiles below the pool tile (10,1), so lava reaches it on tick 5 × 3 = **15**. The exit (13,7) is 9 tiles away along the shaft and tunnel, so an undammed run fails with “goal flooded” on tick 5 × 9 = 45.
<embed {'caption': 'engine_sim.py idle runs and BFS solver routes on the maps-v0.md grids', 'ref': 'node/e0c489a2-bf1e'}>
The best solo runs leave 3 ticks of slack on Flood Gate (block on tick 3, deadline 6), 4 on Ember Warehouse (crate pushed on tick 8, fire reaches it on 12) and 1 on Magma Mine (block on tick 14, deadline 15). Magma Mine is the one where an agent that hesitates for two ticks loses.
## 9. Sensitivity
Doubling model prices or doubling token counts has the same effect, because every cost here is tokens × price: each halves the markup, and paid play stays profitable on every engine (planner + Jev 4.8×, Haiku 3.2×, Decisions 2.3×). Free play takes the hit: break-even free turns fall by more than half, from 160 to 72, because paid inference eats into the same budget. If both double, gross margin falls to 59% on Jev and 12% on Decisions, and the credit price should rise to $0.0021.
```
c' = \alpha_p \, \alpha_t \, c \qquad \mu' = \frac{p}{c'} = \frac{\mu}{\alpha_p \, \alpha_t} \qquad p_{\text{new}} = 10^{-4} \left\lceil \frac{\mu_{\text{target}} \, c_{\text{measured}}}{10^{-4}} \right\rceil \ \text{ when } \frac{p}{c_{\text{measured}}} < \mu_{\text{target}}
```
| Symbol | Meaning | Unit | Default | Source |
| α_p | Model price multiplier | factor | 1 (tested at 2) | task |
| α_t | Token count multiplier against the estimates | factor | 1 (tested at 2) | task |
| μ_target | Lowest acceptable markup before repricing | factor | 5 | concept Guardrail 1 (5× floor) |
| c_measured | Trailing 7-day cost per agent turn from observability logs | USD | none | proposed |
| p_new | New credit price, rounded up to $0.0001 | USD | none | proposed |

<embed {'caption': 'Per-turn costs from the solo 2 × 50 run in engine.py, scaled by α_p × α_t', 'ref': 'node/7b64a4ef-932e'}>
| Measure | Base | Prices or tokens × 2 | Both × 2 |
| Break-even free turns per player per day (5% pay $10, planner + Jev) | 160 | 72 | 28 |
| Same, Haiku only | 102 | 42 | 13 |
| Daily free Race on Flood Gate, per 1,000 players per month | $361 | $722 | $1,444 |
| Daily full 10-minute match (2 s, 2 a side), per 1,000 players per month | $3,453 | $6,906 | $13,812 |
| E_min, Magma Mine, 1 agent, Haiku fallback (proposed E = 100 cr) | 33 cr | 66 cr | 131 cr, fails |
| E_min, Magma Mine, 3 agents, Haiku fallback (proposed E = 450 cr) | 98 cr | 196 cr | 391 cr |

**Worked example.** Both multipliers at 2: Jev's c_eff = 4 × $0.0001035 = $0.000414, so μ = 0.001 / 0.000414 = 2.42, below 5. p_new = 5 × 0.000414 = $0.00207, rounded up to **$0.0021** per credit; entry fees, being in credits, rise with it, which also brings Magma Mine's E_min back under E. The Decisions API is already below the 5× target at base (4.56×), so switching to it means repricing to $0.0011 on day one.
## 10. Parameter summary
Every default in this doc, keyed for a config file. Status says whether a value comes from the sources or is new here.
| Key | Default | Unit | Status |
| `score.base` | 1000 | points | concept |
| `score.agentMultiplier` | {1: 3.0, 2: 1.5, 3+: 1.0} | factor | concept |
| `score.stepWeight` | 0.5 | ratio | concept |
| `score.upkeepPerSkill` | 25 | points | proposed |
| `score.rounding` | half up, Math.floor(x + 0.5) | none | proposed |
| `crew.maxAgents` | 3 | agents | proposed |
| `crew.extraAgentStep` | 0.5 (weights 1, 1.5, 2) | factor | proposed |
| `tokens.actorStaticCached` | 2500 | tokens | concept estimate |
| `tokens.actorDynamic` | 1000 | tokens | concept estimate |
| `tokens.actorOutputCap` | 60 (concept range 60 to 100) | tokens | concept |
| `tokens.plannerDynamic` | 1500 | tokens | engine.py |
| `tokens.planOutput` | 300 | tokens | concept |
| `tokens.decisionPrompt` | 2000 | tokens | engine.py |
| `price.haiku` | input 0.10, cache hit 0.01, output 0.50 | USD per MTok | concept |
| `price.jevInput` | 0.042 (output free) | USD per MTok | concept |
| `price.decisionsInput` | 0.10 (output unpublished) | USD per MTok | concept |
| `planner.replanEveryTicks` | solo 20, PvP 30 | ticks | engine.py |
| `credits.priceUsd` | 0.001 per credit = 1 base agent turn | USD | concept |
| `credits.preauth` | stepLimit × S(n) | credits | concept rule, weighted (proposed) |
| `credits.markupTarget` | 5 | factor | concept |
| `credits.repriceStepUsd` | 0.0001 | USD | proposed |
| `credits.repriceWindowDays` | 7 | days | proposed |
| `free.dailyBudgetSafety` | 0.8 | ratio | proposed |
| `free.soloTurnsPerDay` | 60 | agent turns | proposed |
| `free.rankedMatchesPerDay` | 1 | matches | concept proposal |
| `free.resetUtc` | 00:00 | time | proposed |
| `model.dailyPlayers` | 1000 | players | concept assumption |
| `model.fixedInfraUsdMonth` | 150 | USD | concept assumption |
| `model.feeIncomeUsdMonth` | 200 | USD | concept assumption |
| `pool.entryBaseCredits` | 100 per S(n) unit | credits | proposed |
| `pool.feeToInferenceFloor` | 3 | factor | concept |
| `pool.rakeBps` | 1000 | bps | concept model assumed 10%; proposed |
| `pool.winnerShare` | 0.10 | ratio | proposed |
| `pool.weights` | harmonic, 1/j | none | proposed |
| `pool.minEntrants` | 5 | players | proposed |
| `pool.seasonDays` | 14 | days | proposed |
| `antiFarm.fullWeightPlayers` | 50 | players | proposed |
| `antiFarm.fullWeightFailRate` | 0.5 | ratio | proposed |
| `antiFarm.failPrior` | (F + 1) / (R + 2) | none | proposed |
| `market.feeBps` | 500 | bps | concept model assumed 5%; proposed |
| `market.royaltyBps` | 500 (creator sets 0 to 1000 at mint) | bps | proposed |
| `signal.priorStrength` | 10 | runs | proposed |
| `signal.defaultTagMean` | 0.4, until a tag has 100 runs | ratio | proposed |
| `signal.z` | 1.96 | none | standard |
| `signal.minMapWeight` | 0.1 | ratio | proposed |
| `elo.start` | 1200 | Elo | proposed |
| `elo.kProvisional` | 32 for the first 20 ranked matches | Elo | proposed |
| `elo.k` | 16 | Elo | proposed |
| `elo.floor` | 100 | Elo | proposed |
| `pvp.tickSeconds` | paid 2, free 3 | s | concept |
| `pvp.actionLimitSeconds` | tick − 0.5 | s | proposed |
| `pvp.matchCapSeconds` | 600 | s | concept |
| `pvp.prematchPlanSeconds` | 10 | s | proposed |
| `maps.spreadEvery` | water 2, fire 2, lava 5 | ticks | maps-v0.md |
| `maps.stepLimit` | Flood Gate 60, Ember Warehouse 50, Magma Mine 70 | ticks | maps-v0.md |

## 11. Open questions and source conflicts
### Where the sources disagree or this doc differs
On 25 Oct 2026 the concept was updated to match the Recomputed column in every row except free ranked cost per player and the two-agent step counts; the rows stay as a record of what changed.
| Item | Source says | Recomputed | Why |
| Markup at 0.1 cent per turn | Unit economics: about 10× (Jev), 6.5× (Haiku); Guardrail 1: “about 5×” | 9.66× Jev, 6.45× Haiku, 4.56× Decisions | 5× holds only for the Decisions API; this doc treats 5× as the repricing floor |
| Flood Gate, two-agent score | 1,212 | 1,213 | 1,212.5 rounded half up; the concept used Python's round-half-to-even |
| Dam deadlines | Flood Gate by tick 5, Magma Mine by tick 14 | Ticks 6 and 15 | Agents act before spread in the same tick; checked in engine_sim.py |
| Break-even free turns, planner + Jev | 60, 103, 89, 161, 132, 248 | 59, 103, 88, 160, 132, 247 | Concept rounded the turn cost to $0.000103 |
| Short daily ranked match | About 1.1 cents for 120 turns | 1.2 cents | 6 plan calls for a short match; the concept used the 10-minute per-turn rate |
| Full 10-minute ranked match, 1,200 calls | Platform cost per match | Unreachable on v0 maps | Step limits end a Race by tick 70 (280 calls with 2 a side), if step limits apply in PvP |
| Free ranked cost per player | One match per daily player | Half that when both sides are free players | Two players share one match |
| Two-agent step counts | 23, 29, 32 | Not re-run | maps-v0.md marks one start tile per map; the scripted two-agent routes are not in the files |
| Free ranked tick length | Matches use 1–2 s ticks; free matches use 3 s | Both kept | 3 s is outside the 1–2 s range the PvP section states |
| Actions list | Core concepts lists a `push` action | Not used here | The decided 7 actions have no push; pushing happens through `move` |

### Open questions
- Does a pool entry include its run (assumed here), or is the run charged in credits on top of the fee?
- Which USD per NEAR rate sets top-up credits and each season's NEAR fee, and who publishes it?
- Do map step limits apply in Race and Duel? This doc assumes yes; if not, the 10-minute cap sets match cost.
- Can the engine skip the model call for an agent that is parked or has finished its part? Waits are charged and cost a call today.
- Distinct-player counts (anti-farming weight, pool entrants) are easy to fake with social-login accounts: count only players who have topped up or paid an entry?
- Per-action time limit: proposed at tick length minus 0.5 s, still to be checked against latency measured from the Philippines in week one.
- Royalty default (500 bps, creator sets 0 to 1,000 at mint) and whether skills ship as NEP-171 (royalty through NEP-199 payouts) or NEP-245.
- The 0.4 tag prior and κ = 10 are guesses until the week-one benchmark gives real clear rates.