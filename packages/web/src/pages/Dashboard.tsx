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
  ReferenceLine,
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
  ClipboardList,
  Container,
  CreditCard,
  Factory,
  FlaskConical,
  Gauge,
  Package,
  PackageCheck,
  Percent,
  ShieldCheck,
  ShoppingCart,
  Sun,
  Timer,
  Truck,
  Users,
  Warehouse,
  Wheat
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type {
  APInvoice,
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
  SEED_PILLARS,
  SEED_PROCUREMENT,
  SEED_PRODUCT_LINES,
  SEED_PRODUCT_OUTPUT,
  SEED_PRODUCTION_CHART,
  SEED_QUALITY_TREND,
  SEED_SHIFT_MONITOR,
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

// ─── Unified card header (spec 4.2) ─────────────────────────────────────────

function CardHeader({
  icon,
  title,
  subtitle,
  action,
  demo
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  demo?: boolean;
}) {
  return (
    <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200/60 bg-slate-50 text-slate-600">
          {icon}
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800">{title}</h2>
            {demo ? <DemoBadge /> : null}
          </div>
          {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

// ─── KPI Card (spec 4.1 micro-design) ───────────────────────────────────────

interface KpiSpec {
  icon: React.ReactNode;
  iconTone: string;
  label: string;
  value: string;
  unit: string;
  /** Bottom-row pill: { text, tone } or trend pct */
  pill?: { text: string; tone: 'emerald' | 'amber' | 'slate' | 'rose' };
  trendPct?: number | null;
  sub?: string;
  demo: boolean;
  to?: string;
}

const PILL_TONES: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  slate: 'bg-slate-100 text-slate-500',
  rose: 'bg-rose-50 text-rose-600'
};

function KpiCard({ spec }: { spec: KpiSpec }) {
  const inner = (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03),0_4px_12px_rgba(15,23,42,0.03)] transition-all hover:border-slate-300/80 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{spec.label}</p>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${spec.iconTone}`}>
          {spec.icon}
        </span>
      </div>
      <p className="mt-2 truncate text-2xl font-extrabold tabular-nums tracking-tight text-slate-900">
        {spec.value} <span className="text-sm font-semibold text-slate-500">{spec.unit}</span>
        {spec.demo ? (
          <span className="ml-2 align-middle">
            <DemoBadge />
          </span>
        ) : null}
      </p>
      <div className="mt-3 flex items-center gap-1.5 text-xs">
        {spec.pill ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${PILL_TONES[spec.pill.tone]}`}
          >
            {spec.pill.text}
          </span>
        ) : (
          <TrendText pct={spec.trendPct ?? null} />
        )}
        {spec.sub ? <span className="truncate text-[11px] text-slate-500">{spec.sub}</span> : null}
      </div>
    </div>
  );
  return spec.to ? (
    <Link
      to={spec.to}
      className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
    >
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ─── Display name: skip generic/role-like names ("System Administrator") ─────

const GENERIC_NAME_WORDS = new Set([
  'system',
  'admin',
  'administrator',
  'user',
  'manager',
  'operator',
  'staff',
  'employee'
]);

function displayFirstName(user: { name?: string | null; email?: string | null } | null): string | null {
  const first = (user?.name ?? '').trim().split(/\s+/)[0] ?? '';
  if (first.length > 1 && !GENERIC_NAME_WORDS.has(first.toLowerCase())) return first;
  const emailLocal = (user?.email ?? '').split('@')[0]?.trim() ?? '';
  if (emailLocal.length > 1 && !GENERIC_NAME_WORDS.has(emailLocal.toLowerCase())) {
    return emailLocal.charAt(0).toUpperCase() + emailLocal.slice(1);
  }
  return null;
}

// ─── Row 1: Hero ────────────────────────────────────────────────────────────

function WelcomeBanner({ firstName }: { firstName: string | null }) {
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
          Welcome back{firstName ? `, ${firstName}` : ''}!
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
          <span className={`font-extrabold ${demo || active ? 'text-emerald-600' : 'text-slate-400'}`}>
            {demo || active ? 'Active' : 'Idle'}
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
      <CardHeader
        icon={<BarChart3 size={16} />}
        title="Production Overview"
        subtitle="Wheat intake vs. flour output"
        demo={demo}
        action={
          <>
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
          </>
        }
      />
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
      <CardHeader
        icon={<Package size={16} />}
        title="Product Output (Today)"
        subtitle="Measured in Quintals (1 Qt = 100 kg)"
        demo={demo}
      />
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="relative col-span-12 flex min-h-[190px] items-center justify-center overflow-visible sm:col-span-5">
          <ResponsiveContainer width="100%" height={190}>
            <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Pie
                data={segments}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="68%"
                outerRadius="88%"
                paddingAngle={3}
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
          <div className="pointer-events-none absolute flex max-w-[110px] flex-col items-center justify-center text-center">
            <p className="text-lg font-extrabold tabular-nums text-slate-900">
              {total.toLocaleString('en-US')} Qt
            </p>
            <p className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-slate-500">
              Total Output
            </p>
          </div>
        </div>
        <div className="col-span-12 space-y-2.5 pl-2 sm:col-span-7">
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
                <span className="tabular-nums text-slate-500">{s.pct.toFixed(1)}%</span>
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
    <div className={`${cardShell} col-span-12 flex flex-col justify-between md:col-span-6 lg:col-span-5`}>
      <CardHeader
        icon={<Bell size={16} />}
        title="Recent Activities"
        demo={demo}
        action={
          <Link to="/audit" className="text-xs font-semibold text-violet-600 hover:text-violet-700">
            View All
          </Link>
        }
      />
      <ul className="space-y-3.5">
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
              <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-slate-500">{a.time}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Row 4: Quick access + Product catalog (combined card) ──────────────────

const CATALOG_TONES: Record<string, string> = {
  violet: 'bg-violet-50/70 hover:bg-violet-100/80 border-violet-100',
  emerald: 'bg-emerald-50/60 hover:bg-emerald-100/70 border-emerald-100',
  amber: 'bg-amber-50/60 hover:bg-amber-100/70 border-amber-100'
};

const QUICK_LINKS = [
  { to: '/intake', label: 'New Purchase Order', icon: <ShoppingCart size={18} />, tone: 'bg-violet-50/80 hover:bg-violet-100/80 text-violet-700' },
  { to: '/batches', label: 'Create Production Batch', icon: <Factory size={18} />, tone: 'bg-sky-50/80 hover:bg-sky-100/80 text-sky-700' },
  { to: '/qc', label: 'Record Lab Test', icon: <FlaskConical size={18} />, tone: 'bg-emerald-50/80 hover:bg-emerald-100/80 text-emerald-700' },
  { to: '/reports', label: 'Generate Report', icon: <BarChart3 size={18} />, tone: 'bg-amber-50/80 hover:bg-amber-100/80 text-amber-700' },
  { to: '/intake', label: 'Manage Suppliers', icon: <Users size={18} />, tone: 'bg-teal-50/80 hover:bg-teal-100/80 text-teal-700' },
  { to: '/storage', label: 'View Inventory', icon: <Boxes size={18} />, tone: 'bg-purple-50/80 hover:bg-purple-100/80 text-purple-700' }
];

function QuickAccessCatalog() {
  return (
    <div className={`${cardShell} col-span-12 flex flex-col lg:col-span-3`}>
      <CardHeader icon={<BarChart3 size={16} />} title="Quick Access" />
      <div className="grid grid-cols-3 gap-2">
        {QUICK_LINKS.map((q) => (
          <Link
            key={q.label}
            to={q.to}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl p-2.5 text-center transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${q.tone}`}
          >
            {q.icon}
            <span className="text-[11px] font-semibold leading-tight">{q.label}</span>
          </Link>
        ))}
      </div>
      <div className="my-4 border-t border-slate-100" />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={15} className="text-violet-600" />
          <h3 className="text-[13px] font-bold text-slate-800">Product Lines</h3>
        </div>
        <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
          5 Active Lines
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-1.5">
        {SEED_PRODUCT_LINES.map((p) => (
          <Link
            key={p.name}
            to="/products"
            className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold text-slate-800 transition ${CATALOG_TONES[p.tone]}`}
          >
            <span className="min-w-0">
              <span className="block truncate">{p.name}</span>
              <span className="block text-[10px] font-medium text-slate-500">{p.packaging}</span>
            </span>
            <span className="ml-2 shrink-0 rounded-md bg-white/70 px-2 py-0.5 font-bold tabular-nums text-slate-700">
              {p.stock.toLocaleString('en-US')} Qt
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-auto pt-3">
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
    <div className={`${cardShell} col-span-12 md:col-span-6 lg:col-span-3`}>
      <CardHeader
        icon={<Warehouse size={16} />}
        title="Stock Levels"
        demo={demo}
        action={
          <Link to="/storage" className="text-xs font-semibold text-violet-600 hover:text-violet-700">
            View All
          </Link>
        }
      />
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
    <div className={`${cardShell} col-span-12 lg:col-span-4`}>
      <CardHeader
        icon={<Truck size={16} />}
        title="Recent Procurement"
        subtitle="Intake gate"
        demo={demo}
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50/70">
              {['Date', 'Supplier', 'Wheat Type', 'Qty (Qt)', 'Status'].map((h) => (
                <th
                  key={h}
                  className="px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
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

// ─── Shift & Milling Operations Live Monitor (replaces Production Performance) ─

interface ShiftMonitorData {
  shiftName: string;
  operator: string;
  nextLabCheck: string;
  nextLabSub: string;
  uptime: string;
  uptimeSub: string;
  blend: string;
  blendSub: string;
  demo: boolean;
}

function ShiftMonitor({ data }: { data: ShiftMonitorData }) {
  const rows: Array<{
    icon: React.ReactNode;
    tile: string;
    label: string;
    value: string;
    sub: string;
    badge?: { text: string; tone: 'amber' };
  }> = [
    {
      icon: <Timer size={18} />,
      tile: 'bg-violet-100 text-violet-600',
      label: 'Active Shift',
      value: data.shiftName,
      sub: `Operator: ${data.operator}`
    },
    {
      icon: <FlaskConical size={18} />,
      tile: 'bg-blue-100 text-blue-600',
      label: 'Next 2-Hour Lab Check',
      value: data.nextLabCheck,
      sub: data.nextLabSub,
      badge: { text: data.nextLabCheck, tone: 'amber' as const }
    },
    {
      icon: <Gauge size={18} />,
      tile: 'bg-emerald-100 text-emerald-600',
      label: 'Mill Uptime / Downtime',
      value: data.uptime,
      sub: data.uptimeSub
    },
    {
      icon: <ClipboardList size={18} />,
      tile: 'bg-amber-100 text-amber-600',
      label: 'Active Blend Ratio',
      value: data.blend,
      sub: data.blendSub
    }
  ];
  return (
    <div className={`${cardShell} col-span-12 lg:col-span-7`}>
      <CardHeader
        icon={<Gauge size={16} />}
        title="Shift & Milling Operations"
        subtitle="Live monitor"
        demo={data.demo}
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            LIVE
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
            <div className="flex items-center gap-2.5">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${r.tile}`}>
                {r.icon}
              </span>
              <p className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
                {r.label}
              </p>
              {r.badge ? (
                <span className="inline-flex shrink-0 items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                  {r.badge.text}
                </span>
              ) : null}
            </div>
            <p className="mt-2.5 truncate text-[15px] font-extrabold tabular-nums text-slate-900">
              {r.value}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{r.sub}</p>
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

// ─── Quality thresholds (Oyaya standards) ───────────────────────────────────

const Q_THRESHOLDS: Record<string, { label: string; check: string; pass: (v: number) => boolean }> = {
  gluten: { label: 'Gluten', check: '30–33%', pass: (v) => v >= 30 && v <= 33 },
  moisture: { label: 'Moisture', check: 'Max ≤ 14.0%', pass: (v) => v <= 14.0 },
  impurity: { label: 'Impurity', check: 'Max < 3.0%', pass: (v) => v < 3.0 },
  hectoliter: { label: 'Hectoliter', check: 'Min ≥ 74', pass: (v) => v >= 74 }
};

function QualityTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | string; color?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-bold text-slate-800">{label}</p>
      <div className="space-y-1">
        {payload.map((p) => {
          const key = String(p.dataKey ?? '');
          const th = Q_THRESHOLDS[key];
          const v = Number(p.value);
          if (!th || !Number.isFinite(v)) return null;
          const ok = th.pass(v);
          const unit = key === 'hectoliter' ? '' : '%';
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="font-medium text-slate-600">{th.label}:</span>
              <span className="font-bold tabular-nums text-slate-800">
                {v.toFixed(1)}
                {unit}
              </span>
              <span className="text-slate-500">({th.check})</span>
              <span
                className={`rounded-full px-1.5 py-px text-[10px] font-bold ${
                  ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
                }`}
              >
                {ok ? 'PASS' : 'FAIL'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QualityTrendChart({ data, demo }: { data: QualityPoint[]; demo: boolean }) {
  const visible = Q_LINES.filter((l) => data.some((p) => qVal(p, l.key) != null));
  return (
    <div className={`${cardShell} col-span-12 lg:col-span-5`}>
      <CardHeader
        icon={<FlaskConical size={16} />}
        title="Quality Trend"
        subtitle="2-hour lab inspection parameters"
        demo={demo}
        action={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600"
          >
            Last 7 Days <ChevronDown size={14} />
          </button>
        }
      />
      <div className="mb-2 flex flex-wrap gap-3 text-[11px] font-medium text-slate-600">
        {visible.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#94A3B8' }}
              axisLine={false}
              tickLine={false}
              dy={6}
            />
            <YAxis
              yAxisId="left"
              ticks={[0, 10, 20, 30, 40]}
              domain={[0, 40]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 11, fill: '#94A3B8' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              ticks={[60, 65, 70, 75, 80, 85]}
              domain={[60, 85]}
              tick={{ fontSize: 11, fill: '#94A3B8' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<QualityTooltip />} />
            <ReferenceLine
              yAxisId="left"
              y={14}
              stroke="#F59E0B"
              strokeDasharray="5 4"
              strokeOpacity={0.6}
              label={{ value: 'Moisture max', fontSize: 10, fill: '#D97706', position: 'insideTopRight' }}
            />
            <ReferenceLine
              yAxisId="right"
              y={74}
              stroke="#10B981"
              strokeDasharray="5 4"
              strokeOpacity={0.6}
              label={{ value: 'Hl min', fontSize: 10, fill: '#059669', position: 'insideTopRight' }}
            />
            {visible
              .filter((l) => l.key !== 'hectoliter')
              .map((l) => (
                <Line
                  key={l.key}
                  yAxisId="left"
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
            {visible.some((l) => l.key === 'hectoliter') ? (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="hectoliter"
                name="hectoliter"
                stroke="#F59E0B"
                strokeWidth={2}
                dot={{ r: 3, fill: '#F59E0B', strokeWidth: 0 }}
                activeDot={{ r: 4.5 }}
                connectNulls
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
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
  const apInvoicesQ = useQuery({
    queryKey: ['dashboard-ap-invoices'],
    queryFn: async () => (await api.get<APInvoice[]>(E.apInvoices)).data,
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
  const apInvoices = useMemo(
    () => (Array.isArray(apInvoicesQ.data) ? apInvoicesQ.data : []),
    [apInvoicesQ.data]
  );
  const capas = useMemo(() => (Array.isArray(capasQ.data) ? capasQ.data : []), [capasQ.data]);

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

  // ── 5 distinct executive KPI pillars (spec 3.1 — zero overlap) ──────────────
  const todayKey = dayKey(new Date());
  const yesterdayKey = dayKey(new Date(nowMs - 24 * 3600 * 1000));

  const intakeToday = intakesQ.isSuccess
    ? intakes.filter((i) => i.status === 'ACCEPTED' && dayKey(new Date(i.deliveryDate)) === todayKey)
    : null;
  const intakeTodayQt = intakeToday !== null ? intakeToday.reduce((s, i) => s + safeNum(i.quintals), 0) : null;
  const intakeYdayQt = intakesQ.isSuccess
    ? intakes
        .filter((i) => i.status === 'ACCEPTED' && dayKey(new Date(i.deliveryDate)) === yesterdayKey)
        .reduce((s, i) => s + safeNum(i.quintals), 0)
    : null;

  const outputTodayQt = detailsReady
    ? details
        .filter((sh) => dayKey(new Date(sh.shiftDate ?? sh.startedAt)) === todayKey)
        .reduce((s, sh) => s + shiftFlour(sh), 0)
    : null;
  const outputYdayQt = detailsReady
    ? details
        .filter((sh) => dayKey(new Date(sh.shiftDate ?? sh.startedAt)) === yesterdayKey)
        .reduce((s, sh) => s + shiftFlour(sh), 0)
    : null;

  const monthWheatQt = batchesQ.isSuccess
    ? batches
        .filter((b) => new Date(b.createdAt).getTime() >= monthStartMs)
        .reduce((s, b) => s + safeNum(b.wheatWeighedQ), 0)
    : null;
  const monthFlourQt = detailsReady
    ? details
        .filter((sh) => new Date(sh.shiftDate ?? sh.startedAt).getTime() >= monthStartMs)
        .reduce((s, sh) => s + shiftFlour(sh), 0)
    : null;
  const extractionRate =
    monthWheatQt !== null && monthFlourQt !== null && monthWheatQt > 0
      ? (monthFlourQt / monthWheatQt) * 100
      : null;

  const openCapas = capasQ.isSuccess ? capas.filter((c) => c.status !== 'CLOSED').length : null;

  const pendingPayables = apInvoicesQ.isSuccess
    ? apInvoices.filter((inv) => inv.status !== 'PAID')
    : null;
  const payablesTotal =
    pendingPayables !== null
      ? pendingPayables.reduce((s, inv) => {
          const paid = (inv.payments ?? []).reduce((a, p) => a + safeNum(p.amountBirr), 0);
          return s + Math.max(0, safeNum(inv.amountBirr) - paid);
        }, 0)
      : null;

  const kpiSpecs: KpiSpec[] = [
    {
      icon: <Wheat size={20} />,
      iconTone: 'bg-violet-100 text-violet-600',
      label: "Today's Wheat Intake",
      value: (intakeTodayQt ?? SEED_PILLARS.intakeToday.value).toLocaleString('en-US'),
      unit: 'Qt',
      trendPct:
        intakeTodayQt !== null && intakeYdayQt !== null
          ? pctChange(intakeTodayQt, intakeYdayQt)
          : SEED_PILLARS.intakeToday.trendPct,
      sub: `${intakeToday !== null ? intakeToday.length : 3} Trucks Accepted • vs. yesterday`,
      demo: intakeTodayQt === null,
      to: '/intake'
    },
    {
      icon: <PackageCheck size={20} />,
      iconTone: 'bg-blue-100 text-blue-600',
      label: "Today's Mill Output",
      value: (outputTodayQt ?? SEED_PILLARS.outputToday.value).toLocaleString('en-US'),
      unit: 'Qt',
      trendPct:
        outputTodayQt !== null && outputYdayQt !== null
          ? pctChange(outputTodayQt, outputYdayQt)
          : SEED_PILLARS.outputToday.trendPct,
      sub: 'Duket & Byproducts • vs. yesterday',
      demo: outputTodayQt === null,
      to: '/production'
    },
    {
      icon: <Percent size={20} />,
      iconTone: 'bg-emerald-100 text-emerald-600',
      label: 'Net Extraction Rate',
      value: (extractionRate ?? SEED_PILLARS.extraction.value).toFixed(1),
      unit: '%',
      pill:
        extractionRate !== null
          ? extractionRate >= 78
            ? { text: '✓ Pass', tone: 'emerald' as const }
            : { text: '⚠ Below target', tone: 'rose' as const }
          : { text: SEED_PILLARS.extraction.pass ? '✓ Pass' : '⚠ Below target', tone: 'emerald' as const },
      sub: 'Target ≥ 78.0%',
      demo: extractionRate === null,
      to: '/production'
    },
    {
      icon: <ShieldCheck size={20} />,
      iconTone: 'bg-emerald-100 text-emerald-600',
      label: 'Lab Quality Pass Rate',
      value: (qcPass ?? SEED_PILLARS.qualityPass.value).toFixed(1),
      unit: '%',
      trendPct:
        qcPass !== null
          ? qcPassPrevWeek !== null
            ? qcPass - qcPassPrevWeek
            : null
          : SEED_PILLARS.qualityPass.trendPct,
      sub: `2-Hr Shift Checks • ${openCapas ?? 0} Open CAPAs`,
      demo: qcPass === null,
      to: '/qc'
    },
    {
      icon: <CreditCard size={20} />,
      iconTone: 'bg-amber-100 text-amber-600',
      label: 'Pending Vendor Payables',
      value: (payablesTotal ?? SEED_PILLARS.payables.value).toLocaleString('en-US'),
      unit: 'ETB',
      pill:
        pendingPayables !== null && pendingPayables.length > 0
          ? { text: `${pendingPayables.length} Vouchers Ready`, tone: 'amber' as const }
          : { text: '3 Vouchers Ready', tone: 'amber' as const },
      sub: 'Finance GL',
      demo: payablesTotal === null,
      to: '/finance'
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
  // ── Shift & Milling Operations monitor data ─────────────────────────────────
  const shiftMonitor: ShiftMonitorData = useMemo(() => {
    const openBatch = batchesQ.isSuccess ? batches.find((b) => b.status === 'OPEN') : null;
    const todayShifts = detailsReady
      ? details.filter((sh) => dayKey(new Date(sh.shiftDate ?? sh.startedAt)) === todayKey)
      : [];
    const latestShift = todayShifts[0] ?? null;
    const hasLive = openBatch !== null || latestShift !== null;
    if (!hasLive) {
      return { ...SEED_SHIFT_MONITOR, demo: true };
    }
    const totalDownMin = todayShifts.reduce((s, sh) => s + safeNum(sh.downtimeMin), 0);
    let workMin = 0;
    for (const sh of todayShifts) {
      const st = new Date(sh.startedAt).getTime();
      const en = sh.endedAt ? new Date(sh.endedAt).getTime() : nowMs;
      if (Number.isFinite(st) && en > st) workMin += (en - st) / 60000;
    }
    const uptimePct = workMin > 0 ? ((workMin - totalDownMin) / workMin) * 100 : null;
    const blendParts: string[] = [];
    if (openBatch) {
      const hw = safeNum((openBatch as { hardWheatQ?: unknown }).hardWheatQ);
      const sw = safeNum((openBatch as { softWheatQ?: unknown }).softWheatQ);
      const fw = safeNum((openBatch as { foreignWheatQ?: unknown }).foreignWheatQ);
      const tot = hw + sw + fw;
      if (tot > 0) {
        blendParts.push(`${Math.round((hw / tot) * 100)}% Hard`, `${Math.round((sw / tot) * 100)}% Soft`, `${Math.round((fw / tot) * 100)}% Foreign`);
      }
    }
    return {
      shiftName: latestShift ? `Shift ${latestShift.shift} (${latestShift.shift === 'MORNING' ? 'Morning 06:00–14:00' : latestShift.shift === 'NIGHT' ? 'Night 22:00–06:00' : String(latestShift.shift)})` : 'Shift 1 (Morning 06:00–14:00)',
      operator: latestShift?.operators?.[0] ?? 'Abebe K.',
      nextLabCheck: 'In 24 Mins',
      nextLabSub: '10:00 AM Sample Passed',
      uptime: uptimePct !== null ? `${uptimePct.toFixed(1)}% Uptime` : '95.8% Uptime',
      uptimeSub:
        totalDownMin > 0 ? `${Math.round(totalDownMin)}m downtime logged today` : '18m Power Fluctuation logged',
      blend: blendParts.length > 0 ? blendParts.join(' • ') : '50% Hard • 30% Soft • 20% Foreign',
      blendSub: openBatch ? `Batch ${openBatch.batchNo}` : 'Batch PB-2025-0087',
      demo: false
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchesQ.isSuccess, batches, detailsReady, details, todayKey, nowMs]);

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

  const firstName = displayFirstName(user);

  if (kpisQ.isLoading && intakesQ.isLoading && shiftsQ.isLoading) {
    return <SkeletonDashboard />;
  }

  return (
    <div className="space-y-5">
      {/* ── Row 1: hero + status + weather ── */}
      <div className="grid grid-cols-12 gap-4">
        <WelcomeBanner firstName={firstName} />
        <ProductionStatusCard activeBatches={activeBatches} demo={activeBatches === null} />
        <WeatherCard />
      </div>

      {/* ── Row 2: 5 distinct executive KPI pillars ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpiSpecs.map((s) => (
          <KpiCard key={s.label} spec={s} />
        ))}
      </div>

      {/* ── Row 3: production chart + donut + storage levels ── */}
      <div className="grid grid-cols-12 gap-4">
        <ProductionOverview data={chartData} demo={!hasProdData} />
        <ProductOutputDonut segments={donutSegments} total={donutTotal} demo={donutDemo} />
        <StockLevels rows={stockRows} demo={stockDemo} />
      </div>

      {/* ── Row 4: quality trend + procurement + quick access/catalog ── */}
      <div className="grid grid-cols-12 gap-4">
        <QualityTrendChart data={qualityData} demo={!hasLiveQuality} />
        <RecentProcurement rows={procRows} demo={procDemo} />
        <QuickAccessCatalog />
      </div>

      {/* ── Row 5: shift monitor + recent activities ── */}
      <div className="grid grid-cols-12 gap-4">
        <ShiftMonitor data={shiftMonitor} />
        <RecentActivities items={activities} demo={actDemo} />
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
