import type { ReactNode } from 'react';
import { Badge } from '../components/Badge';

export const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

/* ── Loose API shapes (Prisma decimals arrive as strings) ── */

export type NumLike = string | number | null | undefined;

export const asNum = (v: NumLike): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export interface SupplierRef {
  id: string;
  name: string;
}

export interface IntakeRec {
  id: string;
  intakeNo: string;
  deliveryDate: string;
  supplier?: SupplierRef | null;
  truckPlate: string;
  wheatCategory: string;
  wheatOrigin?: string | null;
  bagCount: number;
  quintals: NumLike;
  grossKg?: NumLike;
  tareKg?: NumLike;
  netKg?: NumLike;
  moistureQuick?: NumLike;
  glutenPct?: NumLike;
  moisturePct?: NumLike;
  impurityPct?: NumLike;
  hectoliterPct?: NumLike;
  germinationPct?: NumLike;
  labTestedAt?: string | null;
  status: string;
  flaggedReasons?: string[];
  decision?: string | null;
  decisionNote?: string | null;
  _count?: { batchSources: number; tankFills: number };
}

export interface BatchRec {
  id: string;
  batchNo: string;
  productType: string;
  status: string;
  blendSoftPct: NumLike;
  blendHardPct: NumLike;
  blendForeignPct: NumLike;
  blendSoftQ: NumLike;
  blendHardQ: NumLike;
  blendForeignQ: NumLike;
  wheatWeighedQ: NumLike;
  createdAt: string;
  _count?: { sources: number; shifts: number; labChecks: number; packRuns: number; nonconformities: number };
}

export interface LotRec {
  id: string;
  batchNo: string;
  productId: string;
  packagingSizeId?: string | null;
  locationCode: string;
  bags: number;
  quintals: NumLike;
  receivedAt: string;
  product?: { id: string; name: string } | null;
}

export interface CycleRec {
  id: string;
  tankCode: string;
  batchNo: string;
  blendRatio?: Record<string, number> | null;
  startedAt: string;
  requiredHrs: NumLike;
  waterAddedQ?: NumLike;
  moistureBefore?: NumLike;
  moistureAfter?: NumLike;
  completedAt?: string | null;
  releasedAt?: string | null;
  notes?: string | null;
  batch?: { id: string; batchNo: string; status: string; wheatWeighedQ: NumLike; createdAt: string } | null;
}

export interface RecallCaseRec {
  id: string;
  caseNo: string;
  rootType: string;
  rootBatchId?: string | null;
  rootBatchNo?: string | null;
  rootLotNo?: string | null;
  severity: string;
  reason: string;
  status: string;
  impactSnapshot?: Record<string, unknown> | null;
  investigationLog?: Array<{ at: string; by: string; step: string }> | null;
  disposition?: string | null;
  dispositionNote?: string | null;
  decidedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  items?: RecallItemRec[];
  _count?: { items: number };
}

export interface RecallItemRec {
  id: string;
  batchNo?: string | null;
  lotNo?: string | null;
  productName?: string | null;
  quintals?: NumLike;
  bags?: number | null;
  customerName?: string | null;
  status: string;
}

/* ── Status badges ── */

export function statusTone(s: string | null | undefined): 'pass' | 'advisory' | 'critical' | 'neutral' {
  const v = (s ?? '').toUpperCase();
  if (['ACCEPTED', 'APPROVED', 'PASS', 'RELEASED', 'CLOSED', 'DISPOSITIONED', 'DELIVERED'].includes(v)) return 'pass';
  if (['REJECTED', 'REJECT', 'DESTROY', 'CRITICAL', 'CLASS_I', 'FAIL', 'RECALLED'].includes(v)) return 'critical';
  if (['CONDITIONAL', 'FLAGGED', 'PENDING_LAB', 'QC_HOLD', 'OPEN', 'INVESTIGATING', 'HELD', 'CLASS_II', 'AFFECTED'].includes(v)) return 'advisory';
  return 'neutral';
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  return <Badge tone={statusTone(value)}>{(value ?? '—').replace(/_/g, ' ')}</Badge>;
}

/* ── Vertical chain timeline ── */

export interface ChainStep {
  icon: ReactNode;
  title: string;
  sub?: ReactNode;
  date?: string | null;
  badge?: ReactNode;
  accent?: string;
}

export function ChainTimeline({ steps }: { steps: ChainStep[] }) {
  return (
    <ol className="relative ml-2 space-y-0 border-l-2 border-slate-200 dark:border-slate-700">
      {steps.map((s, i) => (
        <li key={i} className="relative pb-6 pl-8 last:pb-0">
          <span
            className={`absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white shadow ${
              s.accent ?? 'bg-violet-100 text-violet-700'
            }`}
          >
            {s.icon}
          </span>
          <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{s.title}</p>
              {s.badge ?? null}
            </div>
            {s.sub ? <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{s.sub}</div> : null}
            {s.date ? <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{s.date}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── CSV export ── */

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
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

export const fmtPct = (v: NumLike): string => `${asNum(v).toFixed(1)}%`;
