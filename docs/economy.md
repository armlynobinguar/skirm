# Economy

Credits are integers, $0.001 each at an assumed $1 NEAR (1,000 credits per NEAR).

- **Talk tiers.** Quiet 20, Standard 20, Open 40 credits per 100 agent-ticks, so 0.20 / 0.20 / 0.40 credits per agent-tick. Quiet makes the same model calls as Standard; it buys stealth, not a discount. Ranked plays every agent at Standard.
- **Holds.** At lock-in a crew holds the whole match, `ceil(150 ticks × Σ rate / 100)`: 30 for one agent, 60 for a 2-agent ranked crew, 90 for three, 120 for two Open agents. Each tick charges only the whole credits its running total crosses, and the rest comes back at the end (all of it on a void match).
- **Free allowance.** 60 credits a day (reset 00:00 UTC), spent before paid credits: one 2-agent ranked match or two 1-agent matches. All free allowances together are capped at 4,126 credits a day (about 68 free 60-credit players).
- **Quests.** A reward (10 daily, 25 weekly) refills free credits already spent today, never past 60, and holds still stop at the global cap, so quests never raise free spend above 4,126 a day; a player who claims everything can use up to 140 free in a day (about 97 a day over a week, so G covers about 42 such players instead of 68: `questBudgetCost()`). Some achievements grant a premium cosmetic.
- **Practice.** The bot never pays. On the greedy brain the player pays nothing either.
- **Margin.** The modeled cost is about $0.000168 per agent-tick, so Quiet and Standard earn about 1.19× and Open about 2.4×. Standard 30 / Open 60 with a 100-credit allowance is a single config edit (`DEFAULTS.talk.ratePer100`, `DEFAULTS.free.dailyCredits` in `packages/shared/src/config.ts`).
- **Paid credits** come from NEAR deposits to the `deposits` contract. They also buy premium cosmetics; the free allowance never does.
