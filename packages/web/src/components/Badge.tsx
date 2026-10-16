import type { ReactNode } from 'react';

export type BadgeTone = 'pass' | 'advisory' | 'critical' | 'neutral';

const toneStyles: Record<BadgeTone, string> = {
  pass: 'bg-pass-bg text-pass-text',
  advisory: 'bg-advisory-bg text-advisory-text',
  critical: 'bg-critical-bg text-critical-text border border-critical-text/50 badge-critical-pulse',
  neutral: 'bg-slate-100 text-slate-600'
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
