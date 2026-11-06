'use client';
// The agent's name on its editor plate, with a Rename control: an inline field (Enter saves,
// Escape cancels) checked against the same rule the api applies (1-24 characters, starting with a
// letter or digit; letters, digits, spaces and ' - _ . after). Saved through PATCH /agents/:id.
import { DisplayHeading } from '@skirm/ui';
import { useEffect, useRef, useState } from 'react';
import e from './agentEditor.module.css';

export const AGENT_NAME_MAX = 24;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '\-_.]{0,23}$/u;

/** Why a name would be refused, or null when it is fine (after trimming). */
export function agentNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Give your agent a name.';
  if ([...name].length > AGENT_NAME_MAX) return `At most ${AGENT_NAME_MAX} characters.`;
  if (!NAME_RE.test(name)) return "Start with a letter or digit; then letters, digits, spaces and ' - _ . only.";
  return null;
}

export function RenameAgent({
  name,
  className,
  saving,
  onSave,
}: {
  name: string;
  className?: string;
  saving: boolean;
  /** Saves the new name; call `done` once it is stored to close the field. */
  onSave: (name: string, done: () => void) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  // Another agent picked (‹ ›) while editing: start over with its name.
  useEffect(() => {
    setEditing(false);
    setDraft(name);
  }, [name]);

  if (!editing)
    return (
      <div className={e.nameRow}>
        <DisplayHeading level={1} className={className}>
          {name}
        </DisplayHeading>
        <button type="button" className={e.renameBtn} onClick={() => setEditing(true)} aria-label={`Rename ${name}`} data-testid="agent-rename">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M11.5 2.5l2 2L5 13H3v-2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          Rename
        </button>
      </div>
    );

  const problem = draft.trim() === name ? null : agentNameProblem(draft);
  const unchanged = draft.trim() === name;
  const save = () => {
    if (problem || unchanged || saving) return;
    onSave(draft.trim(), () => setEditing(false));
  };
  const cancel = () => {
    setDraft(name);
    setEditing(false);
  };
  return (
    <form
      className={e.renameForm}
      onSubmit={(ev) => {
        ev.preventDefault();
        save();
      }}
      data-testid="agent-rename-form"
    >
      <input
        ref={input}
        className={e.renameInput}
        value={draft}
        maxLength={AGENT_NAME_MAX + 8}
        onChange={(ev) => setDraft(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            cancel();
          }
        }}
        aria-label="Agent name"
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? 'agent-rename-problem' : undefined}
        data-testid="agent-rename-input"
      />
      <div className={e.row}>
        <button type="button" className={e.btn} onClick={cancel} data-testid="agent-rename-cancel">
          Cancel
        </button>
        <button type="submit" className={`${e.btn} ${e.primary}`} disabled={!!problem || unchanged || saving} data-testid="agent-rename-save">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {problem ? (
        <p id="agent-rename-problem" className={e.hint} role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
