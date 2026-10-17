import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Download,
  Printer,
  Scale,
  Star,
  TrendingUp,
  Truck,
  Wallet,
  Wheat
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type {
  APInvoice,
  PurchaseOrder,
  Supplier,
  WheatCategory,
  WheatIntake
} from '../types';
import { Badge } from '../components/Badge';
import {
  Button,
  EmptyState,
  ErrorBox,
  Field,
  SectionTitle,
  TextInput
} from '../components/ui';
import { fmtBirr, fmtDate, fmtInt, fmtPct, fmtQ } from '../lib/format';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const CATEGORY_LABEL: Record<WheatCategory, string> = {
  SOFT: 'Soft wheat',
  HARD: 'Hard wheat',
  FOREIGN: 'Foreign wheat'
};
const CATEGORY_COLOR: Record<WheatCategory, string> = {
  SOFT: '#0EA5E9',
  HARD: '#7C3AED',
  FOREIGN: '#F59E0B'
};
const CATEGORIES: WheatCategory[] = ['SOFT', 'HARD', 'FOREIGN'];

const tooltipStyle = {
  borderRadius: 12,
  border: '1px solid #E2E8F0',
  fontSize: 12,
  boxShadow: '0 4px 16px rgba(15,23,42,0.08)'
};

/* ── Date helpers ─────────────────────────────────────────────────────────── */

function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type PresetKey = 'week' | 'month' | 'lastMonth' | 'quarter';

function presetRange(key: PresetKey): { from: string; to: string } {
  const now = new Date();
  const today = toLocalISO(now);
  switch (key) {
    case 'week': {
      const dow = (now.getDay() + 6) % 7; // Monday-first
      const monday = new Date(now);
      monday.setDate(now.getDate() - dow);
      return { from: toLocalISO(monday), to: today };
    }
    case 'month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toLocalISO(first), to: today };
    }
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toLocalISO(first), to: toLocalISO(last) };
    }
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      const first = new Date(now.getFullYear(), q * 3, 1);
      return { from: toLocalISO(first), to: today };
    }
  }
}

const PRESET_LABELS: Record<PresetKey, string> = {
  week: 'This week',
  month: 'This month',
  lastMonth: 'Last month',
  quarter: 'This quarter'
};

function weekLabel(monday: Date): string {
  return monday.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/* ── CSV export ───────────────────────────────────────────────────────────── */

function csvEscape(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]): void {
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((r) => r.map(csvEscape).join(','))
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r1 = (n: number): number => Math.round(n * 10) / 10;

/* ── Report row types ─────────────────────────────────────────────────────── */

interface SupplierPerf {
  id: string;
  name: string;
  type: string;
  rating: number | null;
  intakes: number;
  quintals: number;
  accepted: number;
  decided: number;
  acceptanceRate: number | null; // 0..1
  spendBirr: number;
  pricedQ: number;
  avgPrice: number | null; // ETB per Qt
}

interface POVariance {
  id: string;
  poNo: string;
  supplierName: string;
  wheatCategory: WheatCategory;
  ordered: number;
  received: number;
  varianceQ: number;
  variancePct: number | null;
  status: string;
}

interface TrendPoint {
  week: string;
  label: string;
  SOFT: number | null;
  HARD: number | null;
  FOREIGN: number | null;
}

interface AgingBucket {
  key: string;
  label: string;
  color: string;
  amount: number;
  count: number;
}

type TabKey = 'supplier' | 'wheat' | 'price' | 'variance' | 'aging';
type SortKey = 'name' | 'intakes' | 'quintals' | 'acceptanceRate' | 'avgPrice' | 'spendBirr' | 'rating';

const TABS: Array<{ key: TabKey; label: string; icon: typeof Truck }> = [
  { key: 'supplier', label: 'Supplier Performance', icon: Truck },
  { key: 'wheat', label: 'Wheat Type Mix', icon: Wheat },
  { key: 'price', label: 'Price Trends', icon: TrendingUp },
  { key: 'variance', label: 'Intake vs PO Variance', icon: Scale },
  { key: 'aging', label: 'AP Aging', icon: Wallet }
];

const PO_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  DRAFT: 'neutral',
  APPROVED: 'advisory',
  PARTIALLY_RECEIVED: 'advisory',
  COMPLETED: 'pass',
  CANCELLED: 'critical'
};

