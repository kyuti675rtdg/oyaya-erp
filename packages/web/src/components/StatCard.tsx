import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  sub,
  accent = 'navy',
  icon
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: 'navy' | 'harvest' | 'pass' | 'critical' | 'advisory';
  icon?: ReactNode;
}) {
  const bar: Record<string, string> = {
    navy: 'bg-navy',
    harvest: 'bg-harvest',
    pass: 'bg-pass-text',
    critical: 'bg-critical-text',
    advisory: 'bg-advisory-text'
  };
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-white p-4 shadow-sm">
      <div className={`absolute inset-y-0 left-0 w-1 ${bar[accent]}`} />
      <div className="flex items-start justify-between gap-2 pl-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="tnum mt-1 truncate text-2xl font-bold text-ink">{value}</p>
          {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
        </div>
        {icon}
      </div>
    </div>
  );
}
