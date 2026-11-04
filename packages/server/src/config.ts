// Env config for api, worker and realtime, parsed with zod (docs/backend-contract.md, Environment).
import { DEFAULTS } from '@skirm/shared';
import { z } from 'zod';

/** Local stand-in for Cloud KMS `skill-prompt-kek`: 32 bytes, base64. Never use outside dev. */
export const DEV_SKILL_KEK = Buffer.from('skirm-dev-kek-not-for-production').toString('base64');

export const ENV_DEFAULTS = {
  DATABASE_URL: 'postgres://skirm:skirm@localhost:5432/skirm',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_MODE: 'dev',
  SKILL_KEK: DEV_SKILL_KEK,
  NEAR_NETWORK: 'testnet',
  NEAR_RPC_URL: 'https://test.rpc.fastnear.com',
  NEAR_RPC_FALLBACK_URL: 'https://near-testnet.drpc.org',
  NEAR_CONTRACT_SKILLS: 'skills.playskirm.testnet',
  NEAR_CONTRACT_MARKET: 'market.playskirm.testnet',
  NEAR_CONTRACT_REGISTRY: 'registry.playskirm.testnet',
  NEAR_CONTRACT_DEPOSITS: 'deposits.playskirm.testnet',
  NEAR_CONTRACT_SEASONS: 'seasons.playskirm.testnet',
  NEAR_CONTRACT_BADGES: 'badges.playskirm.testnet',
  /** One credit is priced off DEFAULTS.credits (priceUsd at an assumed $1 NEAR). */
  CREDITS_PER_NEAR: DEFAULTS.credits.perNear,
  COST_ALERT_DAILY_USD: 10,
  /** The model provider: any OpenAI-compatible API (same defaults as @skirm/decision-engine's DEFAULT_LLM_*). */
  LLM_BASE_URL: 'https://openrouter.ai/api/v1',
  LLM_MODEL: 'anthropic/claude-haiku-5.5',
  API_PORT: 4000,
  REALTIME_PORT: 4001,
  PUBLIC_API_URL: 'http://localhost:4000',
  PUBLIC_WS_URL: 'ws://localhost:4001/ws',
} as const;

/** Empty strings in .env files mean "unset". */
const optional = () =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v));
const withDefault = (d: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? d : v.trim()));
const enumWithDefault = <const T extends readonly [string, ...string[]]>(values: T, d: T[number]) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.enum(values).default(d as never),
  );
const port = (d: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return d;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        ctx.addIssue({ code: 'custom', message: 'must be a port number' });
        return z.NEVER;
      }
      return n;
    });
/** USD per million tokens, ≥ 0; unset stays undefined. */
const usdPerMTok = () =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return undefined;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        ctx.addIssue({ code: 'custom', message: 'must be a number of USD per million tokens ≥ 0' });
        return z.NEVER;
      }
      return n;
    });
const nearAccount = (d: string) =>
  withDefault(d).refine((v) => /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(v), {
    message: 'must be a NEAR account id',
  });
const url = (d: string, protocols: string[]) =>
  withDefault(d).refine(
    (v) => {
      try {
        return protocols.includes(new URL(v).protocol);
      } catch {
        return false;
      }
    },
    { message: `must be a ${protocols.join(' or ')} URL` },
  );

