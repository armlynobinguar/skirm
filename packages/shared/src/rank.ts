// Player rank titles on the v2 ladder: a name per 300 Elo band, split into divisions I–III of 100
// each. A new player starts at 1,200, Breach Runner II (the prototype's hub card).

export interface RankTier {
  /** Band name, e.g. "Breach Runner". */
  name: string;
  /** Lowest Elo of the band. */
  min: number;
  /** Divisions I–III of 100 Elo each; false for the open-ended bottom and top bands. */
  divisions: boolean;
}

/** Lowest band first. */
export const RANK_TIERS: readonly RankTier[] = [
  { name: 'Recruit', min: 0, divisions: false },
  { name: 'Lane Scout', min: 800, divisions: true },
  { name: 'Breach Runner', min: 1100, divisions: true },
  { name: 'Hazard Warden', min: 1400, divisions: true },
  { name: 'Storm Marshal', min: 1700, divisions: false },
];

export interface RankTitle {
  /** Full title, e.g. "Breach Runner II". */
  title: string;
  tier: string;
  /** 1–3, or null in a band without divisions. */
  division: 1 | 2 | 3 | null;
  /** Elo where the next title starts; null at the top. */
  nextAt: number | null;
}

const ROMAN = ['I', 'II', 'III'] as const;

/** The title for an Elo rating. */
export function rankTitle(elo: number): RankTitle {
  let i = RANK_TIERS.length - 1;
  while (i > 0 && elo < RANK_TIERS[i]!.min) i--;
  const t = RANK_TIERS[i]!;
  const next = RANK_TIERS[i + 1]?.min ?? null;
  if (!t.divisions) return { title: t.name, tier: t.name, division: null, nextAt: next };
  const d = Math.min(2, Math.floor((elo - t.min) / 100));
  return {
    title: `${t.name} ${ROMAN[d]}`,
    tier: t.name,
    division: (d + 1) as 1 | 2 | 3,
    nextAt: d < 2 ? t.min + (d + 1) * 100 : next,
  };
}
