// GET /v2/matches/:id/log (docs/backend-contract.md): the hash-chained match log of
// @skirm/engine/v2 (log.ts), as served publicly once the match is over.
import type { LogHeader, LogTick, MatchResult } from '@skirm/engine/v2';

/** A logged tick; one that carried live crew commands is served without them and marked `redacted`. */
export type PublicLogTick = LogTick & { redacted?: true };

export interface PublicMatchLog {
  matchId: string;
  /** The final hash the server stored for the match (null when none was kept). */
  logHash: string | null;
  log: {
    header: LogHeader;
    ticks: PublicLogTick[];
    /** Hash after the header and after each tick. */
    hashes: string[];
    result: MatchResult | null;
  };
}
