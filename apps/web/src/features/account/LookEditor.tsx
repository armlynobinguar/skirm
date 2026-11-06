'use client';
// Customise how an agent looks: skin, hair style and colour, outfit, pants, build and headgear, with
// a live isometric portrait (the arena's block figure: outfit colour body, skin tone head). Cosmetic
// only; saved through PATCH /agents/:id and allowed mid-run.
// Outfit and hair colours at or above FREE_OUTFIT_COUNT / FREE_HAIR_COUNT are premium (@skirm/shared
// COSMETICS): they show a lock and a price, can be previewed, and are bought with paid credits only
// (POST /cosmetics/:id/buy; a 402 links to credits). A look with an unowned premium colour cannot be
// saved (the api refuses it with 403 cosmetic_not_owned).
import {
  BUILDS,
  COSMETICS,
  FREE_HAIR_COUNT,
  FREE_OUTFIT_COUNT,
  HAIR_COLORS,
  HAIR_STYLES,
  HEADGEAR,
  OUTFIT_COLORS,
  PANTS_COLORS,
  SKIN_TONES,
  defaultAppearance,
  lookColours,
  premiumItemsIn,
  type AgentAppearance,
  type CosmeticItem,
  type CosmeticKind,
  type Unlock,
} from '@skirm/shared';
import { Button, Icon, fmt } from '@skirm/ui';
import Link from 'next/link';
import { useState } from 'react';
import { AgentPortrait } from '@/features/arena/AgentPortrait';
import { roleTitle } from '@/features/arena/roles';
import { errorCopy, isApiError } from '@/lib/api/errors';
import { useBuyCosmetic, useCosmetics, useMe } from '@/lib/api/queries';
import { routes } from '@/lib/routes';
import s from './account.module.css';

const HAIR_LABEL: Readonly<Record<AgentAppearance['hair'], string>> = {
  short: 'Short',
  long: 'Long',
  bun: 'Bun',
  buzz: 'Buzz cut',
  ponytail: 'Ponytail',
  none: 'Bald',
};
const BUILD_LABEL: Readonly<Record<AgentAppearance['build'], string>> = {
  slim: 'Slim',
  regular: 'Regular',
  sturdy: 'Sturdy',
};
const HEADGEAR_LABEL: Readonly<Record<AgentAppearance['headgear'], string>> = {
  role: 'Role gear',
  none: 'None',
  cap: 'Cap',
  bandana: 'Bandana',
  beanie: 'Beanie',
};

/** The premium item at a palette index of a kind, if any. */
const premiumAt = (items: readonly Readonly<CosmeticItem>[], kind: CosmeticKind, i: number) =>
  items.find((c) => c.kind === kind && c.index === i);

function Swatches({
  label,
  colors,
  value,
  onChange,
  testId,
  premium,
}: {
  label: string;
  colors: readonly string[];
  value: number;
  onChange: (i: number) => void;
  testId: string;
  /** Premium palettes: the item at an index (null for a free colour) and whether it is owned. */
  premium?: (i: number) => { item: Readonly<CosmeticItem>; owned: boolean } | null;
}) {
  return (
    <fieldset className={s.lookField}>
      <legend>{label}</legend>
      <div className={s.swatches} role="radiogroup" aria-label={label}>
        {colors.map((c, i) => {
          const p = premium?.(i) ?? null;
          const locked = !!p && !p.owned;
          const button = (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={value === i}
              aria-label={p ? `${label} ${i + 1}, ${p.item.name}, ${p.owned ? 'owned' : `premium, ${p.item.priceCredits} credits`}` : `${label} ${i + 1}`}
              title={p ? (p.owned ? `${p.item.name} · owned` : `${p.item.name} · ${p.item.priceCredits} credits`) : undefined}
              className={s.swatch}
              style={{ background: c }}
              onClick={() => onChange(i)}
              data-testid={`${testId}-${i}`}
              data-premium={p ? (p.owned ? 'owned' : 'locked') : undefined}
            >
              {locked ? (
                <span className={s.swatchLock} aria-hidden="true">
                  <Icon name="lock" size={12} />
                </span>
              ) : null}
            </button>
          );
          return locked ? (
            <span key={c} className={s.premiumSwatch}>
              {button}
              <small className={s.swatchPrice} data-testid={`${testId}-${i}-price`}>
                {p.item.priceCredits}
              </small>
            </span>
          ) : (
            button
          );
        })}
      </div>
    </fieldset>
  );
}

