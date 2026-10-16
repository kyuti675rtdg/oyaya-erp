import type { CSSProperties, ReactNode } from 'react';

type Tone = 'violet' | 'green' | 'amber' | 'blue';

const TONES: Record<Tone, { iconBg: string; iconText: string }> = {
  violet: {
    iconBg: 'bg-gradient-to-br from-violet-light to-violet-primary',
    iconText: 'text-white'
  },
  green: {
    iconBg: 'bg-gradient-to-br from-emerald-400 to-emerald-600',
    iconText: 'text-white'
  },
  amber: {
    iconBg: 'bg-gradient-to-br from-amber-400 to-amber-600',
    iconText: 'text-white'
  },
  blue: {
    iconBg: 'bg-gradient-to-br from-sky-400 to-blue-600',
    iconText: 'text-white'
  }
};

interface KpiCardProps {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  trend?: number | null;
  trendSuffix?: string;
  tone?: Tone;
  /** Stagger index for the entrance animation (× 60ms delay). */
  index?: number;
  style?: CSSProperties;
}

/**
 * Reference-style KPI card: gradient icon square top-left, trend badge top-right,
 * large bold tabular value, small gray label. Lifts subtly on hover.
 */
export function KpiCard({
  icon,
  value,
  label,
  trend,
  trendSuffix = '',
  tone = 'violet',
  index = 0,
  style
}: KpiCardProps) {
  const t = TONES[tone];
  const showTrend = trend !== null && trend !== undefined && Number.isFinite(trend);
  const positive = (trend ?? 0) >= 0;

  return (
    <div
      className="card-lift animate-fade-in-up rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(76,29,149,0.06),0_4px_16px_rgba(76,29,149,0.05)]"
      style={{ animationDelay: `${index * 60}ms`, ...style }}
    >
      <div className="flex items-start justify-between">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-sm ${t.iconBg} ${t.iconText}`}
        >
          {icon}
        </div>
        {showTrend && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
              positive ? 'bg-pass-bg text-pass-text' : 'bg-critical-bg text-critical-text'
            }`}
          >
            {positive ? '▲' : '▼'} {Math.abs(trend ?? 0).toFixed(1)}
            {trendSuffix}
          </span>
        )}
      </div>
      <p className="tnum mt-4 truncate text-3xl font-extrabold tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-sm font-medium text-slate-500">{label}</p>
    </div>
  );
}
