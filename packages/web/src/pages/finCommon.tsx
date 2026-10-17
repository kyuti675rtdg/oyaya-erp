import axios from 'axios';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';

/** Extract a human message from API/axios errors. */
export function errMsg(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data as { error?: string; message?: string } | undefined;
    if (d?.error) return d.error;
    if (d?.message) return d.message;
    if (err.response?.status === 403) return 'You do not have permission to perform this action.';
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

const STATUS_TONES: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'advisory',
  APPROVED: 'pass',
  POSTED: 'pass',
  PAID: 'pass',
  REJECTED: 'critical',
  CANCELLED: 'neutral',
  OPEN: 'advisory',
  PARTIAL: 'advisory',
  INVOICED: 'advisory',
  PLACEMENT: 'neutral'
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{status}</Badge>;
}

export const BUCKET_TONES: Record<string, BadgeTone> = {
  current: 'pass',
  '31-60': 'advisory',
  '61-90': 'advisory',
  '90+': 'critical',
  paid: 'neutral'
};

export function BucketBadge({ bucket }: { bucket: string }) {
  return <Badge tone={BUCKET_TONES[bucket] ?? 'neutral'}>{bucket}</Badge>;
}

const ACCOUNT_TYPE_TONES: Record<string, BadgeTone> = {
  ASSET: 'pass',
  LIABILITY: 'advisory',
  EQUITY: 'neutral',
  REVENUE: 'pass',
  EXPENSE: 'critical'
};

export function AccountTypeBadge({ type }: { type: string }) {
  return <Badge tone={ACCOUNT_TYPE_TONES[type] ?? 'neutral'}>{type}</Badge>;
}

/** Local ISO date (YYYY-MM-DD) for date inputs. */
export function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** First day of the current month, as YYYY-MM-DD. */
export function firstOfMonth(): string {
  const d = new Date();
  return toInputDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Today as YYYY-MM-DD. */
export function todayInput(): string {
  return toInputDate(new Date());
}

/** Approximate current Ethiopian calendar year (Gregorian year minus ~7/8). */
export function approxEthYear(): number {
  const now = new Date();
  // Ethiopian new year (Meskerem 1) falls around Sep 11; approximate cutover.
  const cut = new Date(now.getFullYear(), 8, 11);
  return now >= cut ? now.getFullYear() - 7 : now.getFullYear() - 8;
}

/** CSV download helper. */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
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
