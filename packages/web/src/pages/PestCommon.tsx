import type { ReactNode } from 'react';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import type {
  FollowUpResult,
  PestAlertSeverity,
  PestScheduleEffectiveStatus,
  PestEvidenceStatus,
  PestSeverity,
  RiskCheckpointResult
} from '../types';

/** Design-language card shell (Dashboard spec). */
export const cardShell = 'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

export const PEST_AREAS = [
  'intake gate',
  'dry storage',
  'conditioning tank A',
  'conditioning tank B',
  'conditioning tank C',
  'washing',
  'milling lines',
  'packing',
  'finished goods warehouse',
  'laboratory'
] as const;

export const HIGH_RISK_AREAS = ['dry storage', 'finished goods warehouse', 'packing'] as const;

export const PEST_TYPES = ['RODENT', 'INSECT', 'TERMITE', 'BIRD'] as const;
export const PEST_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const TREATMENT_TYPES = ['TRAP', 'BAIT', 'SPRAY', 'FUMIGATION'] as const;
export const FREQUENCIES = ['WEEKLY', 'MONTHLY'] as const;
export const CHECKPOINT_CATEGORIES = ['BAIT_STATION', 'ENTRY_POINT', 'GENERAL'] as const;

export function pretty(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function ScheduleStatusBadge({ status }: { status: PestScheduleEffectiveStatus }) {
  const tone =
    status === 'DONE' ? 'pass' : status === 'OVERDUE' ? 'critical' : status === 'CANCELLED' ? 'neutral' : 'advisory';
  return <Badge tone={tone}>{status === 'OVERDUE' ? 'Overdue' : pretty(status)}</Badge>;
}

export function SeverityBadge({ severity }: { severity: PestSeverity }) {
  const tone = severity === 'CRITICAL' || severity === 'HIGH' ? 'critical' : severity === 'MEDIUM' ? 'advisory' : 'neutral';
  return <Badge tone={tone}>{pretty(severity)}</Badge>;
}

export function EvidenceStatusBadge({ status }: { status: PestEvidenceStatus }) {
  return <Badge tone={status === 'CLEARED' ? 'pass' : 'critical'}>{pretty(status)}</Badge>;
}

export function CheckpointBadge({ result }: { result: RiskCheckpointResult }) {
  return <Badge tone={result === 'PASS' ? 'pass' : 'critical'}>{result}</Badge>;
}

export function FollowUpResultBadge({ result }: { result: FollowUpResult }) {
  return (
    <Badge tone={result === 'CLEARED' ? 'pass' : 'critical'}>{pretty(result)}</Badge>
  );
}

export function AlertSeverityBadge({ severity }: { severity: PestAlertSeverity }) {
  const tone = severity === 'CRITICAL' ? 'critical' : severity === 'WARNING' ? 'advisory' : 'neutral';
  return <Badge tone={tone}>{pretty(severity)}</Badge>;
}

export function PestCardHeader({
  icon,
  title,
  subtitle,
  action
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return <CardHeader icon={icon} title={title} subtitle={subtitle} action={action} />;
}

/** KPI tile used on pest pages. */
export function PestKpi({
  label,
  value,
  tone = 'slate',
  sub
}: {
  label: string;
  value: ReactNode;
  tone?: 'slate' | 'violet' | 'emerald' | 'amber' | 'rose';
  sub?: string;
}) {
  const toneText: Record<string, string> = {
    slate: 'text-slate-800',
    violet: 'text-violet-700',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700'
  };
  return (
    <div className={cardShell}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${toneText[tone]}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

/** CSV download helper for report pages. */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (v: string | number | null | undefined) => {
    const s = String(v ?? '');
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
