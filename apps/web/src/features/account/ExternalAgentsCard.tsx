'use client';
// S16 "External agents" card (bring your own agent, docs/external-agents.md): register your own
// program to play one of your agents in casual and practice matches, by webhook (skirm POSTs each
// tick's signed turn) or pull (your program reads turns with its token, the way the MCP server does).
// The secret and token are shown once, after registering or rotating. Test-ping checks a webhook.
import { Badge, Button, TextField } from '@skirm/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import type { Agent, ExternalAgent, ExternalAgentSecret } from '@/lib/api/types';
import { errorCopy } from '@/lib/api/errors';
import { useSession } from '@/lib/auth/session';
import { useApi } from '@/lib/services';
import s from './account.module.css';

const KEY = ['me', 'external-agents'] as const;

function SecretOnce({ shown, onDone }: { shown: ExternalAgentSecret; onDone: () => void }) {
  return (
    <div className={s.cardLoose} data-testid="ext-secret">
      <p className={s.note}>
        Copy these now: they are not shown again. Webhook requests carry <code>x-skirm-signature</code>, an HMAC-SHA256 of{' '}
        <code>t.body</code> with the secret. A pull program or the MCP server signs in with the token.
      </p>
      <dl className={s.facts}>
        <dt>Secret</dt>
        <dd className={s.mono} data-testid="ext-secret-value">
          {shown.secret}
        </dd>
        <dt>Token</dt>
        <dd className={s.mono} data-testid="ext-token-value">
          {shown.token}
        </dd>
      </dl>
      <div className={s.actions}>
        <Button variant="secondary" onClick={onDone}>
          I saved them
        </Button>
      </div>
    </div>
  );
}

export function ExternalAgentsCard({ agents }: { agents: Pick<Agent, 'id' | 'name'>[] }) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const { status } = useSession();
  const list = useQuery({ queryKey: KEY, queryFn: () => api.externalAgents(), enabled: status === 'signedIn' });
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState<ExternalAgentSecret | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.show({ tone: 'critical', ...errorCopy(err) });
    } finally {
      setBusy(null);
    }
  };

  const register = () =>
    run('create', async () => {
      const r = await api.createExternalAgent({ name: name.trim(), agentId: agentId || null, webhookUrl: webhookUrl.trim() || null });
      setShown(r);
      setName('');
      setAgentId('');
      setWebhookUrl('');
      await qc.invalidateQueries({ queryKey: KEY });
    });

  const rotate = (x: ExternalAgent) =>
    run(`rotate:${x.id}`, async () => {
      setShown(await api.rotateExternalAgent(x.id));
      await qc.invalidateQueries({ queryKey: KEY });
    });

  const ping = (x: ExternalAgent) =>
    run(`ping:${x.id}`, async () => {
      const r = await api.pingExternalAgent(x.id);
      if (r.mode === 'pull') toast.show({ tone: r.ok ? 'good' : 'warning', title: r.ok ? 'Seen recently' : 'Not seen yet', message: r.ok ? `Last call ${new Date(r.lastSeenAt!).toLocaleString()}` : 'Your program has not called the pull api yet.' });
      else if (r.ok) toast.show({ tone: 'good', title: 'Webhook answered', message: `HTTP ${r.status} in ${r.latencyMs} ms` });
      else toast.show({ tone: 'critical', title: 'Webhook did not answer', message: r.message });
    });

  const remove = (x: ExternalAgent) =>
    run(`delete:${x.id}`, async () => {
      await api.deleteExternalAgent(x.id);
      await qc.invalidateQueries({ queryKey: KEY });
    });

  const bind = (x: ExternalAgent, to: string) =>
    run(`bind:${x.id}`, async () => {
      await api.updateExternalAgent(x.id, { agentId: to || null });
      await qc.invalidateQueries({ queryKey: KEY });
    });

  const rows = list.data ?? [];
  const nameOf = (id: string | null) => agents.find((a) => a.id === id)?.name ?? null;

  return (
    <section aria-labelledby="s16-external" className={s.card} data-testid="s16-external">
      <h2 id="s16-external" className={s.h2Display}>
        External agents
      </h2>
      <p className="sk-muted">
        Plug in your own program: each tick it gets the same fogged view and legal moves as the built-in brain and has 1.2 s
        to answer, or the greedy brain plays that tick. Casual and practice only, never ranked; an agent costs its normal
        talk-tier rate whoever plays it.
      </p>
      {shown ? <SecretOnce shown={shown} onDone={() => setShown(null)} /> : null}
      {list.isError ? (
        <p className="sk-muted" role="alert" data-testid="ext-error">
          Could not load your external agents: {errorCopy(list.error).message}{' '}
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            Retry
          </Button>
        </p>
      ) : null}
      {rows.length ? (
        <ul className={s.runs} data-testid="ext-list">
          {rows.map((x) => (
            <li key={x.id} className={s.runRow} data-testid={`ext-${x.id}`}>
              <div className={s.runMain}>
                <b>{x.name}</b>
                <Badge tone="neutral">{x.mode === 'webhook' ? 'Webhook' : 'Pull'}</Badge>
                {x.agentId ? <Badge tone="good">Plays {nameOf(x.agentId) ?? 'an agent'}</Badge> : <Badge tone="warning">Not bound</Badge>}
                <span className={s.runMeta}>
                  {x.calls ? `${x.calls - x.misses}/${x.calls} ticks answered` : 'no ticks yet'}
                  {x.lastError ? ` · last miss: ${x.lastError}` : ''}
                </span>
              </div>
              <div className={s.actions}>
                <label className={s.field}>
                  <span className="sk-sr-only">Agent it plays</span>
                  <select className={s.select} value={x.agentId ?? ''} onChange={(e) => void bind(x, e.target.value)} disabled={busy !== null} aria-label={`Agent ${x.name} plays`}>
                    <option value="">Not bound</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button variant="ghost" onClick={() => void ping(x)} disabled={busy !== null} loading={busy === `ping:${x.id}`} data-testid={`ext-ping-${x.id}`}>
                  Test ping
                </Button>
                <Button variant="ghost" onClick={() => void rotate(x)} disabled={busy !== null} loading={busy === `rotate:${x.id}`} data-testid={`ext-rotate-${x.id}`}>
                  Rotate secret
                </Button>
                <Button variant="ghost" onClick={() => void remove(x)} disabled={busy !== null} loading={busy === `delete:${x.id}`} data-testid={`ext-delete-${x.id}`}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={s.settingsGrid}>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} data-testid="ext-name" />
        <label className={s.field}>
          Agent it plays
          <select className={s.select} value={agentId} onChange={(e) => setAgentId(e.target.value)} data-testid="ext-agent">
            <option value="">Choose later</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <TextField label="Webhook URL (https, blank for pull)" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://my-agent.example.com/skirm" data-testid="ext-webhook" />
      </div>
      <div className={s.actions}>
        <Button onClick={() => void register()} disabled={!name.trim() || busy !== null} loading={busy === 'create'} data-testid="ext-register">
          Register
        </Button>
      </div>
    </section>
  );
}
