import type { ReactNode } from 'react';
import { useAuth } from '../store/auth';
import { fmtBirr, fmtDate, fmtQ } from '../lib/format';

/**
 * Shared building blocks for the HR & Payroll module (Module 15).
 * Design language: cardShell + CardHeader + slate/violet + lucide + tabular-nums.
 */

export const hrShell = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/70 dark:border-slate-700 shadow-sm p-5';

export const hrPrimaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50 active:scale-[0.98]';

export const hrSecondaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 active:scale-[0.98]';

export function useHrPerms() {
  const hasAnyClaim = useAuth((s) => s.hasAnyClaim);
  return {
    canView: hasAnyClaim(['hr:read', 'payroll:read']),
    canManage: hasAnyClaim(['hr:create', 'payroll:create', 'hr:manage', 'payroll:manage']),
    canApprove: hasAnyClaim(['hr:approve', 'payroll:approve'])
  };
}

export function HrModal({
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
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

export function HrKpi({
  label,
  value,
  sub,
  icon
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
}) {
  return (
    <div className={hrShell}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
          {icon}
        </span>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</p>
      </div>
      <p className="tnum mt-3 text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p> : null}
    </div>
  );
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
  const escape = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

export function HrNotice({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
        ok
          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
          : 'border-red-300 bg-red-50 text-red-800'
      }`}
    >
      {text}
    </div>
  );
}

export function modeLabel(mode: string): string {
  return mode === 'FIXED' ? 'Fixed salary' : mode === 'PIECE_RATE' ? 'Piece-rate' : 'Trip-based';
}

export function runPeriodLabel(run: { periodYear: number; periodMonth: number }): string {
  return `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}`;
}

export { fmtBirr, fmtDate, fmtQ };