export const envSchema = z
  .object({
    NODE_ENV: withDefault('development'),
    DATABASE_URL: url(ENV_DEFAULTS.DATABASE_URL, ['postgres:', 'postgresql:']),
    REDIS_URL: url(ENV_DEFAULTS.REDIS_URL, ['redis:', 'rediss:']),
    AUTH_MODE: enumWithDefault(['dev', 'privy'] as const, 'dev'),
    /**
     * `true` lets NODE_ENV=production run dev settings (AUTH_MODE=dev, the built-in dev SKILL_KEK):
     * the local docker stack only. Unset, a production server refuses them: dev auth trusts the
     * x-dev-user header (anyone signs in as anyone) and accepts `dev:` payment hashes.
     */
    ALLOW_DEV_IN_PRODUCTION: z.enum(['true', 'false']).optional(),
    PRIVY_APP_ID: optional(),
    PRIVY_VERIFICATION_KEY: optional(),
    /**
     * The model brain's provider (docs/backend-contract.md, Environment): any OpenAI-compatible
     * chat-completions API. LLM_API_KEY unset → OPENROUTER_API_KEY (its old name); neither set →
     * the offline greedy brain (unless V2_BRAIN=model with a keyless local LLM_BASE_URL).
     */
    LLM_BASE_URL: url(ENV_DEFAULTS.LLM_BASE_URL, ['https:', 'http:']),
    LLM_API_KEY: optional(),
    OPENROUTER_API_KEY: optional(),
    LLM_MODEL: withDefault(ENV_DEFAULTS.LLM_MODEL),
    /** Unset → LLM_MODEL. */
    LLM_PLANNER_MODEL: optional(),
    /** Cost estimate when the provider returns no cost (OpenRouter returns one). */
    LLM_PRICE_INPUT_USD: usdPerMTok(),
    LLM_PRICE_OUTPUT_USD: usdPerMTok(),
    /** Unset → SKILL_KEK_KMS if set, else the built-in dev key. */
    SKILL_KEK: optional().refine((v) => v === undefined || decodeKek(v.trim()) !== undefined, {
      message: 'must be base64 of exactly 32 bytes',
    }),
    /** Cloud KMS key that wraps data keys when SKILL_KEK is unset. */
    SKILL_KEK_KMS: optional().refine(
      (v) =>
        v === undefined ||
        /^projects\/[a-z0-9.:-]+\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+$/.test(
          v.trim(),
        ),
      { message: 'must be projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>' },
    ),
    NEAR_NETWORK: enumWithDefault(['testnet', 'mainnet'] as const, 'testnet'),
    NEAR_RPC_URL: url(ENV_DEFAULTS.NEAR_RPC_URL, ['https:', 'http:']),
    NEAR_RPC_FALLBACK_URL: url(ENV_DEFAULTS.NEAR_RPC_FALLBACK_URL, ['https:', 'http:']),
    NEAR_OPS_ACCOUNT: optional(),
    NEAR_OPS_KEY: optional(),
    NEAR_CONTRACT_SKILLS: nearAccount(ENV_DEFAULTS.NEAR_CONTRACT_SKILLS),
    NEAR_CONTRACT_MARKET: nearAccount(ENV_DEFAULTS.NEAR_CONTRACT_MARKET),
    NEAR_CONTRACT_REGISTRY: nearAccount(ENV_DEFAULTS.NEAR_CONTRACT_REGISTRY),
    NEAR_CONTRACT_DEPOSITS: nearAccount(ENV_DEFAULTS.NEAR_CONTRACT_DEPOSITS),
    NEAR_CONTRACT_SEASONS: nearAccount(ENV_DEFAULTS.NEAR_CONTRACT_SEASONS),
    NEAR_CONTRACT_BADGES: nearAccount(ENV_DEFAULTS.NEAR_CONTRACT_BADGES),
    CREDITS_PER_NEAR: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined || v.trim() === '') return ENV_DEFAULTS.CREDITS_PER_NEAR;
        const n = Number(v);
        if (!Number.isSafeInteger(n) || n < 1) {
          ctx.addIssue({ code: 'custom', message: 'must be a whole number ≥ 1' });
          return z.NEVER;
        }
        return n;
      }),
    /** Daily model spend (USD, all instances) that raises `cost_alert` logs at 50/80/100%; 0 = off. */
    COST_ALERT_DAILY_USD: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined || v.trim() === '') return ENV_DEFAULTS.COST_ALERT_DAILY_USD;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
          ctx.addIssue({ code: 'custom', message: 'must be a number of USD ≥ 0' });
          return z.NEVER;
        }
        return n;
      }),
    /** api: bearer token for GET /ops/stats (the operator dashboard); unset turns the route off. */
    OPS_TOKEN: optional().refine((v) => v === undefined || v.trim().length >= 32, {
      message: 'must be at least 32 characters',
    }),
    API_PORT: port(ENV_DEFAULTS.API_PORT),
    REALTIME_PORT: port(ENV_DEFAULTS.REALTIME_PORT),
    PUBLIC_API_URL: url(ENV_DEFAULTS.PUBLIC_API_URL, ['http:', 'https:']),
    PUBLIC_WS_URL: url(ENV_DEFAULTS.PUBLIC_WS_URL, ['ws:', 'wss:']),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'privy') {
      if (!env.PRIVY_APP_ID)
        ctx.addIssue({
          code: 'custom',
          path: ['PRIVY_APP_ID'],
          message: 'required when AUTH_MODE=privy',
        });
      if (!env.PRIVY_VERIFICATION_KEY)
        ctx.addIssue({
          code: 'custom',
          path: ['PRIVY_VERIFICATION_KEY'],
          message: 'required when AUTH_MODE=privy',
        });
    }
    if (!!env.NEAR_OPS_ACCOUNT !== !!env.NEAR_OPS_KEY)
      ctx.addIssue({
        code: 'custom',
        path: ['NEAR_OPS_KEY'],
        message: 'NEAR_OPS_ACCOUNT and NEAR_OPS_KEY are set together',
      });
    if (env.NEAR_OPS_KEY && !/^ed25519:[1-9A-HJ-NP-Za-km-z]{40,100}$/.test(env.NEAR_OPS_KEY))
      ctx.addIssue({
        code: 'custom',
        path: ['NEAR_OPS_KEY'],
        message: 'must be an ed25519:<base58> secret key',
      });
  });

