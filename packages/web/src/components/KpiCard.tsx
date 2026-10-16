import type { CSSProperties, ReactNode } from 'react';

type Tone = 'violet' | 'green' | 'amber' | 'blue';

const TONES: Record<Tone, { circle: string }> = {
  violet: { circle: 'bg-violet-100 text-violet-600' },
  green: { circle: 'bg-emerald-100 text-emerald-600' },
  amber: { circle: 'bg-amber-100 text-amber-600' },
  blue: { circle: 'bg-blue-100 text-blue-600' }
};

interface KpiCardProps {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  /** e.g. 12 for +12%, 0 for flat, null to hide */
  trendPct?: number | null;
  tone?: Tone;
  /** Stagger index for the entrance animation (× 60ms delay). */
  index?: number;
  style?: CSSProperties;
}

/**
 * Reference-style KPI card: light-tinted icon circle on the left,
 * small gray label, large bold value, trend row ("↑ 12% / vs. last week").
 */
export function KpiCard({
  icon,
  value,
  label,
  trendPct,
  tone = 'violet',
  index = 0,
  style
}: KpiCardProps) {
  const t = TONES[tone];
  const showTrend = trendPct !== null && trendPct !== undefined && Number.isFinite(trendPct);
  const positive = (trendPct ?? 0) > 0;
  const flat = (trendPct ?? 0) === 0;

  return (
    <div
      className="animate-fade-in-up rounded-xl border border-line bg-white p-5 shadow-sm"
      style={{ animationDelay: `${index * 60}ms`, ...style }}
    >
      <div className="flex items-start gap-3.5">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${t.circle}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-slate-500">{label}</p>
          <p className="tnum mt-1 truncate text-[26px] font-extrabold leading-none tracking-tight text-ink">
            {value}
          </p>
        </div>
      </div>
      {showTrend ? (
        <div className="mt-3 flex items-center justify-end gap-1.5">
          <span
            className={`text-xs font-bold tabular-nums ${
              positive ? 'text-emerald-600' : flat ? 'text-slate-400' : 'text-red-500'
            }`}
          >
            {flat ? '→' : positive ? '↑' : '↓'} {Math.abs(trendPct ?? 0).toFixed(0)}%
          </span>
          <span className="text-xs text-slate-400">vs. last week</span>
        </div>
      ) : null}
    </div>
  );
}
