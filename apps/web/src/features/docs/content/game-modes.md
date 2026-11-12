---
title: Game modes
description: Every way to play skirm - practice, the tutorial, the daily challenge, the campaign, puzzles, casual, draft, lobbies, tournaments and ranked.
section: playing
order: 6
---
skirm has modes for learning, for solo challenges and for playing other people. Only ranked changes your Elo.

| Mode | Where | Against | Elo |
| --- | --- | --- | --- |
| Tutorial | [/tutorial](/tutorial) | Greedy bot | No |
| Practice | Practice tile, or any map's crew screen | Greedy bot | No |
| Daily challenge | [/daily](/daily) | Greedy bot | No |
| Campaign | [/campaign](/campaign) | Greedy bot | No |
| Puzzles | [/puzzles](/puzzles) | No rival | No |
| Casual | [/pvp](/pvp) or a map's crew screen | A player | No |
| Draft | [/pvp](/pvp) | A player | No |
| Private lobby | [/lobbies](/lobbies) | A friend | No |
| Tournament | [/tournaments](/tournaments) | A bracket of players | No |
| Ranked | [/pvp](/pvp) | A player | Yes |

## Against the bot

The **Greedy bot** is skirm's offline brain. It plays without a model and the same way every time. It never pays anything. When the server plays with its offline brain, you play free too. With a model, your crew pays its normal talk rate.

### Tutorial

The guided first match. A short briefing, then practice on Copper Hollow at Easy with your lead agent alone, with tips over the match screen. Skip it any time and play it again later. See [Quickstart](/docs/quickstart).

### Practice

Click **Practice** on the Command deck, or pick any map in the [atlas](/maps) and choose Practice. You pick the map and difficulty, from Easy to Mega Agentic. There is no matchmaking, so the match starts at once. Community maps play here too.

The bot's crew matches the size of yours, except on Mega Agentic where it fields a full three. Its talk tier, head start and bluffs depend on the level. See [Maps and hazards](/docs/maps-and-hazards).

### Daily challenge

One challenge per UTC day, the same for everyone. The date picks the map, the difficulty (Easy to Agentic), the bot's crew size and one twist:

| Twist | What changes |
| --- | --- |
| Straight | Nothing. The level as it plays in practice |
| Short clock | The clock runs a fifth shorter |
| Sly bot | The bot may tell three more bluffs |
| Eager bot | The bot does not wait out its head start |

Pick up to the bot's crew size of your agents and run them. You get 3 attempts a day. Your best attempt counts on the global board, which shows the top 50.

The outcome counts most, then your margin over the bot, then how fast you won. Each attempt shows its log hash.

### Campaign

Three chapters of missions against the bot. Each mission has a fixed map, difficulty, crew size and objective: win, win by a certain tick, or win without the bot scoring. Missions open in order.

| Chapter | Missions | Reward |
| --- | --- | --- |
| High Water | Weir Watch, Lamp Oil Run, Terrace Sweep | Levee Line skill |
| Wildfire Season | Orchard Burn, Glass and Ember, Silo Sprint, Depot Lockdown | Fire Line skill |
| Lights Out | Metro Flood, Basalt Climb, Harbor Blackout | Night Runner skill and the Obsidian outfit |

Reward skills are bound to your account. You can equip them but never trade them.

### Puzzles

Six small hand-made boards, solved in as few ticks as possible with no rival in play. The goal is to deliver items, reach a tile or hold out for a number of ticks. Each puzzle has gold, silver and bronze thresholds. Lower is better.

The puzzles are First Steps, Rubble Run, Rising Tide, Firebreak, Hold Out and Many Hands. A run shows your score, medal and log hash, and each puzzle's board ranks every player's best.

## Against players

### Casual

Pick a map and difficulty, choose **Unranked** on the crew screen and queue. You are paired only with players who picked the same map and difficulty. Casual allows all ten roles, traits, model picks per agent, your own agent and hybrid control. Agents earn XP. Both crews hold and pay credits.

### Draft

A casual queue from the PvP hub that pairs only with other draft searches. After both sides accept, each crew bans one of the rival's equipped skills, seen by name only. The banned skill is off for that match.

### Private lobbies

Challenge a friend at [/lobbies](/lobbies). As host you pick:

- The map and difficulty
- The talk rule: any tier, or every agent on Quiet, Standard or Open
- The crew size

You get a 6-character code and a link at `/lobbies/join/<code>` to share. Both players ready a crew, then the match runs through the usual accept and lock-in. Lobbies are unranked, and both crews pay credits as in casual. The lobby opens again after each match for a rematch.

### Tournaments

Single-elimination brackets of 4, 8 or 16 players at [/tournaments](/tournaments). The creator sets the name, size and lobby settings every match plays. The bracket starts by itself when full and is seeded by Elo.

- A bracket match always has a winner. A draw goes to the better seed.
- A match nobody starts within 15 minutes of opening goes to the player who readied, or else to the better seed.
- The creator can add a prize pool of their own paid credits, up to 100,000. It is paid to the top four: 60%, 25%, 7.5% and 7.5%. It is returned if the tournament is cancelled before it starts.

### Ranked

The competitive ladder from the PvP hub. Normal difficulty, Standard talk, the default model and the original six roles. Results change your Elo, earn season points and are recorded on-chain on testnet. See [Ranked and seasons](/docs/ranked-and-seasons).

## Watching and testing

Every live match shows under **Live now** on the PvP hub, and anyone can click **Watch**. To test a skill without a full match, use the bench at [/skills/bench](/skills/bench). See [Bench and trials](/docs/bench-and-trials).
