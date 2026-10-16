import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
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
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Container,
  CreditCard,
  Droplets,
  Factory,
  FlaskConical,
  Package,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  Sun,
  Truck,
  Users,
  Warehouse,
  Wheat
} from 'lucide-react';
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
import { SkeletonDashboard } from '../components/Skeleton';
import { fmtDate, fmtQ } from '../lib/format';
import {
  SEED_ACTIVITIES,
  SEED_KPIS,
  SEED_PERFORMANCE,
  SEED_PROCUREMENT,
  SEED_PRODUCT_LINES,
  SEED_PRODUCT_OUTPUT,
  SEED_PRODUCTION_CHART,
  SEED_QUALITY_TREND,
  SEED_STOCK_LEVELS,
  SEED_TOTAL_FLOUR
} from '../data/dashboardSeed';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function categoryLabel(c: string): string {
  return c === 'SOFT' ? 'Soft' : c === 'HARD' ? 'Hard' : c === 'FOREIGN' ? 'Foreign' : c;
}

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

function DemoBadge() {
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
      Demo
    </span>
  );
}

function TrendText({ pct, invert = false }: { pct: number | null; invert?: boolean }) {
  if (pct === null || !Number.isFinite(pct)) return null;
  const up = pct >= 0;
  const good = invert ? !up : up;
  const flat = pct === 0;
  return (
    <span
      className={`font-bold tabular-nums ${flat ? 'text-slate-500' : good ? 'text-emerald-600' : 'text-rose-500'}`}
    >
      {flat ? '→' : up ? '↑' : '↓'} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────

interface KpiSpec {
  icon: React.ReactNode;
  iconTone: string;
  label: string;
  value: string;
  unit: string;
  trendPct: number | null;
  demo: boolean;
}

function KpiCard({ spec }: { spec: KpiSpec }) {
  return (
    <div
      className={`${cardShell} flex flex-col justify-between transition-all hover:border-slate-200`}
    >
      <div className="flex items-start gap-3.5">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${spec.iconTone}`}>
          {spec.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-medium text-slate-500">{spec.label}</p>
            {spec.demo ? <DemoBadge /> : null}
          </div>
          <p className="mt-1 truncate text-2xl font-extrabold tabular-nums text-slate-900">
            {spec.value} <span className="text-sm font-semibold text-slate-500">{spec.unit}</span>
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1 text-xs">
        <TrendText pct={spec.trendPct} />
        <span className="text-[11px] text-slate-400">vs. last week</span>
      </div>
    </div>
  );
}

// ─── Row 1: Hero ────────────────────────────────────────────────────────────

function WelcomeBanner({ firstName }: { firstName: string }) {
  return (
    <div
      className={`${cardShell} relative col-span-12 flex min-h-[110px] flex-col justify-center overflow-hidden !p-6 lg:col-span-7`}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 90% at 88% 50%, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0.05) 45%, transparent 70%), linear-gradient(90deg, #F8FAFC 0%, #FEF9EC 55%, #FFFDF7 100%)'
        }}
        aria-hidden="true"
      />
      <svg
        className="pointer-events-none absolute -right-6 top-1/2 h-40 w-40 -translate-y-1/2 text-amber-200/40"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 22V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M12 9C12 5.5 9.5 3 6 3c0 3.5 2.5 6 6 6zM12 9c0-3.5 2.5-6 6-6 0 3.5-2.5 6-6 6zM12 14c0-3.5-2.5-6-6-6 0 3.5 2.5 6 6 6zM12 14c0-3.5 2.5-6 6-6 0 3.5-2.5 6-6 6z" />
      </svg>
      <div className="relative">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          Welcome back, {firstName}!
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Here&rsquo;s what&rsquo;s happening at Oyaya Flour Mill today.
        </p>
      </div>
    </div>
  );
}

function ProductionStatusCard({ activeBatches, demo }: { activeBatches: number | null; demo: boolean }) {
  const active = (activeBatches ?? 0) > 0;
  return (
    <Link
      to="/production"
      className={`${cardShell} col-span-12 flex items-center gap-4 !p-5 transition-all hover:border-slate-200 sm:col-span-6 lg:col-span-3`}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white shadow-md shadow-violet-200">
        <Package size={22} strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-800">
          Production{' '}
          <span className={`font-extrabold ${active ? 'text-emerald-600' : 'text-slate-400'}`}>
            {demo ? 'Active' : active ? 'Active' : 'Idle'}
          </span>
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          Main Mill • Shift 1 (06:00 - 14:00)
        </p>
      </div>
    </Link>
  );
}

function WeatherCard() {
  return (
    <div
      className={`${cardShell} col-span-12 flex items-center justify-between !p-5 sm:col-span-6 lg:col-span-2`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-500">
          <Sun size={20} strokeWidth={2} />
        </div>
        <div>
          <p className="text-lg font-extrabold tabular-nums text-slate-800">22°C</p>
          <p className="text-xs text-slate-500">Addis Ababa</p>
        </div>
      </div>
      <ChevronDown size={16} className="text-slate-400" />
    </div>
  );
}

// ─── Row 3: Production overview (recharts) ──────────────────────────────────

interface ProdPoint {
  name: string;
  wheat: number;
  flour: number;
}

function ProductionOverview({
  data,
  demo
}: {
  data: ProdPoint[];
  demo: boolean;
}) {
  return (
    <div className={`${cardShell} col-span-12 lg:col-span-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">Production Overview</h2>
          {demo ? <DemoBadge /> : null}
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 text-xs font-medium text-slate-600 sm:flex">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#7C3AED]" />
              Flour Produced (Qt)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0EA5E9]" />
              Wheat Received (Qt)
            </span>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600"
          >
            Last 7 Days <ChevronDown size={14} />
          </button>
        </div>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="flourGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#7C3AED" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: '#94A3B8' }}
              axisLine={false}
              tickLine={false}
              dy={6}
            />
            <YAxis
              ticks={[0, 300, 600, 900, 1200, 1500]}
              domain={[0, 1500]}
              tick={{ fontSize: 11, fill: '#94A3B8' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: '1px solid #E2E8F0',
                fontSize: 12,
                boxShadow: '0 4px 16px rgba(15,23,42,0.08)'
              }}
              formatter={(value: unknown, name: unknown) => [
                `${Number(value).toLocaleString('en-US')} Qt`,
                name === 'wheat' ? 'Wheat Received' : 'Flour Produced'
              ]}
            />
            <Area
              type="monotone"
              dataKey="wheat"
              stroke="#0EA5E9"
              strokeWidth={2}
              fill="none"
              fillOpacity={0}
              dot={{ r: 3.5, fill: '#0EA5E9', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
            <Area
              type="monotone"
              dataKey="flour"
              stroke="#7C3AED"
              strokeWidth={2}
              fill="url(#flourGrad)"
              dot={{ r: 3.5, fill: '#7C3AED', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Row 3: Product output donut (recharts) ─────────────────────────────────

interface DonutSeg {
  name: string;
  value: number;
  pct: number;
  color: string;
}

function ProductOutputDonut({
  segments,
  total,
  demo
}: {
  segments: DonutSeg[];
  total: number;
  demo: boolean;
}) {
  return (
    <div className={`${cardShell} col-span-12 md:col-span-6 lg:col-span-4`}>
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-bold text-slate-800">Product Output (Today)</h2>
        {demo ? <DemoBadge /> : null}
      </div>
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="relative col-span-5 flex h-48 items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={segments}
                dataKey="value"
                nameKey="name"
                innerRadius={52}
                outerRadius={74}
                paddingAngle={2}
                strokeWidth={0}
              >
                {segments.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid #E2E8F0',
                  fontSize: 12
                }}
                formatter={(value: unknown) => `${Number(value).toLocaleString('en-US')} Qt`}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-lg font-extrabold tabular-nums text-slate-900">
              {total.toLocaleString('en-US')} Qt
            </p>
            <p className="text-[11px] font-medium text-slate-400">Total Flour</p>
          </div>
        </div>
        <div className="col-span-7 space-y-2.5">
          {segments.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between border-b border-slate-50 pb-1.5 text-xs last:border-0"
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="truncate font-medium text-slate-600">{s.name}</span>
              </span>
              <span className="ml-2 shrink-0">
                <span className="font-bold tabular-nums text-slate-800">
                  {s.value.toLocaleString('en-US')} Qt
                </span>{' '}
                <span className="tabular-nums text-slate-400">{s.pct.toFixed(1)}%</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Row 3: Recent activities ───────────────────────────────────────────────

interface ActivityItem {
  title: string;
  sub: string;
  time: string;
  icon: React.ReactNode;
  tile: string;
  to: string;
}

function RecentActivities({ items, demo }: { items: ActivityItem[]; demo: boolean }) {
  return (
    <div className={`${cardShell} col-span-12 flex flex-col justify-between md:col-span-6 lg:col-span-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">Recent Activities</h2>
          {demo ? <DemoBadge /> : null}
        </div>
        <Link to="/audit" className="text-xs font-semibold text-violet-600 hover:text-violet-700">
          View All
        </Link>
      </div>
      <ul className="mt-3 space-y-3.5">
        {items.map((a, i) => (
          <li key={`${a.title}-${i}`}>
            <Link to={a.to} className="flex items-start gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${a.tile}`}>
                {a.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-slate-800">{a.title}</span>
                <span className="block truncate text-xs text-slate-500">{a.sub}</span>
              </span>
              <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-slate-400">{a.time}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Row 4: Quick access ────────────────────────────────────────────────────

const QUICK_LINKS = [
  { to: '/intake', label: 'New Purchase Order', icon: <ShoppingCart size={20} />, tone: 'bg-violet-50/80 hover:bg-violet-100/80 text-violet-700' },
  { to: '/batches', label: 'Create Production Batch', icon: <Factory size={20} />, tone: 'bg-sky-50/80 hover:bg-sky-100/80 text-sky-700' },
  { to: '/qc', label: 'Record Lab Test', icon: <FlaskConical size={20} />, tone: 'bg-emerald-50/80 hover:bg-emerald-100/80 text-emerald-700' },
  { to: '/reports', label: 'Generate Report', icon: <BarChart3 size={20} />, tone: 'bg-amber-50/80 hover:bg-amber-100/80 text-amber-700' },
  { to: '/intake', label: 'Manage Suppliers', icon: <Users size={20} />, tone: 'bg-teal-50/80 hover:bg-teal-100/80 text-teal-700' },
  { to: '/storage', label: 'View Inventory', icon: <Boxes size={20} />, tone: 'bg-purple-50/80 hover:bg-purple-100/80 text-purple-700' }
];

function QuickAccess() {
  return (
    <div className={`${cardShell} col-span-12 md:col-span-6 lg:col-span-3`}>
      <h2 className="mb-4 text-sm font-bold text-slate-800">Quick Access</h2>
      <div className="grid grid-cols-3 gap-2.5">
        {QUICK_LINKS.map((q) => (
          <Link
            key={q.label}
            to={q.to}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl p-3 text-center transition-all hover:-translate-y-0.5 hover:shadow-md ${q.tone}`}
          >
            {q.icon}
            <span className="text-[11px] font-semibold leading-tight">{q.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Row 4: Stock levels ────────────────────────────────────────────────────

interface StockRow {
  label: string;
  balance: number;
  capacity: number;
  color: string;
  tile: string;
}

function StockLevels({ rows, demo }: { rows: StockRow[]; demo: boolean }) {
  return (
    <div className={`${cardShell} col-span-12 md:col-span-6 lg:col-span-4`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">Stock Levels</h2>
          {demo ? <DemoBadge /> : null}
        </div>
        <Link to="/storage" className="text-xs font-semibold text-violet-600 hover:text-violet-700">
          View All
        </Link>
      </div>
      <div className="mt-3 space-y-3.5">
        {rows.map((r) => {
          const pct = r.capacity > 0 ? Math.min(100, (r.balance / r.capacity) * 100) : 0;
          return (
            <div key={r.label} className="flex items-center gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${r.tile}`}>
                <Warehouse size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">{r.label}</span>
                  <span className="tabular-nums text-slate-500">
                    <span className="font-bold text-slate-800">{r.balance.toLocaleString('en-US')}</span>
                    {' / '}
                    {r.capacity.toLocaleString('en-US')} Qt
                    <span className="ml-2 font-bold text-slate-800">{pct.toFixed(0)}%</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: r.color }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Row 4: Recent procurement ──────────────────────────────────────────────

interface ProcRow {
  date: string;
  supplier: string;
  wheatType: string;
  qty: number;
  status: 'Received' | 'Pending' | string;
}

function RecentProcurement({ rows, demo }: { rows: ProcRow[]; demo: boolean }) {
  return (
    <div className={`${cardShell} col-span-12 lg:col-span-5`}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-bold text-slate-800">Recent Procurement</h2>
        {demo ? <DemoBadge /> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50/70">
              {['Date', 'Supplier', 'Wheat Type', 'Qty (Qt)', 'Status'].map((h) => (
                <th
                  key={h}
                  className="px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map((r, i) => (
              <tr key={`${r.supplier}-${i}`} className="transition-colors hover:bg-slate-50/60">
                <td className="whitespace-nowrap px-2.5 py-2.5 text-xs tabular-nums text-slate-500">
                  {r.date}
                </td>
                <td className="max-w-[150px] truncate px-2.5 py-2.5 text-xs font-semibold text-slate-700">
                  {r.supplier}
                </td>
                <td className="px-2.5 py-2.5 text-xs text-slate-500">{r.wheatType}</td>
                <td className="px-2.5 py-2.5 text-xs font-semibold tabular-nums text-slate-700">
                  {r.qty.toLocaleString('en-US')}
                </td>
                <td className="px-2.5 py-2.5">
                  <span
                    className={`inline-flex rounded-md px-2.5 py-0.5 text-[11px] font-semibold ${
                      r.status === 'Received'
                        ? 'bg-emerald-50 text-emerald-600'
                        : r.status === 'Pending'
                          ? 'bg-amber-50 text-amber-600'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Row 5: Production performance ──────────────────────────────────────────

interface PerfTile {
  label: string;
  value: string;
  trendPct: number | null;
  invert?: boolean;
  icon: React.ReactNode;
  tile: string;
  alert?: boolean;
}

function ProductionPerformance({ tiles, demo }: { tiles: PerfTile[]; demo: boolean }) {
  return (
    <div className={`${cardShell} col-span-12 lg:col-span-5`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">Production Performance</h2>
          {demo ? <DemoBadge /> : null}
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600"
        >
          This Month <ChevronDown size={14} />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-full ${t.tile}`}>
              {t.icon}
            </div>
            <p className="mt-2 text-xs text-slate-500">{t.label}</p>
            <p className={`text-lg font-extrabold tabular-nums ${t.alert ? 'text-rose-600' : 'text-slate-900'}`}>
              {t.value}
            </p>
            <p className="mt-0.5 text-xs">
              <TrendText pct={t.trendPct} invert={t.invert} />
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Row 5: Quality trend (recharts) ────────────────────────────────────────

interface QualityPoint {
  label: string;
  gluten: number | null;
  moisture: number | null;
  impurity: number | null;
  hectoliter?: number | null;
}

const Q_LINES = [
  { key: 'gluten', label: 'Gluten', color: '#10B981' },
  { key: 'moisture', label: 'Moisture', color: '#3B82F6' },
  { key: 'impurity', label: 'Impurity', color: '#7C3AED' },
  { key: 'hectoliter', label: 'Hectoliter Weight', color: '#F59E0B' }
] as const;

function qVal(p: QualityPoint, key: (typeof Q_LINES)[number]['key']): number | null {
  switch (key) {
    case 'gluten':
      return p.gluten;
    case 'moisture':
      return p.moisture;
    case 'impurity':
      return p.impurity;
    case 'hectoliter':
      return p.hectoliter ?? null;
  }
}

function QualityTrendChart({ data, demo }: { data: QualityPoint[]; demo: boolean }) {
  const visible = Q_LINES.filter((l) => data.some((p) => qVal(p, l.key) != null));
  return (
    <div className={`${cardShell} col-span-12 md:col-span-7 lg:col-span-4`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">Quality Trend</h2>
          {demo ? <DemoBadge /> : null}
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600"
        >
          Last 7 Days <ChevronDown size={14} />
        </button>
      </div>
      <div className="my-2 flex flex-wrap gap-3 text-[11px] font-medium text-slate-600">
        {visible.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#94A3B8' }}
              axisLine={false}
              tickLine={false}
              dy={6}
            />
            <YAxis
              ticks={[0, 25, 50, 75, 100]}
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 11, fill: '#94A3B8' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: '1px solid #E2E8F0',
                fontSize: 12
              }}
              formatter={(value, name) => [
                `${Number(value).toFixed(1)}%`,
                Q_LINES.find((l) => l.key === String(name))?.label ?? String(name)
              ]}
            />
            {visible.map((l) => (
              <Line
                key={l.key}
                type="monotone"
                dataKey={l.key}
                name={l.key}
                stroke={l.color}
                strokeWidth={2}
                dot={{ r: 3, fill: l.color, strokeWidth: 0 }}
                activeDot={{ r: 4.5 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Row 5: Product lines & catalog card (replaces promo image card) ─────────

const CATALOG_TONES: Record<string, string> = {
  violet: 'bg-violet-50/70 hover:bg-violet-100/80 border-violet-100',
  emerald: 'bg-emerald-50/60 hover:bg-emerald-100/70 border-emerald-100',
  amber: 'bg-amber-50/60 hover:bg-amber-100/70 border-amber-100'
};

function ProductCatalogCard() {
  return (
    <div className={`${cardShell} col-span-12 flex flex-col justify-between md:col-span-5 lg:col-span-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-violet-600" />
          <h2 className="text-sm font-bold text-slate-800">Product Lines &amp; Catalog</h2>
        </div>
        <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
          5 Active Lines
        </span>
      </div>
      <div className="my-auto grid grid-cols-1 gap-1.5 py-3">
        {SEED_PRODUCT_LINES.map((p) => (
          <Link
            key={p.name}
            to="/products"
            className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold text-slate-800 transition ${CATALOG_TONES[p.tone]}`}
          >
            <span className="min-w-0">
              <span className="block truncate">{p.name}</span>
              <span className="block text-[11px] font-medium text-slate-500">{p.packaging}</span>
            </span>
            <span className="ml-2 shrink-0 rounded-md bg-white/70 px-2 py-0.5 font-bold tabular-nums text-slate-700">
              {p.stock.toLocaleString('en-US')} Qt
            </span>
          </Link>
        ))}
      </div>
      <div className="border-t border-slate-100 pt-3">
        <Link
          to="/products"
          className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-violet-200 transition-all hover:bg-violet-700 active:bg-violet-800"
        >
          View Products <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

// ─── Main dashboard ─────────────────────────────────────────────────────────

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
  const labChecks = useMemo(
    () => (Array.isArray(labChecksQ.data) ? labChecksQ.data : []),
    [labChecksQ.data]
  );

  const nowMs = Date.now();
  const weekAgoMs = nowMs - 7 * 24 * 3600 * 1000;
  const twoWeeksAgoMs = nowMs - 14 * 24 * 3600 * 1000;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartMs = monthStart.getTime();

  const shiftFlour = (sh: ShiftRun) => (sh.outputs ?? []).reduce((a, o) => a + safeNum(o.quintals), 0);

  // ── Live KPI computation ─────────────────────────────────────────────────
  const sumIntakes = (from: number, to: number) =>
    intakesQ.isSuccess
      ? intakes
          .filter((i) => {
            const t = new Date(i.deliveryDate).getTime();
            return i.status === 'ACCEPTED' && t >= from && t < to;
          })
          .reduce((s, i) => s + safeNum(i.quintals), 0)
      : null;
  const wheatThisWeek = sumIntakes(weekAgoMs, nowMs);
  const wheatPrevWeek = sumIntakes(twoWeeksAgoMs, weekAgoMs);
  const flourThisWeek = detailsReady
    ? details
        .filter((sh) => new Date(sh.shiftDate ?? sh.startedAt).getTime() >= weekAgoMs)
        .reduce((s, sh) => s + shiftFlour(sh), 0)
    : null;
  const flourPrevWeek = detailsReady
    ? details
        .filter((sh) => {
          const t = new Date(sh.shiftDate ?? sh.startedAt).getTime();
          return t >= twoWeeksAgoMs && t < weekAgoMs;
        })
        .reduce((s, sh) => s + shiftFlour(sh), 0)
    : null;
  const hasFlourData = detailsReady && details.some((sh) => (sh.outputs ?? []).length > 0);
  const dryStock = k ? safeNum(k.dryPool.balanceQ) : null;
  const activeBatches = batchesQ.isSuccess ? batches.filter((b) => b.status === 'OPEN').length : null;
  const qcPass =
    k && k.qcCompliancePct !== null && k.qcCompliancePct !== undefined ? k.qcCompliancePct : null;
  const qcPassPrevWeek = (() => {
    if (!labChecksQ.isSuccess || labChecks.length === 0) return null;
    const prev = labChecks.filter((c) => {
      const t = new Date(c.sampleTime).getTime();
      return t >= twoWeeksAgoMs && t < weekAgoMs;
    });
    if (prev.length === 0) return null;
    const passed = prev.filter((c) => (c.outOfRange ?? []).length === 0).length;
    return (passed / prev.length) * 100;
  })();

  const kpiSpecs: KpiSpec[] = [
    {
      icon: <Wheat size={22} />,
      iconTone: 'bg-violet-50 text-violet-600',
      label: 'Total Wheat Received',
      value: (wheatThisWeek ?? SEED_KPIS.wheat.value).toLocaleString('en-US'),
      unit: 'Qt',
      trendPct: wheatThisWeek !== null ? pctChange(wheatThisWeek, wheatPrevWeek ?? 0) : SEED_KPIS.wheat.trendPct,
      demo: wheatThisWeek === null
    },
    {
      icon: <PackageCheck size={22} />,
      iconTone: 'bg-blue-50 text-blue-600',
      label: 'Flour Produced',
      value: (hasFlourData && flourThisWeek !== null ? flourThisWeek : SEED_KPIS.flour.value).toLocaleString('en-US'),
      unit: 'Qt',
      trendPct:
        hasFlourData && flourThisWeek !== null
          ? pctChange(flourThisWeek, flourPrevWeek ?? 0)
          : SEED_KPIS.flour.trendPct,
      demo: !(hasFlourData && flourThisWeek !== null)
    },
    {
      icon: <Warehouse size={22} />,
      iconTone: 'bg-emerald-50 text-emerald-600',
      label: 'Current Stock (Dry Storage)',
      value: (dryStock ?? SEED_KPIS.stock.value).toLocaleString('en-US'),
      unit: 'Qt',
      trendPct: dryStock !== null ? null : SEED_KPIS.stock.trendPct,
      demo: dryStock === null
    },
    {
      icon: <Droplets size={22} />,
      iconTone: 'bg-amber-50 text-amber-500',
      label: 'Active Batches',
      value: String(activeBatches ?? SEED_KPIS.batches.value),
      unit: 'Batches',
      trendPct: activeBatches !== null ? 0 : SEED_KPIS.batches.trendPct,
      demo: activeBatches === null
    },
    {
      icon: <ShieldCheck size={22} />,
      iconTone: 'bg-emerald-50 text-emerald-600',
      label: 'Quality Pass Rate',
      value: (qcPass ?? SEED_KPIS.quality.value).toFixed(1),
      unit: '%',
      trendPct: qcPass !== null ? (qcPassPrevWeek !== null ? qcPass - qcPassPrevWeek : null) : SEED_KPIS.quality.trendPct,
      demo: qcPass === null
    }
  ];

  // ── Production chart data ────────────────────────────────────────────────
  const DONUT_COLORS = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#14B8A6'];
  const prodData: ProdPoint[] = useMemo(() => {
    const days = lastNDays(7);
    const byKey = new Map(days.map((d) => [d.key, { name: d.label, wheat: 0, flour: 0 } as ProdPoint]));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intakesQ.isSuccess, intakes, details]);
  const hasProdData = prodData.some((p) => p.wheat > 0 || p.flour > 0);
  const chartData: ProdPoint[] = hasProdData
    ? prodData
    : SEED_PRODUCTION_CHART.labels.map((name, i) => ({
        name,
        wheat: SEED_PRODUCTION_CHART.wheatReceived[i],
        flour: SEED_PRODUCTION_CHART.flourProduced[i]
      }));

  // ── Donut data ───────────────────────────────────────────────────────────
  const liveSegments: DonutSeg[] = useMemo(() => {
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
      .map(([name, value], i) => ({
        name,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
        color: DONUT_COLORS[i % DONUT_COLORS.length]
      }))
      .sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details]);
  const donutDemo = liveSegments.length === 0;
  const donutSegments: DonutSeg[] = donutDemo ? SEED_PRODUCT_OUTPUT : liveSegments;
  const donutTotal = donutDemo ? SEED_TOTAL_FLOUR : donutSegments.reduce((s, x) => s + x.value, 0);

  // ── Stock levels ─────────────────────────────────────────────────────────
  const liveStock: StockRow[] = useMemo(() => {
    if (!k) return [];
    const rows: StockRow[] = [
      {
        label: 'Dry Storage',
        balance: safeNum(k.dryPool.balanceQ),
        capacity: safeNum(k.dryPool.capacityQ),
        color: '#7C3AED',
        tile: 'bg-violet-100 text-violet-600'
      }
    ];
    const tones: Array<[string, string]> = [
      ['#3B82F6', 'bg-blue-100 text-blue-600'],
      ['#10B981', 'bg-teal-100 text-teal-600'],
      ['#F59E0B', 'bg-amber-100 text-amber-600']
    ];
    (k.tanks ?? []).forEach((t, i) => {
      const [color, tile] = tones[i % tones.length];
      rows.push({
        label: `${tankShort(t.code)} (Wet)`,
        balance: safeNum(t.levelQ),
        capacity: safeNum(t.capacityQ),
        color,
        tile
      });
    });
    return rows;
  }, [k]);
  const stockDemo = liveStock.length === 0;
  const stockRows: StockRow[] = stockDemo ? SEED_STOCK_LEVELS : liveStock;

  // ── Procurement rows ─────────────────────────────────────────────────────
  const INTAKE_STATUS: Record<string, 'Received' | 'Pending'> = {
    ACCEPTED: 'Received',
    PENDING_LAB: 'Pending',
    FLAGGED: 'Pending',
    REJECTED: 'Pending'
  };
  const liveProc: ProcRow[] = useMemo(
    () =>
      [...intakes]
        .sort((a, b) => new Date(b.deliveryDate).getTime() - new Date(a.deliveryDate).getTime())
        .slice(0, 5)
        .map((i) => ({
          date: fmtDate(i.deliveryDate),
          supplier: i.supplier?.name ?? '—',
          wheatType: categoryLabel(i.wheatCategory),
          qty: safeNum(i.quintals),
          status: INTAKE_STATUS[i.status] ?? i.status
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intakes]
  );
  const procDemo = liveProc.length === 0;
  const procRows: ProcRow[] = procDemo ? SEED_PROCUREMENT : liveProc;

  // ── Activities ───────────────────────────────────────────────────────────
  const SEED_TILE: Record<string, { icon: React.ReactNode; tile: string; to: string }> = {
    truck: { icon: <Truck size={18} />, tile: 'bg-emerald-50 text-emerald-600', to: '/intake' },
    check: { icon: <CheckCircle2 size={18} />, tile: 'bg-emerald-50 text-emerald-600', to: '/qc' },
    factory: { icon: <Factory size={18} />, tile: 'bg-violet-50 text-violet-600', to: '/batches' },
    card: { icon: <CreditCard size={18} />, tile: 'bg-blue-50 text-blue-600', to: '/finance' },
    tank: { icon: <Container size={18} />, tile: 'bg-amber-50 text-amber-600', to: '/storage' }
  };
  const liveActivities: ActivityItem[] = useMemo(() => {
    const items: Array<ActivityItem & { ts: number }> = [];
    const sortedIntakes = [...intakes].sort(
      (a, b) => new Date(b.deliveryDate).getTime() - new Date(a.deliveryDate).getTime()
    );
    for (const i of sortedIntakes.slice(0, 2)) {
      const ts = new Date(i.deliveryDate).getTime();
      if (!Number.isFinite(ts)) continue;
      items.push({
        ts,
        title: 'New wheat delivery received',
        sub: `Supplier: ${i.supplier?.name ?? 'Unknown'}`,
        time: relTime(ts),
        icon: <Truck size={18} />,
        tile: 'bg-emerald-50 text-emerald-600',
        to: '/intake'
      });
    }
    const sortedBatches = [...batches].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    for (const b of sortedBatches.slice(0, 2)) {
      const ts = new Date(b.createdAt).getTime();
      if (!Number.isFinite(ts)) continue;
      items.push({
        ts,
        title: 'Production batch completed',
        sub: `Batch: ${b.batchNo}`,
        time: relTime(ts),
        icon: <Factory size={18} />,
        tile: 'bg-violet-50 text-violet-600',
        to: `/batches/${b.id}`
      });
    }
    const sortedLab = [...labChecks].sort(
      (a, b) => new Date(b.sampleTime).getTime() - new Date(a.sampleTime).getTime()
    );
    for (const c of sortedLab.slice(0, 1)) {
      const ts = new Date(c.sampleTime).getTime();
      if (!Number.isFinite(ts)) continue;
      const passed = (c.outOfRange ?? []).length === 0;
      items.push({
        ts,
        title: passed ? 'Quality test passed' : 'Quality test flagged',
        sub: `Sample: ${c.id.slice(0, 8)}`,
        time: relTime(ts),
        icon: <CheckCircle2 size={18} />,
        tile: passed ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
        to: '/qc'
      });
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intakes, batches, labChecks]);
  const actDemo = liveActivities.length === 0;
  const activities: ActivityItem[] = actDemo
    ? SEED_ACTIVITIES.map((s) => ({ ...SEED_TILE[s.icon], title: s.title, sub: s.sub, time: s.time }))
    : liveActivities;

  // ── Performance tiles ────────────────────────────────────────────────────
  const perfTiles: PerfTile[] = useMemo(() => {
    const prevMonthStart = new Date(monthStart);
    prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
    const prevMonthStartMs = prevMonthStart.getTime();
    const calc = (fromMs: number, toMs: number) => {
      const shifts = details.filter((sh) => {
        const t = new Date(sh.shiftDate ?? sh.startedAt).getTime();
        return t >= fromMs && t < toMs;
      });
      const flour = shifts.reduce((s, sh) => s + shiftFlour(sh), 0);
      const wheat = batchesQ.isSuccess
        ? batches
            .filter((b) => {
              const t = new Date(b.createdAt).getTime();
              return t >= fromMs && t < toMs;
            })
            .reduce((s, b) => s + safeNum(b.wheatWeighedQ), 0)
        : 0;
      const duket = shifts.reduce(
        (s, sh) =>
          s +
          (sh.outputs ?? [])
            .filter((o) => (o.product?.name ?? '').toLowerCase().includes('duket'))
            .reduce((a, o) => a + safeNum(o.quintals), 0),
        0
      );
      let downMin = 0;
      let workMin = 0;
      for (const sh of shifts) {
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
        hasData: shifts.length > 0 || flour > 0
      };
    };
    const cur = calc(monthStartMs, nowMs);
    const prev = calc(prevMonthStartMs, monthStartMs);
    const live =
      cur.hasData || prev.hasData
        ? [
            {
              label: 'Total Production',
              value: `${cur.flour.toLocaleString('en-US')} Qt`,
              trendPct: pctChange(cur.flour, prev.flour),
              icon: <PackageCheck size={18} />,
              tile: 'bg-emerald-100 text-emerald-600'
            },
            {
              label: 'Extraction Rate',
              value: cur.extraction !== null ? `${cur.extraction.toFixed(1)}%` : '—',
              trendPct:
                cur.extraction !== null && prev.extraction !== null
                  ? pctChange(cur.extraction, prev.extraction)
                  : null,
              icon: <BarChart3 size={18} />,
              tile: 'bg-violet-100 text-violet-600'
            },
            {
              label: 'Duket Yield',
              value: cur.duketYield !== null ? `${cur.duketYield.toFixed(1)}%` : '—',
              trendPct:
                cur.duketYield !== null && prev.duketYield !== null
                  ? pctChange(cur.duketYield, prev.duketYield)
                  : null,
              icon: <Sun size={18} />,
              tile: 'bg-amber-100 text-amber-600',
              alert: cur.duketYield !== null && cur.duketYield < 78
            },
            {
              label: 'Downtime',
              value: cur.downtimePct !== null ? `${cur.downtimePct.toFixed(1)}%` : '—',
              trendPct:
                cur.downtimePct !== null && prev.downtimePct !== null
                  ? pctChange(cur.downtimePct, prev.downtimePct)
                  : null,
              invert: true,
              icon: <Bell size={18} />,
              tile: 'bg-rose-100 text-rose-600'
            }
          ]
        : null;
    if (live) return live;
    return [
      {
        label: 'Total Production',
        value: `${SEED_PERFORMANCE.totalProduction.value.toLocaleString('en-US')} Qt`,
        trendPct: SEED_PERFORMANCE.totalProduction.trendPct,
        icon: <PackageCheck size={18} />,
        tile: 'bg-emerald-100 text-emerald-600'
      },
      {
        label: 'Extraction Rate',
        value: `${SEED_PERFORMANCE.extractionRate.value.toFixed(1)}%`,
        trendPct: SEED_PERFORMANCE.extractionRate.trendPct,
        icon: <BarChart3 size={18} />,
        tile: 'bg-violet-100 text-violet-600'
      },
      {
        label: 'Duket Yield',
        value: `${SEED_PERFORMANCE.duketYield.value.toFixed(1)}%`,
        trendPct: SEED_PERFORMANCE.duketYield.trendPct,
        icon: <Sun size={18} />,
        tile: 'bg-amber-100 text-amber-600'
      },
      {
        label: 'Downtime',
        value: `${SEED_PERFORMANCE.downtime.value.toFixed(1)}%`,
        trendPct: SEED_PERFORMANCE.downtime.trendPct,
        invert: true,
        icon: <Bell size={18} />,
        tile: 'bg-rose-100 text-rose-600'
      }
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details, batchesQ.isSuccess, batches, monthStartMs, nowMs]);
  const perfDemo =
    perfTiles[0].value ===
    `${SEED_PERFORMANCE.totalProduction.value.toLocaleString('en-US')} Qt`;

  // ── Quality trend points ─────────────────────────────────────────────────
  const liveQuality: QualityPoint[] = useMemo(() => {
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
  const hasLiveQuality = liveQuality.some(
    (p) => p.gluten !== null || p.moisture !== null || p.impurity !== null
  );
  const qualityData: QualityPoint[] = hasLiveQuality ? liveQuality : SEED_QUALITY_TREND;

  const firstName = (user?.name ?? '').split(' ')[0] || user?.email || 'there';

  if (kpisQ.isLoading && intakesQ.isLoading && shiftsQ.isLoading) {
    return <SkeletonDashboard />;
  }

  return (
    <div className="min-h-screen space-y-5 bg-[#F4F6FA] p-6">
      {/* ── Row 1: hero + status + weather ── */}
      <div className="grid grid-cols-12 gap-4">
        <WelcomeBanner firstName={firstName} />
        <ProductionStatusCard activeBatches={activeBatches} demo={activeBatches === null} />
        <WeatherCard />
      </div>

      {/* ── Row 2: KPIs ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpiSpecs.map((s) => (
          <KpiCard key={s.label} spec={s} />
        ))}
      </div>

      {/* ── Row 3: production chart + donut + activities ── */}
      <div className="grid grid-cols-12 gap-4">
        <ProductionOverview data={chartData} demo={!hasProdData} />
        <ProductOutputDonut segments={donutSegments} total={donutTotal} demo={donutDemo} />
        <RecentActivities items={activities} demo={actDemo} />
      </div>

      {/* ── Row 4: quick access + stock + procurement ── */}
      <div className="grid grid-cols-12 gap-4">
        <QuickAccess />
        <StockLevels rows={stockRows} demo={stockDemo} />
        <RecentProcurement rows={procRows} demo={procDemo} />
      </div>

      {/* ── Row 5: performance + quality trend + product catalog ── */}
      <div className="grid grid-cols-12 gap-4">
        <ProductionPerformance tiles={perfTiles} demo={perfDemo} />
        <QualityTrendChart data={qualityData} demo={!hasLiveQuality} />
        <ProductCatalogCard />
      </div>
    </div>
  );
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
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
}
