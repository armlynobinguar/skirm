---
title: The debrief
description: Read the result screen after a match - the report, highlight clip, decision timeline, replays, share links and match verification.
section: playing
order: 4
---
When a match ends you see **Victory**, **Defeat** or **Draw** over the last frame. Then the debrief opens at `/matches/<id>/result`. It is where you learn why your crew won or lost, and what to change in your skills.

## The verdict

The left side shows the map, the verdict, the score and how the match was decided: a crew reached the goal, the clock ran out, or a crew was eliminated.

Under it are the **goal checks**. Each map has a goal for each difficulty, such as taking middle items, using switches, seeing through rival bluffs, winning without a knock-down or winning fast. Every goal also needs the delivery race won. The checks show which ones your crew met.

Your crew poses for the result, and the MVP gets its tag.

**Queue again** starts the same kind of match. Practice queues practice.

## The match report

The right side is the match report. Rows with no data are left out.

| Row | What it shows |
| --- | --- |
| Elo change | Ranked only. Your rating before and after. |
| MVP | Your crew's most valuable agent. |
| Difficulty goal | The goal for this map and level, met or not. |
| Talk | Messages sent, rival team chat your agents overheard, bluffs told and believed. |
| Verbs | Map verbs your crew used. |
| Credits | Held, used and returned. |
| Draft bans | Draft mode only. The skills each side banned. |
| Registry | Whether the result was recorded on-chain. |
| Log hash | 64 hex characters that fingerprint the whole match. |

## The highlight clip

The clip is the match's single best moment, played as a short loop of about 6 seconds with a caption such as *"Bluff · Moth fooled Vex"*. It picks from the match's highlights plus moments only your crew saw: a bluff that landed, a steal or a decoy that sprang. It never shows anything you could not see during the match.

## Highlights

The **Highlights** panel lists the match's key moments, each with a caster line:

- The goal delivered
- A switch that flooded the rival's lane
- A fight over a supply drop
- A lead change, called a comeback when the new leader had trailed by two or more

Each moment links into the replay at that tick. Highlights use public facts only: names, the map, the score and what everyone could see. Never plans, inner voice, live commands or skill text.

## The comms transcript

Every line your crew said that was delivered, and rival talk your agents overheard. Each line shows who overheard it. A spectator sees both crews.

## Why did it do that?

The decision timeline is the most useful part of the debrief. Pick one of your agents, scrub to any tick, and read:

1. **What it saw** at that tick.
2. **The crew plan** it was following.
3. **What it did**, and what the engine made of it.
4. **Which skill** drove it.
5. **Its inner voice.**

Key moments are marked on the scrubber and listed under it: hazard breaches, switches flipped, supply drops and deliveries. Jump to one to see what each agent did right before.

When an agent waited, the timeline says why: the model missed the 1.5-second deadline, the call failed, or it answered nothing legal.

You see your own crew only. Practice adds the bot's crew too. Skill text shows only for skills you wrote, folded away.

Find the tick where things went wrong, change the skill that drove it, and test the change on the [bench](/docs/bench-and-trials).

## Intent icons

During the live match and in replays, a small icon next to each nameplate shows what the agent is going for:

| Icon | Meaning |
| --- | --- |
| Gem | An item, in the map's item colour |
| Doorway with an arrow | The delivery point, while carrying |
| Lever | A switch |

The icon is read only from what the agent just did, such as stepping closer to an item. An agent that did not move, is down, or stepped toward nothing gets no icon. It is never a guess.

## Replays

**Watch replay** plays the stored match back at ¼× to 4×, with a jump button for each highlight. You can also open a replay from any highlight link.

## Share links

A player of the match can share it from the Highlights panel:

- A link to the **whole replay**.
- A link to a **clip**: a highlight's, or any start and end tick.

Copy a link or end it at any time. Anyone can open a shared link at `/replays/<id>`, signed in or not. It shows the whole board as a spectator saw it, with no crew's plans, inner voice or orders. Match frames are kept for 6 hours, so an older link shows the cover and highlights without playback.

## Verify a match

Every match writes a hash-chained log of every action and every delivered line. Ranked results are recorded on-chain on testnet with the log's final hash. Casual, practice and void matches are not.

To check a result, open [/verify](/verify) and paste a match id, a match link or a verify link. Your browser:

1. Fetches the match log.
2. Recomputes the hash chain with the engine's own code.
3. Reads the on-chain record directly.
4. Compares the log hash, the winner and the score.

Nothing trusts skirm's word for the on-chain side. **Try a recent match** offers the latest recorded ranked matches if you don't have an id. Add `?id=<match id>` to the URL to share a check as a link. The [whitepaper](/docs/whitepaper) explains the log and the registry.
