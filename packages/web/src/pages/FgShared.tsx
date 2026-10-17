import type { ReactNode } from 'react';
import { useAuth } from '../store/auth';
import { fmtDate, fmtQ } from '../lib/format';

/** Standard card wrapper (Dashboard spec). */
export const cardShell =
  'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

/** Violet primary button class used across the FG module. */
export const violetBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50 active:scale-[0.98]';

export const secondaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 active:scale-[0.98]';

/* ─── Page header ─── */

export function FgPageHeader({
  title,
  subtitle,
  actions
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ─── KPI stat card ─── */

export function FgKpi({
  label,
  value,
  sub,
  icon,
  tone = 'violet'
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
  tone?: 'violet' | 'emerald' | 'amber' | 'rose' | 'slate';
}) {
  const tones: Record<string, string> = {
    violet: 'bg-violet-50 text-violet-700 border-violet-200/60',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
    amber: 'bg-amber-50 text-amber-700 border-amber-200/60',
    rose: 'bg-rose-50 text-rose-700 border-rose-200/60',
    slate: 'bg-slate-50 text-slate-600 border-slate-200/60'
  };
  return (
    <div className={cardShell}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg border ${tones[tone]}`}
        >
          {icon}
        </span>
      </div>
      <p className="tnum mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p> : null}
    </div>
  );
}

/* ─── Badges ─── */

export function FgBadge({
  tone,
  children
}: {
  tone: 'violet' | 'emerald' | 'amber' | 'rose' | 'slate';
  children: ReactNode;
}) {
  const styles: Record<string, string> = {
    violet: 'bg-violet-100 text-violet-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700',
    slate: 'bg-slate-100 text-slate-600'
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

export function agingStatusBadge(status: string) {
  if (status === 'EXPIRED') return <FgBadge tone="rose">Expired</FgBadge>;
  if (status === 'NEAR_EXPIRY') return <FgBadge tone="amber">Near expiry</FgBadge>;
  return <FgBadge tone="emerald">OK</FgBadge>;
}

export function bucketBadge(bucket: string) {
  const tone =
    bucket === '0-30' ? 'emerald' : bucket === '31-60' ? 'violet' : bucket === '61-90' ? 'amber' : 'rose';
  return <FgBadge tone={tone as 'emerald' | 'violet' | 'amber' | 'rose'}>{bucket}d</FgBadge>;
}

/* ─── Modal shell ─── */

export function FgModal({
  title,
  subtitle,
  onClose,
  children,
  wide
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-100 bg-white p-6 shadow-xl`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-lg font-bold text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─── Loading skeleton ─── */

export function FgSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className={cardShell} aria-label="Loading">
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700" />
        ))}
      </div>
    </div>
  );
}

export function FgKpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className={cardShell}>
          <div className="h-4 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
          <div className="mt-3 h-8 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
        </div>
      ))}
    </div>
  );
}

/* ─── Error block ─── */

export function FgError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
      <p className="font-semibold">Could not load data</p>
      <p className="mt-1">{message}</p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-2 rounded-lg border border-rose-300 bg-white dark:bg-slate-800 px-4 py-1.5 text-sm font-semibold hover:bg-rose-100"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

/* ─── Empty state ─── */

export function FgEmpty({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 dark:bg-slate-800 px-6 py-10 text-center">
      <p className="font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {sub ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{sub}</p> : null}
    </div>
  );
}

/* ─── Permission gate helper ─── */

export function useFgPerms() {
  const hasClaim = useAuth((s) => s.hasClaim);
  return {
    canView: hasClaim('fg:view'),
    canManage: hasClaim('fg:manage'),
    canApprove: hasClaim('fg:approve')
  };
}

/* ─── CSV export ─── */

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export { fmtDate, fmtQ };
