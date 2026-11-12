---
title: Agents and roles
description: The ten agent roles and what each one does, agent stats, skills, progression, looks and renaming.
section: playing
order: 1
---
An agent is one member of your crew. It has a name, a role, two stats, a talk tier, up to 3 skills and a look. You set all of these in the agent editor at `/agents/<id>`, which you open from the crew screen or your profile.

## Roles

A role decides which special actions an agent can take. Each map names its own actions, called **verbs**, and every verb belongs to a class. Four roles each own one class. Verbs of any other class are open to everyone.

| Role | What it does | Carries |
| --- | --- | --- |
| Builder | The only role that places blocks (`add_solid` verbs), from the crew's block supply. Walls off hazards and rivals. | 2 |
| Digger | The only role that clears rubble, blocks, crates and trees (`remove_solid` verbs). Walks through dirt in one move instead of three. | 2 |
| Firefighter | The only role that puts out fire next to it (`extinguish` verbs). | 2 |
| Scout | The only role that repels (`area_repel` verbs). Stuns rivals within 2 tiles for 3 ticks, once every 15 ticks. | 2 |
| Runner | Takes and delivers. | 2 |
| Hauler | Takes and delivers. | 3 |
| Medic | Tends a crewmate next to it. Takes 2 ticks off a knock-down and clears a stun, then waits 5 ticks. Never itself, never a rival. | 2 |
| Engineer | Pulls a switch from up to 2 tiles away. Lays 2 bridges of its own over water. | 2 |
| Saboteur | Plants up to 2 decoys on open floor. Rivals see a decoy as an item. A rival that steps on one loses its next action. | 2 |
| Courier | Moves 2 tiles per step on open ground. Rubble, walls and hazards stop the second tile. | 1 |

The first six are the original roles. Medic, Engineer, Saboteur and Courier play in casual, practice, lobbies, tournaments, the campaign, the daily challenge and puzzles, but not in ranked.

### Pick roles for the map

A role only helps where the map has a verb of its class. Copper Hollow has rubble to dig and tunnels to shore, so a Digger and a Builder both have work. It has no repel verb, so a Scout has nothing special to do there. The crew screen and the lock-in screen show how each agent's role fits the map you are about to play.

A Saboteur's decoys share the crew's bluff budget: bluffs told plus decoys planted never pass 3.

### Changing a role

Pick a role in the agent editor under **Role**. You can't change a role while the agent has a skill equipped that is not for that role, and you can't change gameplay settings while the agent is in a live match.

## Stats

| Stat | Range | What it does |
| --- | --- | --- |
| Vision | 1 to 5 | How far the agent sees: 1 + vision tiles, one less at night. |
| Comms | 1 to 5 | How far its voice carries: 2 + comms tiles. |

Every agent starts at vision 3 and comms 3. See [Comms and talk tiers](/docs/comms-and-talk-tiers) for how range shapes who hears what.

## Skills and instructions

Each agent can equip up to 3 skills you own. A skill is a sealed strategy in plain words. See [What is a skill](/docs/what-is-a-skill).

You can also give an agent a **system prompt** of up to 600 characters. The planner reads it ahead of the skill. **Reset** clears it, so the agent plays on its skills alone.

Each agent also has a default **talk tier** for unranked play. Ranked always plays Standard.

## Progression

In ranked and casual matches that end with a result, each agent earns XP. A ranked match gives 40, a casual one 25, plus 20 for a win or 10 for a draw, plus 2 per item it delivered (up to 10 items). Practice gives none.

Agents level up to level 10. At levels 3 and 6 you pick a **trait**, one small step on one stat, up to 2 per agent. Traits play in casual and practice. Ranked plays every agent on its base stats.

## Looks and gear

How an agent looks is purely cosmetic. The engine and scoring never read it. Open **Customize** on an agent from your [profile](/account) to change:

- Skin tone
- Hair style and hair colour
- Outfit colour and pants colour
- Build: slim, regular or sturdy
- Headgear: role gear, none, cap, bandana or beanie

**Role gear** shows the gear for the agent's specialty, such as a hard hat, headlamp or helmet. Every agent starts with a varied default look of free colours.

Some colours are premium, such as the Gold outfit for 100 credits. Premium looks use paid credits only, never the free allowance.

During a match, an agent can also carry one **tool** from a supply drop: sandbags, a pump or a bridge. A chip on the agent's card shows it. See [Maps and hazards](/docs/maps-and-hazards).

## Renaming

Click **Rename** on the agent's name plate in the editor. Press Enter to save or Escape to cancel. A name is 1 to 24 characters. It starts with a letter or digit, then letters, digits, spaces and `' - _ .` only.
