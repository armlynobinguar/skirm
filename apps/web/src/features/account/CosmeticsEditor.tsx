'use client';
// Arena style for one agent: the skin (body palette and pattern), trail and nameplate it wears in
// matches (@skirm/shared EQUIP_COSMETICS). The shop and the inventory in one place: each slot lists
// every item, owned ones equip at once (PUT /agents/:id/cosmetics/:slot), the rest show a price and
// are bought with paid credits only (POST /cosmetics/:id/buy; a 402 links to credits). Purely visual:
// the arena draws it (features/arena/cosmetics.ts), the engine never sees it. When the server has the
// NEP-245 contract on (GET /cosmetics `onchain`), owned items show their mint and can be minted.
import {
  COSMETIC_SLOTS,
  EQUIP_COSMETICS,
  type AgentCosmetics,
  type CosmeticSlot,
  type EquipCosmetic,
} from '@skirm/shared';
import { Badge, Button, fmt } from '@skirm/ui';
import Link from 'next/link';
import { useToast } from '@/components/toast/ToastProvider';
import { AgentPortrait } from '@/features/arena/AgentPortrait';
import { errorCopy, isApiError } from '@/lib/api/errors';
import { useBuyCosmetic, useCosmetics, useEquipCosmetic, useMintCosmetic } from '@/lib/api/queries';
import { routes } from '@/lib/routes';
import s from './account.module.css';

const SLOT_LABEL: Readonly<Record<CosmeticSlot, string>> = { skin: 'Skin', trail: 'Trail', nameplate: 'Nameplate' };
const MINT_LABEL = { pending: 'Minting…', minted: 'On NEAR', failed: 'Mint failed' } as const;

/** A small swatch that shows what an item looks like. */
function Swatch({ item }: { item: Readonly<EquipCosmetic> }) {
  if (item.kind === 'skin')
    return (
      <span
        className={s.styleSwatch}
        aria-hidden="true"
        style={{
          background:
            item.pattern === 'stripes'
              ? `repeating-linear-gradient(45deg, ${item.body} 0 5px, ${item.accent} 5px 8px)`
              : item.pattern === 'chevron'
                ? `linear-gradient(135deg, ${item.body} 40%, ${item.accent} 40% 55%, ${item.body} 55%)`
                : item.pattern === 'dots'
                  ? `radial-gradient(${item.accent} 22%, transparent 24%) 0 0 / 8px 8px, ${item.body}`
                  : item.body,
        }}
      />
    );
  if (item.kind === 'trail')
    return (
      <span
        className={s.styleSwatch}
        aria-hidden="true"
        style={{ background: `linear-gradient(90deg, transparent, ${item.color})` }}
      />
    );
  return (
    <span
      className={s.stylePlate}
      aria-hidden="true"
      style={{ color: item.fg, background: item.bg, boxShadow: `inset 0 0 0 1px ${item.border}` }}
    >
      Aa
    </span>
  );
}

export interface CosmeticsEditorProps {
  agentId: string;
  name: string;
  onDone: () => void;
}

