---
title: Writing your first skill
description: A worked example built on Flood Warden, the starter skill, from a blank editor to an equipped and tested skill.
section: skills
order: 2
---
This page walks you through one skill from start to finish. It uses **Flood Warden**, the starter skill every account gets, as the model. You will write your own skill in the same shape, test it, and put it on an agent.

If you have not read it yet, start with [what is a skill](/docs/what-is-a-skill).

## Flood Warden, field by field

Flood Warden is equipped on Rook when your account is made. You cannot edit it, but you can study it. These are its real fields:

| Field | Value |
| --- | --- |
| Name | Flood Warden |
| Description | Seals the leak before it spreads, then does the job. |
| Required unlocks | Builder (it needs the `place_block` action) |
| Handled tags | spreads, liquid |
| Creator royalty | 5% |

Its prompt:

```
Before any task, find every tile tagged spreads+liquid that touches open floor through a gap one tile wide. Work out the tick it reaches the gap from its spread interval. If you can stand next to the gap before then, go there first and place a block in it. Only then start the goal.
```

Its reflexes:

```
If a spreads+liquid tile is 1 tile from an open gap and place_block is legal toward the gap, place it.
```

Look at what makes this work:

- **One job.** It handles one threat: water getting through a narrow gap.
- **An order of work.** First the gap, "only then" the goal. The agent knows when to stop defending.
- **A test the agent can run.** It compares the tick the water arrives with the time it takes to get there.
- **A concrete action.** It names `place_block`, the Builder's action, so the agent knows what to do.

The editor shows a version of this text as placeholder hints when you open a blank skill.

## Step 1: open the editor

Go to [/skills/new](/skills/new). You can also start from **My skills** at [/skills](/skills). That screen also lists starter templates (such as Flood Plug, Steady Hauler and Crew Caller) that you can copy into a new draft of your own and change.

## Step 2: name and describe it

Pick a **Name**: 3 to 32 letters, digits, spaces, - and '. It shows wherever the skill appears.

Write a **Description** of up to 140 characters. This is for people browsing the Exchange. Agents never read it.

## Step 3: write the prompt

The **Prompt** is the part the model reads. You have 1,200 characters, and it cannot be blank.

Write it as orders to one agent. The model sees the board as text, with a map key from the rules: `~` water, `^` fire, `L` lava, `B` block, `V` switch, `*` item, `E` the delivery point, `?` not seen yet. Its legal actions are listed as text such as `move N` or `place_block E`. Naming what the agent actually sees makes your orders easy to follow.

Here is one way to write a Flood Warden of your own:

```
First, look for water (~) next to a one-tile gap that opens onto floor on your side. If you can reach a tile beside that gap before the water does, go there and place_block toward the gap. Seal at most two gaps, and never block your own route to E. Then collect the nearest item and deliver it.
```

Keep the most important rule in the Prompt. The current match code builds the model call from the Prompt field.

## Step 4: reflexes (optional)

The **Reflexes** field takes up to 400 characters. Use it for short if-then rules, like Flood Warden does. It is sealed and locked with the version. Do not put anything here that the agent needs and the Prompt lacks.

## Step 5: what it needs and handles

On the right side of the editor:

- **Required unlocks.** Tick Builder, Digger or Firefighter if the skill depends on `place_block`, `dig` or `extinguish`. Maps without that unlock will show the skill as not usable. Leave all unticked and it fits every map.
- **Handled tags.** Pick at least one, up to ten. For a flood skill, spreads and liquid. Tags drive the Exchange filters; agents never see them.
- **For roles.** Leave **Any role**, or pick roles to make it a role slot skill. A flood skill that needs blocks fits a Builder.

## Step 6: when it plays

Under **When it plays**, pick a trigger. A flood skill does not need to be in the prompt when no water is around. Pick **Hazard nearby** and set it to a few tiles. The skill then joins the prompt only on ticks a hazard is that close in the agent's own view.

Leave it on **Always** if the skill should shape every move.

## Step 7: save

Press **Save draft**. That writes version 1. Each later save shows **Save as v2**, **Save as v3** and so on. Every saved version stays as it was.

If a save fails, the editor keeps your text in this browser so you do not lose it.

## Step 8: test it on the bench

Open the [skill bench](/skills/bench), pick your skill and version, a map and a difficulty, and run it against the greedy bot. Change the prompt, run the same seed again, and compare the two runs side by side. See [bench and trials](/docs/bench-and-trials).

## Step 9: equip it

Open an agent from the command deck. Its editor has skill slots for the skills you own: click one to equip it. The agent must play a role the skill allows. Each agent carries up to three skills.

Then play a [practice match](/docs/quickstart) and open the debrief. The decision timeline shows, per tick, the skill behind a move when the model named one. See [the debrief](/docs/the-debrief).

## Step 10: mint it (when you are ready)

The **Mint and sell** panel sets the **Creator royalty on resale** (0 to 10%, default 5%) and mints the saved version on-chain. Minting needs a wallet. It locks that version for good, and it queues a hidden benchmark of it. Later edits save as a new version.

Starter skills like Flood Warden are account-bound and are never minted. Read on: [the Exchange](/docs/the-exchange).
