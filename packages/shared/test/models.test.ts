// The model catalog (LLM_MODELS) and the scaled talk rate behind holds and charges.
import { describe, expect, it } from 'vitest';
import { ModelCatalogError, RATE_BPS_ONE, chargeDue, fmtMultiplier, parseModelCatalog, resolveModel, scaledRatePer100, talkHold } from '../src/index';

const DEF = 'anthropic/claude-haiku-5.5';

describe('parseModelCatalog', () => {
  it('is the default model alone at 1.0x when unset or blank', () => {
    const only = [{ id: DEF, label: 'claude-haiku-5.5', rateMultiplierBps: RATE_BPS_ONE }];
    expect(parseModelCatalog(undefined, DEF)).toEqual(only);
    expect(parseModelCatalog('  ', DEF)).toEqual(only);
    expect(parseModelCatalog(null, DEF)).toEqual(only);
  });

  it('puts the default first, adds it when unlisted and defaults labels', () => {
    const cat = parseModelCatalog(JSON.stringify([{ id: 'openai/gpt-5-mini', rateMultiplierBps: 15000 }, { id: 'x/big', label: 'Big', rateMultiplierBps: 30000 }]), DEF);
    expect(cat.map((m) => [m.id, m.label, m.rateMultiplierBps])).toEqual([
      [DEF, 'claude-haiku-5.5', 10000],
      ['openai/gpt-5-mini', 'gpt-5-mini', 15000],
      ['x/big', 'Big', 30000],
    ]);
  });

  it('keeps the operator label for the default model when listed at 1.0x', () => {
    const cat = parseModelCatalog(JSON.stringify([{ id: 'x/cheap', rateMultiplierBps: 5000 }, { id: DEF, label: 'Haiku', rateMultiplierBps: 10000 }]), DEF);
    expect(cat.map((m) => m.id)).toEqual([DEF, 'x/cheap']);
    expect(cat[0]!.label).toBe('Haiku');
  });

  it.each([
    ['not json', 'must be a JSON array'],
    ['{"id":"a"}', 'must be a JSON array'],
    ['[1]', 'entry 0 must be'],
    ['[{"id":"a b","rateMultiplierBps":10000}]', 'entry 0.id'],
    ['[{"id":"a","rateMultiplierBps":1.5}]', 'rateMultiplierBps must be an integer'],
    ['[{"id":"a","rateMultiplierBps":999}]', 'rateMultiplierBps must be an integer'],
    ['[{"id":"a","rateMultiplierBps":100001}]', 'rateMultiplierBps must be an integer'],
    ['[{"id":"a","label":"","rateMultiplierBps":10000}]', 'label must be'],
    ['[{"id":"a","rateMultiplierBps":10000,"price":1}]', 'unknown keys: price'],
    ['[{"id":"a","rateMultiplierBps":10000},{"id":"a","rateMultiplierBps":20000}]', 'a is listed twice'],
    [`[{"id":"${DEF}","rateMultiplierBps":20000}]`, 'always plays at 1.0x'],
  ])('refuses %s', (raw, msg) => {
    expect(() => parseModelCatalog(raw, DEF)).toThrow(ModelCatalogError);
    expect(() => parseModelCatalog(raw, DEF)).toThrow(msg);
  });

  it('caps the catalog size', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `m/${i}`, rateMultiplierBps: 10000 }));
    expect(() => parseModelCatalog(JSON.stringify(many), DEF)).toThrow('at most 8 models');
  });
});

describe('resolveModel', () => {
  const cat = parseModelCatalog(JSON.stringify([{ id: 'x/big', rateMultiplierBps: 15000 }]), DEF);

  it('plays the choice in casual and the default with none', () => {
    expect(resolveModel(cat, 'x/big', false)).toEqual({ model: cat[1], known: true });
    expect(resolveModel(cat, undefined, false)).toEqual({ model: cat[0], known: true });
    expect(resolveModel(cat, null, false)).toEqual({ model: cat[0], known: true });
  });

  it('forces the default in ranked', () => {
    expect(resolveModel(cat, 'x/big', true)).toEqual({ model: cat[0], known: true });
  });

  it('flags an id the catalog does not list (and falls back to the default)', () => {
    expect(resolveModel(cat, 'x/unknown', false)).toEqual({ model: cat[0], known: false });
  });
});

describe('scaledRatePer100', () => {
  it('leaves the tier rate alone at 1.0x or unset', () => {
    expect(scaledRatePer100(20)).toBe(20);
    expect(scaledRatePer100(20, undefined)).toBe(20);
    expect(scaledRatePer100(40, RATE_BPS_ONE)).toBe(40);
  });

  it('scales and rounds up to whole hundredths', () => {
    expect(scaledRatePer100(20, 15000)).toBe(30);
    expect(scaledRatePer100(20, 5000)).toBe(10);
    expect(scaledRatePer100(20, 12345)).toBe(25); // 24.69 → 25
    expect(scaledRatePer100(7, 3333)).toBe(3); // 2.3331 → 3
    expect(scaledRatePer100(40, 100000)).toBe(400);
  });

  it('keeps every per-tick charge inside the hold at any multiplier', () => {
    for (const bps of [1000, 3333, 9999, 10001, 12345, 15000, 27777, 100000])
      for (const ticks of [1, 7, 99, 135, 150]) {
        const rates = [scaledRatePer100(20, bps), scaledRatePer100(40, bps), 20];
        const hold = talkHold(rates, ticks);
        const per = rates.reduce((n, r) => n + r, 0);
        let charged = 0;
        for (let t = 1; t <= ticks; t++) charged += chargeDue(t * per, charged);
        expect(charged).toBe(hold);
      }
  });
});

describe('fmtMultiplier', () => {
  it('reads as a short factor', () => {
    expect([10000, 15000, 5000, 12345].map(fmtMultiplier)).toEqual(['1x', '1.5x', '0.5x', '1.23x']);
  });
});
