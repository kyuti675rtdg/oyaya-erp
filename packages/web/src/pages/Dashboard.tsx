import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type {
  Capa,
  FlatKpis,
  LabCheck,
  ProductionBatch,
  ShiftRun,
  WheatIntake
} from '../types';
import { useAuth } from '../store/auth';
import { KpiCard } from '../components/KpiCard';
import { DonutChart } from '../components/charts/DonutChart';
import { SkeletonDashboard } from '../components/Skeleton';
import { ErrorBox } from '../components/ui';
import { fmtDate, fmtDateTime, fmtQ } from '../lib/format';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Local-calendar YYYY-MM-DD key (avoids UTC shift from toISOString). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function last7Days(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push({
      key: dayKey(d),
      label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    });
  }
  return out;
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function tankShort(code: string): string {
  const c = code.replace('TANK_', '');
  return c.length === 1 ? `Tank ${c}` : c;
}

function greetingForHour(h: number): string {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const INTAKE_PILL: Record<string, string> = {
  ACCEPTED: 'bg-pass-bg text-pass-text',
  PENDING_LAB: 'bg-advisory-bg text-advisory-text',
  FLAGGED: 'bg-critical-bg text-critical-text',
  REJECTED: 'bg-slate-100 text-slate-500'
};

const INTAKE_LABEL: Record<string, string> = {
  ACCEPTED: 'Accepted',
  PENDING_LAB: 'Pending Lab',
  FLAGGED: 'Flagged',
  REJECTED: 'Rejected'
};

function categoryLabel(c: string): string {
  return c === 'SOFT' ? 'Soft' : c === 'HARD' ? 'Hard' : c === 'FOREIGN' ? 'Foreign' : c;
}

const cardShell = 'rounded-xl border border-line bg-white p-5 shadow-sm';

// ─── Inline SVG icons ───────────────────────────────────────────────────────

const iconCls = 'h-6 w-6';

const WheatIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={iconCls}>
    <path d="M12 22V9" strokeLinecap="round" />
    <path d="M12 9C12 5.5 9.5 3 6 3c0 3.5 2.5 6 6 6zM12 9c0-3.5 2.5-6 6-6 0 3.5-2.5 6-6 6z" strokeLinejoin="round" />
    <path d="M12 14c0-3.5-2.5-6-6-6 0 3.5 2.5 6 6 6zM12 14c0-3.5 2.5-6 6-6 0 3.5-2.5 6-6 6z" strokeLinejoin="round" />
  </svg>
);

const SackIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={iconCls}>
    <path d="M9 3h6l1.5 3H7.5L9 3z" strokeLinejoin="round" />
    <path d="M7.5 6c-2 2-3 4.5-3 7a6 6 0 0012 0c0-2.5-1-5-3-7" strokeLinecap="round" />
    <path d="M9.5 12.5h5" strokeLinecap="round" />
  </svg>
);

const WarehouseIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={iconCls}>
    <path d="M3 10l9-6 9 6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 10v8h14v-8" strokeLinejoin="round" />
    <path d="M9 18v-5h6v5" strokeLinejoin="round" />
  </svg>
);

const LayersIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={iconCls}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" strokeLinejoin="round" />
    <path d="M3 13l9 5 9-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ShieldCheckIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={iconCls}>
    <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" strokeLinejoin="round" />
    <path d="M9 12l2.2 2.2L15.5 10" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const smCls = 'h-5 w-5';

const CartIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={smCls}>
    <path d="M3 4h2l2.4 12.2a1.5 1.5 0 001.5 1.2h8.6a1.5 1.5 0 001.5-1.2L21 8H6" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="9.5" cy="20" r="1.4" />
    <circle cx="17.5" cy="20" r="1.4" />
  </svg>
);

const FactoryIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={smCls}>
    <path d="M3 21V10l5 3v-3l5 3V7l8-2v16H3z" strokeLinejoin="round" />
    <path d="M7 17h2m2 0h2m2 0h2" strokeLinecap="round" />
  </svg>
);

const FlaskIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={smCls}>
    <path d="M10 3h4M10 3v6l-5.5 9.5A2 2 0 006.2 21h11.6a2 2 0 001.7-2.5L14 9V3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7.5 15h9" strokeLinecap="round" />
  </svg>
);

const ChartIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={smCls}>
    <path d="M4 20V4" strokeLinecap="round" />
    <path d="M4 20h16" strokeLinecap="round" />
    <path d="M8 16v-5m4 5V8m4 8v-3" strokeLinecap="round" />
  </svg>
);

const UsersIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={smCls}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3.5 20c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5" strokeLinecap="round" />
    <path d="M16 4.8a3.5 3.5 0 010 6.4M17.8 15.4c1.7.8 2.7 2.3 3 4.6" strokeLinecap="round" />
  </svg>
);

const BoxIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={smCls}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" strokeLinejoin="round" />
    <path d="M12 12l8-4.5M12 12L4 7.5M12 12v9" strokeLinejoin="round" />
  </svg>
);

const TruckIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={smCls}>
    <path d="M2 6h12v10H2zM14 10h4l4 4v2h-8" strokeLinejoin="round" />
    <circle cx="6.5" cy="18" r="1.8" />
    <circle cx="17.5" cy="18" r="1.8" />
  </svg>
);

const AlertSmIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={smCls}>
    <path d="M12 3L2.5 20h19L12 3z" strokeLinejoin="round" />
    <path d="M12 10v4" strokeLinecap="round" />
    <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
  </svg>
);

// ─── Inline SVG line/area chart (Production Overview) ────────────────────────

interface TrendPoint {
  label: string;
  wheat: number;
  flour: number;
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  const W = 640;
  const H = 250;
  const padL = 46;
  const padR = 14;
  const padT = 14;
  const padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxV = Math.max(1, ...data.map((d) => Math.max(d.wheat, d.flour)));
  const nice = Math.ceil(maxV / 100) * 100 || 100;
  const n = data.length;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (Math.min(v, nice) / nice) * innerH;

