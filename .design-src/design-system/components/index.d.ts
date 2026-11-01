import type * as React from 'react';

export type Tag = 'spreads' | 'liquid' | 'damages' | 'solid' | 'blocks' | 'pushable' | 'breakable' | 'flammable' | 'collectible' | 'goal';
export type ActionName = 'move' | 'wait' | 'pick_up' | 'drop' | 'place_block' | 'dig' | 'extinguish';
export type Unlock = 'Builder' | 'Digger' | 'Firefighter';
export type Tone = 'neutral' | 'good' | 'warning' | 'critical';
export type Crew = 'a' | 'b';
export type TileKind = 'floor' | 'wall' | 'water' | 'lava' | 'fire' | 'grass' | 'crate' | 'dirt' | 'block' | 'gem' | 'exit' | 'agent' | 'mark';
export type IconName =
  | 'move' | 'wait' | 'pick_up' | 'drop' | 'place_block' | 'dig' | 'extinguish'
  | 'tick' | 'steps' | 'agent' | 'crew' | 'skill' | 'credits' | 'timer' | 'royalty' | 'trophy' | 'replay'
  | 'play' | 'pause' | 'step_back' | 'step_fwd' | 'check' | 'warning' | 'critical' | 'info' | 'close' | 'plus' | 'minus'
  | 'lock' | 'elo' | 'map' | 'pvp' | 'wallet'
  | 'tag_spreads' | 'tag_liquid' | 'tag_damages' | 'tag_solid' | 'tag_blocks' | 'tag_pushable' | 'tag_breakable' | 'tag_flammable' | 'tag_collectible' | 'tag_goal';

export interface LogoProps { size?: number; markOnly?: boolean; className?: string }
export declare function Logo(props: LogoProps): React.ReactElement;

export interface IconProps { name: IconName; size?: number; title?: string; strokeWidth?: number; className?: string }
export declare function Icon(props: IconProps): React.ReactElement;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  hint?: string;
  error?: string;
  /** An Icon name or a node shown before the value. */
  prefix?: IconName | React.ReactNode;
  /** A unit such as "NEAR" or "%". */
  suffix?: React.ReactNode;
  multiline?: boolean;
  mono?: boolean;
}
export declare function TextField(props: TextFieldProps): React.ReactElement;

export interface TabItem { id: string; label: string; count?: number; icon?: IconName; disabled?: boolean }
export interface TabsProps { tabs: TabItem[]; value?: string; defaultValue?: string; onChange?: (id: string) => void; label?: string; className?: string }
export declare function Tabs(props: TabsProps): React.ReactElement;

export interface ToastProps { tone?: Tone; title?: string; children?: React.ReactNode; icon?: IconName; action?: React.ReactNode; onClose?: () => void; className?: string }
export declare function Toast(props: ToastProps): React.ReactElement;

export interface ModalProps { open: boolean; title: string; children?: React.ReactNode; footer?: React.ReactNode; onClose?: () => void; size?: 'md' | 'lg'; inline?: boolean }
export declare function Modal(props: ModalProps): React.ReactElement | null;

export interface BadgeProps { tone?: Tone | 'you'; icon?: IconName | false; solid?: boolean; children?: React.ReactNode; className?: string }
export declare function Badge(props: BadgeProps): React.ReactElement;

export interface TagChipProps { tag: Tag; count?: number; className?: string }
export declare function TagChip(props: TagChipProps): React.ReactElement;

export interface UnlockChipProps { unlock: Unlock; state?: 'owned' | 'needed' | 'missing'; className?: string }
export declare function UnlockChip(props: UnlockChipProps): React.ReactElement;

export interface ScopeChipProps { scope: 'MVP' | 'Stretch' | 'Roadmap'; className?: string }
export declare function ScopeChip(props: ScopeChipProps): React.ReactElement;

export interface AgentAvatarProps { size?: number; crew?: Crew; state?: 'idle' | 'acting' | 'lost'; label?: string; className?: string }
export declare function AgentAvatar(props: AgentAvatarProps): React.ReactElement;

export interface AgentSummary { name: string; crew?: Crew; state?: 'idle' | 'acting' | 'lost'; unlocks?: Unlock[]; skills?: number; elo?: number }
export interface AgentChipProps { agent: AgentSummary; className?: string }
export declare function AgentChip(props: AgentChipProps): React.ReactElement;

export interface CrewSlotProps {
  slot: number;
  agent?: { name: string; crew?: Crew; unlocks?: Unlock[]; skills?: string[] };
  mapUnlocks?: Unlock[];
  creditsPerAgent?: number;
  onAdd?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
}
export declare function CrewSlot(props: CrewSlotProps): React.ReactElement;

export interface ClearRate { tag: Tag; cleared: number; runs: number }
export interface Skill { name: string; creator?: string; unlocks?: Unlock[]; tags?: Tag[]; clearRates?: ClearRate[]; price?: number; royalty?: number }
export interface SkillCardProps { skill: Skill; owned?: boolean; mapUnlocks?: Unlock[]; onBuy?: () => void; onEquip?: () => void; className?: string }
export declare function SkillCard(props: SkillCardProps): React.ReactElement;

export interface BoardAgent { id: string; x: number; y: number; crew?: Crew; alive?: boolean; letter?: string }
export interface MapGridProps {
  /** Grid rows in v0 map characters: # . ~ L ^ , c d = * E 0 */
  rows: string[];
  tileSize?: number;
  agents?: BoardAgent[];
  /** Critical spots, [x, y]. Replays, spectator view and editor only. */
  marks?: Array<[number, number]>;
  detail?: 'full' | 'compact' | 'fill';
  animate?: boolean;
  reducedMotion?: boolean;
  label?: string;
  className?: string;
}
export declare function MapGrid(props: MapGridProps): React.ReactElement;

