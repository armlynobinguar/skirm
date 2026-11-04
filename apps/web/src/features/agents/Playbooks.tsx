'use client';
// Crew playbooks: one crew-level strategy per player, separate from any agent's skills (who hauls,
// who scouts and calls hazards, who blocks; when to regroup; the goal or denying the rival). The
// crew screen keeps a few (GET/POST/PUT/DELETE /playbooks) and marks the one lock-in starts with
// (POST /playbooks/select); the lock-in picker can play another for that match only. The text is
// sealed like a skill prompt: only you read it back, the planner reads it whole and each agent one
// line of it, and the rival, spectators and shared replays never see it.
import { DEFAULTS } from '@skirm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { ApiError } from '@/lib/api/errors';
import type { PlaybookList } from '@/lib/api/playbookTypes';
import { qk } from '@/lib/api/queries';
import { useApi } from '@/lib/services';
import p from './playbooks.module.css';

const chars = (s: string) => [...s].length;
const DEFAULT_MAX_CHARS = DEFAULTS.playbooks.maxChars;
const NAME_MAX = DEFAULTS.playbooks.nameMaxChars;

export function usePlaybooks(enabled = true) {
  const api = useApi();
  return useQuery<PlaybookList>({ queryKey: qk.playbooks, queryFn: () => api.playbooks(), enabled, retry: false });
}

type Draft = { id: string | null; name: string; text: string };

