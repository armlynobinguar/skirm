// Model choice per agent: the models an operator lets players pick for their agents, and what each
// one does to an agent's talk rate. The operator lists them in LLM_MODELS as JSON,
//   [{ "id": "openai/gpt-5-mini", "label": "GPT-5 mini", "rateMultiplierBps": 15000 }, ...]
// where rateMultiplierBps scales the talk tier's rate in basis points (10000 = 1.0x). The default
// model (LLM_MODEL) is always in the catalog, first, at exactly 1.0x: unset LLM_MODELS is a catalog
// of the default alone, so nothing changes. Ranked always plays the default model.
// Prices stay whole: an agent's rate is ceil(ratePer100 × bps / 10000) credits per 100 agent-ticks,
// an integer, so holds (talkHold) and per-tick charges (chargeDue) use the same rate and charges
// never exceed the hold. The server resolves every id against its own catalog: a client never sets
// a price.

/** One pickable model. */
export interface ModelChoice {
  /** The model id as the provider names it (sent as `model` on every call). */
  id: string;
  /** Short name shown in the crew builder. */
  label: string;
  /** Talk-rate multiplier in basis points: 10000 = 1.0x. */
  rateMultiplierBps: number;
}

/** 1.0x in basis points. */
export const RATE_BPS_ONE = 10_000;
/** The cheapest (0.1x) and dearest (10x) multiplier an operator may set. */
export const RATE_BPS_MIN = 1_000;
export const RATE_BPS_MAX = 100_000;
/** At most this many models in a catalog. */
export const MAX_MODEL_CHOICES = 8;
export const MAX_MODEL_LABEL = 40;
/** Model ids as providers write them: `vendor/name`, `name:tag`, `name@version`. */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;

export class ModelCatalogError extends Error {
  constructor(message: string) {
    super(`LLM_MODELS: ${message}`);
    this.name = 'ModelCatalogError';
  }
}

/** The label a model gets when the operator names none: the part after the vendor. */
export function defaultModelLabel(id: string): string {
  return (id.split('/').pop() || id).slice(0, MAX_MODEL_LABEL);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseEntry(v: unknown, i: number): ModelChoice {
  if (!isObj(v)) throw new ModelCatalogError(`entry ${i} must be {id, label?, rateMultiplierBps}`);
  const extra = Object.keys(v).filter((k) => !['id', 'label', 'rateMultiplierBps'].includes(k));
  if (extra.length) throw new ModelCatalogError(`entry ${i} has unknown keys: ${extra.join(', ')}`);
  if (typeof v.id !== 'string' || !MODEL_ID_RE.test(v.id.trim())) throw new ModelCatalogError(`entry ${i}.id must be a model id`);
  const label = v.label === undefined ? undefined : typeof v.label === 'string' ? v.label.trim() : null;
  if (label === null || (label !== undefined && (!label || label.length > MAX_MODEL_LABEL)))
    throw new ModelCatalogError(`entry ${i}.label must be 1 to ${MAX_MODEL_LABEL} characters`);
  const bps = v.rateMultiplierBps;
  if (typeof bps !== 'number' || !Number.isInteger(bps) || bps < RATE_BPS_MIN || bps > RATE_BPS_MAX)
    throw new ModelCatalogError(`entry ${i}.rateMultiplierBps must be an integer from ${RATE_BPS_MIN} to ${RATE_BPS_MAX}`);
  const id = v.id.trim();
  return { id, label: label ?? defaultModelLabel(id), rateMultiplierBps: bps };
}

/**
 * The catalog LLM_MODELS describes, the default model first at 1.0x (added when not listed). Unset
 * or blank: the default model alone. Throws ModelCatalogError on anything malformed, so a bad
 * setting fails at boot rather than mispricing a match.
 */
export function parseModelCatalog(raw: string | undefined | null, defaultModel: string): ModelChoice[] {
  const def: ModelChoice = { id: defaultModel, label: defaultModelLabel(defaultModel), rateMultiplierBps: RATE_BPS_ONE };
  if (raw === undefined || raw === null || raw.trim() === '') return [def];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ModelCatalogError('must be a JSON array');
  }
  if (!Array.isArray(json)) throw new ModelCatalogError('must be a JSON array');
  const listed = json.map(parseEntry);
  const ids = new Set<string>();
  for (const m of listed) {
    if (ids.has(m.id)) throw new ModelCatalogError(`${m.id} is listed twice`);
    ids.add(m.id);
  }
  const own = listed.find((m) => m.id === defaultModel);
  if (own && own.rateMultiplierBps !== RATE_BPS_ONE) throw new ModelCatalogError(`the default model ${defaultModel} always plays at 1.0x (rateMultiplierBps ${RATE_BPS_ONE})`);
  const out = [own ?? def, ...listed.filter((m) => m.id !== defaultModel)];
  if (out.length > MAX_MODEL_CHOICES) throw new ModelCatalogError(`at most ${MAX_MODEL_CHOICES} models`);
  return out;
}

/**
 * The model an agent plays: the default (catalog[0]) in ranked, with no choice, or for an id the
 * catalog does not list (`known` false, so a server can refuse it instead).
 */
export function resolveModel(catalog: readonly ModelChoice[], id: string | null | undefined, ranked: boolean): { model: ModelChoice; known: boolean } {
  const def = catalog[0]!;
  if (id === undefined || id === null || id === def.id) return { model: def, known: true };
  const hit = catalog.find((m) => m.id === id);
  if (!hit) return { model: def, known: false };
  return { model: ranked ? def : hit, known: true };
}

/**
 * An agent's rate in credits per 100 agent-ticks: the tier's rate scaled by the model multiplier,
 * rounded up so the hold always covers the charge. 1.0x (or unset) returns the tier rate unchanged.
 */
export function scaledRatePer100(ratePer100: number, rateBps: number | undefined = RATE_BPS_ONE): number {
  if (rateBps === RATE_BPS_ONE) return ratePer100;
  // Integers: the product is exact, and an exact multiple of 10000 divides exactly, so ceil is safe.
  return Math.ceil((ratePer100 * rateBps) / RATE_BPS_ONE);
}

/** "1.5x" for the crew builder. */
export function fmtMultiplier(rateBps: number): string {
  return `${Number((rateBps / RATE_BPS_ONE).toFixed(2))}x`;
}
