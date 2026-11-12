// A small markdown renderer for the docs pages: headings, paragraphs, lists, fenced code, tables,
// quotes, rules, and inline bold, italics, code and links. It builds React elements directly
// (no HTML strings), so page text can never inject markup. Links to /... use next/link.
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { slugify } from './docs';

type Block =
  | { kind: 'h'; level: 2 | 3 | 4; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const at = (j: number): string => lines[j] ?? '';
  const blocks: Block[] = [];
  let i = 0;
  const isBlank = (l: string) => l.trim() === '';
  const LIST = /^\s*([-*]|\d+\.) (.*)$/;
  const startsBlock = (l: string) =>
    /^#{2,4} /.test(l) || /^```|^~~~/.test(l) || LIST.test(l) || /^\|/.test(l) || /^> ?/.test(l) || /^---+\s*$/.test(l);

  while (i < lines.length) {
    const line = at(i);
    if (isBlank(line)) { i++; continue; }

    const fence = /^(```|~~~)\s*(\S*)/.exec(line);
    if (fence) {
      const marker = fence[1] ?? '```';
      const body: string[] = [];
      i++;
      while (i < lines.length && !at(i).startsWith(marker)) body.push(at(i++));
      i++;
      blocks.push({ kind: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }
    const h = /^(#{2,4}) (.*)$/.exec(line);
    if (h) { blocks.push({ kind: 'h', level: (h[1] ?? '##').length as 2 | 3 | 4, text: (h[2] ?? '').trim() }); i++; continue; }
    if (/^---+\s*$/.test(line)) { blocks.push({ kind: 'hr' }); i++; continue; }

    if (/^\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(at(i))) rows.push(cells(at(i++)));
      const [head = [], sep, ...rest] = rows;
      const hasSep = !!sep && sep.every((c) => /^:?-{2,}:?$/.test(c));
      blocks.push({ kind: 'table', head, rows: hasSep ? rest : rows.slice(1) });
      continue;
    }
    if (/^> ?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^> ?/.test(at(i))) body.push(at(i++).replace(/^> ?/, ''));
      blocks.push({ kind: 'quote', text: body.join(' ') });
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      const ordered = /\d/.test(li[1] ?? '');
      const items: string[] = [];
      while (i < lines.length) {
        const m = LIST.exec(at(i));
        if (m && /\d/.test(m[1] ?? '') === ordered) { items.push(m[2] ?? ''); i++; continue; }
        // A wrapped continuation line belongs to the previous item.
        if (items.length && !isBlank(at(i)) && /^\s{2,}\S/.test(at(i))) { items[items.length - 1] += ` ${at(i).trim()}`; i++; continue; }
        break;
      }
      blocks.push({ kind: ordered ? 'ol' : 'ul', items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !isBlank(at(i)) && !startsBlock(at(i))) para.push(at(i++).trim());
    blocks.push({ kind: 'p', text: para.join(' ') });
  }
  return blocks;
}

/** Inline markdown: `code`, **bold**, *italics*, [text](href). */
export function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k}>{inline(m[2], k)}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{inline(m[3], k)}</em>);
    else out.push(<DocLink key={k} href={m[5] ?? '#'}>{inline(m[4] ?? '', k)}</DocLink>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function DocLink({ href, children }: { href: string; children: ReactNode }) {
  if (href.startsWith('/') || href.startsWith('#')) return <Link href={href}>{children}</Link>;
  const safe = /^(https?:|mailto:)/.test(href) ? href : '#';
  return (
    <a href={safe} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseBlocks(source).map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case 'h': {
            const Tag = `h${b.level}` as 'h2' | 'h3' | 'h4';
            return (
              <Tag key={k} id={b.level === 2 ? slugify(b.text) : undefined}>
                {inline(b.text, k)}
              </Tag>
            );
          }
          case 'p':
            return <p key={k}>{inline(b.text, k)}</p>;
          case 'ul':
          case 'ol': {
            const Tag = b.kind;
            return (
              <Tag key={k}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${k}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case 'code':
            return (
              <pre key={k} data-lang={b.lang || undefined}>
                <code>{b.text}</code>
              </pre>
            );
          case 'table':
            return (
              <div key={k} className="docs-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j}>{inline(c, `${k}-h${j}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri}>
                        {r.map((c, j) => (
                          <td key={j}>{inline(c, `${k}-${ri}-${j}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'quote':
            return <blockquote key={k}>{inline(b.text, k)}</blockquote>;
          case 'hr':
            return <hr key={k} />;
          default:
            return <Fragment key={k} />;
        }
      })}
    </>
  );
}
