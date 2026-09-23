import type { Band, Priority } from '../types/models';

/** Risk colour is semantic and ALWAYS accompanied by its text label.
 *  Nothing in this app communicates risk through colour alone. */
export const BAND_STYLE: Record<Band, { chip: string; dot: string; bar: string; text: string }> = {
  LOW: {
    chip: 'bg-low-bg text-low-fg dark:bg-low/15 dark:text-low',
    dot: 'bg-low', bar: 'bg-low', text: 'text-low-fg dark:text-low',
  },
  MODERATE: {
    chip: 'bg-moderate-bg text-moderate-fg dark:bg-moderate/15 dark:text-moderate',
    dot: 'bg-moderate', bar: 'bg-moderate', text: 'text-moderate-fg dark:text-moderate',
  },
  HIGH: {
    chip: 'bg-high-bg text-high-fg dark:bg-high/15 dark:text-high',
    dot: 'bg-high', bar: 'bg-high', text: 'text-high-fg dark:text-high',
  },
  'VERY HIGH': {
    chip: 'bg-critical-bg text-critical-fg dark:bg-critical/20 dark:text-high',
    dot: 'bg-critical', bar: 'bg-critical', text: 'text-critical-fg dark:text-high',
  },
};

export const PRIORITY_STYLE: Record<Priority, string> = {
  LOW: 'bg-hairline/60 text-fg3',
  MEDIUM: 'bg-moderate-bg text-moderate-fg dark:bg-moderate/15 dark:text-moderate',
  HIGH: 'bg-high-bg text-high-fg dark:bg-high/15 dark:text-high',
  URGENT: 'bg-critical text-white',
};

export function bandOf(score: number): Band {
  if (score >= 80) return 'VERY HIGH';
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MODERATE';
  return 'LOW';
}

export const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const pct = (n: number, dp = 1) => `${n.toFixed(dp)}%`;

export const score1 = (n: number) => n.toFixed(1);

export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dayMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export const SCENARIO_LABEL: Record<string, string> = {
  normal: 'Normal Customers',
  household: 'Legitimate Shared Household',
  isolated: 'Isolated Abuse',
  coordinated: 'Coordinated Threshold Evasion',
};

export const SCENARIO_SHORT: Record<string, string> = {
  normal: 'Normal',
  household: 'Household',
  isolated: 'Isolated Abuse',
  coordinated: 'Coordinated',
};

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
