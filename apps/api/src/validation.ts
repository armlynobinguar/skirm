// Request body/query schemas (zod). Issues are reported as path + message only, never the input
// value, so a rejected skill body cannot echo its prompt back.
import { AGENT_SYSTEM_PROMPT_MAX, V2_ROLES, V2_TALK_TIERS } from '@skirm/db';
import {
  BUILDS,
  HAIR_COLORS,
  HAIR_STYLES,
  HEADGEAR,
  OUTFIT_COLORS,
  PANTS_COLORS,
  SKILL_TRIGGER_LIMITS,
  SKIN_TONES,
  SKILL_ROLES,
  TAGS,
  type SkillRole,
} from '@skirm/shared';
import { z } from 'zod';
import { ApiError } from './errors';

export function parse<T extends z.ZodType>(schema: T, input: unknown, status = 400): z.output<T> {
  const res = schema.safeParse(input ?? {});
  if (res.success) return res.data;
  throw new ApiError(status, 'invalid_request', 'request did not validate', {
    issues: res.error.issues.slice(0, 20).map((i) => ({
      path: i.path.join('.'),
      code: i.code,
      message: i.message,
    })),
  });
}

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`));
export const agentId = id('agt');
export const skillId = id('skl');
export const matchId = id('mat');
export const seasonId = id('ssn');

export const unlock = z.enum(['builder', 'digger', 'firefighter']);
export const gatedAction = z.enum(['place_block', 'dig', 'extinguish']);
export const tag = z.enum(TAGS as unknown as [string, ...string[]]);

export const skillRef = z.object({ id: skillId, version: z.number().int().min(1) });

export const sessionBody = z.object({
  token: z.string().min(1).max(4096).optional(),
  /** Links a NEAR account (deposits, mint, purchases). Optional extension of the contract. */
  nearAccountId: z
    .string()
    .regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/)
    .min(2)
    .max(64)
    .optional(),
  /** Proof of control for `nearAccountId` (required outside dev mode): see near-link.ts. */
  nearProof: z
    .object({
      publicKey: z.string().min(8).max(128),
      signature: z.string().min(8).max(200),
      /** NEP-413 `signMessage` envelope (wallets): base64 32-byte nonce and recipient. */
      nonce: z.string().min(40).max(64).optional(),
      recipient: z.string().min(1).max(128).optional(),
      callbackUrl: z.string().max(512).optional(),
    })
    .optional(),
});

const paletteIndex = (n: number) => z.number().int().min(0).max(n - 1);

/** Cosmetic look on the 3D board; every field is required so a stored look is always complete. */
export const appearance = z
  .object({
    skin: paletteIndex(SKIN_TONES.length),
    hair: z.enum(HAIR_STYLES),
    hairColor: paletteIndex(HAIR_COLORS.length),
    outfit: paletteIndex(OUTFIT_COLORS.length),
    pants: paletteIndex(PANTS_COLORS.length),
    build: z.enum(BUILDS),
    headgear: z.enum(HEADGEAR),
  })
  .strict();

export const agentPatch = z.object({
  name: z.string().max(64).optional(),
  skills: z.array(skillRef).optional(),
  unlocks: z.array(unlock).max(3).optional(),
  appearance: appearance.optional(),
  role: z.enum(V2_ROLES).optional(),
  vision: z.number().int().min(1).max(5).optional(),
  comms: z.number().int().min(1).max(5).optional(),
  tier: z.enum(V2_TALK_TIERS).optional(),
  /** The owner's instructions, counted in characters (code points, like the DB check); null or blank clears them. */
  systemPrompt: z
    .string()
    .refine((v) => [...v.trim()].length <= AGENT_SYSTEM_PROMPT_MAX, `systemPrompt: at most ${AGENT_SYSTEM_PROMPT_MAX} characters`)
    .nullable()
    .optional(),
});

export const skillRoles = z
  .array(z.enum(SKILL_ROLES as unknown as [SkillRole, ...SkillRole[]]))
  .min(1)
  .max(SKILL_ROLES.length)
  .refine((a) => new Set(a).size === a.length, 'roles must be unique')
  .refine((a) => !a.includes('any') || a.length === 1, 'roles: "any" stands alone');

const triggerTiles = z.number().int().min(SKILL_TRIGGER_LIMITS.tiles.min).max(SKILL_TRIGGER_LIMITS.tiles.max);

/** A skill trigger (@skirm/shared SkillTrigger): one of a small typed set, never free text. */
export const skillTrigger = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always') }).strict(),
  z.object({ kind: z.literal('hazard_within'), tiles: triggerTiles }).strict(),
  z.object({ kind: z.literal('behind_on_score') }).strict(),
  z.object({ kind: z.literal('ahead_on_score') }).strict(),
  z.object({ kind: z.literal('rival_near_switch'), tiles: triggerTiles }).strict(),
  z.object({ kind: z.literal('carrying_item') }).strict(),
  z
    .object({
      kind: z.literal('time_left_under'),
      seconds: z.number().int().min(SKILL_TRIGGER_LIMITS.seconds.min).max(SKILL_TRIGGER_LIMITS.seconds.max),
    })
    .strict(),
]);

/** Spec §9 skill format limits. */
export const skillBody = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[\p{L}\p{N} '-]{3,32}$/u, "name: 3-32 letters, digits, spaces, - and '"),
  summary: z.string().max(140).nullish(),
  prompt: z.string().min(1).max(1200),
  reflexes: z.string().max(400).nullish(),
  requires_actions: z
    .array(gatedAction)
    .max(3)
    .refine((a) => new Set(a).size === a.length, 'requires_actions must be unique'),
  handles_tags: z
    .array(tag)
    .min(1)
    .max(10)
    .refine((a) => new Set(a).size === a.length, 'handles_tags must be unique'),
  /** Agent roles that may equip it: `['any']` (the default) or 1-10 role names (all ten store as any). */
  roles: skillRoles.default(['any']),
  royalty_bps: z.number().int().min(0).max(1000).default(500),
  /** When the skill joins its agent's prompt; absent or null: always. Public, unlike the prompt. */
  trigger: skillTrigger.nullish(),
});

export const listingBody = z.object({
  priceYocto: z.string().regex(/^[0-9]{1,40}$/),
  txHash: z.string().min(1).max(128).optional(),
  version: z.number().int().min(1).optional(),
});

export const purchaseBody = z.object({
  txHash: z.string().min(1).max(128),
  version: z.number().int().min(1).optional(),
});

export const depositBody = z.object({ txHash: z.string().min(1).max(128) });

// Query values are strings or absent. `z.string().optional()` first, so zod 4 treats the key as
// optional (a union with z.undefined() does not).
export const intQuery = (min: number, max: number, d: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? d : Number(v)))
    .pipe(z.number().int().min(min).max(max));

/** Optional integer query value (`?version=`, `?crew=`). */
export const optIntQuery = (min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : Number(v)))
    .pipe(z.number().int().min(min).max(max).optional());
