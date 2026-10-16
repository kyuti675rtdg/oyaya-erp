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
import { fmtDate, fmtQ } from '../lib/format';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Local-calendar YYYY-MM-DD key (avoids UTC shift from toISOString). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lastNDays(n: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
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

/** Percent change; null when the base is zero/unknown. */
function pctChange(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

function tankShort(code: string): string {
  const c = code.replace('TANK_', '');
  return c.length === 1 ? `Tank ${c}` : c;
}

const INTAKE_PILL: Record<string, string> = {
  ACCEPTED: 'bg-emerald-100 text-emerald-700',
  PENDING_LAB: 'bg-amber-100 text-amber-700',
  FLAGGED: 'bg-red-100 text-red-600',
  REJECTED: 'bg-slate-100 text-slate-500'
};

const INTAKE_LABEL: Record<string, string> = {
  ACCEPTED: 'Received',
  PENDING_LAB: 'Pending',
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

const SunIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={iconCls}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" strokeLinecap="round" />
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

const CalendarSmIcon = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
    <rect x="3" y="4.5" width="14" height="12" rx="2" />
    <path d="M3 8.5h14M7 3v3M13 3v3" strokeLinecap="round" />
  </svg>
);

const ChevronDownSm = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
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
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxV = Math.max(1, ...data.map((d) => Math.max(d.wheat, d.flour)));
  const nice = Math.ceil(maxV / 300) * 300 || 300;
  const n = data.length;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (Math.min(v, nice) / nice) * innerH;

  const lineFor = (get: (d: TrendPoint) => number) =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(get(d)).toFixed(1)}`).join(' ');
  const areaFor = (get: (d: TrendPoint) => number) =>
    `${lineFor(get)} L${x(n - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => nice * f);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Daily wheat received vs flour produced over the last 7 days"
    >
      <defs>
        <linearGradient id="trendFlourGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5B35D5" stopOpacity={0.25} />
          <stop offset="100%" stopColor="#5B35D5" stopOpacity={0.03} />
        </linearGradient>
      </defs>

      {ticks.map((v) => (
        <g key={v}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#EDEFF5" strokeWidth={1} />
          <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#98A0B3">
            {v.toLocaleString('en-US')}
          </text>
        </g>
      ))}

      <path d={areaFor((d) => d.flour)} fill="url(#trendFlourGrad)" />
      <path d={lineFor((d) => d.wheat)} fill="none" stroke="#2563EB" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      <path d={lineFor((d) => d.flour)} fill="none" stroke="#5B35D5" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

      {data.map((d, i) => (
        <g key={d.label}>
          <circle cx={x(i)} cy={y(d.wheat)} r={3.5} fill="#2563EB" stroke="#fff" strokeWidth={1.5}>
            <title>{`${d.label} — Wheat received: ${fmtQ(d.wheat)} Qt`}</title>
          </circle>
          <circle cx={x(i)} cy={y(d.flour)} r={3.5} fill="#5B35D5" stroke="#fff" strokeWidth={1.5}>
            <title>{`${d.label} — Flour produced: ${fmtQ(d.flour)} Qt`}</title>
          </circle>
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#98A0B3">
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ─── Quality trend multi-line chart ─────────────────────────────────────────

interface QualityPoint {
  label: string;
  gluten: number | null;
  moisture: number | null;
  impurity: number | null;
}

const QLINES = [
  { key: 'gluten', color: '#22C55E', label: 'Gluten' },
  { key: 'moisture', color: '#2563EB', label: 'Moisture' },
  { key: 'impurity', color: '#F59E0B', label: 'Impurity' }
] as const;

function QualityTrendChart({ data }: { data: QualityPoint[] }) {
  const W = 560;
  const H = 230;
  const padL = 40;
  const padR = 10;
  const padT = 10;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = data.length;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (Math.min(100, Math.max(0, v)) / 100) * innerH;

  const lineFor = (key: 'gluten' | 'moisture' | 'impurity') => {
    const pts = data
      .map((d, i) => ({ v: d[key], i }))
      .filter((p) => p.v !== null) as { v: number; i: number }[];
    if (pts.length === 0) return '';
    return pts.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Quality parameters trend over the last 7 days"
    >
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#EDEFF5" strokeWidth={1} />
          <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#98A0B3">
            {v}%
          </text>
        </g>
      ))}
      {QLINES.map((l) => {
        const d = lineFor(l.key);
        if (!d) return null;
        return (
          <g key={l.key}>
            <path d={d} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {data.map((pt, i) =>
              pt[l.key] !== null ? (
                <circle key={i} cx={x(i)} cy={y(pt[l.key] as number)} r={3} fill={l.color} stroke="#fff" strokeWidth={1.5}>
                  <title>{`${pt.label} — ${l.label}: ${(pt[l.key] as number).toFixed(1)}%`}</title>
                </circle>
              ) : null
            )}
          </g>
        );
      })}
      {data.map((d, i) => (
        <text key={d.label} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="#98A0B3">
          {d.label}
        </text>
      ))}
    </svg>
  );
}

// ─── Quick access tiles ─────────────────────────────────────────────────────

const QUICK_LINKS = [
  { to: '/intake', label: 'New Purchase Order', icon: CartIcon, tile: 'bg-violet-100 text-violet-600' },
  { to: '/batches', label: 'Create Production Batch', icon: FactoryIcon, tile: 'bg-blue-100 text-blue-600' },
  { to: '/qc', label: 'Record Lab Test', icon: FlaskIcon, tile: 'bg-emerald-100 text-emerald-600' },
  { to: '/finance', label: 'Generate Report', icon: ChartIcon, tile: 'bg-amber-100 text-amber-600' },
  { to: '/intake', label: 'Manage Suppliers', icon: UsersIcon, tile: 'bg-sky-100 text-sky-600' },
  { to: '/tanks', label: 'View Inventory', icon: BoxIcon, tile: 'bg-indigo-100 text-indigo-600' }
];

const DONUT_COLORS = ['#5B35D5', '#2563EB', '#22C55E', '#F59E0B', '#14B8A6'];
const STOCK_COLORS = ['#5B35D5', '#2563EB', '#22C55E', '#F59E0B'];

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
  // last 35 days of shifts (bounded, capped at 25) for trends + monthly stats.
  const recentShiftIds = useMemo(() => {
    const list = Array.isArray(shiftsQ.data) ? shiftsQ.data : [];
    const cutoff = Date.now() - 35 * 24 * 3600 * 1000;
    return list
      .filter((s) => {
        const t = new Date(s.shiftDate ?? s.startedAt).getTime();
        return Number.isFinite(t) && t >= cutoff;
      })
      .slice(0, 25)
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
    queryFn: async () => (await api.get<LabCheck[]>(`${E.labChecks}?pageSize=50`)).data,
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

  const nowMs = Date.now();
  const weekAgoMs = nowMs - 7 * 24 * 3600 * 1000;
  const twoWeeksAgoMs = nowMs - 14 * 24 * 3600 * 1000;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartMs = monthStart.getTime();

  const shiftFlour = (sh: ShiftRun) => (sh.outputs ?? []).reduce((a, o) => a + safeNum(o.quintals), 0);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const wheatThisWeek = useMemo(
    () =>
      intakesQ.isSuccess
        ? intakes
            .filter((i) => {
              const t = new Date(i.deliveryDate).getTime();
              return i.status === 'ACCEPTED' && t >= weekAgoMs;
            })
            .reduce((s, i) => s + safeNum(i.quintals), 0)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intakesQ.isSuccess, intakes]
  );
  const wheatPrevWeek = useMemo(
    () =>
      intakesQ.isSuccess
        ? intakes
            .filter((i) => {
              const t = new Date(i.deliveryDate).getTime();
              return i.status === 'ACCEPTED' && t >= twoWeeksAgoMs && t < weekAgoMs;
            })
            .reduce((s, i) => s + safeNum(i.quintals), 0)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intakesQ.isSuccess, intakes]
  );

  const flourThisWeek = useMemo(
    () =>
      detailsReady
        ? details
            .filter((sh) => new Date(sh.shiftDate ?? sh.startedAt).getTime() >= weekAgoMs)
            .reduce((s, sh) => s + shiftFlour(sh), 0)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailsReady, details]
  );
  const flourPrevWeek = useMemo(
    () =>
      detailsReady
        ? details
            .filter((sh) => {
              const t = new Date(sh.shiftDate ?? sh.startedAt).getTime();
              return t >= twoWeeksAgoMs && t < weekAgoMs;
            })
            .reduce((s, sh) => s + shiftFlour(sh), 0)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailsReady, details]
  );
  const hasFlourData = detailsReady && details.some((sh) => (sh.outputs ?? []).length > 0);

  const dryStock = k ? safeNum(k.dryPool.balanceQ) : null;

  const activeBatches = useMemo(
    () => (batchesQ.isSuccess ? batches.filter((b) => b.status === 'OPEN').length : null),
    [batchesQ.isSuccess, batches]
  );

  const qcPass = k && k.qcCompliancePct !== null && k.qcCompliancePct !== undefined ? k.qcCompliancePct : null;

  const labChecks = useMemo(
    () => (Array.isArray(labChecksQ.data) ? labChecksQ.data : []),
    [labChecksQ.data]
  );
  const qcPassPrevWeek = useMemo(() => {
    if (!labChecksQ.isSuccess || labChecks.length === 0) return null;
    const prev = labChecks.filter((c) => {
      const t = new Date(c.sampleTime).getTime();
      return t >= twoWeeksAgoMs && t < weekAgoMs;
    });
    if (prev.length === 0) return null;
    const passed = prev.filter((c) => (c.outOfRange ?? []).length === 0).length;
    return (passed / prev.length) * 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labChecksQ.isSuccess, labChecks]);

  // ── Production overview: last-7-day series ─────────────────────────────────
  const trend = useMemo<TrendPoint[]>(() => {
    const days = lastNDays(7);
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
      if (row) row.flour += shiftFlour(sh);
    }
    return [...byKey.values()];
  }, [intakesQ.isSuccess, intakes, details]);
  const hasTrendData = trend.some((p) => p.wheat > 0 || p.flour > 0);

  // ── Product output donut (grouped by product name) ────────────────────────
  const productSegments = useMemo(() => {
    const byName = new Map<string, number>();
    for (const sh of details) {
      const t = new Date(sh.shiftDate ?? sh.startedAt).getTime();
      if (t < weekAgoMs) continue;
      for (const o of sh.outputs ?? []) {
        const name = o.product?.name?.trim() || 'Unnamed product';
        byName.set(name, (byName.get(name) ?? 0) + safeNum(o.quintals));
      }
    }
    const total = [...byName.values()].reduce((s, v) => s + v, 0);
    return [...byName.entries()]
      .map(([label, value], i) => ({
        label,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
        color: DONUT_COLORS[i % DONUT_COLORS.length]
      }))
      .sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details]);
  const totalFlourWeek = productSegments.reduce((s, seg) => s + seg.value, 0);

  // ── Production performance (this month) ────────────────────────────────────
  const perf = useMemo(() => {
    const monthShifts = details.filter((sh) => new Date(sh.shiftDate ?? sh.startedAt).getTime() >= monthStartMs);
    const flour = monthShifts.reduce((s, sh) => s + shiftFlour(sh), 0);
    const wheat = batchesQ.isSuccess
      ? batches
          .filter((b) => new Date(b.createdAt).getTime() >= monthStartMs)
          .reduce((s, b) => s + safeNum(b.wheatWeighedQ), 0)
      : 0;
    const duket = monthShifts.reduce(
      (s, sh) =>
        s +
        (sh.outputs ?? [])
          .filter((o) => (o.product?.name ?? '').toLowerCase().includes('duket'))
          .reduce((a, o) => a + safeNum(o.quintals), 0),
      0
    );
    let downMin = 0;
    let workMin = 0;
    for (const sh of monthShifts) {
      downMin += safeNum(sh.downtimeMin);
      const st = new Date(sh.startedAt).getTime();
      const en = sh.endedAt ? new Date(sh.endedAt).getTime() : NaN;
      if (Number.isFinite(st) && Number.isFinite(en) && en > st) workMin += (en - st) / 60000;
    }
    return {
      flour,
      extraction: wheat > 0 ? (flour / wheat) * 100 : null,
      duketYield: flour > 0 ? (duket / flour) * 100 : null,
      downtimePct: workMin > 0 ? (downMin / workMin) * 100 : null,
      hasData: monthShifts.length > 0 || flour > 0
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details, batchesQ.isSuccess, batches]);

  // ── Quality trend (last 7 days, daily averages) ────────────────────────────
  const qualityTrend = useMemo<QualityPoint[]>(() => {
    const days = lastNDays(7);
    return days.map((d) => {
      const checks = labChecks.filter((c) => dayKey(new Date(c.sampleTime)) === d.key);
      const avg = (get: (c: LabCheck) => number | null) => {
        const vals = checks.map(get).filter((v): v is number => v !== null && Number.isFinite(v));
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      };
      return {
        label: d.label,
        gluten: avg((c) => (c.wetGlutenPct !== null ? safeNum(c.wetGlutenPct) : null)),
        moisture: avg((c) => (c.flourMoisturePct !== null ? safeNum(c.flourMoisturePct) : null)),
        impurity: avg((c) => (c.impurityPct !== null ? safeNum(c.impurityPct) : null))
      };
    });
  }, [labChecks]);
  const hasQualityTrend = qualityTrend.some((p) => p.gluten !== null || p.moisture !== null || p.impurity !== null);

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
        tile: 'bg-emerald-100 text-emerald-600'
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
        tile: 'bg-violet-100 text-violet-600'
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
        tile: 'bg-blue-100 text-blue-600'
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
        tile: 'bg-amber-100 text-amber-600'
      });
    }

    return items.sort((a, b) => b.ts - a.ts).slice(0, 6);
  }, [intakes, batches, labChecks, capasQ.data]);

  // ── Relative time for feed ─────────────────────────────────────────────────
  const relTime = (ts: number) => {
    const diff = nowMs - ts;
    if (diff < 3600000) {
      const m = Math.max(1, Math.floor(diff / 60000));
      return `${m} min ago`;
    }
    if (diff < 86400000) {
      const d = new Date(ts);
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    const days = Math.floor(diff / 86400000);
    return days === 1 ? 'Yesterday' : `${days} days ago`;
  };

  if (kpisQ.isLoading) return <SkeletonDashboard />;
  if (kpisQ.isError)
    return (
      <ErrorBox
        message={kpisQ.error instanceof Error ? kpisQ.error.message : 'Could not load dashboard data.'}
        onRetry={() => kpisQ.refetch()}
      />
    );

  const firstName = (user?.name ?? '').split(' ')[0] || user?.email || 'there';

  const dash = (v: number | null, unit: string) =>
    v === null ? (
      <span className="text-slate-300">—</span>
    ) : (
      <>
        {fmtQ(v)} <span className="text-lg font-bold text-slate-400">{unit}</span>
      </>
    );

  const productionActive = (activeBatches ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* ── Row 1: Welcome banner + status cards ── */}
      <div className="grid grid-cols-12 gap-4">
        <div
          className="animate-fade-in-up relative col-span-12 overflow-hidden rounded-xl border border-line bg-white shadow-sm xl:col-span-8"
        >
          <img
            src={`${import.meta.env.BASE_URL}login-bg.jpg`}
            alt=""
            aria-hidden="true"
            className="absolute inset-y-0 right-0 h-full w-2/3 object-cover"
            loading="lazy"
          />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(90deg, #fff 30%, rgba(255,255,255,0.85) 55%, rgba(255,255,255,0) 100%)' }}
            aria-hidden="true"
          />
          <div className="relative p-6 md:p-7">
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">
              Welcome back, {firstName}!
            </h1>
            <p className="mt-1.5 max-w-md text-sm text-slate-500">
              Here&rsquo;s what&rsquo;s happening at Oyaya Flour Mill today.
            </p>
          </div>
        </div>

        <div className="col-span-12 grid grid-cols-2 gap-4 xl:col-span-4">
          <div className="animate-fade-in-up rounded-xl border border-line bg-white p-4 shadow-sm" style={{ animationDelay: '60ms' }}>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
                {SackIcon}
              </div>
              <div className="min-w-0">
                <p className={`truncate text-sm font-bold ${productionActive ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {productionActive ? 'Production Active' : 'Production Idle'}
                </p>
                <p className="truncate text-xs text-slate-500">
                  Main Mill · {activeBatches ?? '—'} open batch{(activeBatches ?? 0) === 1 ? '' : 'es'}
                </p>
              </div>
            </div>
          </div>
          <div className="animate-fade-in-up rounded-xl border border-line bg-white p-4 shadow-sm" style={{ animationDelay: '120ms' }}>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-500">
                {SunIcon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="tnum text-lg font-extrabold leading-tight text-ink">22°C</p>
                <p className="flex items-center gap-1 truncate text-xs text-slate-500">
                  Addis Ababa {ChevronDownSm}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 2: KPI cards ── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          index={0}
          icon={WheatIcon}
          tone="violet"
          label="Total Wheat Received"
          value={dash(wheatThisWeek, 'Qt')}
          trendPct={wheatThisWeek !== null && wheatPrevWeek !== null ? pctChange(wheatThisWeek, wheatPrevWeek) : null}
        />
        <KpiCard
          index={1}
          icon={SackIcon}
          tone="blue"
          label="Flour Produced"
          value={hasFlourData ? dash(flourThisWeek, 'Qt') : <span className="text-slate-300">—</span>}
          trendPct={hasFlourData && flourThisWeek !== null && flourPrevWeek !== null ? pctChange(flourThisWeek, flourPrevWeek) : null}
        />
        <KpiCard
          index={2}
          icon={WarehouseIcon}
          tone="green"
          label="Current Stock (Dry Storage)"
          value={dash(dryStock, 'Qt')}
        />
        <KpiCard
          index={3}
          icon={LayersIcon}
          tone="amber"
          label="Active Batches"
          value={
            activeBatches === null ? (
              <span className="text-slate-300">—</span>
            ) : (
              <>
                {activeBatches} <span className="text-lg font-bold text-slate-400">Batches</span>
              </>
            )
          }
        />
        <KpiCard
          index={4}
          icon={ShieldCheckIcon}
          tone="green"
          label="Quality Pass Rate"
          value={qcPass === null ? <span className="text-slate-300">—</span> : <>{qcPass.toFixed(1)}%</>}
          trendPct={qcPass !== null && qcPassPrevWeek !== null ? qcPass - qcPassPrevWeek : null}
        />
      </div>

      {/* ── Rows 3–4: charts + activities ── */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 grid grid-cols-12 gap-4 xl:col-span-9">
          {/* Production Overview */}
          <div className={`${cardShell} animate-fade-in-up col-span-12 xl:col-span-7`} style={{ animationDelay: '120ms' }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
                <span className="text-slate-400">{CalendarSmIcon}</span>
                Production Overview
              </h2>
              <div className="flex items-center gap-4">
                <div className="hidden items-center gap-3 text-xs font-medium text-slate-500 sm:flex">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#5B35D5]" />
                    Flour Produced (Qt)
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#2563EB]" />
                    Wheat Received (Qt)
                  </span>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-[#F7F8FC] px-2.5 py-1.5 text-xs font-semibold text-slate-600"
                >
                  {CalendarSmIcon} Last 7 Days {ChevronDownSm}
                </button>
              </div>
            </div>
            {hasTrendData ? (
              <TrendChart data={trend} />
            ) : (
              <div className="py-12 text-center">
                <p className="font-semibold text-slate-700">No production data yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  Wheat receipts and flour output will appear here once production data exists.
                </p>
              </div>
            )}
          </div>

          {/* Product Output donut */}
          <div className={`${cardShell} animate-fade-in-up col-span-12 xl:col-span-5`} style={{ animationDelay: '180ms' }}>
            <h2 className="mb-4 text-[15px] font-bold text-ink">Product Output (Today)</h2>
            {hasFlourData && totalFlourWeek > 0 ? (
              <div className="flex items-center gap-2">
                <DonutChart
                  segments={productSegments}
                  centerValue={fmtQ(totalFlourWeek)}
                  centerLabel="Total Flour"
                  size={150}
                  hideLegend
                />
                <div className="min-w-0 flex-1 space-y-2">
                  {productSegments.map((s) => (
                    <div key={s.label} className="flex items-center gap-2 text-xs">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-600">{s.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-800">{fmtQ(s.value)} Qt</span>
                      <span className="w-11 shrink-0 text-right tabular-nums text-slate-400">
                        {s.pct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-12 text-center">
                <p className="font-semibold text-slate-700">No product output data yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  Flour output by product will appear here once shift outputs are recorded.
                </p>
              </div>
            )}
          </div>

          {/* Quick Access */}
          <div className={`${cardShell} animate-fade-in-up col-span-12 sm:col-span-6 xl:col-span-4`} style={{ animationDelay: '240ms' }}>
            <h2 className="mb-4 text-[15px] font-bold text-ink">Quick Access</h2>
            <div className="grid grid-cols-3 gap-2.5">
              {QUICK_LINKS.map((q) => (
                <Link
                  key={q.label}
                  to={q.to}
                  className="group flex flex-col items-center gap-2 rounded-xl bg-[#F7F8FC] p-3 text-center transition-colors hover:bg-violet-50"
                >
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${q.tile}`}>
                    {q.icon}
                  </span>
                  <span className="text-[11px] font-semibold leading-tight text-slate-600">{q.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Stock Levels */}
          <div className={`${cardShell} animate-fade-in-up col-span-12 sm:col-span-6 xl:col-span-4`} style={{ animationDelay: '300ms' }}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-ink">Stock Levels</h2>
              <Link to="/tanks" className="text-xs font-semibold text-[#5B35D5] hover:underline">
                View All
              </Link>
            </div>
            {stockBars.length === 0 ? (
              <div className="py-8 text-center">
                <p className="font-semibold text-slate-700">No stock data</p>
                <p className="mt-1 text-sm text-slate-500">Storage levels will appear here.</p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {stockBars.map((s) => {
                  const pct = s.capacity > 0 ? Math.min(100, (s.balance / s.capacity) * 100) : 0;
                  return (
                    <div key={s.label}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">{s.label}</span>
                        <span className="font-medium tabular-nums text-slate-500">
                          {fmtQ(s.balance)} / {fmtQ(s.capacity)} Qt
                          <span className="ml-2 font-bold text-ink">{pct.toFixed(0)}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
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

          {/* Recent Procurement */}
          <div className={`${cardShell} animate-fade-in-up col-span-12 xl:col-span-4`} style={{ animationDelay: '360ms' }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-ink">Recent Procurement</h2>
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
                  className="mt-2 text-sm font-semibold text-[#5B35D5] hover:underline"
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
                <table className="w-full min-w-[380px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold text-slate-400">
                      <th className="pb-2 pr-2 font-medium">Date</th>
                      <th className="pb-2 pr-2 font-medium">Supplier</th>
                      <th className="pb-2 pr-2 font-medium">Wheat Type</th>
                      <th className="pb-2 pr-2 text-right font-medium">Qty (Qt)</th>
                      <th className="pb-2 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentIntakes.map((i) => (
                      <tr key={i.id} className="border-t border-line/60 hover:bg-[#F7F8FC]">
                        <td className="whitespace-nowrap py-2.5 pr-2 text-xs text-slate-500">{fmtDate(i.deliveryDate)}</td>
                        <td className="max-w-[110px] truncate py-2.5 pr-2 text-xs font-medium text-ink">
                          {i.supplier?.name ?? '—'}
                        </td>
                        <td className="py-2.5 pr-2 text-xs text-slate-500">{categoryLabel(i.wheatCategory)}</td>
                        <td className="py-2.5 pr-2 text-right text-xs font-semibold tabular-nums text-ink">
                          {fmtQ(i.quintals)}
                        </td>
                        <td className="py-2.5 text-right">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
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

        {/* Recent Activities — tall right column */}
        <div className={`${cardShell} animate-fade-in-up col-span-12 xl:col-span-3`} style={{ animationDelay: '200ms' }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-ink">Recent Activities</h2>
            <Link to="/batches" className="text-xs font-semibold text-[#5B35D5] hover:underline">
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
            <ul className="space-y-1">
              {feed.map((f, idx) => (
                <li key={`${f.to}-${f.ts}-${idx}`}>
                  <Link
                    to={f.to}
                    className="flex items-start gap-3 rounded-lg px-1 py-2.5 transition-colors hover:bg-[#F7F8FC]"
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${f.tile}`}>
                      {f.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink">{f.title}</span>
                      <span className="block truncate text-xs text-slate-500">{f.sub}</span>
                    </span>
                    <span className="shrink-0 pt-0.5 text-[11px] text-slate-400">{relTime(f.ts)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Row 5: Performance + Quality trend + Promo ── */}
      <div className="grid grid-cols-12 gap-4">
        {/* Production Performance */}
        <div className={`${cardShell} animate-fade-in-up col-span-12 xl:col-span-4`} style={{ animationDelay: '420ms' }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-ink">Production Performance</h2>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-[#F7F8FC] px-2.5 py-1.5 text-xs font-semibold text-slate-600"
            >
              This Month {ChevronDownSm}
            </button>
          </div>
          {!perf.hasData ? (
            <div className="py-8 text-center">
              <p className="font-semibold text-slate-700">No production data this month</p>
              <p className="mt-1 text-sm text-slate-500">Monthly performance will appear here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-[#F7F8FC] p-3.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  {SackIcon}
                </div>
                <p className="mt-2 text-xs text-slate-500">Total Production</p>
                <p className="tnum text-lg font-extrabold text-ink">{fmtQ(perf.flour)} Qt</p>
              </div>
              <div className="rounded-xl bg-[#F7F8FC] p-3.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                  {ChartIcon}
                </div>
                <p className="mt-2 text-xs text-slate-500">Extraction Rate</p>
                <p className="tnum text-lg font-extrabold text-ink">
                  {perf.extraction !== null ? `${perf.extraction.toFixed(1)}%` : '—'}
                </p>
              </div>
              <div className="rounded-xl bg-[#F7F8FC] p-3.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-500">
                  {SunIcon}
                </div>
                <p className="mt-2 text-xs text-slate-500">Duket Yield</p>
                <p className="tnum text-lg font-extrabold text-ink">
                  {perf.duketYield !== null ? `${perf.duketYield.toFixed(1)}%` : '—'}
                </p>
              </div>
              <div className="rounded-xl bg-[#F7F8FC] p-3.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-100 text-red-500">
                  {AlertSmIcon}
                </div>
                <p className="mt-2 text-xs text-slate-500">Downtime</p>
                <p className="tnum text-lg font-extrabold text-ink">
                  {perf.downtimePct !== null ? `${perf.downtimePct.toFixed(1)}%` : '—'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Quality Trend */}
        <div className={`${cardShell} animate-fade-in-up col-span-12 xl:col-span-5`} style={{ animationDelay: '480ms' }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-ink">Quality Trend</h2>
            <div className="flex items-center gap-4">
              <div className="hidden items-center gap-3 text-xs font-medium text-slate-500 sm:flex">
                {QLINES.map((l) => (
                  <span key={l.key} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
                    {l.label}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-[#F7F8FC] px-2.5 py-1.5 text-xs font-semibold text-slate-600"
              >
                {CalendarSmIcon} Last 7 Days {ChevronDownSm}
              </button>
            </div>
          </div>
          {hasQualityTrend ? (
            <QualityTrendChart data={qualityTrend} />
          ) : (
            <div className="py-12 text-center">
              <p className="font-semibold text-slate-700">No quality data yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Lab test trends will appear here once quality checks are recorded.
              </p>
            </div>
          )}
        </div>

        {/* Promo card */}
        <div
          className="animate-fade-in-up relative col-span-12 overflow-hidden rounded-xl shadow-sm xl:col-span-3"
          style={{ animationDelay: '540ms' }}
        >
          <img
            src={`${import.meta.env.BASE_URL}login-bg.jpg`}
            alt="Wheat and flour"
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.55) 45%, rgba(0,0,0,0.15) 100%)' }}
            aria-hidden="true"
          />
          <div className="relative flex h-full min-h-[220px] flex-col p-5">
            <p className="text-xs font-medium text-slate-500">Oyaya Flour Mill</p>
            <h3 className="mt-2 text-xl font-extrabold leading-tight text-ink">
              Premium Quality Flour
            </h3>
            <p className="mt-1 text-sm text-slate-600">From our mill to your table.</p>
            <div className="mt-auto pt-4">
              <Link
                to="/sales"
                className="inline-flex items-center gap-2 rounded-lg bg-[#5B35D5] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#4a2bb5]"
              >
                View Products
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
                  <path d="M4 10h12m0 0l-4-4m4 4l-4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