export function CosmeticsEditor({ agentId, name, onDone }: CosmeticsEditorProps) {
  const q = useCosmetics();
  const buy = useBuyCosmetic();
  const equip = useEquipCosmetic();
  const mint = useMintCosmetic();
  const toast = useToast();
  const items = q.data?.equip ?? EQUIP_COSMETICS;
  const owned = new Set(q.data?.owned ?? []);
  const worn: AgentCosmetics = q.data?.equipped?.[agentId] ?? {};
  const onchain = q.data?.onchain ?? null;
  const short = isApiError(buy.error) && buy.error.code === 'insufficient_credits' ? buy.error.shortfall : null;
  const skin = worn.skin ? items.find((c) => c.id === worn.skin) : undefined;

  const put = (slot: CosmeticSlot, itemId: string | null) =>
    equip.mutate({ agentId, slot, itemId }, { onError: (err) => toast.error(err) });

  return (
    <div className={s.lookEditor} data-testid="style-editor">
      <div className={s.lookPreview}>
        <AgentPortrait
          body={skin?.kind === 'skin' ? skin.body : '#34e0c8'}
          head={skin?.kind === 'skin' ? skin.accent : '#ece8e1'}
          team="A"
          label={`${name}, arena style preview`}
          className={s.lookCanvas}
        />
        <div className={s.lookCaption}>
          <span className="sk-kick">
            <b>{name}</b> · arena style
          </span>
        </div>
      </div>

      <div className={s.lookControls}>
        <p className="sk-muted">
          What {name} wears in matches. Visual only: it never changes how the agent plays.
          {onchain ? ` Items are NEP-245 tokens on ${onchain.contractId}.` : ''}
        </p>
        {COSMETIC_SLOTS.map((slot) => (
          <fieldset key={slot} className={s.lookField} data-testid={`style-slot-${slot}`}>
            <legend>{SLOT_LABEL[slot]}</legend>
            <div className={s.styleList} role="radiogroup" aria-label={SLOT_LABEL[slot]}>
              <button
                type="button"
                role="radio"
                aria-checked={!worn[slot]}
                className={s.styleItem}
                disabled={equip.isPending}
                onClick={() => put(slot, null)}
                data-testid={`style-${slot}-none`}
              >
                <span className={s.styleName}>Default</span>
              </button>
              {items
                .filter((c) => c.kind === slot)
                .map((c) => {
                  const has = owned.has(c.id);
                  const on = worn[slot] === c.id;
                  const m = q.data?.mints?.[c.id];
                  return (
                    <div key={c.id} className={s.styleRow} data-testid={`style-item-${c.id}`} data-owned={has ? 'yes' : 'no'}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`${c.name}, ${has ? 'owned' : `${c.priceCredits} credits`}`}
                        className={s.styleItem}
                        disabled={!has || equip.isPending}
                        onClick={() => put(slot, c.id)}
                        data-testid={`style-equip-${c.id}`}
                      >
                        <Swatch item={c} />
                        <span className={s.styleName}>{c.name}</span>
                        <small className="sk-muted">{c.blurb}</small>
                      </button>
                      {has ? (
                        onchain ? (
                          m && m.status !== 'failed' ? (
                            <Badge tone={m.status === 'minted' ? 'good' : 'neutral'} data-testid={`style-mint-${c.id}`}>
                              {MINT_LABEL[m.status]}
                            </Badge>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              loading={mint.isPending && mint.variables === c.id}
                              disabled={mint.isPending}
                              onClick={() => mint.mutate(c.id, { onError: (err) => toast.error(err) })}
                              data-testid={`style-mint-${c.id}`}
                            >
                              {m?.status === 'failed' ? 'Retry mint' : 'Mint'}
                            </Button>
                          )
                        ) : on ? (
                          <Badge tone="you">Worn</Badge>
                        ) : null
                      ) : m?.status === 'minted' ? (
                        // Bought and minted, but the token is not on the linked NEAR account now.
                        <small className="sk-muted" data-testid={`style-elsewhere-${c.id}`}>
                          {m.owner ? `Minted to ${m.owner}, not` : 'Not'} on your linked NEAR account now. Move it back to wear it.
                        </small>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          icon="credits"
                          loading={buy.isPending && buy.variables === c.id}
                          disabled={buy.isPending}
                          onClick={() => buy.mutate(c.id)}
                          data-testid={`style-buy-${c.id}`}
                        >
                          {fmt(c.priceCredits)}
                        </Button>
                      )}
                    </div>
                  );
                })}
            </div>
          </fieldset>
        ))}

        {buy.isError ? (
          <p className="app-banner is-warning" role="alert" data-testid="style-buy-error">
            {short ? (
              <>
                Not enough paid credits: need {fmt(short.need)}, have {fmt(short.have)}. Cosmetics use paid credits, never the free allowance.{' '}
                <Link href={routes.credits()} className="app-link-strong">
                  Top up credits
                </Link>
              </>
            ) : (
              errorCopy(buy.error).message
            )}
          </p>
        ) : null}

        <div className={s.lookActions}>
          <span className={s.lookSpacer} aria-hidden="true" />
          <Button type="button" variant="secondary" size="sm" onClick={onDone} data-testid="style-done">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
