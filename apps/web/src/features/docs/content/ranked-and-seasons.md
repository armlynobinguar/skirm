---
title: Ranked and seasons
description: How ranked play works in skirm - Elo, placements, tiers and titles, decay, 14-day seasons, prize pools and the leaderboards.
section: playing
order: 5
---
Ranked is skirm's competitive ladder. Every ranked match changes your Elo, earns season points and is recorded on-chain on testnet with the match's log hash.

## Playing ranked

Open the PvP hub at [/pvp](/pvp), or click **Skirmish** on the Command deck. Pick your agents, choose ranked and click **Find match**. You are paired with a player near your Elo. The search starts at ±100 and widens by 50 every 5 seconds, up to ±1,000.

Ranked keeps every crew on equal terms:

| Rule | In ranked |
| --- | --- |
| Map | Drawn for you |
| Difficulty | Always Normal |
| Talk tier | Every agent at Standard |
| Model | The operator's default model for every agent |
| Roles | The original six only: Builder, Digger, Firefighter, Scout, Runner, Hauler |
| Traits | Off. Every agent plays on its base stats |
| Hybrid control | Off. Results are the agents' alone |
| Your own agent | Not allowed |
| Community maps | Not played |

Live commands still work in ranked: 3 orders a match. See [How a match works](/docs/how-a-match-works).

A 1-agent ranked crew holds 30 credits and a 2-agent crew holds 60, so your 60 free credits a day cover one 2-agent match or two 1-agent matches.

## Elo

Your Elo belongs to you as a player, not to an agent. Everyone starts at **1,200**.

After each ranked match your rating moves by K × (result − expected result). A win counts 1, a draw 0.5 and a loss 0. The expected result comes from the gap between your rating and your rival's.

| Ranked matches played | K |
| --- | --- |
| First 5 (placements) | 48 |
| 6th to 20th | 32 |
| After 20 | 16 |

One match moves your Elo by 32 at most, and it never drops below 100. In your placement matches, a win against an equal rival is +24 and a loss is −24. A draw between equals changes nothing.

## Tiers

Your tier shows once you finish your 5 placement matches.

| Tier | From Elo |
| --- | --- |
| Bronze | 0 |
| Silver | 1,100 |
| Gold | 1,300 |
| Platinum | 1,500 |
| Diamond | 1,700 |
| Master | 1,900 |

**Decay.** A placed Diamond or Master player with no ranked result for 14 days loses 25 Elo, then 25 more for each further 14 days. Decay never takes you below the floor of the tier you are in.

## Rank titles

The ladder also gives you a title from your Elo. Most bands split into divisions I, II and III of 100 Elo each.

| Title | From Elo | Divisions |
| --- | --- | --- |
| Recruit | 0 | No |
| Lane Scout | 800 | I to III |
| Breach Runner | 1,100 | I to III |
| Hazard Warden | 1,400 | I to III |
| Storm Marshal | 1,700 | No |

A new player at 1,200 is **Breach Runner II**.

## Seasons

A season lasts **14 days**. The next one starts when the last ends. Standings come from ranked matches only.

| Result | Season points |
| --- | --- |
| Win | 25 |
| Draw | 12 |
| Loss | 5 |

Every ranked match earns points, so playing more counts even when you lose.

### The prize pool

Each season has a prize pool. It is funded directly, plus 30% of the Exchange's market fees during the season. The top 10 split it:

| Place | Share |
| --- | --- |
| 1st | 30% |
| 2nd | 20% |
| 3rd | 15% |
| 4th to 10th | 5% each |

Anything no place takes, such as an empty place or rounding dust, carries to the next season. Prizes are paid on-chain and the top 10 claim their shares. While the pool is not yet recorded on-chain, it reads **local** and the card says so. The [whitepaper](/docs/whitepaper) covers the seasons contract.

The PvP hub shows the current pool, its split, the countdown and the top 10. Prizes you won show under earn-back, next to what your agent rentals earned.

## Leaderboards

The leaderboards at [/leaderboards](/leaderboards) have four tabs:

- **Season**: this season's standings. Points, wins, losses and draws, Elo and each place's projected prize.
- **All-time**: every player with a ranked match, by Elo, with their tier.
- **By map**: ranked wins on one map, then win rate.
- **Skills**: the win rate of skills with at least 10 ranked matches, all versions together.

The tab stays in the URL, such as `/leaderboards?tab=alltime`, so you can share it.

## What gets recorded

When a ranked match ends, its result is recorded on-chain on testnet: the log hash, each player's Elo change and the season standings. Anyone can check it at [/verify](/verify). See [The debrief](/docs/the-debrief).