/** The Playbooks section of the crew screen: list, write, edit, select and delete. */
export function PlaybooksSection() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const list = usePlaybooks();
  const [draft, setDraft] = useState<Draft | null>(null);
  const maxChars = list.data?.maxChars ?? DEFAULT_MAX_CHARS;
  const books = list.data?.playbooks ?? [];
  const full = !!list.data && books.length >= list.data.max;

  const fail = (title: string) => (err: unknown) => toast.show({ tone: 'critical', title, message: err instanceof ApiError ? err.message : 'Try again.' });
  const refresh = () => qc.invalidateQueries({ queryKey: qk.playbooks });
  const save = useMutation({
    mutationFn: (d: Draft) => (d.id ? api.updatePlaybook(d.id, { name: d.name.trim(), text: d.text.trim() }) : api.createPlaybook({ name: d.name.trim(), text: d.text.trim() })),
    onSuccess: (b) => {
      void refresh();
      setDraft(null);
      toast.show({ tone: 'good', title: `Playbook “${b.name}” saved.` });
    },
    onError: fail('Playbook not saved'),
  });
  const select = useMutation({ mutationFn: (id: string | null) => api.selectPlaybook(id), onSuccess: () => void refresh(), onError: fail('Not changed') });
  const remove = useMutation({ mutationFn: (id: string) => api.deletePlaybook(id), onSuccess: () => void refresh(), onError: fail('Playbook not deleted') });
  const edit = useMutation({
    mutationFn: (id: string) => api.playbook(id),
    onSuccess: (b) => setDraft({ id: b.id, name: b.name, text: b.text }),
    onError: fail('Could not open the playbook'),
  });

  const busy = save.isPending || select.isPending || remove.isPending || edit.isPending;
  const over = draft ? chars(draft.text.trim()) > maxChars || chars(draft.name.trim()) > NAME_MAX : false;
  const valid = !!draft && !!draft.name.trim() && !!draft.text.trim() && !over;

  return (
    <section className={`sk-panel ${p.box}`} aria-label="Playbooks" data-testid="playbooks">
      <div className={p.head}>
        <span className="sk-kick">
          <b>Playbooks</b> · crew strategy{list.data ? ` · ${books.length}/${list.data.max}` : ''}
        </span>
        {draft ? null : (
          <button type="button" className={p.btn} disabled={busy || full || list.isLoading} onClick={() => setDraft({ id: null, name: '', text: '' })} data-testid="playbook-new">
            New playbook
          </button>
        )}
      </div>
      <p className={p.note}>
        How your crew divides the work, when it regroups and what it puts first. The planner follows the selected one; only you can read it, and the rival
        never sees it.
      </p>
      {list.isError ? <p className={p.note}>Playbooks could not be loaded.</p> : null}
      {books.length ? (
        <ul className={p.list}>
          {books.map((b) => (
            <li key={b.id} className={p.item} data-selected={b.selected ? '' : undefined} data-testid={`playbook-${b.id}`}>
              <span className={p.name}>{b.name}</span>
              {b.selected ? <span className={p.tag}>Selected</span> : null}
              <span className={p.actions}>
                <button type="button" className={p.btn} disabled={busy} onClick={() => select.mutate(b.selected ? null : b.id)} aria-pressed={b.selected} aria-label={b.selected ? `Unselect ${b.name}` : `Select ${b.name}`}>
                  {b.selected ? 'Unselect' : 'Select'}
                </button>
                <button type="button" className={p.btn} disabled={busy} onClick={() => edit.mutate(b.id)} aria-label={`Edit ${b.name}`}>
                  Edit
                </button>
                <button type="button" className={p.btn} disabled={busy} onClick={() => remove.mutate(b.id)} aria-label={`Delete ${b.name}`}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : list.data && !draft ? (
        <p className={p.note}>No playbooks yet. Example: “Rook hauls, Wren scouts and calls hazards, Moss blocks. Regroup at the delivery point when two are down.”</p>
      ) : null}
      {draft ? (
        <form
          className={p.form}
          onSubmit={(ev) => {
            ev.preventDefault();
            if (valid) save.mutate(draft);
          }}
          data-testid="playbook-form"
        >
          <input className={p.input} value={draft.name} maxLength={NAME_MAX * 2} placeholder="Name, e.g. Haul and scout" aria-label="Playbook name" onChange={(ev) => setDraft({ ...draft, name: ev.target.value })} />
          <textarea
            className={p.text}
            value={draft.text}
            placeholder="Who does what, when to regroup, goal or deny the rival."
            aria-label="Playbook text"
            onChange={(ev) => setDraft({ ...draft, text: ev.target.value })}
          />
          <span className={p.count} data-over={chars(draft.text.trim()) > maxChars ? '' : undefined} data-testid="playbook-count">
            {chars(draft.text.trim())}/{maxChars}
          </span>
          <span className={p.actions}>
            <button type="submit" className={`${p.btn} ${p.primary}`} disabled={!valid || busy} data-testid="playbook-save">
              Save
            </button>
            <button type="button" className={p.btn} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </span>
        </form>
      ) : null}
    </section>
  );
}

/**
 * The lock-in picker: which playbook this match plays (the selected one by default, or none).
 * `value` undefined means "as selected"; the caller sends `playbookId` only when it changed.
 */
export function PlaybookPicker({ value, onChange, disabled }: { value: string | null | undefined; onChange: (id: string | null) => void; disabled?: boolean }) {
  const list = usePlaybooks();
  const books = list.data?.playbooks ?? [];
  if (!list.data || !books.length) return null;
  const selected = books.find((b) => b.selected)?.id ?? null;
  const current = value === undefined ? selected : value;
  return (
    <label className={`sk-panel ${p.box}`} data-testid="v2-playbook">
      <span className="sk-kick">Playbook · crew strategy</span>
      <select className={p.select} value={current ?? ''} disabled={disabled} onChange={(ev) => onChange(ev.target.value || null)} aria-label="Playbook for this match">
        <option value="">None</option>
        {books.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <span className={p.note}>Your planner follows it; the rival never sees it.</span>
    </label>
  );
}

/** The playbook id the picker chose when it differs from the selected one (else undefined: keep it). */
export function playbookChange(list: PlaybookList | undefined, value: string | null | undefined): string | null | undefined {
  if (value === undefined || !list) return undefined;
  const selected = list.playbooks.find((b) => b.selected)?.id ?? null;
  return value === selected ? undefined : value;
}
