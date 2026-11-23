// Sealed loadouts (Zama FHEVM on Sepolia): the game server's read side of packages/fhevm
// SkirmMatch.sol. Both players seal an encrypted loadout on chain; once the reveal is finalized the
// contract holds the verified plaintexts, and this module reads them back and turns them into the
// crew that plays. The server holds no key and sends no transaction: it only reads.
//
// Gated by ZAMA_ENABLED. Env: SEPOLIA_RPC_URL, and optionally ZAMA_MATCH_ADDRESS (default: the
// SkirmMatch address in packages/fhevm/deployments/sepolia.json, via @skirm/fhevm/generated).
import { SkirmMatchAbi, sepolia } from '@skirm/fhevm/generated';
import { SealedLoadoutError, decodeLoadout, type DecodedPick, type EncodedLoadout, type SealedRosterAgent } from '@skirm/shared';
import { Contract, JsonRpcProvider, id as keccakUtf8 } from 'ethers';

export const SEALED_MATCH_STATUSES = ['none', 'open', 'locked', 'revealing', 'revealed', 'forfeited', 'cancelled'] as const;
/** SkirmMatch.Status, by name. */
export type SealedMatchStatus = (typeof SEALED_MATCH_STATUSES)[number];

/** What the chain says about one match. */
export interface SealedMatchState {
  status: SealedMatchStatus;
  /** Side 0 (team A) and side 1 (team B), lower-case; the zero address is a seat nobody claimed. */
  players: [string, string];
  locked: [boolean, boolean];
  /** The verified plaintexts per side, once status is `revealed`; else null. */
  revealed: [EncodedLoadout, EncodedLoadout] | null;
}

/** Reads a match from SkirmMatch (mocked in tests). */
export interface SealedMatchReader {
  read(matchId: string): Promise<SealedMatchState>;
}

export interface ZamaServerConfig {
  enabled: boolean;
  rpcUrl: string;
  /** SkirmMatch address, or null when it is not deployed (the feature then stays off). */
  matchAddress: string | null;
}

const DEFAULT_SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** ZAMA_ENABLED=1|true, SEPOLIA_RPC_URL, ZAMA_MATCH_ADDRESS (else the deployments file). */
export function zamaServerConfig(env: Record<string, string | undefined> = process.env): ZamaServerConfig {
  const flag = env.ZAMA_ENABLED?.trim();
  const override = env.ZAMA_MATCH_ADDRESS?.trim();
  const matchAddress = override && ADDRESS_RE.test(override) ? override : sepolia.contracts.SkirmMatch;
  return {
    enabled: flag === '1' || flag === 'true',
    rpcUrl: env.SEPOLIA_RPC_URL?.trim() || DEFAULT_SEPOLIA_RPC,
    matchAddress,
  };
}

/** The on-chain id of an off-chain match: keccak256 of its id's UTF-8 bytes (the web computes the same). */
export function sealedMatchKey(matchId: string): string {
  return keccakUtf8(matchId);
}

/** Team A is side 0, team B side 1. */
export const sideOf = (team: 'A' | 'B'): 0 | 1 => (team === 'A' ? 0 : 1);

const triple = (v: readonly unknown[]): [number, number, number] => [Number(v[0]), Number(v[1]), Number(v[2])];

/** SkirmMatch over JSON-RPC (ethers). */
export class EthersSealedMatchReader implements SealedMatchReader {
  private readonly contract: Contract;

  constructor(address: string, rpcUrl: string) {
    this.contract = new Contract(address, SkirmMatchAbi, new JsonRpcProvider(rpcUrl, sepolia.chainId, { staticNetwork: true }));
  }

  async read(matchId: string): Promise<SealedMatchState> {
    const key = sealedMatchKey(matchId);
    const m = (await this.contract.getFunction('getMatch')(key)) as { players: string[]; status: bigint; locked: boolean[] };
    const status = SEALED_MATCH_STATUSES[Number(m.status)] ?? 'none';
    let revealed: SealedMatchState['revealed'] = null;
    if (status === 'revealed') {
      const sides = await Promise.all([0, 1].map((s) => this.contract.getFunction('revealedLoadout')(key, s)));
      revealed = sides.map((r: { agents: unknown[]; skills: unknown[]; tiers: unknown[] }) => ({
        agents: triple(r.agents),
        skills: triple(r.skills),
        tiers: triple(r.tiers),
      })) as [EncodedLoadout, EncodedLoadout];
    }
    return {
      status,
      players: [String(m.players[0]).toLowerCase(), String(m.players[1]).toLowerCase()],
      locked: [!!m.locked[0], !!m.locked[1]],
      revealed,
    };
  }
}

/** The reader when the feature is on and SkirmMatch is deployed, else null. */
export function createSealedMatchReader(cfg: ZamaServerConfig = zamaServerConfig()): SealedMatchReader | null {
  if (!cfg.enabled || !cfg.matchAddress) return null;
  return new EthersSealedMatchReader(cfg.matchAddress, cfg.rpcUrl);
}

export class SealedMatchError extends Error {
  constructor(
    readonly code: 'not_revealed' | 'wrong_player' | 'invalid_loadout',
    message: string,
  ) {
    super(message);
    this.name = 'SealedMatchError';
  }
}

/**
 * The crew `team` sealed, as the chain revealed it: the authoritative picks for the match. Refuses
 * a match that is not revealed yet, a seat held by another address than the one the player declared,
 * and plaintexts that do not decode against the player's roster.
 */
export function revealedCrew(state: SealedMatchState, team: 'A' | 'B', address: string, roster: readonly SealedRosterAgent[]): DecodedPick[] {
  if (state.status !== 'revealed' || !state.revealed) throw new SealedMatchError('not_revealed', `the sealed loadouts are not revealed yet (${state.status})`);
  const side = sideOf(team);
  if (state.players[side] !== address.toLowerCase()) throw new SealedMatchError('wrong_player', `side ${team} was sealed by another address`);
  try {
    return decodeLoadout(state.revealed[side], roster);
  } catch (err) {
    if (err instanceof SealedLoadoutError) throw new SealedMatchError('invalid_loadout', err.message);
    throw err;
  }
}
