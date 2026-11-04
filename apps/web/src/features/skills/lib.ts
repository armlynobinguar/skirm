// Skills + Market helpers: limits mirrored from apps/api/src/validation.ts (Spec §9), NEAR amounts as
// bigint strings (never floats) and test-run outcome labels.
import { AGENT_ROLES, TAGS, UNLOCK_ACTION, type AgentRoleName, type Tag, type Unlock } from '@skirm/shared';
import { formatNear, parseNear } from '@/lib/constants';
import type { GatedAction, SkillBody, SkillStatus } from '@/lib/api/types';

export { TAGS };

/** Spec §9 / api skillBody limits. */
export const LIMITS = {
  nameMin: 3,
  nameMax: 32,
  summary: 140,
  prompt: 1200,
  reflexes: 400,
  royaltyMaxBps: 1000,
  royaltyDefaultBps: 500,
  tagsMax: 10,
} as const;

/** Same pattern as the api (after trim). */
export const NAME_RE = /^[\p{L}\p{N} '-]{3,32}$/u;

/** Network fee estimate shown on M02 until a wallet quotes one: about 0.001 NEAR. */
export const NETWORK_FEE_ESTIMATE_YOCTO = (10n ** 21n).toString();

export const UNLOCK_ORDER: Unlock[] = ['builder', 'digger', 'firefighter'];
export const ACTION_UNLOCK: Record<GatedAction, Unlock> = {
  place_block: 'builder',
  dig: 'digger',
  extinguish: 'firefighter',
};
export const unlockAction = (u: Unlock) => UNLOCK_ACTION[u] as GatedAction;

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
export { fmtInt };

/** "1.5 NEAR" from a yoctoNEAR string; "" for null. */
export function near(yocto: string | bigint | null | undefined, decimals = 4): string {
  if (yocto === null || yocto === undefined) return '';
  return `${formatNear(yocto, decimals)} NEAR`;
}

/** "5%" from basis points, two decimals at most ("7.5%"). */
export function bpsPct(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}%` : `${whole}%`;
}

/** "5" or "7.5" (percent) → bps; null when not a valid 0–10% value with ≤ 2 decimals. */
export function pctToBps(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const [w = '0', f = ''] = t.split('.');
  const bps = Number(w) * 100 + Number((f + '00').slice(0, 2));
  return bps >= 0 && bps <= LIMITS.royaltyMaxBps ? bps : null;
}

export const STATUS_ICON: Record<SkillStatus, 'info' | 'check' | 'royalty'> = {
  Draft: 'info',
  Minted: 'check',
  Listed: 'royalty',
  Starter: 'check',
};

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function clockTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ---------- S08 form ----------

export interface SkillForm {
  name: string;
  summary: string;
  prompt: string;
  reflexes: string;
  requires: Unlock[];
  tags: Tag[];
  /** Roles that may equip it; empty = any role. */
  roles: AgentRoleName[];
  /** Percent text as typed ("5"). */
  royalty: string;
}

export const emptyForm = (): SkillForm => ({
  name: '',
  summary: '',
  prompt: '',
  reflexes: '',
  requires: [],
  tags: [],
  roles: [],
  royalty: '5',
});

export type FormErrors = Partial<Record<keyof SkillForm, string>>;

/** Client-side copy of the api's skillBody checks, so a save never round-trips to fail. */
export function validateForm(f: SkillForm): FormErrors {
  const e: FormErrors = {};
  if (!NAME_RE.test(f.name.trim())) e.name = "3 to 32 letters, digits, spaces, - and '.";
  if (f.summary.length > LIMITS.summary) e.summary = `At most ${LIMITS.summary} characters.`;
  if (f.prompt.trim().length === 0) e.prompt = 'Write the prompt the planner reads.';
  else if (f.prompt.length > LIMITS.prompt) e.prompt = `At most ${fmtInt(LIMITS.prompt)} characters.`;
  if (f.reflexes.length > LIMITS.reflexes) e.reflexes = `At most ${LIMITS.reflexes} characters.`;
  if (f.tags.length < 1) e.tags = 'Pick at least one tag the skill handles.';
  if (pctToBps(f.royalty) === null) e.royalty = '0 to 10%, up to 2 decimals.';
  return e;
}

export function toBody(f: SkillForm): SkillBody {
  return {
    name: f.name.trim(),
    summary: f.summary.trim() ? f.summary : null,
    prompt: f.prompt,
    reflexes: f.reflexes.trim() ? f.reflexes : null,
    requires_actions: UNLOCK_ORDER.filter((u) => f.requires.includes(u)).map(unlockAction),
    handles_tags: TAGS.filter((t) => f.tags.includes(t)),
    roles: f.roles.length ? AGENT_ROLES.filter((r) => f.roles.includes(r)) : ['any'],
    royalty_bps: pctToBps(f.royalty) ?? LIMITS.royaltyDefaultBps,
  };
}

export function sameForm(a: SkillForm, b: SkillForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The api takes at most 40 digits (listingBody.priceYocto). */
const MAX_YOCTO_DIGITS = 40;

/**
 * A typed NEAR price → exact yoctoNEAR string, or an error line. Built on the strict shared
 * parseNear (digits, optional 1–24 decimals, never rounded), plus what a price form also accepts
 * (".5" and "5.") and needs (more than 0, within the api's 40-digit limit).
 */
export function parsePrice(text: string): { yocto: string } | { error: string } {
  const t = text.trim();
  const generic = { error: 'Enter a price in NEAR, e.g. 1.5' };
  if (!t || t === '.') return generic;
  let yocto: string;
  try {
    yocto = parseNear(/^\d+\.$/.test(t) ? t.slice(0, -1) : t.startsWith('.') ? `0${t}` : t);
  } catch {
    return /^\d*\.\d{25,}$/.test(t) ? { error: 'NEAR has at most 24 decimals.' } : generic;
  }
  if (yocto === '0') return { error: 'The price must be more than 0 NEAR.' };
  if (yocto.length > MAX_YOCTO_DIGITS) return { error: 'That price is too high.' };
  return { yocto };
}

/** A unique dev purchase hash: `dev:<yocto>:<nonce>` (apps/api market.controller DEV_PURCHASE_RE). */
export function devTxHash(yocto: string): string {
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `dev:${yocto}:${nonce}`;
}

/** What the Exchange says when the server runs the offline bot brain (no model key): no benchmark score. */
export const NEEDS_MODEL = 'Benchmarks need a model key; this server runs the offline bot brain';
