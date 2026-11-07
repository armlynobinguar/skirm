'use client';
// S16 Profile and settings (/account). Owner: account builder.
//
// Agents (role, talk tier, unlocks, skills), the account's rank (Elo, title, ranked record and ladder
// place from GET /me `rank`), Settings (usePreferences: sound effects, replay speed, reduced motion,
// probabilities, tag names), recent v2 matches (GET /me/matches) linking to their results, profile
// facts (joined, royalties earned from GET /me) and unlocks, the linked NEAR account (M01 links it; in
// AUTH_MODE=dev the api trusts a typed account id, outside dev mode it needs a NEP-413 proof;
// Disconnect is DELETE /me/near, refused with 409 listing_active while a listing is open), the
// credits balance, achievements with their soulbound badges (AchievementsCard.tsx) and sign out.
import { AgentAvatar, Badge, Button, CreditsBalance, Icon, Modal, Tabs, UnlockChip, fmt, unlockName } from '@skirm/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RequireSession } from '@/components/shell/RequireSession';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { ButtonLink } from '@/components/ButtonLink';
import { TierBadge, tierFrom } from '@/components/TierBadge';
import { qk, useMe, useMyMatches } from '@/lib/api/queries';
import { errorCopy, isApiError } from '@/lib/api/errors';
import type { Agent, AgentPatch, Me, MyMatch } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { STARTER_AGENTS, formatNear } from '@/lib/constants';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { useWallet } from '@/lib/wallet/hooks';
import { agentBone, agentColour, agentDress } from '@/features/agents/agentView';
import { mapById } from '@/features/arena/world';
import { ConnectWalletModal } from '@/features/skills/ConnectWalletModal';
import s from './account.module.css';
import { formatUtc, formatUtcDate } from './format';
import { SettingsCard } from './SettingsCard';
import { DataCard } from './DataCard';
import { AchievementsCard } from './AchievementsCard';
import { ExternalAgentsCard } from './ExternalAgentsCard';
import { SkillLoadout } from './SkillLoadout';
import { CosmeticsEditor } from './CosmeticsEditor';
import { LookEditor } from './LookEditor';

const RECENT_MATCHES = 5;

export function ProfileScreen() {
  return (
    <RequireSession>
      <ProfileBody />
    </RequireSession>
  );
}

