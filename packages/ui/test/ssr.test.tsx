// @vitest-environment node
// Server rendering: no window/document at module load or during render (Next.js SSR).
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToString } from 'react-dom/server';

// Importing the whole library cold takes well over the default 5 s when every workspace tests at
// once (the pre-push hook), though it is under a second on its own.
const COLD_IMPORT_MS = 30_000;

describe('SSR safety', () => {
  it('imports and renders every component without a DOM', { timeout: COLD_IMPORT_MS }, async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    const ui = await import('../src');
    const el = (
      <div>
        <ui.Logo />
        <ui.Icon name="dig" />
        <ui.Button loading>Waiting</ui.Button>
        <ui.TextField label="Royalty" suffix="%" />
        <ui.TextField label="Prompt" multiline />
        <ui.Tabs tabs={[{ id: 'a', label: 'A' }]} />
        <ui.Toast title="Saved" />
        <ui.Modal open title="Confirm" />
        <ui.Badge tone="warning">Low credits</ui.Badge>
        <ui.TagChip tag="liquid" />
        <ui.UnlockChip unlock="Digger" state="needed" />
        <ui.ScopeChip scope="Stretch" />
        <ui.AgentAvatar crew="a" size={32} state="acting" />
        <ui.AgentChip agent={{ name: 'Ada', elo: 1200, unlocks: ['builder'] }} />
        <ui.CreditsBalance balance={120} />
        <ui.TopUpPanel network="Testnet" />
        <ui.Meter value={14} max={60} tone="warning" label="Steps" />
        <ui.Panel side="you"><ui.Kicker>Season 1</ui.Kicker><ui.DisplayHeading size={40}>Lock in</ui.DisplayHeading></ui.Panel>
        <ui.HazardTape />
        <ui.Pips value={3} max={5} label="Vision" />
        <ui.DiamondChip colour="#ffb547">Actor</ui.DiamondChip>
        <ui.Segmented label="Talk" value="standard" options={[{ value: 'standard', label: 'Std' }]} />
      </div>
    );
    const html = renderToString(el);
    expect(html).toContain('sk-meter');
    expect(html).toContain('sk-agent-body');
    expect(html).toContain('skirm');
    expect(html).not.toContain('pl-');
  });
});