function Choice<T extends string>({
  label,
  options,
  names,
  value,
  onChange,
  testId,
}: {
  label: string;
  options: readonly T[];
  names: Readonly<Record<T, string>>;
  value: T;
  onChange: (v: T) => void;
  testId: string;
}) {
  return (
    <fieldset className={s.lookField}>
      <legend>{label}</legend>
      <div className="sk-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={value === o}
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            data-testid={`${testId}-${o}`}
          >
            {names[o]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export interface LookEditorProps {
  agentId: string;
  name: string;
  unlocks: Unlock[];
  initial: AgentAppearance;
  saving: boolean;
  onSave: (look: AgentAppearance) => void;
  onCancel: () => void;
}

export function LookEditor({ agentId, name, unlocks, initial, saving, onSave, onCancel }: LookEditorProps) {
  const [look, setLook] = useState<AgentAppearance>(initial);
  const set = <K extends keyof AgentAppearance>(k: K, v: AgentAppearance[K]) => setLook((l) => ({ ...l, [k]: v }));
  const role = roleTitle(unlocks);
  const changed = JSON.stringify(look) !== JSON.stringify(initial);

  const me = useMe();
  const cosmetics = useCosmetics();
  const buy = useBuyCosmetic();
  const items = cosmetics.data?.items ?? COSMETICS;
  const owned = new Set(cosmetics.data?.owned ?? me.data?.cosmetics ?? []);
  const premium = (kind: CosmeticKind, free: number) => (i: number) => {
    if (i < free) return null;
    const item = premiumAt(items, kind, i);
    return item ? { item, owned: owned.has(item.id) } : null;
  };
  // Premium colours in the look the account does not own yet: the look cannot be saved until bought.
  const unowned = premiumItemsIn(look)
    .filter((id) => !owned.has(id))
    .map((id) => items.find((c) => c.id === id))
    .filter((c): c is Readonly<CosmeticItem> => !!c);
  const short = isApiError(buy.error) && buy.error.code === 'insufficient_credits' ? buy.error.shortfall : null;

  return (
    <div className={s.lookEditor} data-testid="look-editor">
      <div className={s.lookPreview}>
        <AgentPortrait
          body={OUTFIT_COLORS[look.outfit] ?? OUTFIT_COLORS[0]}
          head={SKIN_TONES[look.skin] ?? SKIN_TONES[0]}
          team="A"
          label={`${name}, ${role}, preview`}
          role={role}
          dress={lookColours(look).dress}
          className={s.lookCanvas}
        />
        <div className={s.lookCaption}>
          <span className="sk-kick">
            <b>{name}</b> · {role}
          </span>
        </div>
      </div>

      <div className={s.lookControls}>
        <Swatches label="Skin" colors={SKIN_TONES} value={look.skin} onChange={(i) => set('skin', i)} testId="look-skin" />
        <Choice label="Hair" options={HAIR_STYLES} names={HAIR_LABEL} value={look.hair} onChange={(v) => set('hair', v)} testId="look-hair" />
        <Swatches
          label="Hair colour"
          colors={HAIR_COLORS}
          value={look.hairColor}
          onChange={(i) => set('hairColor', i)}
          testId="look-haircolor"
          premium={premium('hair', FREE_HAIR_COUNT)}
        />
        <Swatches
          label="Outfit"
          colors={OUTFIT_COLORS}
          value={look.outfit}
          onChange={(i) => set('outfit', i)}
          testId="look-outfit"
          premium={premium('outfit', FREE_OUTFIT_COUNT)}
        />
        <Swatches label="Pants" colors={PANTS_COLORS} value={look.pants} onChange={(i) => set('pants', i)} testId="look-pants" />
        <Choice label="Build" options={BUILDS} names={BUILD_LABEL} value={look.build} onChange={(v) => set('build', v)} testId="look-build" />
        <Choice
          label="Headgear"
          options={HEADGEAR}
          names={HEADGEAR_LABEL}
          value={look.headgear}
          onChange={(v) => set('headgear', v)}
          testId="look-headgear"
        />

        {unowned.length ? (
          <div className={s.lookPremium} data-testid="look-premium">
            {unowned.map((c) => (
              <div key={c.id} className={s.lookPremiumRow}>
                <span>
                  <Icon name="lock" size={14} /> <b>{c.name}</b> is premium: {fmt(c.priceCredits)} paid credits. Buy it to save this look.
                </span>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  icon="credits"
                  loading={buy.isPending && buy.variables === c.id}
                  disabled={buy.isPending}
                  onClick={() => buy.mutate(c.id)}
                  data-testid={`look-buy-${c.id}`}
                >
                  Buy · {fmt(c.priceCredits)} credits
                </Button>
              </div>
            ))}
            {buy.isError ? (
              <p className="app-banner is-warning" role="alert" data-testid="look-buy-error">
                {short ? (
                  <>
                    Not enough paid credits: need {fmt(short.need)}, have {fmt(short.have)}. Premium looks use paid credits, never the free allowance.{' '}
                    <Link href={routes.credits()} className="app-link-strong" data-testid="look-buy-topup">
                      Top up credits
                    </Link>
                  </>
                ) : (
                  errorCopy(buy.error).message
                )}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className={s.lookActions}>
          <Button type="button" variant="ghost" size="sm" onClick={() => setLook(defaultAppearance(agentId))} data-testid="look-reset">
            Reset to default
          </Button>
          <span className={s.lookSpacer} aria-hidden="true" />
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!changed || saving || unowned.length > 0}
            title={unowned.length ? 'Buy the premium colours first, or pick free ones' : undefined}
            onClick={() => onSave(look)}
            data-testid="look-save"
          >
            {saving ? 'Saving…' : 'Save look'}
          </Button>
        </div>
      </div>
    </div>
  );
}
