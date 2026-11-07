// @skirm/ui: the skirm design system as typed React components.
// Load '@skirm/ui/tokens.css' then '@skirm/ui/styles.css' once at the app root.
export * from './types';
export {
  TAGS,
  ACTIONS,
  TAG_MEANING,
  UNLOCKS,
  THING_TAGS,
  THING_NAME,
  TILES,
  ICONS,
  FILLED_ICONS,
  DURATION,
} from './data';
export { agentGlyph, type AgentGlyphOptions } from './glyphs';
export { cx, fmt, unlockName } from './util';

export { Icon, type IconProps } from './components/Icon';
export { AkIcon, akIconMarkup, type AkIconProps, type AkIconName } from './components/AkIcon';
export { Logo, LogoMark, type LogoProps, type LogoMarkProps } from './components/Logo';
export { Button, type ButtonProps } from './components/Button';
export { TextField, type TextFieldProps } from './components/TextField';
export { Tabs, type TabsProps, type TabItem } from './components/Tabs';
export { Toast, type ToastProps } from './components/Toast';
export { Modal, type ModalProps } from './components/Modal';
export { Badge, type BadgeProps } from './components/Badge';
export { TagChip, type TagChipProps } from './components/TagChip';
export { UnlockChip, type UnlockChipProps } from './components/UnlockChip';
export { ScopeChip, type ScopeChipProps } from './components/ScopeChip';
export { AgentAvatar, type AgentAvatarProps } from './components/AgentAvatar';
export { AgentChip, type AgentChipProps, type AgentSummary } from './components/AgentChip';
export { CreditsBalance, type CreditsBalanceProps } from './components/CreditsBalance';
export { TopUpPanel, type TopUpPanelProps, type TopUpPack } from './components/TopUpPanel';
export { Meter, type MeterProps } from './components/Meter';
export {
  Panel,
  Kicker,
  DisplayHeading,
  HazardTape,
  Pips,
  DiamondChip,
  Segmented,
  Soon,
  type PanelProps,
  type DisplayHeadingProps,
  type PipsProps,
  type DiamondChipProps,
  type SegmentedProps,
  type SegmentedOption,
  type SoonProps,
} from './components/Arena';
export {
  ROLE_LOOKS,
  lookFor,
  dressLook,
  genericLook,
  lookParts,
  lookTop,
  poseKind,
  poseAt,
  isoPolys,
  polyBounds,
  fillOf,
  shadeHex,
  hslHex,
  ISO_V,
  HEAD_TOP,
  FALL_S,
  CHEER_S,
  type RoleLook,
  type LookPart,
  type LookGroup,
  type LookFill,
  type LookColours,
  type VerbFx,
  type Pose,
  type PoseKind,
  type PoseInput,
  type Social,
  type IsoPoly,
  type Dress,
} from './looks';
