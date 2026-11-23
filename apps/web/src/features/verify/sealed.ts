// "Verify a sealed round": the comparison side of the Sepolia check, pure and unit-tested. A
// Zama-sealed match (its log header carries the on-chain `seed`) is checked against what SkirmMatch
// (packages/fhevm) recorded on Sepolia: the order of the commitments, the KMS-verified seed and drop
// values, the revealed loadouts, the anchored log hash and the winner, and finally a replay of the
// logged actions through @skirm/engine. Reading the chain lives in ./sealedChain.ts; this module only
// compares plain data, so the same code runs on a live read and on the fixture (./sealedFixture.ts).
import { createMatch, mapV2, parseMapV2, placeSealedDrop, sealedDropTile, seedDropValue, specsFromHeader, stepMatch, type LogAgent, type MatchResult } from '@skirm/engine/v2';
import { SEALED_SLOTS, SEALED_TIERS, SealedLoadoutError, decodeLoadout, type EncodedLoadout, type SealedRosterAgent } from '@skirm/shared';
import type { PublicMatchLog } from '@/lib/api/matchLogTypes';
import { checkChain } from './verify';

type Log = PublicMatchLog['log'];
type Team = 'A' | 'B';
const TEAMS: readonly Team[] = ['A', 'B'];

/** SkirmMatch.Status, by name. */
export const CHAIN_STATUSES = ['none', 'open', 'locked', 'revealing', 'revealed', 'forfeited', 'cancelled', 'settled'] as const;
export type ChainStatus = (typeof CHAIN_STATUSES)[number];

/** SkirmMatch.NO_SIDE: the winner seat of a draw. */
export const DRAW_SEAT = 255;

/** One SkirmMatch event for the match, where it sits on chain. */
export interface ChainEvent {
  name: string;
  block: number;
  logIndex: number;
  tx: string;
  /** Decoded arguments, stringified (bigints as decimals, arrays as arrays). */
  args: Record<string, unknown>;
}

/** Everything the check needs from SkirmMatch, as plain data (./sealedChain.ts reads it). */
export interface SealedChainRecord {
  /** The SkirmMatch address read (null for the fixture). */
  contract: string | null;
  /** keccak256(utf8(matchId)): the match's on-chain id. */
  key: string;
  status: ChainStatus;
  players: [string, string];
  locked: [boolean, boolean];
  /** Verified plaintext loadouts (null before finalizeReveal). */
  revealed: [EncodedLoadout, EncodedLoadout] | null;
  randomness: {
    /** Verified seed, decimal uint64 (null before finalizeReveal). */
    seed: string | null;
    /** Verified value per drop slot (null until its finalizeDrop). */
    drops: (number | null)[];
    startedAt: number;
  };
  /** The settled result (null before settle). `logHash` is 0x-prefixed. */
  settlement: { logHash: string; winner: number; settledAt: number } | null;
  /** Public escrow terms and the encrypted handles (amounts are never readable). */
  escrow: { minStake: string; feeBps: number; staked: [string, string]; paid: [string, string]; stakeOk: [boolean, boolean] };
  /** The match's events in chain order, as far as the scan reached. */
  events: ChainEvent[];
  /** The scan did not reach the match's creation (old match, or an RPC that limits log ranges). */
  eventsPartial?: boolean;
}

/** pass ✅, fail ❌, pending ⏳ (not on chain yet), private 🔒 (never revealed, by design). */
export type SealedCheckState = 'pass' | 'fail' | 'pending' | 'private';

export interface SealedCheck {
  id: 'commitments' | 'seed' | 'drops' | 'loadouts' | 'anchor' | 'replay' | 'privacy';
  label: string;
  state: SealedCheckState;
  /** One line: what was compared and how it came out. */
  detail: string;
  /** Why the check means what it means, in plain words. */
  why: string;
  /** Supporting facts, one per line (tx hashes, per-side or per-drop results). */
  lines: string[];
  /** Transactions behind the check (Sepolia hashes). */
  txs: { label: string; hash: string }[];
}

