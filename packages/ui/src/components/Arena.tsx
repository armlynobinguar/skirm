import * as React from 'react';
import { cx } from '../util';

// v2 Arena primitives (Skirm Arena Deck prototype): the cut-corner HUD panel, kicker labels,
// condensed display headings, hazard tape, attribute pips, diamond chips and a segmented control.
// Styles are in components.css under "v2 Arena primitives".

export interface PanelProps extends React.HTMLAttributes<HTMLElement> {
  /** Element to render (default div). */
  as?: 'div' | 'section' | 'aside' | 'header' | 'footer';
  /** A 3px side colour along the top: teal for you, red for the rival. */
  side?: 'you' | 'rival';
  /** No inner padding. */
  flush?: boolean;
}

/** Cut-corner translucent panel. Extra props go to the element. */
export function Panel({ as: Tag = 'div', side, flush, className, children, ...rest }: PanelProps): React.ReactElement {
  return (
    <Tag {...rest} className={cx('sk-panel', side && 'is-' + side, flush && 'is-flush', className)}>
      {children}
    </Tag>
  );
}

/** Small mono uppercase label. A <b> child shows in teal. */
export function Kicker({ className, ...rest }: React.HTMLAttributes<HTMLSpanElement>): React.ReactElement {
  return <span {...rest} className={cx('sk-kick', className)} />;
}

export interface DisplayHeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level?: 1 | 2 | 3;
  /** Font size in px (the display face is set solid, line-height .9). */
  size?: number;
}

/** Condensed heavy uppercase heading. */
export function DisplayHeading({ level = 1, size, className, style, ...rest }: DisplayHeadingProps): React.ReactElement {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
  return <Tag {...rest} className={cx('sk-disp', className)} style={size ? { fontSize: size, ...style } : style} />;
}

/** The amber-and-black hazard tape strip (decorative). */
export function HazardTape({ className }: { className?: string }): React.ReactElement {
  return <span aria-hidden="true" className={cx('sk-tape', className)} />;
}

export interface PipsProps {
  value: number;
  max: number;
  /** Any CSS colour (default amber). */
  colour?: string;
  /** Accessible name, e.g. "Vision". The value is read as "3 of 5". */
  label: string;
}

/** An attribute bar of `max` small segments with `value` lit. */
export function Pips({ value, max, colour, label }: PipsProps): React.ReactElement {
  const on = Math.max(0, Math.min(max, Math.round(value)));
  return (
    <span
      className="sk-pips"
      role="img"
      aria-label={`${label} ${on} of ${max}`}
      style={colour ? ({ '--sk-pips-colour': colour } as React.CSSProperties) : undefined}
    >
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < on ? 'is-on' : undefined} />
      ))}
    </span>
  );
}

export interface DiamondChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Marker colour (any CSS colour, default teal). */
  colour?: string;
  /** Filled teal (selected). */
  on?: boolean;
}

/** Mono label with a diamond marker, e.g. an effect class or a model name. */
export function DiamondChip({ colour, on, className, style, children, ...rest }: DiamondChipProps): React.ReactElement {
  return (
    <span
      {...rest}
      className={cx('sk-dchip', on && 'is-on', className)}
      style={colour ? ({ '--sk-dchip-colour': colour, ...style } as React.CSSProperties) : style}
    >
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange?: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  /** Stretch to the container width. */
  block?: boolean;
  /** Every option disabled (e.g. a talk tier locked in ranked). */
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** One-of-several toggle buttons (aria-pressed). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  block,
  disabled,
  className,
  'data-testid': testId,
}: SegmentedProps<T>): React.ReactElement {
  return (
    <div role="group" aria-label={label} className={cx('sk-seg', block && 'is-block', className)} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled || o.disabled}
          onClick={() => (o.value === value ? undefined : onChange?.(o.value))}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface SoonProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** What is coming, for the tooltip and screen readers, e.g. "Season prizes". */
  what?: string;
}

/**
 * The labelled "Soon" state for a designed feature that is not live yet (seasons, prizes, rentals,
 * bluff stats, ...). Put it where the value would be; never show a mock number instead.
 */
export function Soon({ what, className, children, ...rest }: SoonProps): React.ReactElement {
  const label = what ? `${what}: coming soon` : 'Coming soon';
  return (
    <span {...rest} className={cx('sk-soon', className)} title={label} aria-label={label} data-soon="">
      {children ?? 'Soon'}
    </span>
  );
}
