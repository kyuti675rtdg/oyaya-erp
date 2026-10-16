import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { FlatKpis, ProductionBatch } from '../types';
import { useAuth } from '../store/auth';
import { KpiCard } from '../components/KpiCard';
import { BarChart } from '../components/charts/BarChart';
import { DonutChart } from '../components/charts/DonutChart';
import { SkeletonDashboard } from '../components/Skeleton';
import { ErrorBox } from '../components/ui';
import { fmtBirr, fmtDateTime, fmtQ } from '../lib/format';

// ─── Inline SVG icons for KPI cards ──────────────────────────────────────────
const WheatIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
    <path d="M12 22V9" strokeLinecap="round" />
    <path d="M12 9C12 5.5 9.5 3 6 3c0 3.5 2.5 6 6 6zM12 9c0-3.5 2.5-6 6-6 0 3.5-2.5 6-6 6z" strokeLinejoin="round" />
    <path d="M12 14c0-3.5-2.5-6-6-6 0 3.5 2.5 6 6 6zM12 14c0-3.5 2.5-6 6-6 0 3.5-2.5 6-6 6z" strokeLinejoin="round" />
  </svg>
);

const CurrencyIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
    <path d="M6 9.5V8a4 4 0 014-4h4a4 4 0 014 4v1.5" strokeLinecap="round" />
    <rect x="3" y="9" width="18" height="11" rx="2.5" />
    <circle cx="12" cy="14.5" r="2" />
  </svg>
);

const AlertIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
    <path d="M12 3L2.5 20h19L12 3z" strokeLinejoin="round" />
    <path d="M12 10v4" strokeLinecap="round" />
    <circle cx="12" cy="17" r="0.7" fill="currentColor" />
  </svg>
);

const CheckIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.8 2.8L16.5 9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Friendly mill-themed empty-state illustration (inline SVG). */
const BatchEmptyIcon = (
  <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-14 w-14 text-violet-light">
    <circle cx="24" cy="24" r="12" />
    <circle cx="44" cy="42" r="12" />
    <path d="M32 24h8a4 4 0 014 4v6" strokeLinecap="round" />
  </svg>
);

const DONUT_COLORS = ['#7C3AED', '#8B5CF6', '#C4B5FD', '#4C1D95'];

const cardShell =
  'rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(76,29,149,0.06),0_4px_16px_rgba(76,29,149,0.05)]';

function tankShort(code: string): string {
  const c = code.replace('TANK_', '');
  return c.length === 1 ? `Tank ${c}` : c;
}

