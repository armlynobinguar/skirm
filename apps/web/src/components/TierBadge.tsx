// Ranked tier badge (Bronze to Master, DEFAULTS.ranked in @skirm/shared): the tier name on its
// colour, or "Placement n/5" while the player's placement matches are left. Used on the profile, the
// account dock in the top bar, the match found screens and the leaderboards.
import { playerTier, type PlayerTier } from '@skirm/shared';
import s from './TierBadge.module.css';

/** The tier the API sent, or the same rule run on Elo and ranked matches (older payloads, fixtures). */
export function tierFrom(rank: { elo: number; rankedMatches: number; tier?: PlayerTier | undefined }): PlayerTier {
  return rank.tier ?? playerTier(rank.elo, rank.rankedMatches);
}

/** Short text for a tier: its name, or the placement progress. */
export function tierText(t: PlayerTier): string {
  return t.tier ?? `Placement ${t.placementsPlayed}/${t.placementMatches}`;
}

export function TierBadge({ tier, size = 'md', testId }: { tier: PlayerTier; size?: 'sm' | 'md'; testId?: string }) {
  const name = tier.tier;
  const title = name
    ? tier.nextAt !== null
      ? `${name} tier · next tier at ${tier.nextAt} Elo`
      : `${name} tier · the top tier`
    : `Placement: ${tier.placementsPlayed} of ${tier.placementMatches} ranked matches played; the tier shows after ${tier.placementMatches}`;
  return (
    <span
      className={`${s.badge} ${size === 'sm' ? s.sm : ''}`}
      data-tier={name ?? 'placement'}
      title={title}
      data-testid={testId}
    >
      <i className={s.gem} aria-hidden="true" />
      {tierText(tier)}
    </span>
  );
}