export interface TileLegendProps { kinds?: TileKind[]; size?: number; compact?: boolean; className?: string }
export declare function TileLegend(props: TileLegendProps): React.ReactElement;

export interface MapInfo { id?: string; name: string; theme?: string; rows: string[]; tags?: Tag[]; unlocks?: Unlock[]; goal: string; stepLimit: number; bestSolo?: { steps: number; score: number }; marks?: Array<[number, number]> }
export interface MapCardProps { map: MapInfo; cleared?: boolean; yourBest?: number; onPlay?: () => void; entryFee?: number; thumbSize?: number; maxTags?: number; className?: string }
export declare function MapCard(props: MapCardProps): React.ReactElement;

export interface RunHUDProps {
  tick: number;
  stepLimit: number;
  agentsAlive: number;
  agentsTotal: number;
  creditsSpent?: number;
  creditsHeld?: number;
  status?: 'planning' | 'running' | 'cleared' | 'failed';
  failReason?: string;
  speed?: number;
  crew?: Crew;
  className?: string;
}
export declare function RunHUD(props: RunHUDProps): React.ReactElement;

export interface ActionOption { action: string; p: number }
export interface ConfidenceBarProps { options: ActionOption[]; agentName?: string; crew?: Crew; tick?: number; max?: number; lowAt?: number; timedOut?: boolean; className?: string }
export declare function ConfidenceBar(props: ConfidenceBarProps): React.ReactElement;

export interface ReplayEvent { tick: number; kind: 'spread' | 'block' | 'collect' | 'replan' | 'lost' | 'goal'; label?: string }
export interface ReplayScrubberProps {
  total: number;
  tick?: number;
  defaultTick?: number;
  onSeek?: (tick: number) => void;
  playing?: boolean;
  onPlayToggle?: () => void;
  speed?: number;
  speeds?: number[];
  onSpeed?: (speed: number) => void;
  events?: ReplayEvent[];
  className?: string;
}
export declare function ReplayScrubber(props: ReplayScrubberProps): React.ReactElement;

export interface ScoreBreakdownProps { agents?: number; steps?: number; stepLimit?: number; upkeep?: number; skills?: number; cleared?: boolean; failReason?: string; rankText?: string; className?: string }
export declare function ScoreBreakdown(props: ScoreBreakdownProps): React.ReactElement;

export interface ScoreHistogramProps { bins: number[]; min?: number; max?: number; yourScore?: number; caption?: string; height?: number; className?: string }
export declare function ScoreHistogram(props: ScoreHistogramProps): React.ReactElement;

export interface LeaderboardRowProps { row: { rank: number; player: string; agents: number; steps: number; score: number }; you?: boolean; percentile?: number; className?: string }
export declare function LeaderboardRow(props: LeaderboardRowProps): React.ReactElement;

export interface CreditsBalanceProps { balance: number; freeRuns?: number; lowAt?: number; onTopUp?: () => void; className?: string }
export declare function CreditsBalance(props: CreditsBalanceProps): React.ReactElement;

export interface TopUpPack { near: number }
export interface TopUpPanelProps { packs?: TopUpPack[]; creditsPerNear?: number; defaultIndex?: number; network?: string; onConfirm?: (pack: TopUpPack) => void; pending?: boolean; className?: string }
export declare function TopUpPanel(props: TopUpPanelProps): React.ReactElement;

export interface PvPCrew { name: string; elo: number; eloDelta?: number; agents: number; lost?: number; progress?: string; you?: boolean; leading?: boolean }
export interface PvPHeaderProps { crewA: PvPCrew; crewB: PvPCrew; elapsedMs: number; capMs?: number; tick?: number; mode?: 'Race' | 'Duel'; ranked?: boolean; className?: string }
export declare function PvPHeader(props: PvPHeaderProps): React.ReactElement;

declare global {
  interface Window {
    Promptlings: {
      Logo: typeof Logo; Icon: typeof Icon; Button: typeof Button; TextField: typeof TextField; Tabs: typeof Tabs; Toast: typeof Toast; Modal: typeof Modal;
      Badge: typeof Badge; TagChip: typeof TagChip; UnlockChip: typeof UnlockChip; ScopeChip: typeof ScopeChip;
      AgentAvatar: typeof AgentAvatar; AgentChip: typeof AgentChip; CrewSlot: typeof CrewSlot; SkillCard: typeof SkillCard;
      MapGrid: typeof MapGrid; TileLegend: typeof TileLegend; MapCard: typeof MapCard;
      RunHUD: typeof RunHUD; ConfidenceBar: typeof ConfidenceBar; ReplayScrubber: typeof ReplayScrubber; ScoreBreakdown: typeof ScoreBreakdown;
      ScoreHistogram: typeof ScoreHistogram; LeaderboardRow: typeof LeaderboardRow; CreditsBalance: typeof CreditsBalance; TopUpPanel: typeof TopUpPanel;
      PvPHeader: typeof PvPHeader;
      TAGS: Tag[]; TAG_MEANING: Record<Tag, string>; ACTIONS: ActionName[]; UNLOCKS: Record<Unlock, { action: ActionName; icon: IconName }>;
      TILES: Array<{ kind: TileKind; ch: string | null; name: string; tags: Tag[]; token: string; glyph: string }>;
      MAPS: { floodGate: MapInfo; emberWarehouse: MapInfo; magmaMine: MapInfo };
      multiplierFor(agents: number): number;
      /** Rounds half up. Upkeep: `upkeep` total if given, else UPKEEP_PER_SKILL (25) x `skills`. */
      scoreRun(run: { cleared: boolean; agents: number; steps: number; stepLimit: number; skills?: number; upkeep?: number }): number;
      UPKEEP_PER_SKILL: number;
    };
  }
}
