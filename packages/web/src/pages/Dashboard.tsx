import { useMemo, useState } from 'react';
import { useChartTheme } from '../lib/theme';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Download,
  Factory,
  FlaskConical,
  Gauge,
  Percent,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
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
  SalesInvoice,
  ShiftRun,
  WheatIntake
} from '../types';
import { useAuth } from '../store/auth';
import { SkeletonDashboard } from '../components/Skeleton';
import { fmtDate } from '../lib/format';
import {
  SEED_PILLARS,
  SEED_PROCUREMENT,
  SEED_PRODUCT_OUTPUT,
  SEED_PRODUCTION_CHART,
  SEED_SHIFT_MONITOR,
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

function lastNMonths(n: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-GB', { month: 'short' })
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

function categoryLabel(c: string): string {
  return c === 'SOFT' ? 'Soft' : c === 'HARD' ? 'Hard' : c === 'FOREIGN' ? 'Foreign' : c;
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

// Orlando card: white, thin border, soft shadow
const cardShell =
  'bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5';

function DemoBadge() {
  return (
    <span className="rounded bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
      Demo
    </span>
  );
}

/** Orlando trend line: green/red arrow + "X% more/less than <suffix>". */
function TrendLine({ pct, suffix }: { pct: number | null; suffix: string }) {
  if (pct === null || !Number.isFinite(pct) || pct === 0) return null;
  const up = pct > 0;
  return (
    <p
      className={`mt-2 flex items-center gap-1 text-xs font-medium ${
        up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
      }`}
    >
      {up ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
      <span className="tabular-nums">
        {Math.abs(pct).toFixed(1)}% {up ? 'more' : 'less'} than {suffix}
      </span>
    </p>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone =
    s === 'received' || s === 'approved' || s === 'current' || s === 'paid'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
      : s === 'pending' || s === 'due soon'
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
        : 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400';
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>
      {status}
    </span>
  );
}

// ─── KPI Card (Orlando micro-design) ────────────────────────────────────────

interface KpiSpec {
  icon: React.ReactNode;
  chip: string;
  label: string;
  value: string;
  trendPct?: number | null;
  trendSuffix?: string;
  customTrend?: React.ReactNode;
  demo: boolean;
  to?: string;
}

function KpiCard({ spec }: { spec: KpiSpec }) {
  const inner = (
    <div className={`${cardShell} h-full transition-shadow hover:shadow-md`}>
      <div className="flex items-start justify-between gap-2">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white ${spec.chip}`}
          aria-hidden="true"
        >
          {spec.icon}
        </span>
        {spec.demo ? <DemoBadge /> : null}
      </div>
      <p className="mt-3 truncate text-2xl font-extrabold tabular-nums tracking-tight text-gray-900 dark:text-white">
        {spec.value}
      </p>
      <p className="mt-1 truncate text-xs text-gray-500 dark:text-slate-400">{spec.label}</p>
      {spec.customTrend ?? <TrendLine pct={spec.trendPct ?? null} suffix={spec.trendSuffix ?? 'yesterday'} />}
    </div>
  );
  return spec.to ? (
    <Link
      to={spec.to}
      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      aria-label={spec.label}
    >
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ─── Page header (Orlando: Welcome + date | period, Filter, Export) ─────────

type Period = 'today' | 'yesterday';
type ProcFilter = 'all' | 'Received' | 'Pending';
type ShiftSel = 'all' | 'Day' | 'Night';

function PageHeader({
  firstName,
  period,
  setPeriod,
  shift,
  setShift,
  procFilter,
  setProcFilter,
  onExport
}: {
  firstName: string | null;
  period: Period;
  setPeriod: (p: Period) => void;
  shift: ShiftSel;
  setShift: (s: ShiftSel) => void;
  procFilter: ProcFilter;
  setProcFilter: (f: ProcFilter) => void;
  onExport: () => void;
}) {
  const [periodOpen, setPeriodOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const todayStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  const btn =
    'touch inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-gray-700 dark:text-slate-200 shadow-sm transition-colors hover:bg-gray-50 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500';

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          Welcome{firstName ? ` ${firstName}` : ''}
        </h1>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-slate-400">Today is {todayStr}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Shift dropdown (Orlando "Staff ID" position) */}
        <div className="relative">
          <button
            type="button"
            className={btn}
            aria-haspopup="listbox"
            aria-expanded={shiftOpen}
            aria-label="Select shift"
            onClick={() => {
              setShiftOpen((v) => !v);
              setPeriodOpen(false);
              setFilterOpen(false);
            }}
          >
            <Clock size={15} aria-hidden="true" />
            {shift === 'all' ? 'All Shifts' : `${shift} Shift`}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {shiftOpen ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setShiftOpen(false)}
                aria-label="Close shift menu"
                tabIndex={-1}
              />
              <div
                role="listbox"
                aria-label="Shift"
                className="absolute right-0 z-40 mt-2 w-44 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 py-1 shadow-lg"
              >
                {(['all', 'Day', 'Night'] as ShiftSel[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="option"
                    aria-selected={shift === s}
                    onClick={() => {
                      setShift(s);
                      setShiftOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm capitalize transition-colors hover:bg-gray-50 dark:hover:bg-slate-700 ${
                      shift === s ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-300'
                    }`}
                  >
                    {s === 'all' ? 'All Shifts' : `${s} Shift`}
                    {shift === s ? <Check size={14} className="text-violet-600" aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* Period dropdown */}
        <div className="relative">
          <button
            type="button"
            className={btn}
            aria-haspopup="listbox"
            aria-expanded={periodOpen}
            aria-label="Select period"
            onClick={() => {
              setPeriodOpen((v) => !v);
              setShiftOpen(false);
              setFilterOpen(false);
            }}
          >
            <Calendar size={15} aria-hidden="true" />
            {period === 'today' ? 'Today' : 'Yesterday'}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {periodOpen ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setPeriodOpen(false)}
                aria-label="Close period menu"
                tabIndex={-1}
              />
              <div
                role="listbox"
                aria-label="Period"
                className="absolute right-0 z-40 mt-2 w-40 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 py-1 shadow-lg"
              >
                {(['today', 'yesterday'] as Period[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="option"
                    aria-selected={period === p}
                    onClick={() => {
                      setPeriod(p);
                      setPeriodOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm capitalize transition-colors hover:bg-gray-50 dark:hover:bg-slate-700 ${
                      period === p ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-300'
                    }`}
                  >
                    {p}
                    {period === p ? <Check size={14} className="text-violet-600" aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* Filter */}
        <div className="relative">
          <button
            type="button"
            className={btn}
            aria-haspopup="true"
            aria-expanded={filterOpen}
            aria-label="Filter purchase orders"
            onClick={() => {
              setFilterOpen((v) => !v);
              setPeriodOpen(false);
              setShiftOpen(false);
            }}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            Filter
            {procFilter !== 'all' ? (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                1
              </span>
            ) : null}
          </button>
          {filterOpen ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setFilterOpen(false)}
                aria-label="Close filter menu"
                tabIndex={-1}
              />
              <div
                className="absolute right-0 z-40 mt-2 w-48 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 py-1 shadow-lg"
                role="menu"
                aria-label="Purchase order status filter"
              >
                <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                  Order status
                </p>
                {(
                  [
                    ['all', 'All orders'],
                    ['Received', 'Received'],
                    ['Pending', 'Pending']
                  ] as Array<[ProcFilter, string]>
                ).map(([f, label]) => (
                  <button
                    key={f}
                    type="button"
                    role="menuitemradio"
                    aria-checked={procFilter === f}
                    onClick={() => {
                      setProcFilter(f);
                      setFilterOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors hover:bg-gray-50 dark:hover:bg-slate-700 ${
                      procFilter === f ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-300'
                    }`}
                  >
                    {label}
                    {procFilter === f ? <Check size={14} className="text-violet-600" aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* Export */}
        <button type="button" className={btn} onClick={onExport} aria-label="Export dashboard summary as CSV">
          <Download size={15} aria-hidden="true" />
          Export
        </button>
      </div>
    </div>
  );
}

// ─── Display name: skip generic/role-like names ──────────────────────────────

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

// ─── Donut: Mill Output Mix (Orlando "Staff applications card" style) ───────

interface DonutSeg {
  name: string;
  value: number;
  color: string;
}

function colorForProduct(name: string, i: number): string {
  const n = name.toLowerCase();
  if (n.includes('special')) return '#3B82F6';
  if (n.includes('duket')) return '#7C3AED';
  if (n.includes('furishka')) return '#F59E0B';
  if (n.includes('fino')) return '#10B981';
  if (n.includes('fernacho')) return '#14B8A6';
  const palette = ['#7C3AED', '#F59E0B', '#3B82F6', '#10B981', '#14B8A6', '#A78BFA'];
  return palette[i % palette.length];
}

function OutputDonut({
  segments,
  total,
  demo,
  periodLabel
}: {
  segments: DonutSeg[];
  total: number;
  demo: boolean;
  periodLabel: string;
}) {
  return (
    <section className={`${cardShell} col-span-12 lg:col-span-4`} aria-label={`Mill output mix, ${periodLabel}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Mill Output Mix</h2>
        {demo ? <DemoBadge /> : null}
      </div>
      <p className="sr-only">
        Total output {total.toLocaleString('en-US')} quintals {periodLabel}.{' '}
        {segments.map((s) => `${s.name}: ${s.value.toLocaleString('en-US')} quintals`).join('. ')}
      </p>
      <div className="relative mx-auto h-48 w-48" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="70%"
              outerRadius="95%"
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
                border: '1px solid #E5E7EB',
                fontSize: 12,
                boxShadow: '0 4px 16px rgba(15,23,42,0.08)'
              }}
              formatter={(value: unknown) => `${Number(value).toLocaleString('en-US')} Qt`}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="text-2xl font-extrabold tabular-nums tracking-tight text-gray-900 dark:text-white">
            {total.toLocaleString('en-US')}
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400">Total Output (Qt)</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2.5">
        {segments.map((s) => (
          <li key={s.name} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-gray-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="shrink-0 font-bold tabular-nums text-gray-900 dark:text-white">
              {s.value.toLocaleString('en-US')}{' '}
              <span className="text-xs font-medium text-gray-400 dark:text-slate-500">Qt</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Weekly Mill Performance (grouped bars, Orlando "Annual payroll" style) ──

interface PerfPoint {
  name: string;
  wheat: number;
  flour: number;
}

function WeeklyPerformance({ data, demo }: { data: PerfPoint[]; demo: boolean }) {
  const ct = useChartTheme();
  return (
    <section className={`${cardShell} col-span-12 lg:col-span-4`} aria-label="Weekly mill performance">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Weekly Mill Performance</h2>
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
          {demo ? <DemoBadge /> : null}
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#7C3AED]" aria-hidden="true" /> Wheat Intake
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#F59E0B]" aria-hidden="true" /> Flour Output
          </span>
        </div>
      </div>
      <p className="sr-only">
        Bar chart comparing wheat intake and flour output in quintals for the last 7 days.
      </p>
      <div className="h-64 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barGap={3}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ct.grid} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: ct.tick }}
              axisLine={false}
              tickLine={false}
              dy={6}
            />
            <YAxis
              tick={{ fontSize: 11, fill: ct.tick }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
            />
            <Tooltip
              cursor={{ fill: ct.cursor, opacity: 0.4 }}
              contentStyle={{
                borderRadius: 12,
                border: `1px solid ${ct.tooltipBorder}`,
                backgroundColor: ct.tooltipBg,
                color: ct.tooltipText,
                fontSize: 12,
                boxShadow: '0 4px 16px rgba(15,23,42,0.08)'
              }}
              formatter={(value: unknown, name: unknown) => [
                `${Number(value).toLocaleString('en-US')} Qt`,
                name === 'wheat' ? 'Wheat Intake' : 'Flour Output'
              ]}
            />
            <Bar dataKey="wheat" name="wheat" fill="#7C3AED" radius={[4, 4, 0, 0]} barSize={11} />
            <Bar dataKey="flour" name="flour" fill="#F59E0B" radius={[4, 4, 0, 0]} barSize={11} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ─── Revenue Trend (Orlando "Total income" area style) ──────────────────────

interface RevenuePoint {
  label: string;
  revenue: number;
}

const SEED_MONTHLY_REVENUE = [
  820000, 910000, 870000, 1040000, 1120000, 980000, 1060000, 1150000, 1090000, 1210000, 1180000,
  1250000
];

function RevenueTrend({ data, demo }: { data: RevenuePoint[]; demo: boolean }) {
  const ct = useChartTheme();
  const total = data.reduce((s, d) => s + d.revenue, 0);
  const target = Math.round((total / Math.max(1, data.length)) * 1.15);
  return (
    <section className={`${cardShell} col-span-12 lg:col-span-4`} aria-label="Revenue trend, last 12 months">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Revenue Trend</h2>
        {demo ? <DemoBadge /> : null}
      </div>
      <p className="text-2xl font-extrabold tabular-nums tracking-tight text-gray-900 dark:text-white">
        {total.toLocaleString('en-US')}{' '}
        <span className="text-sm font-semibold text-gray-500 dark:text-slate-400">ETB</span>
      </p>
      <p className="text-xs text-gray-500 dark:text-slate-400">in last 12 months</p>
      <p className="sr-only">
        Area chart of monthly sales revenue in birr for the last 12 months, with a target reference line at{' '}
        {target.toLocaleString('en-US')} birr.
      </p>
      <div className="mt-2 h-52 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 4, left: -4, bottom: 0 }}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#7C3AED" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ct.grid} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: ct.tick }}
              axisLine={false}
              tickLine={false}
              dy={6}
              interval={1}
            />
            <YAxis
              tick={{ fontSize: 11, fill: ct.tick }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${Math.round(v / 1000)}k`)}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: `1px solid ${ct.tooltipBorder}`,
                backgroundColor: ct.tooltipBg,
                color: ct.tooltipText,
                fontSize: 12,
                boxShadow: '0 4px 16px rgba(15,23,42,0.08)'
              }}
              formatter={(value: unknown) => [`${Number(value).toLocaleString('en-US')} ETB`, 'Revenue']}
            />
            <ReferenceLine
              y={target}
              stroke="#DC2626"
              strokeDasharray="6 4"
              strokeOpacity={0.7}
              label={{
                value: 'Target',
                fontSize: 10,
                fill: '#FFFFFF',
                position: 'insideTopRight'
              }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#7C3AED"
              strokeWidth={2.5}
              fill="url(#revGrad)"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ─── Orlando tables ─────────────────────────────────────────────────────────

const TH = 'px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400';
const TD = 'px-3 py-3 text-sm text-gray-700 dark:text-slate-200';

interface ProcRow {
  date: string;
  supplier: string;
  wheatType: string;
  qty: number;
  status: 'Received' | 'Pending' | string;
}

function PurchaseOrdersTable({
  rows,
  demo,
  filter
}: {
  rows: ProcRow[];
  demo: boolean;
  filter: ProcFilter;
}) {
  const visible = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  return (
    <section className={`${cardShell} col-span-12 lg:col-span-6`} aria-label="Recent purchase orders">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Recent Purchase Orders</h2>
        <div className="flex items-center gap-2">
          {demo ? <DemoBadge /> : null}
          <Link
            to="/purchase-orders"
            className="text-xs font-semibold text-violet-600 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
          >
            View all
          </Link>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-200 dark:border-slate-700">
              <th scope="col" className={TH}>S/N</th>
              <th scope="col" className={TH}>Supplier</th>
              <th scope="col" className={TH}>Date</th>
              <th scope="col" className={TH}>Wheat Type</th>
              <th scope="col" className={`${TH} text-right`}>Qty (Qt)</th>
              <th scope="col" className={`${TH} text-right`}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
            {visible.map((r, i) => (
              <tr key={`${r.supplier}-${i}`} className="transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/30">
                <td className="px-3 py-3 text-sm tabular-nums text-gray-400 dark:text-slate-500">
                  {String(i + 1).padStart(2, '0')}
                </td>
                <td className={`${TD} max-w-[180px] truncate font-medium`}>{r.supplier}</td>
                <td className={`${TD} whitespace-nowrap tabular-nums`}>{r.date}</td>
                <td className={TD}>{r.wheatType}</td>
                <td className={`${TD} text-right font-semibold tabular-nums`}>{r.qty.toLocaleString('en-US')}</td>
                <td className="px-3 py-3 text-right">
                  <StatusPill status={r.status} />
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
                  No purchase orders match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface PayableRow {
  vendor: string;
  invoiceNo: string;
  amount: number;
  dueDate: string;
  status: 'Overdue' | 'Due Soon' | 'Current';
}

const SEED_PAYABLES: PayableRow[] = [
  { vendor: 'Alemu Trading PLC', invoiceNo: 'AP-2025-0142', amount: 62500, dueDate: 'Apr 10, 2025', status: 'Overdue' },
  { vendor: 'Debre Berhan Farmers', invoiceNo: 'AP-2025-0145', amount: 48200, dueDate: 'Apr 16, 2025', status: 'Due Soon' },
  { vendor: 'Selam Agricultural Coop', invoiceNo: 'AP-2025-0148', amount: 37750, dueDate: 'Apr 20, 2025', status: 'Current' },
  { vendor: 'Addis Grain Traders', invoiceNo: 'AP-2025-0151', amount: 29800, dueDate: 'Apr 22, 2025', status: 'Current' }
];

function PayablesTable({ rows, demo }: { rows: PayableRow[]; demo: boolean }) {
  const visible = rows.length > 0 ? rows : SEED_PAYABLES;
  const showDemo = rows.length === 0 ? true : demo;
  const totals = useMemo(() => {
    let current = 0;
    let dueSoon = 0;
    let overdue = 0;
    for (const r of visible) {
      const s = r.status.toLowerCase();
      if (s.includes('overdue')) overdue += r.amount;
      else if (s.includes('due soon') || s.includes('pending')) dueSoon += r.amount;
      else current += r.amount;
    }
    return { current, dueSoon, overdue, total: current + dueSoon + overdue };
  }, [visible]);
  return (
    <section className={`${cardShell} col-span-12 lg:col-span-6`} aria-label="Vendor payables aging">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Vendor Payables</h2>
        <div className="flex items-center gap-2">
          {showDemo ? <DemoBadge /> : null}
          <Link
            to="/finance/accounts-payable"
            className="rounded text-xs font-semibold text-violet-600 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            View all
          </Link>
        </div>
      </div>
      {/* Aging summary — Orlando "Budget history" style totals */}
      <div className="mb-3 grid grid-cols-3 gap-2" role="list" aria-label="Payables aging summary">
        <div role="listitem" className="rounded-xl border border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 px-3 py-2">
          <p className="text-[11px] font-medium text-gray-500 dark:text-slate-400">Current</p>
          <p className="text-sm font-extrabold tabular-nums text-gray-900 dark:text-white">
            {totals.current.toLocaleString('en-US')}
          </p>
        </div>
        <div role="listitem" className="rounded-xl border border-amber-100 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">Due Soon</p>
          <p className="text-sm font-extrabold tabular-nums text-amber-800 dark:text-amber-200">
            {totals.dueSoon.toLocaleString('en-US')}
          </p>
        </div>
        <div role="listitem" className="rounded-xl border border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-3 py-2">
          <p className="text-[11px] font-medium text-red-700 dark:text-red-300">Overdue</p>
          <p className="text-sm font-extrabold tabular-nums text-red-800 dark:text-red-200">
            {totals.overdue.toLocaleString('en-US')}
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-200 dark:border-slate-700">
              <th scope="col" className={TH}>S/N</th>
              <th scope="col" className={TH}>Vendor</th>
              <th scope="col" className={TH}>Invoice</th>
              <th scope="col" className={`${TH} text-right`}>Amount (ETB)</th>
              <th scope="col" className={TH}>Due Date</th>
              <th scope="col" className={TH}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
            {visible.map((r, i) => (
              <tr key={`${r.invoiceNo}-${i}`} className="transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/30">
                <td className="px-3 py-3 text-sm tabular-nums text-gray-400 dark:text-slate-500">
                  {String(i + 1).padStart(2, '0')}
                </td>
                <td className={`${TD} max-w-[160px] truncate font-medium`}>{r.vendor}</td>
                <td className={`${TD} whitespace-nowrap tabular-nums text-gray-500 dark:text-slate-400`}>
                  {r.invoiceNo}
                </td>
                <td className={`${TD} text-right font-bold tabular-nums text-gray-900 dark:text-white`}>
                  {r.amount.toLocaleString('en-US')}
                </td>
                <td className={`${TD} whitespace-nowrap tabular-nums`}>{r.dueDate}</td>
                <td className="px-3 py-3">
                  <StatusPill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/40">
              <td colSpan={3} className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                Total outstanding
              </td>
              <td className="px-3 py-2.5 text-right text-sm font-extrabold tabular-nums text-gray-900 dark:text-white">
                {totals.total.toLocaleString('en-US')}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

// ─── Quality Alerts + Shift Monitor ─────────────────────────────────────────

interface AlertItem {
  title: string;
  sub: string;
  time: string;
  severity: 'critical' | 'warning';
}

const SEED_ALERTS: AlertItem[] = [
  { title: 'Moisture above threshold', sub: 'Sample WB-1045 • 14.6% (max 14.0%)', time: '10:15 AM', severity: 'critical' },
  { title: 'CAPA overdue', sub: 'Corrective action past due date', time: 'Yesterday', severity: 'warning' },
  { title: 'Duket yield below 78%', sub: 'Latest shift extraction 76.2%', time: 'Yesterday', severity: 'warning' }
];

function QualityAlerts({ items }: { items: AlertItem[] }) {
  const visible = items.length > 0 ? items : SEED_ALERTS;
  return (
    <section className={`${cardShell} col-span-12 lg:col-span-6`} aria-label="Quality alerts">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 dark:text-white">
          <FlaskConical size={16} className="text-violet-600" aria-hidden="true" />
          Quality Alerts
        </h2>
        <div className="flex items-center gap-2">
          {items.length === 0 ? <DemoBadge /> : null}
          <Link
            to="/qc"
            className="rounded text-xs font-semibold text-violet-600 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            View all
          </Link>
        </div>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-slate-700/60">
        {visible.map((a, i) => (
          <li key={`${a.title}-${i}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                a.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-500'
              }`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-800 dark:text-slate-100">{a.title}</p>
              <p className="truncate text-xs text-gray-500 dark:text-slate-400">{a.sub}</p>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-gray-400 dark:text-slate-500">
              <Clock size={12} aria-hidden="true" />
              {a.time}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

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

function ShiftMonitorCard({ data }: { data: ShiftMonitorData }) {
  const rows = [
    { icon: <Gauge size={16} />, label: 'Active Shift', value: data.shiftName, sub: `Operator: ${data.operator}` },
    { icon: <FlaskConical size={16} />, label: 'Next Lab Check', value: data.nextLabCheck, sub: data.nextLabSub },
    { icon: <Truck size={16} />, label: 'Mill Uptime', value: data.uptime, sub: data.uptimeSub },
    { icon: <Wheat size={16} />, label: 'Blend Ratio', value: data.blend, sub: data.blendSub }
  ];
  return (
    <section className={`${cardShell} col-span-12 lg:col-span-6`} aria-label="Shift monitor">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 dark:text-white">
          <Gauge size={16} className="text-violet-600" aria-hidden="true" />
          Shift Monitor
        </h2>
        <div className="flex items-center gap-2">
          {data.demo ? <DemoBadge /> : null}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
            LIVE
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className="rounded-xl border border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-700/30 p-3.5"
          >
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
              <span className="text-violet-500" aria-hidden="true">{r.icon}</span>
              {r.label}
            </dt>
            <dd className="mt-2 truncate text-sm font-extrabold tabular-nums text-gray-900 dark:text-white">
              {r.value}
            </dd>
            <dd className="mt-0.5 truncate text-xs text-gray-500 dark:text-slate-400">{r.sub}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ─── CSV export ─────────────────────────────────────────────────────────────

function exportCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Main dashboard ─────────────────────────────────────────────────────────

export function Dashboard() {
  const { user } = useAuth();
  const REFETCH = 60000;
  const [period, setPeriod] = useState<Period>('today');
  const [procFilter, setProcFilter] = useState<ProcFilter>('all');
  const [shift, setShift] = useState<ShiftSel>('all');

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
  const salesQ = useQuery({
    queryKey: ['dashboard-sales-invoices'],
    queryFn: async () => (await api.get<SalesInvoice[]>(`${E.salesInvoices}?pageSize=200`)).data,
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

  const todayKey = dayKey(new Date());
  const yesterdayKey = dayKey(new Date(nowMs - 24 * 3600 * 1000));
  const dayBeforeKey = dayKey(new Date(nowMs - 2 * 24 * 3600 * 1000));
  const periodKey = period === 'today' ? todayKey : yesterdayKey;
  const periodPrevKey = period === 'today' ? yesterdayKey : dayBeforeKey;
  const periodLabel = period === 'today' ? 'today' : 'yesterday';

  const shiftFlour = (sh: ShiftRun) => (sh.outputs ?? []).reduce((a, o) => a + safeNum(o.quintals), 0);

  // ── Intake / output per day ──────────────────────────────────────────────
  const intakeForDay = (key: string): number | null =>
    intakesQ.isSuccess
      ? intakes
          .filter((i) => i.status === 'ACCEPTED' && dayKey(new Date(i.deliveryDate)) === key)
          .reduce((s, i) => s + safeNum(i.quintals), 0)
      : null;
  const intakeCur = intakeForDay(periodKey);
  const intakePrev = intakeForDay(periodPrevKey);

  const outputForDay = (key: string): number | null =>
    detailsReady
      ? details
          .filter((sh) => dayKey(new Date(sh.shiftDate ?? sh.startedAt)) === key)
          .reduce((s, sh) => s + shiftFlour(sh), 0)
      : null;
  const outputCur = outputForDay(periodKey);
  const outputPrev = outputForDay(periodPrevKey);

  // ── Extraction rate (month to date) ──────────────────────────────────────
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

  // ── QC pass rate ─────────────────────────────────────────────────────────
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
  const openCapas = capasQ.isSuccess ? capas.filter((c) => c.status !== 'CLOSED').length : null;

  // ── 4 Orlando KPI cards ───────────────────────────────────────────────────
  const kpiSpecs: KpiSpec[] = [
    {
      icon: <Wheat size={18} />,
      chip: 'bg-orange-500',
      label: `${period === 'today' ? "Today's" : "Yesterday's"} Wheat Intake (Qt)`,
      value: (intakeCur ?? SEED_PILLARS.intakeToday.value).toLocaleString('en-US'),
      trendPct:
        intakeCur !== null && intakePrev !== null
          ? pctChange(intakeCur, intakePrev)
          : SEED_PILLARS.intakeToday.trendPct,
      trendSuffix: period === 'today' ? 'yesterday' : 'the day before',
      demo: intakeCur === null,
      to: '/intake'
    },
    {
      icon: <Factory size={18} />,
      chip: 'bg-blue-500',
      label: `${period === 'today' ? "Today's" : "Yesterday's"} Mill Output (Qt)`,
      value: (outputCur ?? SEED_PILLARS.outputToday.value).toLocaleString('en-US'),
      trendPct:
        outputCur !== null && outputPrev !== null
          ? pctChange(outputCur, outputPrev)
          : SEED_PILLARS.outputToday.trendPct,
      trendSuffix: period === 'today' ? 'yesterday' : 'the day before',
      demo: outputCur === null,
      to: '/production'
    },
    {
      icon: <Percent size={18} />,
      chip: 'bg-violet-600',
      label: 'Net Extraction Rate (month to date)',
      value: `${(extractionRate ?? SEED_PILLARS.extraction.value).toFixed(1)}%`,
      customTrend:
        extractionRate !== null ? (
          extractionRate >= 78 ? (
            <p className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <Check size={14} aria-hidden="true" />
              On target (≥ 78%)
            </p>
          ) : (
            <p className="mt-2 flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400">
              <AlertTriangle size={14} aria-hidden="true" />
              Below target (≥ 78%)
            </p>
          )
        ) : (
          <p className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <Check size={14} aria-hidden="true" />
            On target (≥ 78%)
          </p>
        ),
      demo: extractionRate === null,
      to: '/production'
    },
    {
      icon: <ShieldCheck size={18} />,
      chip: 'bg-emerald-500',
      label: `Lab Quality Pass Rate${openCapas !== null ? ` • ${openCapas} open CAPAs` : ''}`,
      value: `${(qcPass ?? SEED_PILLARS.qualityPass.value).toFixed(1)}%`,
      customTrend:
        qcPass !== null && qcPassPrevWeek !== null ? (
          (() => {
            const diff = qcPass - qcPassPrevWeek;
            if (Math.abs(diff) < 0.05) return null;
            const up = diff > 0;
            return (
              <p
                className={`mt-2 flex items-center gap-1 text-xs font-medium ${
                  up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {up ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
                <span className="tabular-nums">{Math.abs(diff).toFixed(1)} pts vs last week</span>
              </p>
            );
          })()
        ) : (
          <TrendLine pct={qcPass === null ? SEED_PILLARS.qualityPass.trendPct : null} suffix="last week" />
        ),
      demo: qcPass === null,
      to: '/qc'
    }
  ];

  // ── Weekly performance chart data ────────────────────────────────────────
  const perfData: PerfPoint[] = useMemo(() => {
    const days = lastNDays(7);
    const byKey = new Map(days.map((d) => [d.key, { name: d.label, wheat: 0, flour: 0 } as PerfPoint]));
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
  const hasPerfData = perfData.some((p) => p.wheat > 0 || p.flour > 0);
  const chartData: PerfPoint[] = hasPerfData
    ? perfData
    : SEED_PRODUCTION_CHART.labels.map((name, i) => ({
        name,
        wheat: SEED_PRODUCTION_CHART.wheatReceived[i],
        flour: SEED_PRODUCTION_CHART.flourProduced[i]
      }));

  // ── Donut segments for the selected period ────────────────────────────────
  const donut = useMemo(() => {
    const byName = new Map<string, number>();
    for (const sh of details) {
      const t = new Date(sh.shiftDate ?? sh.startedAt).getTime();
      if (!Number.isFinite(t) || dayKey(new Date(t)) !== periodKey) continue;
      for (const o of sh.outputs ?? []) {
        const name = o.product?.name?.trim() || 'Other';
        byName.set(name, (byName.get(name) ?? 0) + safeNum(o.quintals));
      }
    }
    const total = [...byName.values()].reduce((s, v) => s + v, 0);
    const segs: DonutSeg[] = [...byName.entries()]
      .map(([name, value], i) => ({ name, value, color: colorForProduct(name, i) }))
      .sort((a, b) => b.value - a.value);
    return { segs, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details, periodKey]);
  const donutDemo = donut.segs.length === 0;
  const donutSegments: DonutSeg[] = donutDemo
    ? SEED_PRODUCT_OUTPUT.map((s) => ({ name: s.name, value: s.value, color: s.color }))
    : donut.segs;
  const donutTotal = donutDemo ? SEED_TOTAL_FLOUR : donut.total;

  // ── Revenue trend (12 months from sales invoices) ─────────────────────────
  const revenue = useMemo(() => {
    const months = lastNMonths(12);
    const sums = new Map(months.map((m) => [m.key, 0]));
    let live = false;
    if (salesQ.isSuccess && Array.isArray(salesQ.data)) {
      for (const inv of salesQ.data) {
        const t = new Date(inv.invoicedAt ?? inv.createdAt).getTime();
        if (!Number.isFinite(t)) continue;
        const d = new Date(t);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (sums.has(key)) {
          sums.set(key, (sums.get(key) ?? 0) + safeNum(inv.amountBirr));
          live = true;
        }
      }
    }
    if (!live) {
      months.forEach((m, i) => sums.set(m.key, SEED_MONTHLY_REVENUE[i % SEED_MONTHLY_REVENUE.length]));
    }
    return {
      data: months.map((m) => ({ label: m.label, revenue: Math.round(sums.get(m.key) ?? 0) })),
      live
    };
  }, [salesQ.isSuccess, salesQ.data]);

  // ── Procurement rows ──────────────────────────────────────────────────────
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
        .slice(0, 6)
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

  // ── Payables rows ─────────────────────────────────────────────────────────
  const payableRows: PayableRow[] = useMemo(() => {
    if (!apInvoicesQ.isSuccess) return [];
    return [...apInvoices]
      .filter((inv) => inv.status !== 'PAID')
      .map((inv) => {
        const paid = (inv.payments ?? []).reduce((a, p) => a + safeNum(p.amountBirr), 0);
        const balance = Math.max(0, safeNum(inv.amountBirr) - paid);
        const due = inv.dueDate ? new Date(inv.dueDate).getTime() : NaN;
        const daysOver = Number.isFinite(due) ? Math.floor((nowMs - due) / 86400000) : -999;
        const status: PayableRow['status'] =
          daysOver > 0 ? 'Overdue' : daysOver > -7 ? 'Due Soon' : 'Current';
        return {
          vendor: inv.intake?.supplier?.name ?? '—',
          invoiceNo: inv.invoiceNo,
          amount: balance,
          dueDate: inv.dueDate ? fmtDate(inv.dueDate) : '—',
          status
        };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apInvoicesQ.isSuccess, apInvoices, nowMs]);
  const payablesDemo = apInvoicesQ.isSuccess && payableRows.length === 0;

  // ── Quality alerts ────────────────────────────────────────────────────────
  const alerts: AlertItem[] = useMemo(() => {
    const items: AlertItem[] = [];
    const flagged = [...labChecks]
      .filter((c) => (c.outOfRange ?? []).length > 0)
      .sort((a, b) => new Date(b.sampleTime).getTime() - new Date(a.sampleTime).getTime())
      .slice(0, 3);
    for (const c of flagged) {
      const ts = new Date(c.sampleTime).getTime();
      items.push({
        title: 'Lab sample out of range',
        sub: (c.outOfRange ?? []).join(', '),
        time: Number.isFinite(ts) ? relTime(ts) : '—',
        severity: 'critical'
      });
    }
    const open = [...capas]
      .filter((c) => c.status !== 'CLOSED')
      .slice(0, Math.max(0, 4 - items.length));
    for (const c of open) {
      items.push({
        title: 'Open CAPA requires action',
        sub: `CAPA ${c.capaNo} • ${c.issueDescription.slice(0, 40)}`,
        time: 'Open',
        severity: 'warning'
      });
    }
    return items.slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labChecks, capas]);

  // ── Shift monitor ─────────────────────────────────────────────────────────
  const shiftMonitor: ShiftMonitorData = useMemo(() => {
    const openBatch = batchesQ.isSuccess ? batches.find((b) => b.status === 'OPEN') : null;
    const todayShifts = detailsReady
      ? details.filter((sh) => dayKey(new Date(sh.shiftDate ?? sh.startedAt)) === todayKey)
      : [];
    const shiftFiltered =
      shift === 'all'
        ? todayShifts
        : todayShifts.filter(
            (sh) => String(sh.shift ?? '').toLowerCase().includes(shift.toLowerCase())
          );
    const latestShift = (shiftFiltered[0] ?? todayShifts[0]) ?? null;
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
        blendParts.push(
          `${Math.round((hw / tot) * 100)}% Hard`,
          `${Math.round((sw / tot) * 100)}% Soft`,
          `${Math.round((fw / tot) * 100)}% Foreign`
        );
      }
    }
    return {
      shiftName: latestShift ? `Shift ${latestShift.shift}` : 'Shift 1 (Morning)',
      operator: latestShift?.operators?.[0] ?? 'Abebe K.',
      nextLabCheck: 'In 24 Mins',
      nextLabSub: '2-hour inspection cycle',
      uptime: uptimePct !== null ? `${uptimePct.toFixed(1)}% Uptime` : '95.8% Uptime',
      uptimeSub:
        totalDownMin > 0 ? `${Math.round(totalDownMin)}m downtime logged today` : 'No downtime logged',
      blend: blendParts.length > 0 ? blendParts.join(' • ') : '50% Hard • 30% Soft • 20% Foreign',
      blendSub: openBatch ? `Batch ${openBatch.batchNo}` : 'No open batch',
      demo: false
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchesQ.isSuccess, batches, detailsReady, details, todayKey, nowMs, shift]);

  const firstName = displayFirstName(user);

  const handleExport = () => {
    const rows: string[][] = [
      ['Oyaya ERP — Dashboard Summary', new Date().toLocaleString()],
      [],
      ['KPI', 'Value'],
      ["Wheat Intake", `${(intakeCur ?? 0).toLocaleString('en-US')} Qt`],
      ["Mill Output", `${(outputCur ?? 0).toLocaleString('en-US')} Qt`],
      ["Net Extraction Rate", `${(extractionRate ?? 0).toFixed(1)}%`],
      ["Lab Quality Pass Rate", `${(qcPass ?? 0).toFixed(1)}%`],
      [],
      ['Recent Purchase Orders'],
      ['S/N', 'Supplier', 'Date', 'Wheat Type', 'Qty (Qt)', 'Status'],
      ...procRows.map((r, i) => [
        String(i + 1).padStart(2, '0'),
        r.supplier,
        r.date,
        r.wheatType,
        String(r.qty),
        r.status
      ]),
      [],
      ['Vendor Payables'],
      ['S/N', 'Vendor', 'Invoice', 'Amount (ETB)', 'Due Date', 'Status'],
      ...(payableRows.length > 0 ? payableRows : SEED_PAYABLES).map((r, i) => [
        String(i + 1).padStart(2, '0'),
        r.vendor,
        r.invoiceNo,
        String(r.amount),
        r.dueDate,
        r.status
      ])
    ];
    exportCsv(`oyaya-dashboard-${dayKey(new Date())}.csv`, rows);
  };

  if (kpisQ.isLoading && intakesQ.isLoading && shiftsQ.isLoading) {
    return <SkeletonDashboard />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        firstName={firstName}
        period={period}
        setPeriod={setPeriod}
        shift={shift}
        setShift={setShift}
        procFilter={procFilter}
        setProcFilter={setProcFilter}
        onExport={handleExport}
      />

      {/* 4 KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiSpecs.map((s) => (
          <KpiCard key={s.label} spec={s} />
        ))}
      </div>

      {/* Donut + weekly bars + revenue */}
      <div className="grid grid-cols-12 gap-4">
        <OutputDonut segments={donutSegments} total={donutTotal} demo={donutDemo} periodLabel={periodLabel} />
        <WeeklyPerformance data={chartData} demo={!hasPerfData} />
        <RevenueTrend data={revenue.data} demo={!revenue.live} />
      </div>

      {/* Tables */}
      <div className="grid grid-cols-12 gap-4">
        <PurchaseOrdersTable rows={procRows} demo={procDemo} filter={procFilter} />
        <PayablesTable rows={payableRows} demo={payablesDemo} />
      </div>

      {/* Alerts + shift */}
      <div className="grid grid-cols-12 gap-4">
        <QualityAlerts items={alerts} />
        <ShiftMonitorCard data={shiftMonitor} />
      </div>
    </div>
  );
}