function greetingForHour(h: number): string {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard() {
  const { user } = useAuth();
  const [batchSearch, setBatchSearch] = useState('');

  const kpisQ = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: async () => (await api.get<FlatKpis>(E.dashboardKpis)).data,
    refetchInterval: 60000
  });

  const batchesQ = useQuery({
    queryKey: ['dashboard-recent-batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(`${E.batches}?pageSize=8`)).data,
    refetchInterval: 60000
  });

  const k = kpisQ.data;

  // Wheat in stock = dry pool balance + sum of tank levels
  const wheatStockQ = useMemo(() => {
    if (!k) return null;
    const tankSum = k.tanks.reduce((s, t) => s + Number(t.levelQ ?? 0), 0);
    return Number(k.dryPool.balanceQ ?? 0) + tankSum;
  }, [k]);

  const storageBars = useMemo(() => {
    if (!k) return [];
    return [
      { label: 'Dry Pool', seriesA: Number(k.dryPool.balanceQ ?? 0), seriesB: Number(k.dryPool.capacityQ ?? 0) },
      ...k.tanks.map((t) => ({
        label: tankShort(t.code),
        seriesA: Number(t.levelQ ?? 0),
        seriesB: Number(t.capacityQ ?? 0)
      }))
    ];
  }, [k]);

  const donutSegments = useMemo(() => {
    if (!k) return [];
    const segs = [
      { label: 'Dry Pool', value: Number(k.dryPool.balanceQ ?? 0), color: DONUT_COLORS[0] },
      ...k.tanks.map((t, i) => ({
        label: tankShort(t.code),
        value: Number(t.levelQ ?? 0),
        color: DONUT_COLORS[(i + 1) % DONUT_COLORS.length]
      }))
    ];
    return segs;
  }, [k]);

  const filteredBatches = useMemo(() => {
    const list = batchesQ.data ?? [];
    const q = batchSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((b) => b.batchNo.toLowerCase().includes(q));
  }, [batchesQ.data, batchSearch]);

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

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="animate-fade-in-up">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-[28px]">
          {greeting}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-slate-500">Here&rsquo;s your mill operations overview</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          index={0}
          icon={WheatIcon}
          tone="violet"
          label="Wheat in stock"
          value={wheatStockQ === null ? '—' : `${fmtQ(wheatStockQ)} q`}
        />
        <KpiCard
          index={1}
          icon={CurrencyIcon}
          tone="green"
          label="Month revenue"
          value={k ? fmtBirr(k.monthRevenue) : '—'}
        />
        <KpiCard
          index={2}
          icon={AlertIcon}
          tone="amber"
          label="Open CAPAs"
          value={k ? k.openCapas : '—'}
        />
        <KpiCard
          index={3}
          icon={CheckIcon}
          tone="blue"
          label="QC compliance (7d)"
          value={k?.qcCompliancePct === null || k?.qcCompliancePct === undefined ? '—' : `${k.qcCompliancePct.toFixed(1)}%`}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Storage levels bar chart */}
        <div
          className={`${cardShell} animate-fade-in-up xl:col-span-2`}
          style={{ animationDelay: '240ms' }}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">Storage Levels</h2>
            <span className="rounded-full bg-lavender-bg px-3 py-1 text-xs font-semibold text-slate-500">
              Quintals
            </span>
          </div>
          <BarChart
            data={storageBars}
            seriesALabel="Stock"
            seriesBLabel="Capacity"
            colorA="#7C3AED"
            colorB="#DDD3F8"
          />
        </div>

        {/* Wheat distribution donut */}
        <div className={`${cardShell} animate-fade-in-up`} style={{ animationDelay: '300ms' }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">Wheat Distribution</h2>
            <span className="rounded-full bg-lavender-bg px-3 py-1 text-xs font-semibold text-slate-500">
              By location
            </span>
          </div>
          {donutSegments.length > 0 && wheatStockQ !== null ? (
            <DonutChart
              segments={donutSegments}
              centerValue={`${fmtQ(wheatStockQ)}`}
              centerLabel="Total quintals"
            />
          ) : (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <p className="font-semibold text-slate-700">No wheat data yet</p>
              <p className="mt-1 text-sm text-slate-500">Distribution will appear here.</p>
            </div>
          )}
        </div>
      </div>

      {/* Recent batches table */}
      <div className={`${cardShell} animate-fade-in-up`} style={{ animationDelay: '360ms' }}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-bold text-ink">Recent Batches</h2>
          <div className="relative w-full sm:max-w-xs">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13.5 13.5L17 17" strokeLinecap="round" />
            </svg>
            <input
              value={batchSearch}
              onChange={(e) => setBatchSearch(e.target.value)}
              placeholder="Search batches…"
              className="w-full rounded-xl border border-line bg-lavender-bg py-2 pl-9 pr-3 text-sm text-ink outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-violet-light focus:bg-white focus:ring-2 focus:ring-violet-primary/20"
              aria-label="Search batches"
            />
          </div>
        </div>

        {batchesQ.isLoading ? (
          <div className="space-y-2.5 py-2" role="status" aria-label="Loading batches">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton-shimmer h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : batchesQ.isError ? (
          <ErrorBox
            message={batchesQ.error instanceof Error ? batchesQ.error.message : 'Could not load batches.'}
            onRetry={() => batchesQ.refetch()}
          />
        ) : filteredBatches.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            {BatchEmptyIcon}
            <p className="mt-4 text-base font-bold text-ink">
              {batchSearch ? 'No matching batches' : 'No batches yet'}
            </p>
            <p className="mt-1 max-w-xs text-sm text-slate-500">
              {batchSearch
                ? 'Try a different search term.'
                : 'Your milling batches will appear here once production begins.'}
            </p>
            {!batchSearch && (
              <Link
                to="/shifts"
                className="focus-ring-violet mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-primary px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(124,58,237,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-dark hover:shadow-[0_8px_20px_rgba(124,58,237,0.4)] active:translate-y-0"
              >
                Go to Shift Milling
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                  <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                  <th className="pb-3 pr-4">Batch #</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Created</th>
                  <th className="pb-3 text-right">Output</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b border-line/60 transition-colors duration-150 last:border-0 hover:bg-violet-pale/40"
                  >
                    <td className="py-3 pr-4">
                      <Link
                        to={`/batches/${b.id}`}
                        className="focus-ring-violet rounded font-semibold text-violet-dark hover:underline"
                      >
                        {b.batchNo}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          b.status === 'OPEN'
                            ? 'bg-pass-bg text-pass-text'
                            : b.status === 'CLOSED'
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-advisory-bg text-advisory-text'
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-500">{fmtDateTime(b.createdAt)}</td>
                    <td className="tnum py-3 text-right font-semibold tabular-nums text-ink">
                      {fmtQ(b.wheatWeighedQ)} q
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
