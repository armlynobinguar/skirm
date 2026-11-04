'use client';
// The host's settings of a private lobby (also a tournament's): map, difficulty, talk rule, crew size.
import { DIFFICULTIES, type Difficulty } from '@skirm/engine/v2';
import { LOBBY_TALK_RULES, type LobbyTalkRule } from '@skirm/shared';
import { DIFFS, MAPS, diffIndex } from '@/features/arena/world';
import type { LobbySettings } from '@/lib/api/lobbyTypes';
import { TALK_RULE_LABEL } from './lobbyUtil';
import l from './lobbies.module.css';

export const DEFAULT_LOBBY_SETTINGS: LobbySettings = { mapId: MAPS[0]?.id ?? 'copper-hollow', difficulty: 'normal', talk: 'any', crewSize: 3 };

export function LobbySettingsForm({
  value,
  onChange,
  disabled,
  testPrefix,
}: {
  value: LobbySettings;
  onChange: (v: LobbySettings) => void;
  disabled?: boolean;
  testPrefix: string;
}) {
  const set = <K extends keyof LobbySettings>(k: K, v: LobbySettings[K]) => onChange({ ...value, [k]: v });
  return (
    <div className={l.form}>
      <label className={l.field}>
        <span className="sk-kick">Map</span>
        <select className="sk-input" value={value.mapId} disabled={disabled} onChange={(e) => set('mapId', e.target.value)} data-testid={`${testPrefix}-map`}>
          {MAPS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code} · {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className={l.field}>
        <span className="sk-kick">Difficulty</span>
        <select
          className="sk-input"
          value={value.difficulty}
          disabled={disabled}
          onChange={(e) => set('difficulty', e.target.value as Difficulty)}
          data-testid={`${testPrefix}-difficulty`}
        >
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {DIFFS[diffIndex(d)]?.n ?? d}
            </option>
          ))}
        </select>
      </label>
      <label className={l.field}>
        <span className="sk-kick">Talk</span>
        <select className="sk-input" value={value.talk} disabled={disabled} onChange={(e) => set('talk', e.target.value as LobbyTalkRule)} data-testid={`${testPrefix}-talk`}>
          {LOBBY_TALK_RULES.map((t) => (
            <option key={t} value={t}>
              {TALK_RULE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className={l.field}>
        <span className="sk-kick">Crew size</span>
        <select className="sk-input" value={value.crewSize} disabled={disabled} onChange={(e) => set('crewSize', Number(e.target.value))} data-testid={`${testPrefix}-crew`}>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              Up to {n} {n === 1 ? 'agent' : 'agents'}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** "CH-05 Copper Hollow · Easy · Any tier · up to 3 agents". */
export function settingsLine(s: Pick<LobbySettings, 'mapId' | 'difficulty' | 'talk' | 'crewSize'>): string {
  const map = MAPS.find((m) => m.id === s.mapId);
  const diff = DIFFS[diffIndex(s.difficulty)]?.n ?? s.difficulty;
  return `${map ? `${map.code} ${map.name}` : s.mapId} · ${diff} · ${TALK_RULE_LABEL[s.talk]} · up to ${s.crewSize} ${s.crewSize === 1 ? 'agent' : 'agents'}`;
}