function ProfileBody() {
  const me = useMe();
  const { signOut, mode } = useSession();
  const router = useRouter();
  const [walletOpen, setWalletOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  return (
    <div className={s.page} data-testid="screen-s16">
      <h1 className="app-h1">Account</h1>
      {me.data === undefined ? (
        me.isError ? (
          <ErrorCard error={me.error} onRetry={() => void me.refetch()} title="Your account did not load" />
        ) : (
          <Skeleton rows={6} label="Loading account" />
        )
      ) : (
        <div className={s.split}>
          <div className={s.main}>
            <RankCard me={me.data} />
            <AgentsCard agents={me.data.agents} />
            <SettingsCard />
            <ExternalAgentsCard agents={me.data.agents} />
            <DataCard handle={me.data.account.handle} />
            <RecentMatches />
            <AchievementsCard />
          </div>
          <aside className={s.aside}>
            <ProfileCard me={me.data} mode={mode} />
            <WalletCard
              me={me.data}
              dev={mode === 'dev'}
              onConnect={() => setWalletOpen(true)}
            />
            <Link href={routes.credits()} className={s.balanceLink} data-testid="s16-credits">
              <CreditsBalance balance={me.data.credits.balance} />
            </Link>
            <div className={s.actions}>
              <Button
                variant="ghost"
                data-testid="s16-sign-out"
                onClick={async () => {
                  await signOut();
                  router.push(routes.signIn());
                }}
              >
                Sign out
              </Button>
            </div>
          </aside>
        </div>
      )}
      {me.isError && me.data !== undefined ? (
        <ErrorCard error={me.error} onRetry={() => void me.refetch()} />
      ) : null}
      <ConnectWalletModal
        open={walletOpen}
        reason="connect"
        onClose={() => setWalletOpen(false)}
        onConnected={(id) => {
          setWalletOpen(false);
          toast.show({ tone: 'good', title: 'NEAR account linked', message: id });
          void qc.invalidateQueries({ queryKey: qk.me });
        }}
      />
    </div>
  );
}

function AgentsCard({ agents }: { agents: Agent[] }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Agent | null>(null);
  const [tab, setTab] = useState<'look' | 'skills' | 'style'>('look');
  const open = (a: Agent, t: 'look' | 'skills' | 'style') => {
    setTab(t);
    setEditing(a);
  };
  const save = useMutation({
    mutationFn: (v: { id: string; patch: AgentPatch }) => api.patchAgent(v.id, v.patch),
    onSuccess: (a, v) => {
      void qc.invalidateQueries({ queryKey: qk.me });
      toast.show(
        v.patch.appearance
          ? { tone: 'good', title: 'Look saved', message: `${a.name} wears it in the arena` }
          : { tone: 'good', title: 'Skills saved', message: `${a.name}: ${a.skills.map((k) => k.name).join(', ') || 'no skills'}` },
      );
      setEditing(null);
    },
    onError: (err) => toast.error(err),
  });
  return (
    <section aria-labelledby="s16-agents" className={s.card} data-testid="s16-agents">
      <div className={s.headRow}>
        <h2 id="s16-agents" className={s.h2Display}>
          Agents
        </h2>
        <span className={s.note}>
          {agents.length} of {STARTER_AGENTS.length} · every account starts with {STARTER_AGENTS.length}
        </span>
      </div>
      {agents.length === 0 ? (
        <p className={s.note}>No agents on this account.</p>
      ) : (
        <div className={s.tableBare}>
          {/* Explicit roles keep table semantics when the phone layout restyles rows as cards. */}
          <table className={`${s.table} ${s.agentsTable}`} role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">Agent</th>
                <th scope="col" role="columnheader">Unlock</th>
                <th scope="col" role="columnheader">Skills</th>
                <th scope="col" role="columnheader">Role</th>
                <th scope="col" role="columnheader">Talk</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {agents.map((a) => (
                <tr key={a.id} role="row" data-testid={`s16-agent-${a.id}`}>
                  <td role="cell" className={s.agentCell}>
                    <span className={s.agentName}>
                      <AgentAvatar size={28} label={a.name} role={a.role} body={agentColour(a)} head={agentBone(a)} dress={agentDress(a)} />
                      <span data-testid="s16-agent-name">{a.name}</span>
                      <button
                        type="button"
                        className={s.lookBtn}
                        onClick={() => open(a, 'look')}
                        data-testid={`s16-agent-look-${a.id}`}
                        aria-label={`Customize ${a.name}: look and skills`}
                      >
                        Customize
                      </button>
                    </span>
                  </td>
                  <td role="cell" className={s.agentUnlock} data-label="Unlock">
                    {a.unlocks.length ? (
                      <span className={s.chips}>
                        {a.unlocks.map((u) => (
                          <UnlockChip key={u} unlock={u} />
                        ))}
                      </span>
                    ) : (
                      <span className="sk-muted">None</span>
                    )}
                  </td>
                  <td role="cell" className={s.agentSkills} data-label="Skills">
                    {a.skills.length ? (
                      a.skills.map((sk) => `${sk.name} v${sk.version}`).join(', ')
                    ) : (
                      <span className="sk-muted">Map briefing only</span>
                    )}
                  </td>
                  <td role="cell" className={s.agentRole} data-label="Role" data-testid="s16-agent-role">
                    {a.role} · vision {a.vision} · comms {a.comms}
                  </td>
                  <td role="cell" className={s.agentTalk} data-label="Talk">
                    {TIER_LABEL[a.tier]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ButtonLink size="sm" href={routes.home()} className={s.selfStart}>
        Play a match
      </ButtonLink>
      <Modal open={!!editing} title={editing ? `Customize ${editing.name}` : ''} size="lg" onClose={() => setEditing(null)}>
        {editing ? (
          <Tabs
            label="Customize"
            value={tab}
            onChange={(id) => setTab(id as 'look' | 'skills' | 'style')}
            tabs={[
              { id: 'look', label: 'Look', testId: 's16-customize-look' },
              { id: 'skills', label: 'Skills', count: editing.skills.length, testId: 's16-customize-skills' },
              { id: 'style', label: 'Arena style', testId: 's16-customize-style' },
            ]}
          />
        ) : null}
        {editing && tab === 'skills' ? (
          <SkillLoadout
            key={`${editing.id}-skills`}
            agent={editing}
            saving={save.isPending}
            onSave={(skills) => save.mutate({ id: editing.id, patch: { skills } })}
            onCancel={() => setEditing(null)}
          />
        ) : null}
        {editing && tab === 'look' ? (
          <LookEditor
            key={editing.id}
            agentId={editing.id}
            name={editing.name}
            unlocks={editing.unlocks}
            initial={editing.appearance}
            saving={save.isPending}
            onSave={(appearance) => save.mutate({ id: editing.id, patch: { appearance } })}
            onCancel={() => setEditing(null)}
          />
        ) : null}
        {editing && tab === 'style' ? (
          <CosmeticsEditor key={`${editing.id}-style`} agentId={editing.id} name={editing.name} onDone={() => setEditing(null)} />
        ) : null}
      </Modal>
    </section>
  );
}

const TIER_LABEL: Record<Agent['tier'], string> = { quiet: 'Quiet', standard: 'Standard', open: 'Open' };

/** The account's place on the v2 ladder: tier, Elo, title, ranked record, ladder position, decay. */
function RankCard({ me }: { me: Me }) {
  const rank = me.rank;
  const tier = tierFrom(rank);
  return (
    <section aria-labelledby="s16-rank" className={s.card} data-testid="s16-rank">
      <div className={s.headRow}>
        <h2 id="s16-rank" className={s.h2Display}>
          Rank
        </h2>
        <span className={s.note}>Ranked matches only</span>
      </div>
      <dl className={s.facts}>
        <dt>Tier</dt>
        <dd data-testid="s16-rank-tier">
          <TierBadge tier={tier} />
          {tier.tier === null ? (
            <span className={s.note}>{` ${tier.placementMatches - tier.placementsPlayed} placement matches left`}</span>
          ) : tier.nextAt !== null ? (
            <span className={s.note}>{` next at ${fmt(tier.nextAt)}`}</span>
          ) : null}
        </dd>
        <dt>Elo</dt>
        <dd className="sk-mono" data-testid="s16-rank-elo">
          {fmt(rank.elo)}
        </dd>
        <dt>Title</dt>
        <dd data-testid="s16-rank-title">{rank.title}</dd>
        <dt>Record</dt>
        <dd className="sk-mono" data-testid="s16-rank-record">
          {`${rank.wins}–${rank.losses}–${rank.draws} in ${fmt(rank.rankedMatches)}`}
        </dd>
        <dt>Ladder</dt>
        <dd className="sk-mono" data-testid="s16-rank-position">
          {rank.position ? `#${fmt(rank.position)}` : 'Not placed yet'}
        </dd>
        {rank.decayAt ? (
          <>
            <dt>Decay</dt>
            <dd data-testid="s16-rank-decay">{`Play a ranked match by ${formatUtcDate(rank.decayAt)} to keep your Elo`}</dd>
          </>
        ) : null}
      </dl>
      <ButtonLink size="sm" href={routes.leaderboards()} className={s.selfStart}>
        Season standings
      </ButtonLink>
    </section>
  );
}

function matchOutcome(m: MyMatch): { label: string; tone: 'good' | 'critical' | 'neutral' | 'warning' } {
  switch (m.result) {
    case 'win':
      return { label: 'Won', tone: 'good' };
    case 'loss':
      return { label: 'Lost', tone: 'critical' };
    case 'draw':
      return { label: 'Draw', tone: 'neutral' };
    case 'void':
      return { label: 'Called off', tone: 'neutral' };
    default:
      return { label: 'Live', tone: 'warning' };
  }
}

const eloText = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : '±0');

function RecentMatches() {
  const matches = useMyMatches();
  const rows = matches.data?.slice(0, RECENT_MATCHES);
  return (
    <section aria-labelledby="s16-matches" className={s.card} data-testid="s16-matches">
      <div className={s.headRow}>
        <h2 id="s16-matches" className={s.h2Display}>
          Recent matches
        </h2>
        <span className={s.note}>Last {RECENT_MATCHES}</span>
      </div>
      {rows === undefined ? (
        matches.isError ? (
          <ErrorCard error={matches.error} onRetry={() => void matches.refetch()} title="Matches did not load" />
        ) : (
          <Skeleton rows={3} label="Loading matches" />
        )
      ) : rows.length === 0 ? (
        <div className="app-empty" data-testid="empty-state">
          <p className={s.note}>No matches yet. A practice match against the bot crew is free.</p>
          <ButtonLink size="sm" variant="primary" href={routes.home()} className={s.selfStart} data-testid="s16-matches-start">
            Start playing
          </ButtonLink>
        </div>
      ) : (
        <ul className={s.runs}>
          {rows.map((m) => {
            const o = matchOutcome(m);
            const kind = m.practice ? 'Practice' : m.ranked ? 'Ranked' : 'Casual';
            return (
              <li key={m.id} className={s.runRow} data-testid={`s16-match-${m.id}`}>
                <span className={s.runMain}>
                  <Link href={m.result === 'live' ? routes.match(m.id) : routes.matchResult(m.id)} style={{ fontWeight: 700 }}>
                    {mapById(m.mapId)?.name ?? m.mapId}
                  </Link>
                  <Badge tone={o.tone}>{o.label}</Badge>
                  <span className={s.runMeta}>
                    {kind}
                    {m.score ? ` · ${m.score.you}–${m.score.rival}` : ''}
                    {m.eloDelta !== null ? ` · Elo ${eloText(m.eloDelta)}` : ''}
                  </span>
                </span>
                {m.endedAt ? <span className={s.runMeta}>{formatUtc(m.endedAt)} UTC</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ProfileCard({ me, mode }: { me: Me; mode: 'dev' | 'privy' }) {
  const byId = new Map(me.agents.map((a) => [a.id, a.name]));
  return (
    <section aria-labelledby="s16-who" className={`${s.card} ${s.cardLoose}`} data-testid="s16-profile">
      <h2 id="s16-who" className={s.h2}>
        Profile
      </h2>
      <dl className={s.facts}>
        <dt>Handle</dt>
        <dd className="sk-mono" data-testid="s16-handle">
          {me.account.handle}
        </dd>
        <dt>Sign-in</dt>
        <dd>{mode === 'dev' ? 'Dev handle (local and judges)' : 'Social login'}</dd>
        {me.account.createdAt ? (
          <>
            <dt>Joined</dt>
            <dd className="sk-mono" data-testid="s16-joined">
              {formatUtcDate(me.account.createdAt)}
            </dd>
          </>
        ) : null}
        {me.royaltiesYocto !== undefined ? (
          <>
            <dt>Royalties earned</dt>
            <dd className="sk-mono" data-testid="s16-royalties">
              {formatNear(me.royaltiesYocto)} NEAR
            </dd>
          </>
        ) : null}
      </dl>
      <div className="app-stack" style={{ gap: 'var(--space-2)' }}>
        <h3 className={s.h2} style={{ fontSize: 15 }}>
          Unlocks
        </h3>
        {me.unlocks.length === 0 ? (
          <p className={s.note}>No unlocks yet.</p>
        ) : (
          <ul className={s.runs} data-testid="s16-unlocks">
            {me.unlocks.map((u) => (
              <li key={u.id} className={s.runRow}>
                <UnlockChip unlock={u.kind} />
                <span className={s.note}>
                  {u.attachedAgentId ? `On ${byId.get(u.attachedAgentId) ?? 'an agent'}` : 'Not attached'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <span className={s.note}>
          {unlockName('builder')}, {unlockName('digger')} and {unlockName('firefighter')} come with every account.
        </span>
      </div>
    </section>
  );
}

function WalletCard({ me, dev, onConnect }: { me: Me; dev: boolean; onConnect: () => void }) {
  const linked = me.account.nearAccountId;
  const api = useApi();
  const wallet = useWallet();
  const qc = useQueryClient();
  const toast = useToast();
  const unlink = useMutation({
    mutationFn: () => api.unlinkNear(),
    onSuccess: ({ account }) => {
      // Also sign the browser wallet out (NEAR Connect), so the next link starts from the picker.
      if (!dev) void wallet.disconnect().catch(() => undefined);
      qc.setQueryData<Me>(qk.me, (old) => (old ? { ...old, account: { ...old.account, ...account } } : old));
      void qc.invalidateQueries({ queryKey: qk.me });
      toast.show({ tone: 'good', title: 'NEAR wallet disconnected', message: linked ?? undefined });
    },
    onError: (err) => {
      if (!(isApiError(err) && err.code === 'listing_active')) toast.error(err);
    },
  });
  const blocked = isApiError(unlink.error) && unlink.error.code === 'listing_active' ? errorCopy(unlink.error) : null;
  return (
    <section aria-labelledby="s16-wallet" className={s.card} data-testid="s16-wallet">
      <div className={s.headRow} style={{ alignItems: 'center' }}>
        <h2 id="s16-wallet" className={s.h2}>
          NEAR wallet
        </h2>
        <Badge>Testnet</Badge>
      </div>
      {linked ? (
        <span className={s.walletId} data-testid="s16-near-account">
          {linked}
        </span>
      ) : (
        <span className={s.walletId} data-testid="s16-near-none">
          Not connected
        </span>
      )}
      <p className={s.note}>
        Needed only to top up credits, mint, buy or resell skills. Royalties are paid to this account.
      </p>
      <div className={s.actions}>
        <Button icon="wallet" onClick={onConnect} data-testid="s16-connect-wallet">
          {linked ? 'Connect a different wallet' : 'Connect wallet'}
        </Button>
        {linked ? (
          <Button
            variant="ghost"
            loading={unlink.isPending}
            disabled={unlink.isPending}
            onClick={() => unlink.mutate()}
            data-testid="s16-disconnect-wallet"
          >
            Disconnect wallet
          </Button>
        ) : null}
      </div>
      {blocked && linked ? (
        <div className={`app-banner is-warning ${s.walletError}`} role="alert" data-testid="s16-unlink-blocked">
          <strong>{blocked.title}</strong>
          <span>
            Your skill listings pay this account, so it stays linked while one is open. {blocked.message}{' '}
            <Link href={routes.skills()}>Open My skills</Link>
          </span>
        </div>
      ) : null}
      {dev ? (
        <p className={s.devNote} data-testid="s16-dev-note">
          <Icon name="info" size={12} /> Dev mode: Connect wallet links a typed testnet account id without a wallet
          signature.
        </p>
      ) : null}
    </section>
  );
}
