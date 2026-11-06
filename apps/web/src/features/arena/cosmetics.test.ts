import { equipCosmeticById } from '@skirm/shared';
import { describe, expect, it } from 'vitest';
import { v2FrameFixture } from '@/test/fixtures';
import { cosmeticsOf, drawCosmetics2D, plateOf, skinOf, trailOf, trailSteps } from './cosmetics';
import { agentColours, composeV2Arena } from './live';

function dressed() {
  const f = v2FrameFixture();
  return {
    ...f,
    agents: f.agents.map((a) =>
      a.id === 'wick' ? { ...a, cosmetics: { skin: 'skin_ember', trail: 'trail_spark', nameplate: 'plate_gold' } } : a,
    ),
  };
}

/** A canvas context that records the fill and stroke colours it was given. */
function fakeCtx() {
  const fills: string[] = [];
  const strokes: string[] = [];
  const texts: string[] = [];
  let fillStyle = '';
  let strokeStyle = '';
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    ellipse() {},
    setLineDash() {},
    fill() {
      fills.push(fillStyle);
    },
    stroke() {
      strokes.push(strokeStyle);
    },
    fillRect() {
      fills.push(fillStyle);
    },
    strokeRect() {
      strokes.push(strokeStyle);
    },
    fillText(t: string) {
      texts.push(`${fillStyle}:${t}`);
    },
    measureText: (t: string) => ({ width: t.length * 6 }),
    set fillStyle(v: string) {
      fillStyle = v;
    },
    get fillStyle() {
      return fillStyle;
    },
    set strokeStyle(v: string) {
      strokeStyle = v;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textAlign: 'left',
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, strokes, texts };
}

describe('arena cosmetics', () => {
  it('reads what each agent wears off a frame', () => {
    expect(cosmeticsOf(v2FrameFixture())).toBeNull();
    expect(cosmeticsOf(dressed())).toEqual({
      wick: { skin: 'skin_ember', trail: 'trail_spark', nameplate: 'plate_gold' },
    });
    expect(skinOf({ skin: 'trail_spark' })).toBeUndefined(); // an id in the wrong slot draws nothing
    expect(trailOf({ trail: 'trail_spark' })?.style).toBe('sparks');
    expect(plateOf({})).toBeUndefined();
  });

  it('tints a worn skin onto the body and leaves the others in their crew colours', () => {
    const a = composeV2Arena(dressed())!;
    const ember = equipCosmeticById('skin_ember')!;
    const wick = a.state.agents.find((x) => x.id === 'wick') as unknown as { c: string; bone: string };
    const moss = a.state.agents.find((x) => x.id === 'moss') as unknown as { c: string; bone: string; slot: number };
    expect(ember.kind === 'skin' && wick.c === ember.body && wick.bone === ember.accent).toBe(true);
    expect(moss.c).toBe(agentColours('A', moss.slot).body);
    expect(a.cosmetics).toEqual({ wick: { skin: 'skin_ember', trail: 'trail_spark', nameplate: 'plate_gold' } });
    expect(composeV2Arena(v2FrameFixture())!.cosmetics).toBeUndefined();
  });

  it('keeps a short trail of recent tiles per agent', () => {
    expect(trailSteps('t1', 'k', 1, 1, 0)).toEqual([[1, 1, 0]]);
    trailSteps('t1', 'k', 2, 1, 100);
    expect(trailSteps('t1', 'k', 3, 1, 200).map((s) => s[0])).toEqual([1, 2, 3]);
    // Old steps fade out; the current tile stays.
    expect(trailSteps('t1', 'k', 3, 1, 5000)).toEqual([[3, 1, 5000]]);
    // A new arena starts over.
    expect(trailSteps('t1', 'other', 9, 9, 5100)).toEqual([[9, 9, 5100]]);
  });

  it('draws the skin ring, the trail and the nameplate in the item colours', () => {
    const arena = composeV2Arena(dressed())!;
    const { ctx, fills, strokes, texts } = fakeCtx();
    const plate = equipCosmeticById('plate_gold')!;
    const ember = equipCosmeticById('skin_ember')!;
    const wick = arena.state.agents.find((x) => x.id === 'wick')!;
    // Two frames on different tiles leave a trail step behind.
    drawCosmetics2D(ctx, { ...arena, state: { ...arena.state, agents: arena.state.agents.map((a) => (a.id === 'wick' ? { ...a, x: a.x + 1 } : a)) } }, null, 1, 40, 0, 0, { tags: true });
    drawCosmetics2D(ctx, arena, null, 1, 40, 0, 0, { tags: true });
    if (plate.kind !== 'nameplate' || ember.kind !== 'skin') throw new Error('catalog');
    expect(fills).toContain(plate.bg);
    expect(strokes).toContain(plate.border);
    expect(texts).toContain(`${plate.fg}:${wick.name}`);
    expect(strokes).toContain(ember.accent);
    expect(fills).toContain('#ffd166'); // spark trail

    // No tags yet (intro), reduced motion: no plate, no trail.
    const quiet = fakeCtx();
    drawCosmetics2D(quiet.ctx, arena, null, 1, 40, 0, 0, { still: true });
    expect(quiet.texts).toEqual([]);
    expect(quiet.fills).not.toContain('#ffd166');
    // Nobody dressed: nothing drawn.
    const none = fakeCtx();
    drawCosmetics2D(none.ctx, composeV2Arena(v2FrameFixture())!, null, 1, 40, 0, 0, { tags: true });
    expect(none.fills).toEqual([]);
  });
});
