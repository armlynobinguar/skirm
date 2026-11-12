import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown, parseBlocks } from './Markdown';

describe('docs markdown', () => {
  it('renders headings with anchors, lists, code, tables and quotes', () => {
    const { container } = render(
      <Markdown
        source={[
          '## The **turn**',
          'A paragraph with `code`, *emphasis* and a [link](/docs/quickstart).',
          '',
          '- one',
          '- two',
          '',
          '1. first',
          '2. second',
          '',
          '```json',
          '{ "a": 1 }',
          '```',
          '',
          '| Role | Does |',
          '| --- | --- |',
          '| Runner | carries oil |',
          '',
          '> Every move is its own call.',
        ].join('\n')}
      />,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('id', 'the-turn');
    expect(container.querySelector('code')).toHaveTextContent('code');
    expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute('href', '/docs/quickstart');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelector('pre')).toHaveAttribute('data-lang', 'json');
    expect(container.querySelector('pre')).toHaveTextContent('{ "a": 1 }');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Role', 'Does']);
    expect(within(table).getByRole('cell', { name: 'Runner' })).toBeInTheDocument();
    expect(container.querySelector('blockquote')).toHaveTextContent('Every move is its own call.');
  });

  it('never renders page text as markup, and drops unsafe link targets', () => {
    const { container } = render(
      <Markdown source={'<img src=x onerror=alert(1)> [bad](javascript:alert(1)) [ok](https://playskirm.xyz)'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'bad' })).toHaveAttribute('href', '#');
    expect(screen.getByRole('link', { name: 'ok' })).toHaveAttribute('rel', 'noreferrer');
  });

  it('keeps code fences verbatim, even with markdown inside', () => {
    const blocks = parseBlocks('```\n## not a heading\n- not a list\n```');
    expect(blocks).toEqual([{ kind: 'code', lang: '', text: '## not a heading\n- not a list' }]);
  });
});
