// Header and menu icons in the v2 Arena look (the prototype's akIcon), drawn in code on a 32-unit
// grid: a halftone dot gradient (real dots, sized by position), fine hatching, corner brackets and one
// accent stroke each. The accent reads --nacc from any ancestor (teal when unset); PvP adds a red
// guard for the rival side. Lines and dots use currentColor.
// The markup is generated from constants only (no props reach it), so it is set as inner HTML.
import * as React from 'react';
import { cx } from '../util';

export type AkIconName =
  | 'play'
  | 'mine'
  | 'market'
  | 'skirm'
  | 'pvp'
  | 'lb'
  | 'sfx'
  | 'notes'
  | 'atlas'
  | 'crew'
  | 'proof'
  | 'practice'
  | 'pause'
  | 'resume'
  | 'tpv'
  | 'story'
  | 'back';

type Dir = 'x' | '-x' | 'y' | '-y' | 'd' | '-d';

/** The SVG body for one icon; `uid` keeps clip-path ids unique on the page. */
export function akIconMarkup(kind: AkIconName, uid: string): string {
  const id = (k: string) => `ak${uid}${k}`;
  const clip = (k: string, d: string, eo = false) => `<clipPath id="${id(k)}"><path d="${d}"${eo ? ' clip-rule="evenodd"' : ''}/></clipPath>`;
  const dots = (k: string, x0: number, y0: number, x1: number, y1: number, dir: Dir, step = 2.2, rmax = 1.05, rmin = 0.1) => {
    let o = '';
    let row = 0;
    for (let y = y0; y <= y1 + 0.01; y += step, row++) {
      for (let x = x0 + (row % 2 ? step / 2 : 0); x <= x1 + 0.01; x += step) {
        const tx = (x - x0) / (x1 - x0 || 1);
        const ty = (y - y0) / (y1 - y0 || 1);
        const t = { x: tx, '-x': 1 - tx, y: ty, '-y': 1 - ty, d: (tx + ty) / 2, '-d': 1 - (tx + ty) / 2 }[dir];
        const r = rmin + (rmax - rmin) * t;
        if (r > 0.22) o += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}"/>`;
      }
    }
    return `<g clip-path="url(#${id(k)})" fill="currentColor">${o}</g>`;
  };
  const hatch = (k: string, op = 0.5, step = 2.1, back = false) => {
    let d = '';
    for (let q = -34; q < 68; q += step) d += back ? `M${q} 0L${q + 32} 32` : `M${q} 0L${q - 32} 32`;
    return `<path clip-path="url(#${id(k)})" d="${d}" stroke="currentColor" stroke-width=".55" opacity="${op}" fill="none"/>`;
  };
  const ln = (d: string, w = 1.3, extra = '') =>
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="square" ${extra}/>`;
  const acc = (d: string, w = 2) => `<path d="${d}" fill="none" style="stroke:var(--nacc,var(--you))" stroke-width="${w}" stroke-linecap="square"/>`;
  const accF = (d: string) => `<path d="${d}" style="fill:var(--nacc,var(--you))"/>`;
  const brackets = `<path d="M.5 4.5v-4h4M27.5.5h4v4M31.5 27.5v4h-4M4.5 31.5h-4v-4" fill="none" stroke="currentColor" stroke-width=".9" opacity=".5"/>`;
  let defs = '';
  let g = '';
  switch (kind) {
    case 'play': {
      const hex = 'M16 4L26.4 10V22L16 28L5.6 22V10Z';
      const tri = 'M12 10.5L22.5 16L12 21.5Z';
      defs = clip('h', hex) + clip('t', tri);
      g = hatch('h', 0.28) + ln(hex) + ln('M9.3 10.8L19.4 16L9.3 21.2', 0.8, 'stroke-dasharray="1.2 1.3" opacity=".6"') + dots('t', 11, 10, 23, 22, '-x', 2, 1.15) + ln(tri, 1.2) + acc('M5.6 22L16 28') + accF('M24.6 3.6h3v1.4h-3z');
      break;
    }
    case 'mine': {
      const body = 'M8 5H20L24 9V27H8Z';
      const win = 'M11 8.5H20V14.5H11Z';
      defs = clip('w', win) + clip('s', 'M20.5 17H24V27H20.5Z');
      g =
        hatch('s', 0.55) +
        ln(body) +
        dots('w', 11, 8.5, 20, 14.5, 'd', 1.9, 0.95) +
        ln(win, 0.9) +
        ln('M11 18.5h6.5M11 21.5h4.5M11 24.5h7', 1.1) +
        ln('M4.5 11h3.5M4.5 15h3.5M4.5 19h3.5M4.5 23h3.5M24 13h3.5M24 17h3.5M24 21h3.5', 0.9, 'opacity=".75"') +
        acc('M20 5L24 9', 2.2) +
        accF('M8 27h5v1.6H8z');
      break;
    }
    case 'market': {
      const outer = 'M16 3L29 16L16 29L3 16Z';
      const inner = 'M16 9.5L22.5 16L16 22.5L9.5 16Z';
      defs = clip('r', 'M16 3L29 16L16 29Z') + clip('i', inner);
      g = hatch('r', 0.38, 2.1, true) + ln(outer) + dots('i', 9.5, 9.5, 22.5, 22.5, 'y', 1.9, 1) + ln(inner, 0.8, 'opacity=".7"') + acc('M8 13.2H23.5M20.5 10.2L23.5 13.2', 1.5) + acc('M24 18.8H8.5M11.5 21.8L8.5 18.8', 1.5);
      break;
    }
    case 'skirm':
    case 'pvp': {
      const b1 = 'M5 25L22.5 5H27V9.5L7 27Z';
      const b2 = 'M27 25L9.5 5H5V9.5L25 27Z';
      defs = clip('a', b1) + clip('b', b2);
      g =
        hatch('b', 0.6) +
        ln(b2, 1) +
        dots('a', 5, 5, 27, 27, '-d', 2, 1.1, 0.25) +
        ln(b1, 1.1) +
        acc('M3.5 21.5L10.5 28.5', 1.8) +
        (kind === 'skirm' ? acc('M28.5 21.5L21.5 28.5', 1.8) : `<path d="M28.5 21.5L21.5 28.5" fill="none" style="stroke:var(--rival)" stroke-width="1.8"/>`) +
        '<rect x="14.3" y="14.3" width="3.4" height="3.4" transform="rotate(45 16 16)" fill="currentColor"/>';
      break;
    }
    case 'lb': {
      const L = 'M5 18H12V28H5Z';
      const M = 'M12.5 12H19.5V28H12.5Z';
      const R = 'M20 21.5H27V28H20Z';
      defs = clip('l', L) + clip('m', M) + clip('q', R);
      g = hatch('l', 0.5) + hatch('q', 0.5, 2.1, true) + dots('m', 12.5, 12, 19.5, 28, '-y', 1.9, 1.05) + ln(L, 1.1) + ln(M, 1.2) + ln(R, 1.1) + accF('M12.5 9.6L13.9 5.4L16 8L18.1 5.4L19.5 9.6Z') + ln('M2.5 28.5H29.5', 1, 'opacity=".7"');
      break;
    }
    case 'sfx': {
      const cone = 'M5 12H10L17 6V26L10 20H5Z';
      defs = clip('c', cone);
      g = dots('c', 5, 6, 17, 26, 'x', 1.9, 1.05) + ln(cone, 1.2) + ln('M21 11.5a6.4 6.4 0 0 1 0 9M24.5 8.2a10.8 10.8 0 0 1 0 15.6', 1.4) + acc('M5 12V20', 2.2);
      break;
    }
    case 'notes': {
      const doc = 'M7 4H20L25 9V28H7Z';
      defs = clip('t', 'M7 4H20V11H7Z') + clip('d', doc);
      g = hatch('d', 0.22) + dots('t', 7, 4, 20, 11, 'x', 1.9, 0.95) + ln(doc, 1.2) + ln('M10 15h11M10 19h11M10 23h7', 1.2) + accF('M20 4V9H25Z');
      break;
    }
    case 'atlas': {
      const top = 'M16 4L28 10.5L16 17L4 10.5Z';
      const band = 'M4 10.5L16 17L28 10.5V15.5L16 22L4 15.5Z';
      defs = clip('t', top) + clip('b', band);
      g =
        hatch('b', 0.45) +
        dots('t', 4, 4, 28, 17, '-y', 2, 1.05) +
        ln(top, 1.2) +
        ln('M4 15.5L16 22L28 15.5', 1.2) +
        ln('M4 20.5L16 27L28 20.5', 1.1, 'opacity=".6"') +
        ln('M4 10.5V20.5M28 10.5V20.5', 0.8, 'opacity=".5"') +
        acc('M4 10.5L16 4', 1.8) +
        accF('M16 8.6l1.9 1.9-1.9 1.9-1.9-1.9z');
      break;
    }
    case 'crew': {
      const ch = 'M12.5 5.5H19.5V11.5H12.5Z';
      const cb = 'M11.5 12.5H20.5V22H11.5Z';
      const lb = 'M3.5 16.5H9.5V24H3.5Z';
      const rb = 'M22.5 16.5H28.5V24H22.5Z';
      defs = clip('c', cb) + clip('l', lb) + clip('r', rb);
      g =
        hatch('l', 0.55) +
        hatch('r', 0.55, 2.1, true) +
        dots('c', 11.5, 12.5, 20.5, 22, '-y', 1.9, 1.05) +
        ln(ch, 1.2) +
        ln(cb, 1.2) +
        ln('M13 23H19V26.5H13Z', 1) +
        ln('M4 11H9V15.5H4Z', 1) +
        ln(lb, 1) +
        ln('M23 11H28V15.5H23Z', 1) +
        ln(rb, 1) +
        acc('M14 8.6h4', 1.8) +
        ln('M5.5 13.3h2M24.5 13.3h2', 1.2, 'opacity=".8"') +
        ln('M1.5 28H30.5', 1, 'opacity=".6"');
      break;
    }
    case 'proof': {
      const cart = 'M5 4H16L20 8V25H5Z';
      const win = 'M8 7.5H16V12.5H8Z';
      const badge = 'M28.5 22a6.5 6.5 0 1 1-13 0a6.5 6.5 0 1 1 13 0Z';
      defs = clip('w', win) + clip('g', badge);
      g =
        ln(cart, 1.2) +
        dots('w', 8, 7.5, 16, 12.5, 'd', 1.8, 0.9) +
        ln(win, 0.9) +
        ln('M8 16h7M8 19h5', 1.1) +
        ln('M2 10h3M2 14h3M2 18h3', 0.9, 'opacity=".7"') +
        `<path d="${badge}" style="fill:var(--ink-2)"/>` +
        hatch('g', 0.45) +
        ln(badge, 1.2) +
        ln('M22 13v2M22 29v2M13 22h2M29 22h2', 1, 'opacity=".7"') +
        acc('M18.8 22.2l2.2 2.3 4.2-4.6', 2);
      break;
    }
    case 'practice': {
      const ring = 'M28 16a12 12 0 1 1-24 0a12 12 0 1 1 24 0ZM23.5 16a7.5 7.5 0 1 0-15 0a7.5 7.5 0 1 0 15 0Z';
      const disc = 'M23.5 16a7.5 7.5 0 1 1-15 0a7.5 7.5 0 1 1 15 0Z';
      defs = clip('r', ring, true) + clip('d', disc);
      g =
        hatch('r', 0.4) +
        dots('d', 8.5, 8.5, 23.5, 23.5, 'd', 1.9, 1.05) +
        ln('M28 16a12 12 0 1 1-24 0a12 12 0 1 1 24 0Z', 1.2) +
        ln(disc, 1) +
        ln('M16 .5v5M16 26.5v5M.5 16h5M26.5 16h5', 1.1) +
        acc('M16 4a12 12 0 0 1 12 12', 2) +
        '<circle cx="16" cy="16" r="2.4" style="fill:var(--nacc,var(--you))"/>';
      break;
    }
    case 'pause': {
      const a = 'M9.5 7H14V25H9.5Z';
      const b = 'M18 7H22.5V25H18Z';
      defs = clip('a', a) + clip('b', b);
      g = dots('a', 9.5, 7, 14, 25, '-y', 1.8, 0.95) + hatch('b', 0.6) + ln(a, 1.2) + ln(b, 1.2) + acc('M7 28H25', 1.6);
      break;
    }
    case 'resume': {
      const tri = 'M10 7L25 16L10 25Z';
      defs = clip('t', tri);
      g = dots('t', 10, 7, 25, 25, '-x', 1.9, 1.05) + ln(tri, 1.3) + ln('M6.5 9.5V22.5', 1, 'stroke-dasharray="1.2 1.3" opacity=".6"') + acc('M10 25L25 16', 1.8);
      break;
    }
    case 'tpv': {
      const body = 'M12 11.5H20V19.5H12Z';
      defs = clip('b', body);
      g =
        ln('M13 4.5H19V10.5H13Z', 1.2) +
        dots('b', 12, 11.5, 20, 19.5, '-y', 1.8, 0.95) +
        ln(body, 1.2) +
        ln('M13.5 24.5L4.5 11M18.5 24.5L27.5 11', 0.9, 'stroke-dasharray="1.4 1.4" opacity=".7"') +
        accF('M12.5 24.5H19.5V29H12.5Z') +
        acc('M14.5 7.5h3', 1.6);
      break;
    }
    case 'story': {
      const box = 'M3.5 6.5H28.5V21.5H17L11.5 26.5V21.5H3.5Z';
      defs = clip('b', box);
      g = hatch('b', 0.22) + ln(box, 1.2) + ln('M7.5 11.5h17M7.5 15.5h11', 1.3) + dots('b', 20, 13.5, 27, 20, 'x', 1.8, 0.9) + acc('M3.5 6.5H12', 2);
      break;
    }
    case 'back': {
      const tri = 'M18.5 7L9.5 16L18.5 25Z';
      defs = clip('k', tri);
      g = dots('k', 9.5, 7, 18.5, 25, '-x', 1.9, 1) + ln('M18.5 7L9.5 16L18.5 25', 1.8) + ln('M25 7L16 16L25 25', 1, 'opacity=".5"') + acc('M23 16H28', 1.6);
      break;
    }
  }
  return `<defs>${defs}</defs>${brackets}${g}`;
}

export interface AkIconProps {
  name: AkIconName;
  /** Pixel size of the square SVG. Defaults to filling its box (CSS sizes it). */
  size?: number;
  className?: string;
}

/** One code-drawn icon. Decorative: label the control it sits in, not the icon. */
export function AkIcon({ name, size, className }: AkIconProps): React.ReactElement {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const html = React.useMemo(() => akIconMarkup(name, uid), [name, uid]);
  return (
    <svg
      className={cx('sk-ak', className)}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