  const lineFor = (get: (d: TrendPoint) => number) =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(get(d)).toFixed(1)}`).join(' ');
  const areaFor = (get: (d: TrendPoint) => number) =>
    `${lineFor(get)} L${x(n - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => nice * f);
  const fmtTick = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${v}`);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Daily wheat received vs flour produced over the last 7 days"
      >
        <defs>
          <linearGradient id="trendFlourGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5B35D5" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#5B35D5" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="trendWheatGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.14} />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#E2E7F0" strokeWidth={1} />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#667085">
              {fmtTick(v)}
            </text>
          </g>
        ))}

        <path d={areaFor((d) => d.wheat)} fill="url(#trendWheatGrad)" />
        <path d={areaFor((d) => d.flour)} fill="url(#trendFlourGrad)" />
        <path d={lineFor((d) => d.wheat)} fill="none" stroke="#3B82F6" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <path d={lineFor((d) => d.flour)} fill="none" stroke="#5B35D5" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {data.map((d, i) => (
          <g key={d.label}>
            <circle cx={x(i)} cy={y(d.wheat)} r={3.5} fill="#3B82F6" stroke="#fff" strokeWidth={1.5}>
              <title>{`${d.label} — Wheat received: ${fmtQ(d.wheat)} Qt`}</title>
            </circle>
            <circle cx={x(i)} cy={y(d.flour)} r={3.5} fill="#5B35D5" stroke="#fff" strokeWidth={1.5}>
              <title>{`${d.label} — Flour produced: ${fmtQ(d.flour)} Qt`}</title>
            </circle>
            <text x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill="#667085" fontWeight={500}>
              {d.label}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-2 flex items-center justify-center gap-5 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#3B82F6]" />
          Wheat Received (Qt)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#5B35D5]" />
          Flour Produced (Qt)
        </span>
      </div>
    </div>
  );
}

// ─── Quick access tiles ─────────────────────────────────────────────────────

const QUICK_LINKS = [
  { to: '/intake', label: 'New Purchase Order', icon: CartIcon, tile: 'bg-violet-100 text-violet-700' },
  { to: '/batches', label: 'Create Production Batch', icon: FactoryIcon, tile: 'bg-blue-100 text-blue-700' },
  { to: '/qc', label: 'Record Lab Test', icon: FlaskIcon, tile: 'bg-emerald-100 text-emerald-700' },
  { to: '/finance', label: 'Generate Report', icon: ChartIcon, tile: 'bg-amber-100 text-amber-700' },
  { to: '/intake', label: 'Manage Suppliers', icon: UsersIcon, tile: 'bg-sky-100 text-sky-700' },
  { to: '/tanks', label: 'View Inventory', icon: BoxIcon, tile: 'bg-indigo-100 text-indigo-700' }
];

const DONUT_COLORS = ['#5B35D5', '#3B82F6', '#22C55E', '#F59E0B', '#14B8A6'];
const STOCK_COLORS = ['#5B35D5', '#3B82F6', '#22C55E', '#F59E0B'];

interface FeedItem {
  ts: number;
  title: string;
  sub: string;
  to: string;
  icon: React.ReactNode;
  tile: string;
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export function Dashboard() {
  const { user } = useAuth();
  const REFETCH = 60000;

  const kpisQ = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: async () => (await api.get<FlatKpis>(E.dashboardKpis)).data,
    refetchInterval: REFETCH
  });

  const intakesQ = useQuery({
    queryKey: ['dashboard-intakes'],
    queryFn: async () => (await api.get<WheatIntake[]>(`${E.intakes}?pageSize=100`)).data,
    refetchInterval: REFETCH
  });

  const batchesQ = useQuery({
    queryKey: ['dashboard-batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(`${E.batches}?pageSize=100`)).data,
    refetchInterval: REFETCH
  });

  const shiftsQ = useQuery({
    queryKey: ['dashboard-shifts'],
    queryFn: async () => (await api.get<ShiftRun[]>(E.shifts)).data,
    refetchInterval: REFETCH
  });

  // Shift outputs only come from the detail endpoint — fetch details for the
  // last 7 days of shifts (bounded, capped at 15) so flour figures stay real.
  const recentShiftIds = useMemo(() => {
    const list = Array.isArray(shiftsQ.data) ? shiftsQ.data : [];
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    return list
      .filter((s) => {
        const t = new Date(s.shiftDate ?? s.startedAt).getTime();
        return Number.isFinite(t) && t >= cutoff;
      })
      .slice(0, 15)
      .map((s) => s.id);
  }, [shiftsQ.data]);

  const shiftDetailsQ = useQuery({
    queryKey: ['dashboard-shift-details', recentShiftIds],
    queryFn: async () => {
      const rows = await Promise.all(recentShiftIds.map((id) => api.get<ShiftRun>(E.shift(id))));
      return rows.map((r) => r.data);
    },
    enabled: shiftsQ.isSuccess && recentShiftIds.length > 0,
    refetchInterval: REFETCH
  });

  const labChecksQ = useQuery({
    queryKey: ['dashboard-lab-checks'],
    queryFn: async () => (await api.get<LabCheck[]>(`${E.labChecks}?pageSize=20`)).data,
    refetchInterval: REFETCH
  });

  const capasQ = useQuery({
    queryKey: ['dashboard-capas'],
    queryFn: async () => (await api.get<Capa[]>(E.capas)).data,
    refetchInterval: REFETCH
  });

  const k = kpisQ.data;
  const intakes = useMemo(() => (Array.isArray(intakesQ.data) ? intakesQ.data : []), [intakesQ.data]);
  const batches = useMemo(() => (Array.isArray(batchesQ.data) ? batchesQ.data : []), [batchesQ.data]);
  const details = useMemo(
    () => (Array.isArray(shiftDetailsQ.data) ? shiftDetailsQ.data : []),
    [shiftDetailsQ.data]
  );
  const detailsReady = shiftsQ.isSuccess && (recentShiftIds.length === 0 || shiftDetailsQ.isSuccess);

  // ── KPIs (all real or honest "—") ──────────────────────────────────────────
  const wheatReceived = useMemo(
    () =>
      intakesQ.isSuccess
        ? intakes.filter((i) => i.status === 'ACCEPTED').reduce((s, i) => s + safeNum(i.quintals), 0)
        : null,
    [intakesQ.isSuccess, intakes]
  );

  const flourProduced = useMemo(
    () =>
      detailsReady
        ? details.reduce(
            (s, sh) => s + (sh.outputs ?? []).reduce((a, o) => a + safeNum(o.quintals), 0),
            0
          )
        : null,
    [detailsReady, details]
  );
  const hasFlourData =
    detailsReady && details.some((sh) => (sh.outputs ?? []).length > 0);

  const dryStock = k ? safeNum(k.dryPool.balanceQ) : null;

  const activeBatches = useMemo(
    () => (batchesQ.isSuccess ? batches.filter((b) => b.status === 'OPEN').length : null),
    [batchesQ.isSuccess, batches]
  );

  const qcPass = k && k.qcCompliancePct !== null && k.qcCompliancePct !== undefined ? k.qcCompliancePct : null;

  // ── Production overview: last-7-day series ─────────────────────────────────
  const trend = useMemo<TrendPoint[]>(() => {
    const days = last7Days();
    const byKey = new Map(days.map((d) => [d.key, { label: d.label, wheat: 0, flour: 0 } as TrendPoint]));
    if (intakesQ.isSuccess) {
      for (const i of intakes) {
        const t = new Date(i.deliveryDate).getTime();
        if (!Number.isFinite(t)) continue;
        const row = byKey.get(dayKey(new Date(t)));
        if (row) row.wheat += safeNum(i.quintals);
      }
    }
    for (const sh of details) {
      const t = new Date(sh.shiftDate ?? sh.startedAt).getTime();
      if (!Number.isFinite(t)) continue;
      const row = byKey.get(dayKey(new Date(t)));
      if (row) row.flour += (sh.outputs ?? []).reduce((a, o) => a + safeNum(o.quintals), 0);
    }
    return [...byKey.values()];
  }, [intakesQ.isSuccess, intakes, details]);
  const hasTrendData = trend.some((p) => p.wheat > 0 || p.flour > 0);

  // ── Product output donut (grouped by product name) ────────────────────────
  const productSegments = useMemo(() => {
    const byName = new Map<string, number>();
    for (const sh of details) {
      for (const o of sh.outputs ?? []) {
        const name = o.product?.name?.trim() || 'Unnamed product';
        byName.set(name, (byName.get(name) ?? 0) + safeNum(o.quintals));
      }
    }
    return [...byName.entries()]
      .map(([label, value], i) => ({ label, value, color: DONUT_COLORS[i % DONUT_COLORS.length] }))
      .sort((a, b) => b.value - a.value);
  }, [details]);
  const totalFlour = productSegments.reduce((s, seg) => s + seg.value, 0);

  // ── Stock level bars ───────────────────────────────────────────────────────
  const stockBars = useMemo(() => {
    if (!k) return [];
    const bars = [
      {
        label: 'Dry Storage',
        balance: safeNum(k.dryPool.balanceQ),
        capacity: safeNum(k.dryPool.capacityQ),
        color: STOCK_COLORS[0]
      },
      ...(k.tanks ?? []).map((t, i) => ({
        label: `${tankShort(t.code)} (Wet)`,
        balance: safeNum(t.levelQ),
        capacity: safeNum(t.capacityQ),
        color: STOCK_COLORS[(i + 1) % STOCK_COLORS.length]
      }))
    ];
    return bars;
  }, [k]);

  // ── Recent procurement (last 5 intakes) ────────────────────────────────────
  const recentIntakes = useMemo(
    () =>
      [...intakes]
        .sort((a, b) => new Date(b.deliveryDate).getTime() - new Date(a.deliveryDate).getTime())
        .slice(0, 5),
    [intakes]
  );

  // ── Activity feed (most recent 6 across sources) ───────────────────────────
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    const push = (tsRaw: string | null | undefined, item: Omit<FeedItem, 'ts'>) => {
      const ts = tsRaw ? new Date(tsRaw).getTime() : NaN;
      if (Number.isFinite(ts)) items.push({ ...item, ts });
    };

    const labChecks = Array.isArray(labChecksQ.data) ? labChecksQ.data : [];
    const capas = Array.isArray(capasQ.data) ? capasQ.data : [];

    const sortedIntakes = [...intakes].sort(
      (a, b) => new Date(b.deliveryDate).getTime() - new Date(a.deliveryDate).getTime()
    );
    for (const i of sortedIntakes.slice(0, 3)) {
      push(i.deliveryDate, {
        title: 'Wheat delivery received',
        sub: `${i.supplier?.name ?? 'Unknown supplier'} · ${fmtQ(i.quintals)} Qt · ${categoryLabel(i.wheatCategory)}`,
        to: '/intake',
        icon: TruckIcon,
        tile: 'bg-emerald-100 text-emerald-700'
      });
    }

    const sortedBatches = [...batches].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    for (const b of sortedBatches.slice(0, 2)) {
      push(b.createdAt, {
        title: 'Production batch created',
        sub: `Batch ${b.batchNo} · ${fmtQ(b.wheatWeighedQ)} Qt weighed`,
        to: `/batches/${b.id}`,
        icon: FactoryIcon,
        tile: 'bg-violet-100 text-violet-700'
      });
    }

    const sortedChecks = [...labChecks].sort(
      (a, b) => new Date(b.sampleTime).getTime() - new Date(a.sampleTime).getTime()
    );
    for (const c of sortedChecks.slice(0, 2)) {
      push(c.sampleTime, {
        title: 'Lab test recorded',
        sub:
          (c.outOfRange ?? []).length > 0
            ? `${c.outOfRange.length} parameter(s) out of range`
            : 'All parameters within range',
        to: '/qc',
        icon: FlaskIcon,
        tile: 'bg-blue-100 text-blue-700'
      });
    }

    const sortedCapas = [...capas].sort(
      (a, b) => new Date(b.dateIdentified).getTime() - new Date(a.dateIdentified).getTime()
    );
    for (const c of sortedCapas.slice(0, 2)) {
      push(c.dateIdentified, {
        title: `CAPA raised · ${c.capaNo}`,
        sub: c.issueDescription.length > 70 ? `${c.issueDescription.slice(0, 70)}…` : c.issueDescription,
        to: '/capa',
        icon: AlertSmIcon,
        tile: 'bg-amber-100 text-amber-700'
      });
    }

    return items.sort((a, b) => b.ts - a.ts).slice(0, 6);
  }, [intakes, batches, labChecksQ.data, capasQ.data]);

  if (kpisQ.isLoading) return <SkeletonDashboard />;
  if (kpisQ.isError)
    return (
      <ErrorBox
        message={kpisQ.error instanceof Error ? kpisQ.error.message : 'Could not load dashboard data.'}
        onRetry={() => kpisQ.refetch()}
      />
    );

  const firstName = (user?.name ?? '').split(' ')[0] || user?.email || 'there';
  const greeting = greetingForHour(new Date().getHours());

  const kpi = (value: React.ReactNode, noData: boolean, label: string) => ({
    value: noData ? <span className="text-slate-300">—</span> : value,
    label: noData ? `${label} · No data` : label
  });

  const wheatKpi = kpi(
    <>
      {fmtQ(wheatReceived)} <span className="text-xl font-bold text-slate-400">Qt</span>
    </>,
    wheatReceived === null,
    'Total Wheat Received'
  );
  const flourKpi = kpi(
    <>
      {fmtQ(flourProduced)} <span className="text-xl font-bold text-slate-400">Qt</span>
    </>,
    flourProduced === null || !hasFlourData,
    'Flour Produced'
  );
  const stockKpi = kpi(
    <>
      {fmtQ(dryStock)} <span className="text-xl font-bold text-slate-400">Qt</span>
    </>,
    dryStock === null,
    'Current Stock (Dry Storage)'
  );
  const batchKpi = kpi(
    <>
      {activeBatches} <span className="text-xl font-bold text-slate-400">Batches</span>
    </>,
    activeBatches === null,
    'Active Batches'
  );
  const qcKpi = kpi(<>{qcPass?.toFixed(1)}%</>, qcPass === null, 'Quality Pass Rate');

  return (
    <div className="space-y-6">
      {/* 1 — Welcome banner */}
      <div className={`${cardShell} animate-fade-in-up flex items-center justify-between gap-4 overflow-hidden`}>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink">Welcome back, {firstName}!</h1>
          <p className="mt-1 text-sm text-slate-500">
            {greeting} — here&rsquo;s what&rsquo;s happening at Oyaya Flour Mill today.
          </p>
        </div>
        <img
          src={`${import.meta.env.BASE_URL}login-bg.jpg`}
          alt="Wheat and flour"
          className="hidden h-24 w-56 shrink-0 rounded-xl object-cover md:block"
          loading="lazy"
        />
      </div>

      {/* 2 — KPI row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard index={0} icon={WheatIcon} tone="violet" label={wheatKpi.label} value={wheatKpi.value} />
        <KpiCard index={1} icon={SackIcon} tone="blue" label={flourKpi.label} value={flourKpi.value} />
        <KpiCard index={2} icon={WarehouseIcon} tone="green" label={stockKpi.label} value={stockKpi.value} />
        <KpiCard index={3} icon={LayersIcon} tone="amber" label={batchKpi.label} value={batchKpi.value} />
        <KpiCard index={4} icon={ShieldCheckIcon} tone="green" label={qcKpi.label} value={qcKpi.value} />
      </div>

      {/* 3 — Production overview + product output */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className={`${cardShell} animate-fade-in-up xl:col-span-2`} style={{ animationDelay: '120ms' }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">Production Overview</h2>
            <span className="rounded-full bg-lavender-bg px-3 py-1 text-xs font-semibold text-slate-500">
              Last 7 Days
            </span>
          </div>
          {!intakesQ.isSuccess && !detailsReady ? (
            <div className="py-12 text-center">
              <p className="font-semibold text-slate-700">No production data yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Wheat receipts and flour output will appear here once production data exists.
              </p>
            </div>
          ) : hasTrendData ? (
            <TrendChart data={trend} />
          ) : (
            <div className="py-12 text-center">
              <p className="font-semibold text-slate-700">No production data yet</p>
              <p className="mt-1 text-sm text-slate-500">
                No wheat receipts or flour output recorded in the last 7 days.
              </p>
            </div>
          )}
        </div>

        <div className={`${cardShell} animate-fade-in-up`} style={{ animationDelay: '180ms' }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">Product Output</h2>
            <span className="rounded-full bg-lavender-bg px-3 py-1 text-xs font-semibold text-slate-500">
              Last 7 Days
            </span>
          </div>
          {hasFlourData && totalFlour > 0 ? (
            <DonutChart
              segments={productSegments}
              centerValue={`${fmtQ(totalFlour)}`}
              centerLabel="Total flour (Qt)"
              size={180}
            />
          ) : (
            <div className="py-12 text-center">
              <p className="font-semibold text-slate-700">No product output data yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Flour output by product will appear here once shift outputs are recorded.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 4 — Quick access + stock levels + recent procurement */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Quick access */}
        <div className={`${cardShell} animate-fade-in-up`} style={{ animationDelay: '240ms' }}>
          <h2 className="mb-4 text-base font-bold text-ink">Quick Access</h2>
          <div className="grid grid-cols-3 gap-3">
            {QUICK_LINKS.map((q) => (
              <Link
                key={q.label}
                to={q.to}
                className="group flex flex-col items-center gap-2 rounded-xl border border-transparent p-3 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-line hover:bg-lavender-bg"
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${q.tile} transition-transform duration-200 group-hover:scale-110`}
                >
                  {q.icon}
                </span>
                <span className="text-xs font-semibold leading-tight text-slate-600">{q.label}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Stock levels */}
        <div className={`${cardShell} animate-fade-in-up`} style={{ animationDelay: '300ms' }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">Stock Levels</h2>
            <Link to="/tanks" className="text-xs font-semibold text-violet-primary hover:underline">
              View All
            </Link>
          </div>
          {stockBars.length === 0 ? (
            <div className="py-8 text-center">
              <p className="font-semibold text-slate-700">No stock data</p>
              <p className="mt-1 text-sm text-slate-500">Storage levels will appear here.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {stockBars.map((s) => {
                const pct = s.capacity > 0 ? Math.min(100, (s.balance / s.capacity) * 100) : 0;
                return (
                  <div key={s.label}>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">{s.label}</span>
                      <span className="font-medium tabular-nums text-slate-500">
                        {fmtQ(s.balance)} / {fmtQ(s.capacity)} Qt ·{' '}
                        <span className="font-bold text-ink">{pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, backgroundColor: s.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent procurement */}
        <div className={`${cardShell} animate-fade-in-up`} style={{ animationDelay: '360ms' }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">Recent Procurement</h2>
            <Link to="/intake" className="text-xs font-semibold text-violet-primary hover:underline">
              View All
            </Link>
          </div>
          {intakesQ.isLoading ? (
            <div className="space-y-2.5 py-2" role="status" aria-label="Loading procurement">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton-shimmer h-9 w-full rounded-lg" />
              ))}
            </div>
          ) : intakesQ.isError ? (
            <div className="py-8 text-center">
              <p className="font-semibold text-slate-700">Could not load procurement</p>
              <button
                type="button"
                onClick={() => intakesQ.refetch()}
                className="mt-2 text-sm font-semibold text-violet-primary hover:underline"
              >
                Retry
              </button>
            </div>
          ) : recentIntakes.length === 0 ? (
            <div className="py-8 text-center">
              <p className="font-semibold text-slate-700">No procurement yet</p>
              <p className="mt-1 text-sm text-slate-500">Recent wheat intakes will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                    <th className="pb-2 pr-3">Date</th>
                    <th className="pb-2 pr-3">Supplier</th>
                    <th className="pb-2 pr-3">Type</th>
                    <th className="pb-2 pr-3 text-right">Qty (Qt)</th>
                    <th className="pb-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentIntakes.map((i) => (
                    <tr key={i.id} className="border-b border-line/60 last:border-0 hover:bg-lavender-bg/60">
                      <td className="whitespace-nowrap py-2.5 pr-3 text-slate-600">{fmtDate(i.deliveryDate)}</td>
                      <td className="max-w-[140px] truncate py-2.5 pr-3 font-medium text-ink">
                        {i.supplier?.name ?? '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600">{categoryLabel(i.wheatCategory)}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-ink">
                        {fmtQ(i.quintals)}
                      </td>
                      <td className="py-2.5 text-right">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            INTAKE_PILL[i.status] ?? 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {INTAKE_LABEL[i.status] ?? i.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 5 — Recent activities */}
      <div className={`${cardShell} animate-fade-in-up`} style={{ animationDelay: '420ms' }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">Recent Activities</h2>
          <Link to="/batches" className="text-xs font-semibold text-violet-primary hover:underline">
            View All
          </Link>
        </div>
        {feed.length === 0 ? (
          <div className="py-8 text-center">
            <p className="font-semibold text-slate-700">No recent activity</p>
            <p className="mt-1 text-sm text-slate-500">
              Deliveries, lab tests, batches and CAPAs will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line/60">
            {feed.map((f, idx) => (
              <li key={`${f.to}-${f.ts}-${idx}`}>
                <Link
                  to={f.to}
                  className="flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-lavender-bg/70"
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${f.tile}`}
                  >
                    {f.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{f.title}</span>
                    <span className="block truncate text-xs text-slate-500">{f.sub}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-slate-400">
                    {fmtDateTime(new Date(f.ts).toISOString())}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
