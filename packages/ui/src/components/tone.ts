import type { IconName, Tone } from '../types';

export const TONE_ICON: Readonly<Record<Tone, IconName>> = {
  neutral: 'info',
  good: 'check',
  warning: 'warning',
  critical: 'critical',
};