const AGING_DEFS: Array<{ key: string; label: string; color: string; max: number }> = [
  { key: 'current', label: 'Current', color: '#10B981', max: 0 },
  { key: 'd30', label: '1–30 days', color: '#F59E0B', max: 30 },
  { key: 'd60', label: '31–60 days', color: '#F97316', max: 60 },
  { key: 'd90', label: '61–90 days', color: '#EF4444', max: 90 },
  { key: 'd90plus', label: '90+ days', color: '#991B1B', max: Number.POSITIVE_INFINITY }
];

export function ProcurementReports() {
  const [preset, setPreset] = useState<PresetKey | 'custom'>('month');
  const [range, setRange] = useState<{ from: string; to: string }>(() => presetRange('month'));
  const [tab, setTab] = useState<TabKey>('supplier');
  const [sortKey, setSortKey] = useState<SortKey>('quintals');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fromISO = new Date(`${range.from}T00:00:00`).toISOString();
  const toISO = new Date(`${range.to}T23:59:59.999`).toISOString();
  const fromMs = useMemo(() => new Date(fromISO).getTime(), [fromISO]);
  const toMs = useMemo(() => new Date(toISO).getTime(), [toISO]);

  const suppliersQ = useQuery({
    queryKey: ['proc-rep', 'suppliers'],
    queryFn: async () => (await api.get<Supplier[]>(E.suppliers)).data
  });
  const intakesQ = useQuery({
    queryKey: ['proc-rep', 'intakes', range.from, range.to],
    queryFn: async () =>
      (await api.get<WheatIntake[]>(`${E.intakes}?from=${fromISO}&to=${toISO}`)).data
  });
  const posQ = useQuery({
    queryKey: ['proc-rep', 'pos'],
    queryFn: async () => (await api.get<PurchaseOrder[]>(E.purchaseOrders)).data
  });
  const invQ = useQuery({
    queryKey: ['proc-rep', 'invoices'],
    queryFn: async () => (await api.get<APInvoice[]>(E.apInvoices)).data
  });

  const loading =
    suppliersQ.isLoading || intakesQ.isLoading || posQ.isLoading || invQ.isLoading;
  const loadError = suppliersQ.error ?? intakesQ.error ?? posQ.error ?? invQ.error;
  const retry = () => {
    void suppliersQ.refetch();
    void intakesQ.refetch();
    void posQ.refetch();
    void invQ.refetch();
  };

  const suppliers = useMemo(() => suppliersQ.data ?? [], [suppliersQ.data]);
  const intakes = useMemo(() => intakesQ.data ?? [], [intakesQ.data]);
  const pos = useMemo(() => posQ.data ?? [], [posQ.data]);
  const invoices = useMemo(() => invQ.data ?? [], [invQ.data]);

  const inRange = (iso?: string | null): boolean => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= fromMs && t <= toMs;
  };

  const invoicesInRange = useMemo(
    () => invoices.filter((inv) => inRange(inv.issuedAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices, fromMs, toMs]
  );
  const posInRange = useMemo(
    () => pos.filter((p) => inRange(p.createdAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pos, fromMs, toMs]
  );

  /* ── KPI strip ──────────────────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const accepted = intakes.filter((i) => i.status === 'ACCEPTED');
    const quintals = accepted.reduce((s, i) => s + Number(i.quintals), 0);
    const spend = invoicesInRange.reduce((s, inv) => s + Number(inv.amountBirr), 0);
    const decided = intakes.filter((i) => i.status === 'ACCEPTED' || i.status === 'REJECTED');
    return {
      intakeCount: intakes.length,
      quintals,
      spend,
      acceptanceRate: decided.length > 0 ? accepted.length / decided.length : null
    };
  }, [intakes, invoicesInRange]);

  /* ── Supplier performance ───────────────────────────────────────────────── */
  const supplierPerf = useMemo<SupplierPerf[]>(() => {
    const bySupplier = new Map<string, SupplierPerf>();
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));

    for (const intake of intakes) {
      const s = supplierById.get(intake.supplierId);
      let row = bySupplier.get(intake.supplierId);
      if (!row) {
        row = {
          id: intake.supplierId,
          name: s?.name ?? intake.supplier?.name ?? 'Unknown supplier',
          type: s?.type ?? '—',
          rating: s?.rating ?? null,
          intakes: 0,
          quintals: 0,
          accepted: 0,
          decided: 0,
          acceptanceRate: null,
          spendBirr: 0,
          pricedQ: 0,
          avgPrice: null
        };
        bySupplier.set(intake.supplierId, row);
      }
      row.intakes += 1;
      const q = Number(intake.quintals);
      if (Number.isFinite(q)) row.quintals += q;
      if (intake.status === 'ACCEPTED') row.accepted += 1;
      if (intake.status === 'ACCEPTED' || intake.status === 'REJECTED') row.decided += 1;
    }

    // Average price from AP invoices of accepted intakes
    const invoiceByIntake = new Map(invoicesInRange.map((inv) => [inv.intakeId, inv]));
    for (const intake of intakes) {
      if (intake.status !== 'ACCEPTED') continue;
      const inv = invoiceByIntake.get(intake.id);
      if (!inv) continue;
      const amount = Number(inv.amountBirr);
      const q = Number(intake.quintals);
      if (!Number.isFinite(amount) || !Number.isFinite(q) || q <= 0) continue;
      const row = bySupplier.get(intake.supplierId);
      if (!row) continue;
      row.spendBirr += amount;
      row.pricedQ += q;
    }

    for (const row of bySupplier.values()) {
      row.acceptanceRate = row.decided > 0 ? row.accepted / row.decided : null;
      row.avgPrice = row.pricedQ > 0 ? row.spendBirr / row.pricedQ : null;
    }
    return [...bySupplier.values()];
  }, [intakes, invoicesInRange, suppliers]);

  const sortedPerf = useMemo(() => {
    const val = (r: SupplierPerf): number | string => {
      switch (sortKey) {
        case 'name': return r.name.toLowerCase();
        case 'intakes': return r.intakes;
        case 'quintals': return r.quintals;
        case 'acceptanceRate': return r.acceptanceRate ?? -1;
        case 'avgPrice': return r.avgPrice ?? -1;
        case 'spendBirr': return r.spendBirr;
        case 'rating': return r.rating ?? -1;
      }
    };
    const rows = [...supplierPerf];
    rows.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const cmp =
        typeof va === 'string' || typeof vb === 'string'
          ? String(va).localeCompare(String(vb))
          : (va as number) - (vb as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [supplierPerf, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  /* ── Wheat type mix ─────────────────────────────────────────────────────── */
  const wheatMix = useMemo(() => {
    const rows = CATEGORIES.map((cat) => {
      const quintals = intakes
        .filter((i) => i.status === 'ACCEPTED' && i.wheatCategory === cat)
        .reduce((s, i) => s + Number(i.quintals), 0);
      return { category: cat, label: CATEGORY_LABEL[cat], quintals };
    });
    const total = rows.reduce((s, r) => s + r.quintals, 0);
    return rows.map((r) => ({
      ...r,
      share: total > 0 ? r.quintals / total : 0,
      total
    }));
  }, [intakes]);
  const wheatMixTotal = wheatMix.length > 0 ? wheatMix[0].total : 0;

  /* ── Price trends (weekly avg ETB/Qt from accepted intakes' AP invoices) ── */
  const priceTrend = useMemo<TrendPoint[]>(() => {
    const invoiceByIntake = new Map(invoicesInRange.map((inv) => [inv.intakeId, inv]));
    const groups = new Map<
      string,
      { monday: Date; sums: Record<WheatCategory, { total: number; n: number }> }
    >();
    for (const intake of intakes) {
      if (intake.status !== 'ACCEPTED') continue;
      const inv = invoiceByIntake.get(intake.id);
      if (!inv) continue;
      const amount = Number(inv.amountBirr);
      const q = Number(intake.quintals);
      if (!Number.isFinite(amount) || !Number.isFinite(q) || q <= 0) continue;
      const d = new Date(intake.deliveryDate);
      if (Number.isNaN(d.getTime())) continue;
      const dow = (d.getDay() + 6) % 7;
      const monday = new Date(d);
      monday.setDate(d.getDate() - dow);
      monday.setHours(0, 0, 0, 0);
      const key = toLocalISO(monday);
      let g = groups.get(key);
      if (!g) {
        g = {
          monday: new Date(monday),
          sums: {
            SOFT: { total: 0, n: 0 },
            HARD: { total: 0, n: 0 },
            FOREIGN: { total: 0, n: 0 }
          }
        };
        groups.set(key, g);
      }
      g.sums[intake.wheatCategory].total += amount / q;
      g.sums[intake.wheatCategory].n += 1;
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([week, g]) => {
        const pt: TrendPoint = { week, label: weekLabel(g.monday), SOFT: null, HARD: null, FOREIGN: null };
        for (const cat of CATEGORIES) {
          const s = g.sums[cat];
          if (s.n > 0) pt[cat] = s.total / s.n;
        }
        return pt;
      });
  }, [intakes, invoicesInRange]);

  /* ── Intake vs PO variance ──────────────────────────────────────────────── */
  const poVariance = useMemo<POVariance[]>(() => {
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));
    return posInRange.map((p) => {
      const ordered = Number(p.quantityQ);
      const received = Number(p.receivedQ);
      return {
        id: p.id,
        poNo: p.poNo,
        supplierName: p.supplier?.name ?? supplierById.get(p.supplierId)?.name ?? '—',
        wheatCategory: p.wheatCategory,
        ordered: Number.isFinite(ordered) ? ordered : 0,
        received: Number.isFinite(received) ? received : 0,
        varianceQ: (Number.isFinite(received) ? received : 0) - (Number.isFinite(ordered) ? ordered : 0),
        variancePct:
          Number.isFinite(ordered) && ordered > 0
            ? (((Number.isFinite(received) ? received : 0) - ordered) / ordered) * 100
            : null,
        status: p.status
      };
    });
  }, [posInRange, suppliers]);

  const varianceSummary = useMemo(() => {
    const active = poVariance.filter((p) => p.status !== 'CANCELLED' && p.status !== 'DRAFT');
    const ordered = active.reduce((s, p) => s + p.ordered, 0);
    const received = active.reduce((s, p) => s + p.received, 0);
    return {
      ordered,
      received,
      fulfillment: ordered > 0 ? received / ordered : null,
      under: active.filter((p) => p.varianceQ < -0.001).length,
      over: active.filter((p) => p.varianceQ > 0.001).length
    };
  }, [poVariance]);

  /* ── AP aging ───────────────────────────────────────────────────────────── */
  const aging = useMemo<AgingBucket[]>(() => {
    const nowMs = Date.now();
    const buckets: AgingBucket[] = AGING_DEFS.map((d) => ({
      key: d.key,
      label: d.label,
      color: d.color,
      amount: 0,
      count: 0
    }));
    for (const inv of invoicesInRange) {
      if (inv.status === 'PAID') continue;
      const paid = (inv.payments ?? []).reduce((s, p) => s + Number(p.amountBirr), 0);
      const outstanding = Number(inv.amountBirr) - paid;
      if (!Number.isFinite(outstanding) || outstanding <= 0.005) continue;
      const base = inv.dueDate ?? inv.issuedAt;
      const baseMs = new Date(base).getTime();
      const days = Number.isFinite(baseMs) ? Math.floor((nowMs - baseMs) / 86400000) : 0;
      const def = AGING_DEFS.find((d) => days <= d.max) ?? AGING_DEFS[AGING_DEFS.length - 1];
      const bucket = buckets.find((b) => b.key === def.key);
      if (bucket) {
        bucket.amount += outstanding;
        bucket.count += 1;
      }
    }
    return buckets;
  }, [invoicesInRange]);
  const agingTotal = aging.reduce((s, b) => s + b.amount, 0);

  /* ── CSV exports ────────────────────────────────────────────────────────── */
  const fileSuffix = `${range.from}_to_${range.to}`;

  const exportSupplierCSV = () => {
    downloadCSV(
      `oyaya-supplier-performance-${fileSuffix}.csv`,
      ['Supplier', 'Type', 'Intakes', 'Quintals', 'Acceptance rate %', 'Avg price (ETB/Qt)', 'Spend (ETB)', 'Rating'],
      sortedPerf.map((r) => [
        r.name,
        r.type,
        r.intakes,
        r1(r.quintals),
        r.acceptanceRate === null ? '' : r2(r.acceptanceRate * 100),
        r.avgPrice === null ? '' : r2(r.avgPrice),
        r2(r.spendBirr),
        r.rating === null ? '' : r.rating
      ])
    );
  };

  const exportWheatCSV = () => {
    downloadCSV(
      `oyaya-wheat-type-mix-${fileSuffix}.csv`,
      ['Wheat type', 'Quintals', 'Share %'],
      wheatMix.map((r) => [r.label, r1(r.quintals), r2(r.share * 100)])
    );
  };

  const exportPriceCSV = () => {
    downloadCSV(
      `oyaya-price-trends-${fileSuffix}.csv`,
      ['Week of', 'Soft (ETB/Qt)', 'Hard (ETB/Qt)', 'Foreign (ETB/Qt)'],
      priceTrend.map((p) => [
        p.week,
        p.SOFT === null ? '' : r2(p.SOFT),
        p.HARD === null ? '' : r2(p.HARD),
        p.FOREIGN === null ? '' : r2(p.FOREIGN)
      ])
    );
  };

  const exportVarianceCSV = () => {
    downloadCSV(
      `oyaya-po-variance-${fileSuffix}.csv`,
      ['PO No', 'Supplier', 'Wheat type', 'Ordered (Qt)', 'Received (Qt)', 'Variance (Qt)', 'Variance %', 'Status'],
      poVariance.map((p) => [
        p.poNo,
        p.supplierName,
        CATEGORY_LABEL[p.wheatCategory],
        r1(p.ordered),
        r1(p.received),
        r1(p.varianceQ),
        p.variancePct === null ? '' : r2(p.variancePct),
        p.status
      ])
    );
  };

  const exportAgingCSV = () => {
    downloadCSV(
      `oyaya-ap-aging-${fileSuffix}.csv`,
      ['Bucket', 'Invoices', 'Outstanding (ETB)'],
      aging.map((b) => [b.label, b.count, r2(b.amount)])
    );
  };

  const exportAll = () => {
    exportSupplierCSV();
    exportWheatCSV();
    exportPriceCSV();
    exportVarianceCSV();
    exportAgingCSV();
  };

  /* ── Loading / error states ─────────────────────────────────────────────── */
  if (loading && intakes.length === 0 && suppliers.length === 0) {
    return (
      <div className="space-y-5" aria-label="Loading procurement reports">
        <div className="skeleton-shimmer h-10 w-64 rounded-lg" />
        <div className={`${cardShell}`}>
          <div className="skeleton-shimmer h-6 w-48 rounded-lg" />
          <div className="mt-4 flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton-shimmer h-9 w-28 rounded-full" />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={cardShell}>
              <div className="skeleton-shimmer h-4 w-24 rounded-lg" />
              <div className="skeleton-shimmer mt-3 h-8 w-2/3 rounded-lg" />
            </div>
          ))}
        </div>
        <div className={cardShell}>
          <div className="skeleton-shimmer h-6 w-56 rounded-lg" />
          <div className="skeleton-shimmer mt-4 h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">Procurement Reports</h1>
        <div className="mt-6">
          <ErrorBox
            message={loadError instanceof Error ? loadError.message : 'Failed to load report data.'}
            onRetry={retry}
          />
        </div>
      </div>
    );
  }

  const applyPreset = (key: PresetKey) => {
    setPreset(key);
    setRange(presetRange(key));
  };

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (
      <span className="ml-1 inline-flex align-middle text-violet-600">
        {sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
      </span>
    ) : null;

  const thClass =
    'cursor-pointer select-none whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 hover:text-slate-800';

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">Procurement Reports</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Supplier performance, pricing and payables · {fmtDate(fromISO)} – {fmtDate(toISO)}
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportAll}>
            <Download size={16} /> Export all (CSV)
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={16} /> Print / PDF
          </Button>
        </div>
      </div>

      {/* Period selector */}
      <div className={`${cardShell} no-print mb-5`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
            <CalendarDays size={16} className="text-violet-600" /> Reporting period
          </span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PRESET_LABELS) as PresetKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  preset === key
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {PRESET_LABELS[key]}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-end gap-3">
            <Field label="From">
              <TextInput
                type="date"
                value={range.from}
                max={range.to}
                onChange={(e) => {
                  setPreset('custom');
                  setRange((r) => ({ ...r, from: e.target.value }));
                }}
              />
            </Field>
            <Field label="To">
              <TextInput
                type="date"
                value={range.to}
                min={range.from}
                onChange={(e) => {
                  setPreset('custom');
                  setRange((r) => ({ ...r, to: e.target.value }));
                }}
              />
            </Field>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={cardShell}>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Intakes in period</p>
          <p className="tnum mt-2 text-3xl font-extrabold text-slate-900 dark:text-slate-100">{fmtInt(kpis.intakeCount)}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">All delivery statuses</p>
        </div>
        <div className={cardShell}>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Accepted volume</p>
          <p className="tnum mt-2 text-3xl font-extrabold text-slate-900 dark:text-slate-100">{fmtQ(kpis.quintals)} Qt</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">QC-accepted deliveries</p>
        </div>
        <div className={cardShell}>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Procurement spend</p>
          <p className="tnum mt-2 text-3xl font-extrabold text-slate-900 dark:text-slate-100">{fmtBirr(kpis.spend)}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">AP invoices issued in period</p>
        </div>
        <div className={cardShell}>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Acceptance rate</p>
          <p className="tnum mt-2 text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            {kpis.acceptanceRate === null ? '—' : fmtPct(kpis.acceptanceRate * 100)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Accepted of decided intakes</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="no-print mb-5 flex flex-wrap gap-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
              tab === key
                ? 'bg-violet-600 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* ── Supplier performance ─────────────────────────────────────────── */}
      {tab === 'supplier' && (
        <div className={`${cardShell} print-sheet`}>
          <SectionTitle
            title="Supplier Performance"
            sub="Delivery volume, QC acceptance and average purchase price per supplier"
            action={
              <Button variant="secondary" onClick={exportSupplierCSV} className="no-print !px-4 !py-2 !text-sm">
                <Download size={15} /> CSV
              </Button>
            }
          />
          {sortedPerf.length === 0 ? (
            <EmptyState title="No data for selected period" sub="No wheat intakes were recorded in this period." />
          ) : (
            <>
              <div className="mb-6 h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sortedPerf.slice(0, 12)}
                    layout="vertical"
                    margin={{ top: 0, right: 24, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F1F5F9" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: '#94A3B8' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={132}
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: unknown) => [`${Number(value).toFixed(1)} Qt`, 'Accepted + pending volume']}
                    />
                    <Bar dataKey="quintals" fill="#7C3AED" radius={[0, 6, 6, 0]} name="Volume" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-700">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800">
                      <th className={thClass} onClick={() => toggleSort('name')}>Supplier{sortIcon('name')}</th>
                      <th className={thClass} onClick={() => toggleSort('intakes')}>Intakes{sortIcon('intakes')}</th>
                      <th className={thClass} onClick={() => toggleSort('quintals')}>Volume (Qt){sortIcon('quintals')}</th>
                      <th className={thClass} onClick={() => toggleSort('acceptanceRate')}>
                        Acceptance rate{sortIcon('acceptanceRate')}
                      </th>
                      <th className={thClass} onClick={() => toggleSort('avgPrice')}>
                        Avg price / Qt{sortIcon('avgPrice')}
                      </th>
                      <th className={thClass} onClick={() => toggleSort('spendBirr')}>Spend{sortIcon('spendBirr')}</th>
                      <th className={thClass} onClick={() => toggleSort('rating')}>Rating{sortIcon('rating')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPerf.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-800 dark:text-slate-100">{r.name}</p>
                          <p className="text-xs text-slate-400 dark:text-slate-500">{r.type.replace(/_/g, ' ')}</p>
                        </td>
                        <td className="tnum px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{fmtInt(r.intakes)}</td>
                        <td className="tnum px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{fmtQ(r.quintals)}</td>
                        <td className="px-4 py-3">
                          {r.acceptanceRate === null ? (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          ) : (
                            <Badge tone={r.acceptanceRate >= 0.9 ? 'pass' : r.acceptanceRate >= 0.7 ? 'advisory' : 'critical'}>
                              {fmtPct(r.acceptanceRate * 100)}
                            </Badge>
                          )}
                        </td>
                        <td className="tnum px-4 py-3 font-medium text-slate-700 dark:text-slate-200">
                          {r.avgPrice === null ? <span className="text-slate-400 dark:text-slate-500">—</span> : fmtBirr(r.avgPrice)}
                        </td>
                        <td className="tnum px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{fmtBirr(r.spendBirr)}</td>
                        <td className="px-4 py-3">
                          {r.rating === null ? (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-200">
                              <Star size={13} className="fill-amber-400 text-amber-400" /> {r.rating.toFixed(1)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Wheat type mix ───────────────────────────────────────────────── */}
      {tab === 'wheat' && (
        <div className={`${cardShell} print-sheet`}>
          <SectionTitle
            title="Procurement by Wheat Type"
            sub="QC-accepted volume split across wheat categories"
            action={
              <Button variant="secondary" onClick={exportWheatCSV} className="no-print !px-4 !py-2 !text-sm">
                <Download size={15} /> CSV
              </Button>
            }
          />
          {wheatMixTotal <= 0 ? (
            <EmptyState title="No data for selected period" sub="No accepted intakes were recorded in this period." />
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="relative h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={wheatMix}
                      dataKey="quintals"
                      nameKey="label"
                      innerRadius={72}
                      outerRadius={112}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {wheatMix.map((m) => (
                        <Cell key={m.category} fill={CATEGORY_COLOR[m.category]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: unknown) => [`${Number(value).toFixed(1)} Qt`, 'Accepted volume']}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <p className="tnum text-2xl font-extrabold text-slate-900 dark:text-slate-100">{fmtQ(wheatMixTotal)}</p>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Qt accepted</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800">
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Wheat type
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Quintals
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Share
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {wheatMix.map((m) => (
                      <tr key={m.category} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
                            <span
                              className="inline-block h-3 w-3 rounded-full"
                              style={{ backgroundColor: CATEGORY_COLOR[m.category] }}
                            />
                            {m.label}
                          </span>
                        </td>
                        <td className="tnum px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-200">{fmtQ(m.quintals)}</td>
                        <td className="tnum px-4 py-3 text-right font-bold text-slate-900 dark:text-slate-100">{fmtPct(m.share * 100)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50/60">
                      <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">Total</td>
                      <td className="tnum px-4 py-3 text-right font-bold text-slate-900 dark:text-slate-100">{fmtQ(wheatMixTotal)}</td>
                      <td className="tnum px-4 py-3 text-right font-bold text-slate-900 dark:text-slate-100">100.0%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Price trends ─────────────────────────────────────────────────── */}
      {tab === 'price' && (
        <div className={`${cardShell} print-sheet`}>
          <SectionTitle
            title="Price Trends"
            sub="Weekly average purchase price per quintal from accepted intakes with AP invoices"
            action={
              <Button variant="secondary" onClick={exportPriceCSV} className="no-print !px-4 !py-2 !text-sm">
                <Download size={15} /> CSV
              </Button>
            }
          />
          {priceTrend.length === 0 ? (
            <EmptyState
              title="No data for selected period"
              sub="Price history needs accepted intakes with AP invoices in this period."
            />
          ) : (
            <>
              <div className="mb-6 h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={priceTrend} margin={{ top: 5, right: 16, left: -4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#94A3B8' }}
                      axisLine={false}
                      tickLine={false}
                      dy={6}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#94A3B8' }}
                      axisLine={false}
                      tickLine={false}
                      domain={['auto', 'auto']}
                      tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: unknown, name: unknown) => [
                        `ETB ${Number(value).toFixed(2)} / Qt`,
                        CATEGORY_LABEL[name as WheatCategory] ?? String(name)
                      ]}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="SOFT"
                      name="Soft wheat"
                      stroke={CATEGORY_COLOR.SOFT}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="HARD"
                      name="Hard wheat"
                      stroke={CATEGORY_COLOR.HARD}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="FOREIGN"
                      name="Foreign wheat"
                      stroke={CATEGORY_COLOR.FOREIGN}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-700">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800">
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Week of
                      </th>
                      {CATEGORIES.map((c) => (
                        <th
                          key={c}
                          className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                        >
                          {CATEGORY_LABEL[c]} (ETB/Qt)
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {priceTrend.map((p) => (
                      <tr key={p.week} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-100">{p.label}</td>
                        {CATEGORIES.map((c) => (
                          <td key={c} className="tnum px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-200">
                            {p[c] === null ? <span className="text-slate-400 dark:text-slate-500">—</span> : fmtBirr(p[c] as number)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Intake vs PO variance ────────────────────────────────────────── */}
      {tab === 'variance' && (
        <div className={`${cardShell} print-sheet`}>
          <SectionTitle
            title="Intake vs PO Variance"
            sub="Purchase orders created in the period — ordered versus received quantities"
            action={
              <Button variant="secondary" onClick={exportVarianceCSV} className="no-print !px-4 !py-2 !text-sm">
                <Download size={15} /> CSV
              </Button>
            }
          />
          {poVariance.length === 0 ? (
            <EmptyState title="No data for selected period" sub="No purchase orders were created in this period." />
          ) : (
            <>
              <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Total ordered</p>
                  <p className="tnum mt-1 text-xl font-extrabold text-slate-900 dark:text-slate-100">{fmtQ(varianceSummary.ordered)} Qt</p>
                </div>
                <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Total received</p>
                  <p className="tnum mt-1 text-xl font-extrabold text-slate-900 dark:text-slate-100">{fmtQ(varianceSummary.received)} Qt</p>
                </div>
                <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Fulfillment</p>
                  <p className="tnum mt-1 text-xl font-extrabold text-slate-900 dark:text-slate-100">
                    {varianceSummary.fulfillment === null ? '—' : fmtPct(varianceSummary.fulfillment * 100)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Under / over receipts</p>
                  <p className="tnum mt-1 text-xl font-extrabold text-slate-900 dark:text-slate-100">
                    <span className="text-red-600">{varianceSummary.under}</span>
                    <span className="text-slate-400 dark:text-slate-500"> / </span>
                    <span className="text-emerald-600">{varianceSummary.over}</span>
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-700">
                <table className="w-full min-w-[880px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800">
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">PO No</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Supplier</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Wheat</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Ordered (Qt)
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Received (Qt)
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Variance (Qt)
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Variance %
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poVariance.map((p) => (
                      <tr key={p.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-100">{p.poNo}</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{p.supplierName}</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{CATEGORY_LABEL[p.wheatCategory]}</td>
                        <td className="tnum px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-200">{fmtQ(p.ordered)}</td>
                        <td className="tnum px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-200">{fmtQ(p.received)}</td>
                        <td
                          className={`tnum px-4 py-3 text-right font-bold ${
                            p.varianceQ < -0.001 ? 'text-red-600' : p.varianceQ > 0.001 ? 'text-emerald-600' : 'text-slate-700'
                          }`}
                        >
                          {p.varianceQ > 0 ? '+' : ''}
                          {fmtQ(p.varianceQ)}
                        </td>
                        <td
                          className={`tnum px-4 py-3 text-right font-bold ${
                            p.variancePct !== null && p.variancePct < -0.05
                              ? 'text-red-600'
                              : p.variancePct !== null && p.variancePct > 0.05
                                ? 'text-emerald-600'
                                : 'text-slate-700'
                          }`}
                        >
                          {p.variancePct === null ? '—' : `${p.variancePct > 0 ? '+' : ''}${p.variancePct.toFixed(1)}%`}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={PO_TONE[p.status] ?? 'neutral'}>{p.status.replace(/_/g, ' ')}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                Summary totals exclude cancelled and draft purchase orders.
              </p>
            </>
          )}
        </div>
      )}

      {/* ── AP aging ─────────────────────────────────────────────────────── */}
      {tab === 'aging' && (
        <div className={`${cardShell} print-sheet`}>
          <SectionTitle
            title="AP Aging Summary"
            sub="Outstanding supplier payables by days past due date"
            action={
              <Button variant="secondary" onClick={exportAgingCSV} className="no-print !px-4 !py-2 !text-sm">
                <Download size={15} /> CSV
              </Button>
            }
          />
          {agingTotal <= 0 ? (
            <EmptyState title="No data for selected period" sub="No outstanding supplier payables for invoices issued in this period." />
          ) : (
            <>
              <div className="mb-6 h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={aging} margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#94A3B8' }}
                      axisLine={false}
                      tickLine={false}
                      dy={6}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#94A3B8' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `ETB ${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: unknown, name: unknown, props: unknown) => {
                        const count = (props as { payload?: { count?: number } })?.payload?.count ?? 0;
                        return [`${fmtBirr(Number(value))} · ${fmtInt(count)} invoices`, 'Outstanding'];
                      }}
                    />
                    <Bar dataKey="amount" radius={[6, 6, 0, 0]} name="Outstanding">
                      {aging.map((b) => (
                        <Cell key={b.key} fill={b.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800">
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Bucket
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Invoices
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Outstanding
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Share
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {aging.map((b) => (
                      <tr key={b.key} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
                            <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: b.color }} />
                            {b.label}
                          </span>
                        </td>
                        <td className="tnum px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-200">{fmtInt(b.count)}</td>
                        <td className="tnum px-4 py-3 text-right font-bold text-slate-900 dark:text-slate-100">{fmtBirr(b.amount)}</td>
                        <td className="tnum px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-200">
                          {agingTotal > 0 ? fmtPct((b.amount / agingTotal) * 100) : '—'}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50/60">
                      <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">Total outstanding</td>
                      <td className="tnum px-4 py-3 text-right font-bold text-slate-900 dark:text-slate-100">
                        {fmtInt(aging.reduce((s, b) => s + b.count, 0))}
                      </td>
                      <td className="tnum px-4 py-3 text-right font-bold text-slate-900 dark:text-slate-100">{fmtBirr(agingTotal)}</td>
                      <td className="tnum px-4 py-3 text-right font-bold text-slate-900 dark:text-slate-100">100.0%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                Invoices without a due date are aged from their issue date. Fully paid invoices are excluded.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
