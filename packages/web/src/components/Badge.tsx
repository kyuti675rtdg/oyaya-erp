import type { ReactNode } from 'react';

export type BadgeTone = 'pass' | 'advisory' | 'critical' | 'neutral';

const toneStyles: Record<BadgeTone, string> = {
  pass: 'bg-pass-bg dark:bg-emerald-900/30 text-pass-text dark:text-emerald-400',
  advisory: 'bg-advisory-bg dark:bg-amber-900/30 text-advisory-text dark:text-amber-400',
  critical: 'bg-critical-bg dark:bg-rose-900/30 text-critical-text dark:text-rose-400 border border-critical-text/50 badge-critical-pulse',
  neutral: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
};

export function Badge({
  tone = 'neutral',
  children,
  className = ''
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${toneStyles[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Semantic status badge derived from a numeric check against a threshold. */
export function ThresholdBadge({
  value,
  threshold,
  mode,
  label
}: {
  value: number;
  threshold: number;
  /** 'min' flags when value < threshold; 'max' flags when value > threshold. */
  mode: 'min' | 'max';
  label?: string;
}) {
  const breached = mode === 'min' ? value < threshold : value > threshold;
  return (
    <Badge tone={breached ? 'critical' : 'pass'}>
      {label ?? `${value.toFixed(1)} vs ${threshold}`}
    </Badge>
  );
}