export type SealedStatus = 'verified' | 'mismatch' | 'incomplete';

export interface SealedReport {
  status: SealedStatus;
  checks: SealedCheck[];
  /** The recomputed head of the hash chain, 0x-less (null when the chain broke). */
  logHash: string | null;
}

/** Whether a log was played on SkirmMatch's FHE randomness (a sealed round). */
export const isSealedLog = (log: Pick<Log, 'header'> | null | undefined): boolean => !!log?.header.seed;

/** The contract's winner seat for a log result: A 0, B 1, a draw (or no result: a void) NO_SIDE. */
export function seatOf(result: Pick<MatchResult, 'winner'> | null): number {
  return result?.winner === 'A' ? 0 : result?.winner === 'B' ? 1 : DRAW_SEAT;
}

const seatName = (seat: number) => (seat === 0 ? 'A' : seat === 1 ? 'B' : seat === DRAW_SEAT ? 'draw' : `seat ${seat}`);
const shortHex = (h: string) => (h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);
const norm32 = (h: string) => (h.startsWith('0x') ? h.slice(2) : h).toLowerCase();
const order = (e: ChainEvent) => e.block * 1_000_000 + e.logIndex;
const before = (a: ChainEvent, b: ChainEvent) => order(a) < order(b);
const where = (e: ChainEvent) => `block ${e.block} · log ${e.logIndex}`;

function check(id: SealedCheck['id'], label: string, state: SealedCheckState, detail: string, why: string, lines: string[] = [], txs: SealedCheck['txs'] = []): SealedCheck {
  return { id, label, state, detail, why, lines, txs };
}

// ---------- 1. commitments came first ----------

export function checkCommitments(chain: SealedChainRecord): SealedCheck {
  const label = 'Commitments came first';
  const why =
    'Both loadouts were sealed as FHE ciphertexts before SkirmMatch drew the seed and drop values (FHE.randEuint64 / randEuint16, drawn inside the second seal). Neither player could pick a crew against the randomness, and nobody could read the other side’s pick before locking their own.';
  const sealed = TEAMS.map((_, side) => chain.events.find((e) => e.name === 'LoadoutSealed' && Number(e.args.side) === side));
  const drawn = chain.events.find((e) => e.name === 'RandomnessDrawn');
  const txs = [
    ...sealed.flatMap((e, side) => (e ? [{ label: `Team ${TEAMS[side]} sealed`, hash: e.tx }] : [])),
    ...(drawn ? [{ label: 'Randomness drawn', hash: drawn.tx }] : []),
  ];
  const lines = [
    ...sealed.map((e, side) => (e ? `Team ${TEAMS[side]} sealed its loadout at ${where(e)}` : `Team ${TEAMS[side]}: no LoadoutSealed event found`)),
    drawn ? `Seed and drops drawn at ${where(drawn)}${sealed.some((e) => e?.tx === drawn.tx) ? ' (same transaction as the second seal, after it)' : ''}` : 'No RandomnessDrawn event found',
  ];
  if (!chain.locked[0] || !chain.locked[1]) return check('commitments', label, 'fail', 'SkirmMatch does not show both loadouts sealed.', why, lines, txs);
  if (!sealed[0] || !sealed[1] || !drawn) {
    const partial = chain.eventsPartial ? ' The event scan did not reach back far enough on this RPC.' : '';
    return check('commitments', label, chain.eventsPartial ? 'pending' : 'fail', `Some events could not be found.${partial}`, why, lines, txs);
  }
  const ok = before(sealed[0], drawn) && before(sealed[1], drawn);
  return check('commitments', label, ok ? 'pass' : 'fail', ok ? 'Both seals precede the randomness draw.' : 'The randomness was drawn before both loadouts were sealed.', why, lines, txs);
}

// ---------- 2. seed is genuine ----------

