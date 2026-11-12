---
title: Maps and hazards
description: The ten official maps, their goals and hazards, switches, supply drops and tools, difficulty levels, the atlas and community maps.
section: playing
order: 2
---
Every skirm map is mirrored: both crews start on opposite sides of the same layout, with the delivery point, switches and supply drops on the centre column. Each map has a goal item and a delivery point. The first crew to deliver the goal wins.

## The ten maps

Browse them in the map atlas at [/maps](/maps). Goals below are on Normal, the level ranked plays.

| Code | Map | Label | Hazard | Carry | Goal |
| --- | --- | --- | --- | --- | --- |
| SW-01 | Saltmarsh Weir | Tutorial | Water | Water jug to the Stilt shelter | 2 |
| AO-02 | Ashfall Orchard | Starter | Fire | Seed pack to the Root cellar | 3 |
| FD-03 | Frostline Depot | Starter | None, ice | Heat pack to the Warm room | 3 |
| GR-04 | Glasshouse Ruins | Standard | Fire | Seed vial to the Garden gate | 4 |
| CH-05 | Copper Hollow | Standard | Water | Lamp oil to the Cage lift | 4 |
| DB-06 | Dust Bowl Silos | Standard | Fire | Water tank to the Storm cellar | 4 |
| MT-07 | Monsoon Terraces | Veteran | Water | Rice sack to the Village hut | 5 |
| SM-08 | Sunken Metro | Veteran | Water, gas, live rails | Med kit to the Exit stairs | 5 |
| BS-09 | Basalt Stair | Extreme | Lava | Ash mask to the Cave mouth | 6 |
| BH-10 | Blackout Harbor | Elite | Water and fire | Flare to the Lighthouse | 6 |

Copper Hollow is the default practice map and today's ranked rotation map.

### Map rules

Three switches on a map change how it plays:

- **Fog.** Your crew sees only what its agents see. On from Glasshouse Ruins onward.
- **Steal.** A knocked-down agent drops its items next to it, and either crew can pick them up. Without steal, items go back where they came from. On wherever fog is on.
- **Night.** Vision is one tile shorter. On Basalt Stair and Blackout Harbor.

## Hazards

Hazards spread in waves. Each one grows one wave every few ticks, up to a cap, then recedes wave by wave, then grows again.

| Hazard | What it does |
| --- | --- |
| Water | Knocks down any agent it reaches for 4 ticks. The agent drops what it carries. |
| Fire | Knocks down any agent it reaches. A Firefighter can put it out. |
| Lava | Removes any agent it reaches from the match, with everything it carries. Only placed stone or a dug channel slows it. |
| Gas | Vents puff clouds that drift and thin. An agent standing in gas loses every other action. |
| Live water | Sparking cables electrify the water they touch. An agent on or next to it is stunned for 2 ticks. |
| Ice | Not a hazard that spreads. A mover that steps onto ice slides one more tile the same way. |

Each map names its own verbs, such as **Dig rubble** on Copper Hollow or **Beat out flames** on Ashfall Orchard, and the atlas's **Details** drawer lists them. Pick roles that answer the map's hazards. See [Agents and roles](/docs/agents-and-roles).

## Switches

Most maps have shared switches on the centre column. An agent next to one can pull it to fill the **rival's** lane with water, fire or dirt for 8 ticks. Then the switch resets for 26 ticks. Both crews can use it, so the best time is when the rival is carrying. An Engineer can pull one from 2 tiles away.

Examples: **Start the pump** on Copper Hollow and **Trigger a rockslide** on Basalt Stair.

## Supply drops and tools

A supply drop lands an extra goal item in the middle at a set tick: tick 40 on most maps, ticks 35 and 70 on the larger ones. Both crews know it is coming. Saltmarsh Weir has none.

On some water maps a drop also carries a tool. An agent that steps on it takes the tool if it holds none. It keeps the tool when knocked down.

| Tool | Use | Maps |
| --- | --- | --- |
| Sandbags | Place on an adjacent open tile. Water never spreads into it again. Agents step over it. | Copper Hollow, Blackout Harbor |
| Pump | Place on an adjacent tile. Drains water within 2 tiles over 3 ticks, then it is spent. | Monsoon Terraces, Sunken Metro, Blackout Harbor |
| Bridge | Place on adjacent water. Agents walk on it and water there never knocks them down. | Monsoon Terraces, Sunken Metro |

## Difficulty levels

Casual and practice let you pick a level. Ranked always plays Normal.

| Level | Hazards | Goal | Clock | Other |
| --- | --- | --- | --- | --- |
| Easy | Slower | One fewer | 5:00 | The practice bot waits 12 s |
| Normal | As designed | As designed | 5:00 | Ranked plays this |
| Hard | Faster | Same | 4:30 | |
| Agentic | Faster | One more | 4:30 | Fog everywhere; the bot talks on Open and bluffs often |
| Mega Agentic | Fastest | One more | 4:00 | Night fog; the bot fields a full crew on Open |

## The atlas

In the atlas at [/maps](/maps), pick a map and a level to see the goal. Click the map's number to open **Practice**, **Ranked** or **Details**.

## Community maps and the editor

The **Community** tab at [/maps?tab=community](/maps?tab=community) lists maps other players made. They play in practice and casual, never in ranked or lobbies.

Make your own in the editor at [/maps/editor](/maps/editor):

1. Paint tiles from the palette: floor, walls, rubble, hazard sources, goal items, the delivery point, spawns, switches and their lanes, and supply drops. The mirror helper paints the other half for you.
2. Set names, rules, verbs, hazards, switches and drops. Problems show under the board and on their tiles as you work.
3. **Save** keeps a draft. **Test play** runs a few bot-vs-bot matches and shows both sides' wins.
4. **Publish** checks the map again. It must be mirrored, walled, fair and playable, and its text passes the speech filter.

A published map never changes. You can publish at most 3 maps a day.
