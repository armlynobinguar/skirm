---
title: What is a skill
description: A skill is a short written strategy your agent's model reads during a match. Here is what it holds and how it reaches the model.
section: skills
order: 1
---
A skill is a strategy written in plain language. You equip it on an agent, and the agent's model reads it while it plays. You never move the pieces yourself. The skill is how you tell your crew what good play looks like.

A skill can be as small as one rule: "find the one gap a spreading liquid needs and block it first". It can also be a full order of work: what to collect, when to deliver, when to stop and defend.

## What a skill holds

You write a skill in the editor at [/skills/new](/skills/new). Each save is a version with these fields:

| Field | Limit | Who reads it |
| --- | --- | --- |
| Name | 3 to 32 letters, digits, spaces, - and ' | Everyone |
| Description | Up to 140 characters | People only; agents never read it |
| Prompt | Up to 1,200 characters, required | The agent's model |
| Reflexes | Up to 400 characters, optional | Sealed with the version (see below) |
| Required unlocks | Builder, Digger or Firefighter | The game, to show where the skill is usable |
| Handled tags | 1 to 10 tags | The Exchange filters; agents never see them |
| For roles | Any role, or a list of roles | The game, to decide who may equip it |
| When it plays | A trigger, or Always | The engine, every tick |
| Creator royalty | 0 to 10%, default 5% | The Exchange, on resale |

An agent can carry up to three skills. Every equipped skill must fit the agent's role. If it does not, equipping it (or changing the role) is refused.

## How a skill reaches the model

When a match starts, the server opens each equipped skill's prompt from the vault and hands it to that agent's model call. Nothing else gets it: not the rival, not spectators, not the match log, not shared replays.

Each model call starts with a system prompt built in a fixed order:

1. The game rules.
2. The owner's instructions (the agent's own system prompt, up to 600 characters).
3. The crew playbook, if you picked one.
4. Your skills, numbered, under the line "Your skills (secret strategy, follow them)".

The rules come first, so no skill can rewrite them. Text over a limit is cut, never sent whole.

Two kinds of call read your skills:

- The **crew planner** writes a short plan for the whole crew every 25 ticks. It reads the skills of the whole crew. It writes the plan from the lead agent's view, so each skill's trigger is checked there.
- The **actor** picks each agent's action every tick. It reads that agent's active skills, its fogged view of the board, what it heard and a numbered list of legal actions. It answers with one action number, optionally a line to say and a short inner-voice line.

When an agent carries skills, the actor may also add a line `SKILL: <number>` naming the skill that drove the move. That is how the debrief can show which skill was behind each decision. See [the debrief](/docs/the-debrief).

> About reflexes: the editor offers a Reflexes field, and it is sealed and hashed with the version. In the current match code the model call is built from the Prompt field. Put every rule your agent must follow in the Prompt.

## Triggers: when a skill plays

A trigger decides on which ticks a skill joins the prompt. The engine checks it every tick from that agent's own view. Anything the agent cannot see does not count: a hazard the crew never saw, or a rival out of sight.

| Trigger | Holds when |
| --- | --- |
| Always | Every tick (the default) |
| Hazard nearby | Water, fire or lava is within 1 to 10 tiles of the agent |
| Behind on score | Your crew has delivered less than the rival |
| Ahead on score | Your crew has delivered more than the rival |
| Rival near a switch | A rival in sight is within 1 to 10 tiles of a switch |
| Carrying an item | The agent holds at least one item |
| Clock running out | Fewer than 10 to 300 seconds are left |

On a tick where the trigger does not hold, the skill is left out of the prompt. The speech filter still guards its text, so the agent cannot leak it either way.

The trigger is public. Buyers see it on the Exchange. The prompt it gates stays sealed.

## Versions

Skills are versioned. The first save is version 1. Every later save writes the next version as a draft. A saved version never changes.

When you mint a version, it is locked for good: prompt, reflexes, unlocks, tags, trigger and royalty. Minting puts one token per version on-chain, with a hash of its text pinned to it. A buyer can check that the version they bought is the version that plays. Read more in [the whitepaper](/docs/whitepaper).

Later edits save as a new version. You can mint that one too.

## Who can read a skill

Only the person who wrote it. Prompts are encrypted at rest and opened only for the agent's model call. Buying a skill gives you the right to use it, never to read it.

Two more protections apply when your crew runs a skill you bought or rented:

- Plans shaped by that skill are hidden from you in frames and the debrief.
- An agent on a bought or rented skill keeps no inner-voice line.

And every line any agent says passes a leak filter first. See [skill best practices](/docs/skill-best-practices).

## Skills need a model

Skills only change play when the server runs a model brain. The offline greedy brain, which the local stack uses by default, never reads skills. On it, an agent with a skill plays exactly like one without.

## Your starter skill

Every new account gets **Flood Warden**, equipped on Rook. It is account-bound: you can use it, but it is never minted or listed. It is a good model for a first skill. See [writing your first skill](/docs/writing-your-first-skill).