export function checkSeed(log: Log, chain: SealedChainRecord): SealedCheck {
  const label = 'Seed is genuine';
  const why =
    'The seed was revealed by finalizeReveal, which runs FHE.checkSignatures on chain: the plaintext must carry the Zama KMS signatures for the seed’s ciphertext handle, or the call reverts. So the SeedRevealed value is the one the contract drew, and nobody (players, skirm’s server, the deployer) could choose or re-roll it.';
  const ev = chain.events.find((e) => e.name === 'SeedRevealed');
  const txs = ev ? [{ label: 'finalizeReveal (SeedRevealed)', hash: ev.tx }] : [];
  const onchain = chain.randomness.seed;
  const logged = log.header.seed ?? null;
  const lines = [`Log header seed: ${logged ?? 'none'}`, `On-chain seed: ${onchain ?? 'not revealed'}`, ev ? `SeedRevealed at ${where(ev)}` : 'No SeedRevealed event found'];
  if (onchain === null) return check('seed', label, 'pending', 'The seed is not revealed on chain yet.', why, lines, txs);
  if (ev && String(ev.args.seed) !== onchain) return check('seed', label, 'fail', 'The SeedRevealed event and the stored seed disagree.', why, lines, txs);
  const ok = logged === onchain;
  return check('seed', label, ok ? 'pass' : 'fail', ok ? `The log was played on the KMS-verified seed ${onchain}.` : `The log says ${logged ?? 'no seed'}, the chain ${onchain}.`, why, lines, txs);
}

// ---------- 3. drops are genuine ----------

export function checkDrops(log: Log, chain: SealedChainRecord): SealedCheck {
  const label = 'Drops are genuine';
  const why =
    'Each supply drop tile comes from an encrypted random value that opened on its own, in order, only once it was due (revealDrop, then finalizeDrop with the KMS proof). The engine maps a value to a tile with the same code you run here (sealedDropTile). A drop whose value did not arrive in time is placed from the seed instead (fromSeed), which anyone can recompute and nobody could steer.';
  const def = mapV2(log.header.map);
  if (!def) return check('drops', label, 'fail', `Unknown map ${log.header.map}.`, why);
  const map = parseMapV2(def);
  const seed = log.header.seed ?? '';
  const logged = log.ticks.flatMap((t) => (t.drops ?? []).map((d) => ({ ...d, tick: t.tick })));
  const lines: string[] = [];
  const txs: SealedCheck['txs'] = [];
  let ok = true;
  for (const d of logged) {
    const ev = chain.events.find((e) => e.name === 'DropRevealed' && Number(e.args.slot) === d.slot);
    if (ev) txs.push({ label: `Drop ${d.slot + 1} revealed`, hash: ev.tx });
    let tile: [number, number] | null = null;
    try {
      tile = sealedDropTile(map, d.value);
    } catch {
      tile = null;
    }
    const tileOk = !!tile && tile[0] === d.at[0] && tile[1] === d.at[1];
    const source = d.fromSeed ? seedDropValue(seed, d.slot) : chain.randomness.drops[d.slot];
    const valueOk = source === d.value;
    const from = d.fromSeed ? `seed fallback (sha256 of seed:drop:${d.slot} = ${seedDropValue(seed, d.slot)})` : `on chain ${source ?? 'not revealed'}`;
    lines.push(`Drop ${d.slot + 1} (tick ${d.tick}): value ${d.value}, ${from}${valueOk ? ' ✓' : ' ✗'}; tile ${d.at.join(',')}${tileOk ? ' = engine mapping ✓' : `, engine maps it to ${tile ? tile.join(',') : 'nothing'} ✗`}`);
    ok &&= valueOk && tileOk;
  }
  const expected = def.drops.length;
  if (!logged.length) {
    return check('drops', label, expected ? 'pending' : 'pass', expected ? 'No sealed drop landed before the match ended.' : 'This map has no supply drops.', why, lines, txs);
  }
  if (logged.length < expected) lines.push(`${logged.length} of ${expected} map drops landed before the match ended.`);
  return check('drops', label, ok ? 'pass' : 'fail', ok ? `${logged.length} drop${logged.length === 1 ? '' : 's'} match the chain and the engine’s tile mapping.` : 'A logged drop disagrees with the chain or the tile mapping.', why, lines, txs);
}

