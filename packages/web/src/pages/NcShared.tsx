// Shared helpers for the Module 6 (Nonconformity & CAPA) pages.
import type {
  NcActionStatus,
  NcDecision,
  NcSeverity,
  NcSignoffStatus,
  NcSource,
  NcStatus
} from '../types';

export const cardShell = 'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

export const NC_SOURCE_LABEL: Record<NcSource, string> = {
  INTAKE: 'Intake',
  IN_PROCESS: 'In-process',
  FLOUR: 'Flour',
  HYGIENE: 'Hygiene',
  PEST: 'Pest'
};

export const NC_SEVERITY_LABEL: Record<NcSeverity, string> = {
  CRITICAL: 'Critical',
  MAJOR: 'Major',
  MINOR: 'Minor'
};

export const NC_STATUS_LABEL: Record<NcStatus, string> = {
  OPEN: 'Open',
  UNDER_REVIEW: 'Under review',
  CLOSED: 'Closed'
};

export const NC_DECISION_LABEL: Record<NcDecision, string> = {
  RELEASE: 'Release',
  REWORK: 'Rework',
  DOWNGRADE: 'Downgrade',
  RECYCLE_FEED: 'Recycle to feed',
  REJECT_DISPOSE: 'Reject & dispose'
};

export const NC_ACTION_STATUS_LABEL: Record<NcActionStatus, string> = {
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  VERIFIED: 'Verified'
};

export const severityTone = (s: NcSeverity): 'critical' | 'advisory' | 'neutral' =>
  s === 'CRITICAL' ? 'critical' : s === 'MAJOR' ? 'advisory' : 'neutral';

export const ncStatusTone = (s: NcStatus): 'critical' | 'advisory' | 'pass' =>
  s === 'OPEN' ? 'critical' : s === 'UNDER_REVIEW' ? 'advisory' : 'pass';

export const actionStatusTone = (s: NcActionStatus): 'neutral' | 'advisory' | 'pass' =>
  s === 'PLANNED' ? 'neutral' : s === 'IN_PROGRESS' ? 'advisory' : 'pass';

export const signoffTone = (s: NcSignoffStatus): 'advisory' | 'pass' =>
  s === 'PENDING' ? 'advisory' : 'pass';

/** Download a CSV built from row objects. */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const esc = (v: string | number): string => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Full days between now and an ISO date. */
export function ageDays(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
