import type { ReactNode } from 'react';

type Tone = 'violet' | 'green' | 'amber' | 'blue';

const TONES: Record<Tone, { iconBg: string; iconText: string }> = {
  violet: { iconBg: 'bg-violet-pale', iconText: 'text-violet-primary' },
  green: { iconBg: 'bg-pass-bg', iconText: 'text-pass-text' },
  amber: { iconBg: 'bg-advisory-bg', iconText: 'text-advisory-text' },
  blue: { iconBg: 'bg-blue-50', iconText: 'text-blue-600' }
};

interface KpiCardProps {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  trend?: number | null;
  trendSuffix?: string;
  tone?: Tone;
}

/**
 * Reference-style KPI card: tinted icon square top-left, trend badge top-right,
 * large bold value, small gray label below.
 */
export function KpiCard({ icon, value, label, trend, trendSuffix = '', tone = 'violet' }: KpiCardProps) {
  const t = TONES[tone];
  const showTrend = trend !== null && trend !== undefined && Number.isFinite(trend);
  const positive = (trend ?? 0) >= 0;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(76,29,149,0.06),0_4px_16px_rgba(76,29,149,0.05)]">
      <div className="flex items-start justify-between">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${t.iconBg} ${t.iconText}`}>
          {icon}
        </div>
        {showTrend && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
              positive ? 'bg-pass-bg text-pass-text' : 'bg-critical-bg text-critical-text'
            }`}
          >
            {positive ? '▲' : '▼'} {Math.abs(trend ?? 0).toFixed(1)}{trendSuffix}
          </span>
        )}
      </div>
      <p className="tnum mt-4 truncate text-3xl font-extrabold tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-sm font-medium text-slate-500">{label}</p>
    </div>
  );
}