// ---------- 4. loadouts played as sealed ----------

/**
 * One side's revealed loadout against the crew its log header played. With the player's roster the
 * loadout decodes (packages/shared decodeLoadout) to agent ids; without it (rosters are private) the
 * check still covers what the plaintexts alone prove: the slot count, the talk tiers, distinct roster
 * indices, and that their order agrees with the agent ids (the roster is indexed sorted by id).
 */
export function compareLoadout(enc: EncodedLoadout, crew: readonly LogAgent[], opts: { ranked: boolean; roster?: readonly SealedRosterAgent[] }): { ok: boolean; detail: string } {
  if (opts.roster) {
    try {
      const picks = decodeLoadout(enc, opts.roster);
      const ids = picks.map((p) => p.agentId);
      const want = crew.map((a) => a.id);
      if (ids.join(',') !== want.join(',')) return { ok: false, detail: `sealed ${ids.join(', ')}, played ${want.join(', ')}` };
      if (!opts.ranked) {
        const bad = picks.findIndex((p, i) => p.tier !== crew[i]!.tier);
        if (bad >= 0) return { ok: false, detail: `${ids[bad]} sealed ${picks[bad]!.tier} talk, played ${crew[bad]!.tier}` };
      }
      return { ok: true, detail: `decodes to ${ids.join(', ')}${opts.ranked ? '' : ` (${picks.map((p) => p.tier).join(', ')})`}` };
    } catch (err) {
      if (err instanceof SealedLoadoutError) return { ok: false, detail: `does not decode: ${err.message}` };
      throw err;
    }
  }
  const n = enc.agents.findIndex((a) => a === 0);
  const count = n < 0 ? SEALED_SLOTS : n;
  if (enc.agents.slice(count).some((a) => a !== 0)) return { ok: false, detail: 'an agent after an empty slot' };
  if (count !== crew.length) return { ok: false, detail: `sealed ${count} agents, played ${crew.length}` };
  const idx = enc.agents.slice(0, count);
  if (new Set(idx).size !== idx.length) return { ok: false, detail: 'the same roster index twice' };
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      if (idx[i]! < idx[j]! !== crew[i]!.id < crew[j]!.id) return { ok: false, detail: `roster order of slots ${i + 1} and ${j + 1} disagrees with agents ${crew[i]!.id} and ${crew[j]!.id}` };
    }
  }
  if (!opts.ranked) {
    const bad = crew.findIndex((a, i) => SEALED_TIERS[enc.tiers[i]!] !== a.tier);
    if (bad >= 0) return { ok: false, detail: `slot ${bad + 1} sealed ${SEALED_TIERS[enc.tiers[bad]!] ?? `tier ${enc.tiers[bad]}`} talk, played ${crew[bad]!.tier}` };
  }
  return { ok: true, detail: `${count} agent${count === 1 ? '' : 's'}${opts.ranked ? '' : `, tiers ${crew.map((a) => a.tier).join(', ')}`}, roster order consistent` };
}

export function checkLoadouts(log: Log, chain: SealedChainRecord, rosters?: Partial<Record<Team, readonly SealedRosterAgent[]>>): SealedCheck {
  const label = 'Loadouts played as sealed';
  const why =
    'The game server does not get to choose the crews of a sealed match: it plays the plaintexts finalizeReveal stored after the KMS proof, decoded with packages/shared sealed-loadout. Rosters are private, so without them the check confirms what the revealed numbers alone prove (crew size, talk tiers, and roster order against the agent ids); with a roster it decodes each pick to an agent.';
  const txs = chain.events.filter((e) => e.name === 'LoadoutRevealed').map((e) => ({ label: `Team ${TEAMS[Number(e.args.side)] ?? '?'} revealed`, hash: e.tx }));
  if (!chain.revealed) return check('loadouts', label, 'pending', 'The loadouts are not revealed on chain yet.', why, [], txs);
  const results = TEAMS.map((t, side) => ({ t, ...compareLoadout(chain.revealed![side]!, log.header.crews[t], { ranked: log.header.ranked, ...(rosters?.[t] ? { roster: rosters[t] } : {}) }) }));
  const lines = results.map((r) => `Team ${r.t}: ${r.detail} ${r.ok ? '✓' : '✗'}`);
  if (log.header.ranked) lines.push('Ranked plays every agent at Standard talk, so the sealed talk tiers are not compared.');
  const ok = results.every((r) => r.ok);
  return check('loadouts', label, ok ? 'pass' : 'fail', ok ? 'Both revealed loadouts match the crews in the log header.' : 'A revealed loadout does not match the crew that played.', why, lines, txs);
}

