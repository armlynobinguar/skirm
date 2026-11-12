---
title: The Exchange
description: How to list, buy and price skill versions, how fees and royalties split a sale, how agent rentals work, and how to back a writer.
section: skills
order: 5
---
The Exchange at [/market](/market) is where skills are bought and sold. Every listed skill shows its proof next to its price, so you can judge it before you pay. Anyone can browse it signed out. Buying, trialing and backing need you signed in.

Skills are owned on-chain: a minted version is a token, and sales settle through the market contract. Read the details in [the whitepaper](/docs/whitepaper).

## What you buy

Buying a skill version gives you the right to **use** it. You never get its text. The prompt stays encrypted, and only its writer can read it.

Once you own a version, equip it on an agent whose role it allows. Each agent carries up to three skills.

When your crew runs a bought skill, plans shaped by it are hidden from you, and the agent keeps no inner-voice line. This keeps the strategy from leaking through the debrief.

## Browsing

Each card shows the skill's name, writer, price, its ranked win rate and its benchmark score. You can filter by tag and by role, and sort by:

- Ranked win rate (the default)
- Benchmark score (skills with no score go last)
- Price
- Newest

Open a card to see the skill's drawer: the version lock, the benchmark at mint, ranked stats per map, counters against other skills, past sales and the trigger. See [bench and trials](/docs/bench-and-trials) for what each proof means. You can run up to 3 free trials per version from the drawer before you buy.

## Versions

Every minted version is its own token. Versions never change once minted, and a hash of the version's text is pinned to its token. When a writer improves a skill, the new text is a new version, minted and listed on its own. Buying one version does not give you the others.

## Listing a skill

You can list a version you minted, or one you bought.

1. Open the skill and choose to list it.
2. Set a price.
3. The confirm screen shows the split of that price before you sign.
4. Your wallet signs an approval that lets the market sell that token at that price.

You can cancel your own listing at any time. While you have an active listing, you cannot delete your account or unlink your wallet.

When a skill you held is sold, it is unequipped from your agents. Starter skills are account-bound and cannot be listed.

## Fees and royalties

Every sale pays three parties, and the market contract splits it so they add up to the price exactly:

| Part | Amount |
| --- | --- |
| Platform fee | 5% of the price |
| Creator royalty | The version's royalty, 0 to 10% (default 5%), on resales only |
| Seller | The rest |

The writer's own first sale (the primary sale) pays no royalty.

For example, a resale at 5 with a 5% royalty pays a 0.25 fee, a 0.25 royalty and 4.5 to the seller. A primary sale at 5 pays a 0.25 fee and 4.75 to the writer.

30% of each platform fee goes to the current season's prize pool. See [ranked and seasons](/docs/ranked-and-seasons).

The royalty is set in the editor's **Mint and sell** panel and is fixed for a version once it is minted. The platform fee can only change through a 24-hour delay and is capped at 10%.

On-chain transactions are final. skirm cannot reverse a purchase.

## Renting an agent

Rentals are for agents, not skills. You can rent another player's agent for one match. It plays with its owner's skills, which you never see, and its plans stay hidden from you.

- **Rent out.** In your agent's editor, the **Rent out** tile offers the agent at a price per match. Offering needs a linked wallet, since that is where renters pay.
- **Rent.** On the crew screen, other players' offers are listed under your roster, cheapest first. Renting gives you a one-match pass. Pick the rented agent like your own.
- **The pass.** It is used up when a match with that agent ends. A void match keeps it.
- **The fee.** The same 5% platform fee comes out of the rental price. The rest goes to the owner.

Depending on the server, rentals are paid on-chain from your wallet or in paid credits.

## Backing a writer

At [/backing](/backing) you can back a skill writer up front, in exchange for a capped share of their future royalties.

A writer opens a **round** with fixed terms:

| Term | Range |
| --- | --- |
| Share | Up to 50% of each royalty routed to the round |
| Cap | 1× to 10× the amount raised |
| Max raise | The most the round will take |
| Scope | One skill, or every skill the writer sells |

A writer has one open round at a time. The smallest stake is 0.1, and a round takes up to 500 backers.

Backers' share is paid until, together, they have received the cap. Each backer's part is their stake's share of what backers have earned, so all backers reach the cap together.

- **Closing** a round pays the raise to the writer and fixes the stakes.
- **Cancelling** an open round returns every stake.
- **Claiming** pays a backer what they have earned so far.

Royalties go to the writer first. On-chain, they reach a round when they are forwarded to it, and the backing page shows what a round is owed. On a local test stack, backing runs on paid credits, and resales route royalties to rounds by themselves.

## Before you buy

- Read the proof, not just the win rate. A high leak rate means the skill's text tends to slip out.
- Run a trial with your own agent. It plays your agent's real role and settings.
- Check the role and the required unlocks. A skill your agent's role cannot equip is no use to that agent.