export type EnvConfig = z.output<typeof envSchema>;

export interface ServerConfig extends EnvConfig {
  /** SKILL_KEK decoded (the built-in dev key when unset). */
  kek: Uint8Array;
  /** Which wrapper seals new data keys: SKILL_KEK (or the dev key), or Cloud KMS SKILL_KEK_KMS. */
  kekMode: 'local' | 'kms';
  /** True when new skills are sealed with the public dev KEK (refuse to treat data as production). */
  devKek: boolean;
  /** Startup warnings for the app to log loudly (never contain secret values). */
  warnings: string[];
  /** NEAR ops signer configured → Near* adapters, else Noop*. */
  nearOpsConfigured: boolean;
  /** RPC endpoints in order of preference. */
  nearRpcUrls: string[];
}

export class ConfigError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(`invalid environment: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
    this.name = 'ConfigError';
  }
}

function decodeKek(v: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return undefined;
  const b = Buffer.from(v, 'base64');
  return b.length === 32 ? new Uint8Array(b) : undefined;
}

/** Parses the environment. Error messages name variables, never their values. */
export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const res = envSchema.safeParse(env);
  if (!res.success) {
    throw new ConfigError(
      res.error.issues.map((i) => ({ path: i.path.join('.') || '(env)', message: i.message })),
    );
  }
  const c = res.data;
  const skillKek = c.SKILL_KEK?.trim();
  const kekMode = !skillKek && c.SKILL_KEK_KMS ? 'kms' : 'local';
  const devKek = kekMode === 'local' && (!skillKek || skillKek === DEV_SKILL_KEK);
  const warnings: string[] = [];
  const devAllowed = c.ALLOW_DEV_IN_PRODUCTION === 'true';
  if (c.NODE_ENV === 'production' && !devAllowed) {
    const issues: { path: string; message: string }[] = [];
    if (c.AUTH_MODE === 'dev')
      issues.push({ path: 'AUTH_MODE', message: 'dev in production trusts x-dev-user and dev: payment hashes; use privy (or ALLOW_DEV_IN_PRODUCTION=true for a local stack)' });
    if (devKek)
      issues.push({ path: 'SKILL_KEK', message: 'the public built-in dev key in production leaves skill prompts unprotected; set SKILL_KEK_KMS (or ALLOW_DEV_IN_PRODUCTION=true for a local stack)' });
    if (issues.length) throw new ConfigError(issues);
  }
  if (devKek && c.NODE_ENV === 'production')
    warnings.push(
      'SKILL_KEK is the public built-in dev key and SKILL_KEK_KMS is unset: skill prompts are NOT ' +
        'protected. Fine for the local docker run; set SKILL_KEK_KMS (or a real SKILL_KEK) anywhere else.',
    );
  return {
    ...c,
    SKILL_KEK: skillKek,
    SKILL_KEK_KMS: c.SKILL_KEK_KMS?.trim(),
    LLM_BASE_URL: c.LLM_BASE_URL.replace(/\/+$/, ''),
    LLM_API_KEY: (c.LLM_API_KEY ?? c.OPENROUTER_API_KEY)?.trim(),
    LLM_PLANNER_MODEL: c.LLM_PLANNER_MODEL?.trim() ?? c.LLM_MODEL,
    kek: decodeKek(skillKek ?? DEV_SKILL_KEK)!,
    kekMode,
    devKek,
    warnings,
    nearOpsConfigured: !!(c.NEAR_OPS_ACCOUNT && c.NEAR_OPS_KEY),
    nearRpcUrls: [...new Set([c.NEAR_RPC_URL, c.NEAR_RPC_FALLBACK_URL])],
  };
}