// ---------- 5. result anchored ----------

export function checkAnchor(log: Log, chain: SealedChainRecord): SealedCheck {
  const label = 'Result anchored';
  const why =
    'When the match ended, skirm’s operator called settle(matchId, winnerSeat, logHash), which stores the head of the hash-chained log on Sepolia and pays the escrow out. Your browser recomputed the chain from the log it downloaded; if a single action, message, drop or crew in the log were changed, the head would differ.';
  const chainCheck = checkChain(log);
  const ev = chain.events.find((e) => e.name === 'MatchSettled');
  const txs = ev ? [{ label: 'settle (MatchSettled)', hash: ev.tx }] : [];
  const recomputed = chainCheck.final;
  const lines = [`Recomputed head: ${recomputed ?? `chain breaks at ${chainCheck.brokenAt === 0 ? 'the header' : `tick ${chainCheck.brokenAt}`}`}`];
  if (!chain.settlement) return check('anchor', label, 'pending', 'The match is not settled on chain yet.', why, lines, txs);
  const s = chain.settlement;
  lines.push(`Anchored on chain: ${norm32(s.logHash)}`, `Winner seat on chain: ${seatName(s.winner)}; log result: ${log.result?.winner ?? 'none (void)'}`);
  if (!recomputed) return check('anchor', label, 'fail', 'The downloaded log does not rechain.', why, lines, txs);
  const hashOk = norm32(s.logHash) === recomputed;
  const seatOk = s.winner === seatOf(log.result);
  const detail = hashOk && seatOk ? `Log hash ${shortHex(recomputed)} and winner ${seatName(s.winner)} match.` : !hashOk ? 'The anchored log hash differs from the one your browser recomputed.' : 'The settled winner differs from the log result.';
  return check('anchor', label, hashOk && seatOk ? 'pass' : 'fail', detail, why, lines, txs);
}

// ---------- 6. replay ----------

export interface ReplayResult {
  ok: boolean;
  /** Ticks replayed. */
  ticks: number;
  result: MatchResult | null;
  /** First thing that disagreed. */
  error: string | null;
}

/**
 * Re-runs the logged actions through @skirm/engine: the crews and options from the header, the seed,
 * each sealed drop placed where the log says it landed. Returns the result the engine reaches.
 */
export function replayLog(log: Log): ReplayResult {
  const def = mapV2(log.header.map);
  if (!def) return { ok: false, ticks: 0, result: null, error: `unknown map ${log.header.map}` };
  try {
    const s = createMatch(def, specsFromHeader(log.header), {
      ranked: log.header.ranked,
      ...(log.header.difficulty ? { difficulty: log.header.difficulty } : {}),
      ...(log.header.seed !== undefined ? { seed: log.header.seed } : {}),
      ...(log.header.sealedDrops ? { sealedDrops: true } : {}),
    });
    for (const t of log.ticks) {
      for (const d of t.drops ?? []) {
        const placed = placeSealedDrop(s, d.slot, d.value);
        if (placed.at[0] !== d.at[0] || placed.at[1] !== d.at[1]) return { ok: false, ticks: s.tick, result: null, error: `tick ${t.tick}: drop ${d.slot + 1} lands at ${placed.at.join(',')}, the log says ${d.at.join(',')}` };
      }
      stepMatch(s, { actions: t.actions, says: t.says });
      if (s.tick !== t.tick) return { ok: false, ticks: s.tick, result: null, error: `the log skips from tick ${s.tick - 1} to ${t.tick}` };
    }
    return { ok: true, ticks: s.tick, result: s.result ?? null, error: null };
  } catch (err) {
    return { ok: false, ticks: 0, result: null, error: (err as Error).message };
  }
}

export function checkReplay(log: Log): SealedCheck {
  const label = 'Replay';
  const why =
    'The AI agents decide off chain, but the rules do not: replaying every logged action through the same engine (@skirm/engine, in your browser) must land on the same final state. A server that edited the score, or played different rules, would not survive this.';
  const r = replayLog(log);
  const want = log.result;
  if (!r.ok) return check('replay', label, 'fail', `The replay failed: ${r.error}.`, why);
  if (!want) return check('replay', label, r.result ? 'fail' : 'pass', r.result ? 'The engine finished the match but the log records no result.' : `${r.ticks} ticks replayed; the log records no result (void).`, why);
  const got = r.result;
  const lines = [`Log: ${want.winner} ${want.score.A}–${want.score.B} after ${want.ticks} ticks (${want.reason})`, `Engine: ${got ? `${got.winner} ${got.score.A}–${got.score.B} after ${got.ticks} ticks (${got.reason})` : `no result after ${r.ticks} ticks`}`];
  const ok = !!got && got.winner === want.winner && got.score.A === want.score.A && got.score.B === want.score.B && got.ticks === want.ticks && got.reason === want.reason;
  return check('replay', label, ok ? 'pass' : 'fail', ok ? `${r.ticks} ticks replayed in your browser to the logged result.` : 'The engine reaches a different result than the log.', why, lines);
}

// ---------- 7. privacy ----------

export function privacyNote(chain: SealedChainRecord): SealedCheck {
  const staked = chain.escrow.minStake !== '0';
  const lines = staked
    ? [
        `Minimum stake (public terms): ${chain.escrow.minStake} base units, fee ${chain.escrow.feeBps / 100}%`,
        ...TEAMS.map((t, i) => `Team ${t} stake: encrypted handle ${shortHex(chain.escrow.staked[i]!)}; stake ok: ${chain.escrow.stakeOk[i] ? 'yes' : 'no'} (public flag)`),
        ...TEAMS.map((t, i) => `Team ${t} payout: encrypted handle ${shortHex(chain.escrow.paid[i]!)}`),
      ]
    : ['Unstaked match: no cSKIRM moved.'];
  lines.push('Skill prompts and playbooks: never on chain; the loadout only carries roster indices and a skill bitmask.');
  return check(
    'privacy',
    'Never revealed',
    'private',
    staked ? 'Stake amounts and payouts stay encrypted (ERC-7984 cSKIRM).' : 'Nothing private was staked on this match.',
    'Fairness does not need the amounts: the contract computed the matched pot and every payout under FHE, and only the public “stake ok” flag (stake ≥ minimum) was opened. Each player can decrypt their own stake and payout; rivals, spectators and skirm’s server cannot. On a transparent chain the stakes would tell the rival how confident you are before the match starts.',
    lines,
    chain.events.filter((e) => e.name === 'StakePaid').map((e) => ({ label: `Payout to team ${TEAMS[Number(e.args.side)] ?? '?'}`, hash: e.tx })),
  );
}

// ---------- report ----------

/** Every check for a sealed round. `rosters`: the players' rosters, when known (the fixture). */
export function buildSealedReport(log: Log, chain: SealedChainRecord, opts: { rosters?: Partial<Record<Team, readonly SealedRosterAgent[]>> } = {}): SealedReport {
  const checks = [checkCommitments(chain), checkSeed(log, chain), checkDrops(log, chain), checkLoadouts(log, chain, opts.rosters), checkAnchor(log, chain), checkReplay(log), privacyNote(chain)];
  const status: SealedStatus = checks.some((c) => c.state === 'fail') ? 'mismatch' : checks.some((c) => c.state === 'pending') ? 'incomplete' : 'verified';
  return { status, checks, logHash: checkChain(log).final };
}
