import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ChartBar,
  Droplets,
  Gauge,
  Printer,
  Shuffle,
  Timer,
  Wheat
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { ConditioningCycle, ConditioningTank, DryPoolDetail, StorageMovementRow, TankBlend } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, ErrorBox, Field, Select, Spinner, TextInput } from '../components/ui';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const MOIST_MIN = 15.0;
const MOIST_MAX = 16.5;
const BLEND_TARGET = { soft: 50, hard: 30, foreign: 20 };
const DEVIATION_TOL = 5;

type PeriodKey = 'today' | 'last7' | 'last30' | 'custom';
type TabKey = 'stock' | 'utilization' | 'cycles' | 'blends' | 'movements';

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'stock', label: 'Stock Position', icon: <Boxes className="h-4 w-4" /> },
  { key: 'utilization', label: 'Tank Utilization', icon: <Gauge className="h-4 w-4" /> },
  { key: 'cycles', label: 'Conditioning Cycles', icon: <Timer className="h-4 w-4" /> },
  { key: 'blends', label: 'Blend Compliance', icon: <Shuffle className="h-4 w-4" /> },
  { key: 'movements', label: 'Movement Summary', icon: <ChartBar className="h-4 w-4" /> }
];

/* ── CSV helpers ──────────────────────────────────────────────────────────── */
function csvEscape(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
  a.remove();
  URL.revokeObjectURL(url);
}

/* ── Formatting ───────────────────────────────────────────────────────────── */
function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}
const pct = (n: number, d: number): number => (d > 0 ? (n / d) * 100 : 0);

function UtilizationBar({ value, color = 'bg-amber-500' }: { value: number; color?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 print:bg-slate-200">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function StorageReports() {
  const [tab, setTab] = useState<TabKey>('stock');
  const [period, setPeriod] = useState<PeriodKey>('last7');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = useMemo(() => {
    const now = new Date();
    const end = now.toISOString();
    switch (period) {
      case 'today': {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        return { from: start.toISOString(), to: end };
      }
      case 'last7':
        return { from: new Date(now.getTime() - 7 * 86400000).toISOString(), to: end };
      case 'last30':
        return { from: new Date(now.getTime() - 30 * 86400000).toISOString(), to: end };
      case 'custom': {
        const from = customFrom ? new Date(`${customFrom}T00:00:00`).toISOString() : null;
        const to = customTo ? new Date(`${customTo}T23:59:59`).toISOString() : end;
        return from ? { from, to } : { from: new Date(now.getTime() - 7 * 86400000).toISOString(), to: end };
      }
    }
  }, [period, customFrom, customTo]);

  const fileSuffix = `${range.from.slice(0, 10)}-to-${range.to.slice(0, 10)}`;

  const tanksQ = useQuery({
    queryKey: ['tanks'],
    queryFn: async () => (await api.get<ConditioningTank[]>(E.tanks)).data
  });
  const dryPoolQ = useQuery({
    queryKey: ['dryPoolDetail'],
    queryFn: async () => (await api.get<DryPoolDetail>(E.dryPoolDetail)).data
  });
  const cyclesQ = useQuery({
    queryKey: ['storageCycles', range.from, range.to],
    queryFn: async () => (await api.get<ConditioningCycle[]>(E.cycles, { params: { from: range.from, to: range.to } })).data
  });
  const blendsQ = useQuery({
    queryKey: ['blends'],
    queryFn: async () => (await api.get<TankBlend[]>(E.blends)).data
  });
  const movementsQ = useQuery({
    queryKey: ['movementsFiltered', range.from, range.to],
    queryFn: async () =>
      (await api.get<StorageMovementRow[]>(E.movementsFiltered, { params: { from: range.from, to: range.to } })).data
  });

  const tanks = tanksQ.data ?? [];
  const dryPool = dryPoolQ.data;
  const cycles = cyclesQ.data ?? [];
  const blends = blendsQ.data ?? [];
  const movements = movementsQ.data ?? [];

  /* ── Tab 2: utilization aggregates ──────────────────────────────────────── */
  const utilization = useMemo(() => {
    const fromMs = new Date(range.from).getTime();
    const toMs = new Date(range.to).getTime();
    return tanks.map((t) => {
      const b = blends.find((x) => x.tankCode === t.code);
      const fillsInPeriod = (b?.history ?? []).filter((h) => {
        const ms = new Date(h.filledAt).getTime();
        return ms >= fromMs && ms <= toMs;
      }).length;
      const tankCycles = cycles.filter((c) => c.tankCode === t.code);
      const completed = tankCycles.filter(
        (c) => c.completedAt && new Date(c.completedAt).getTime() >= fromMs && new Date(c.completedAt).getTime() <= toMs
      ).length;
      // No per-fill level history on the server: approximate average from the current level.
      return { tank: t, avgLevelQ: t.levelQ, fills: fillsInPeriod, cyclesCompleted: completed };
    });
  }, [tanks, blends, cycles, range]);

  /* ── Tab 3: cycle stats ─────────────────────────────────────────────────── */
  const cycleStats = useMemo(() => {
    if (cycles.length === 0) return null;
    const avgRequired = cycles.reduce((s, c) => s + (c.requiredHrs ?? 0), 0) / cycles.length;
    const completed = cycles.filter((c) => c.completedAt != null);
    const withElapsed = completed.filter((c) => {
      const start = new Date(c.startedAt).getTime();
      const done = new Date(c.completedAt as string).getTime();
      return Number.isFinite(start) && Number.isFinite(done) && done >= start;
    });
    const avgElapsed =
      withElapsed.length > 0
        ? withElapsed.reduce(
            (s, c) => s + (new Date(c.completedAt as string).getTime() - new Date(c.startedAt).getTime()) / 3600000,
            0
          ) / withElapsed.length
        : 0;
    const onTime = withElapsed.filter(
      (c) =>
        (new Date(c.completedAt as string).getTime() - new Date(c.startedAt).getTime()) / 3600000 <= (c.requiredHrs ?? 0)
    ).length;
    const withMoisture = completed.filter((c) => c.moistureAfter != null);
    const compliant = withMoisture.filter((c) => c.moistureAfter! >= MOIST_MIN && c.moistureAfter! <= MOIST_MAX).length;
    return {
      total: cycles.length,
      completed: completed.length,
      avgRequired,
      avgElapsed,
      onTimePct: pct(onTime, withElapsed.length),
      moisturePct: pct(compliant, withMoisture.length),
      onTimeN: onTime,
      onTimeD: withElapsed.length,
      moistN: compliant,
      moistD: withMoisture.length
    };
  }, [cycles]);

  /* ── Tab 4: blend compliance ────────────────────────────────────────────── */
  const blendRows = useMemo(
    () =>
      tanks.map((t) => {
        const b = blends.find((x) => x.tankCode === t.code);
        const blend = b?.blend ?? null;
        const dev = blend
          ? {
              soft: blend.soft - BLEND_TARGET.soft,
              hard: blend.hard - BLEND_TARGET.hard,
              foreign: blend.foreign - BLEND_TARGET.foreign
            }
          : null;
        const flagged =
          blend == null ||
          Math.abs(dev!.soft) > DEVIATION_TOL ||
          Math.abs(dev!.hard) > DEVIATION_TOL ||
          Math.abs(dev!.foreign) > DEVIATION_TOL;
        return { tank: t, batchNo: b?.batchNo ?? null, levelQ: b?.levelQ ?? t.levelQ, blend, dev, flagged };
      }),
    [tanks, blends]
  );

  /* ── Tab 5: movement aggregation ────────────────────────────────────────── */
  const movementSummary = useMemo(() => {
    const totals: Record<string, number> = { IN: 0, OUT: 0, ADJUST: 0 };
    const byLoc = new Map<string, { IN: number; OUT: number; ADJUST: number }>();
    const byType = new Map<string, { IN: number; OUT: number; ADJUST: number }>();
    for (const m of movements) {
      const dir = ['IN', 'OUT', 'ADJUST'].includes(m.direction?.toUpperCase()) ? m.direction.toUpperCase() : 'ADJUST';
      totals[dir] = (totals[dir] ?? 0) + (m.quintals ?? 0);
      const loc = m.locationCode || '—';
      const type = m.wheatType || '—';
      const l = byLoc.get(loc) ?? { IN: 0, OUT: 0, ADJUST: 0 };
      l[dir as keyof typeof l] += m.quintals ?? 0;
      byLoc.set(loc, l);
      const w = byType.get(type) ?? { IN: 0, OUT: 0, ADJUST: 0 };
      w[dir as keyof typeof w] += m.quintals ?? 0;
      byType.set(type, w);
    }
    return { totals, byLoc: [...byLoc.entries()], byType: [...byType.entries()] };
  }, [movements]);

  const anyLoading =
    tanksQ.isLoading || dryPoolQ.isLoading || cyclesQ.isLoading || blendsQ.isLoading || movementsQ.isLoading;
  const anyError = tanksQ.isError || dryPoolQ.isError || cyclesQ.isError || blendsQ.isError || movementsQ.isError;
  const refetchAll = () => {
    tanksQ.refetch();
    dryPoolQ.refetch();
    cyclesQ.refetch();
    blendsQ.refetch();
    movementsQ.refetch();
  };

  /* ── CSV exports ────────────────────────────────────────────────────────── */
  const exportCSV = () => {
    switch (tab) {
      case 'stock': {
        downloadCSV(`oyaya-storage-stock-position-${fileSuffix}.csv`,
          ['Location', 'Capacity (Qt)', 'Balance (Qt)', 'Utilization %'],
          [
            ['Dry pool', dryPool?.capacityQ ?? 0, dryPool?.balanceQ ?? 0, Number((dryPool?.pct ?? 0).toFixed(1))],
            ...tanks.map((t) => [`Tank ${t.code}`, t.capacityQ, t.levelQ, Number(pct(t.levelQ, t.capacityQ).toFixed(1))]),
            ...Object.entries(dryPool?.breakdown ?? {}).map(([type, q]) => [`Dry pool — ${type}`, '', q, ''])
          ]);
        break;
      }
      case 'utilization': {
        downloadCSV(`oyaya-storage-tank-utilization-${fileSuffix}.csv`,
          ['Tank', 'Capacity (Qt)', 'Avg level (Qt)', 'Utilization %', 'Fills in period', 'Cycles completed'],
          utilization.map((u) => [
            u.tank.code, u.tank.capacityQ, Number(u.avgLevelQ.toFixed(1)),
            Number(pct(u.avgLevelQ, u.tank.capacityQ).toFixed(1)), u.fills, u.cyclesCompleted
          ]));
        break;
      }
      case 'cycles': {
        downloadCSV(`oyaya-storage-conditioning-cycles-${fileSuffix}.csv`,
          ['Cycle id', 'Tank', 'Batch', 'Started', 'Required (h)', 'Completed', 'Elapsed (h)', 'Moisture before %', 'Moisture after %'],
          cycles.map((c) => {
            const elapsed =
              c.completedAt && new Date(c.startedAt).getTime() && new Date(c.completedAt).getTime() >= new Date(c.startedAt).getTime()
                ? Number(((new Date(c.completedAt).getTime() - new Date(c.startedAt).getTime()) / 3600000).toFixed(2))
                : '';
            return [
              c.id, c.tankCode, c.batchNo, fmtDateTime(c.startedAt), c.requiredHrs, fmtDateTime(c.completedAt),
              elapsed, c.moistureBefore ?? '', c.moistureAfter ?? ''
            ];
          }));
        break;
      }
      case 'blends': {
        downloadCSV(`oyaya-storage-blend-compliance-${fileSuffix}.csv`,
          ['Tank', 'Batch', 'Soft % (target 50)', 'Hard % (target 30)', 'Foreign % (target 20)', 'Deviation flagged'],
          blendRows.map((r) => [
            r.tank.code, r.batchNo ?? '', r.blend?.soft ?? '', r.blend?.hard ?? '', r.blend?.foreign ?? '',
            r.flagged ? 'YES' : 'no'
          ]));
        break;
      }
      case 'movements': {
        downloadCSV(`oyaya-storage-movement-summary-${fileSuffix}.csv`,
          ['Group', 'Key', 'IN (Qt)', 'OUT (Qt)', 'ADJUST (Qt)', 'Net (Qt)'],
          [
            ['Total', 'All', movementSummary.totals.IN, movementSummary.totals.OUT, movementSummary.totals.ADJUST,
              movementSummary.totals.IN - movementSummary.totals.OUT],
            ...movementSummary.byLoc.map(([loc, v]) => ['Location', loc, v.IN, v.OUT, v.ADJUST, v.IN - v.OUT] as (string | number)[]),
            ...movementSummary.byType.map(([type, v]) => ['Wheat type', type, v.IN, v.OUT, v.ADJUST, v.IN - v.OUT] as (string | number)[])
          ]);
        break;
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className={`${cardShell} print:hidden`}>
        <CardHeader
          icon={<ChartBar className="h-4 w-4" />}
          title="Storage Reports"
          subtitle="Conditioning tanks, dry pool, blends and movements."
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={exportCSV}>
                Export CSV
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Print
              </Button>
            </div>
          }
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <Field label="Period">
            <Select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
              <option value="today">Today</option>
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
              <option value="custom">Custom range</option>
            </Select>
            </Field>
          </div>
          {period === 'custom' && (
            <>
              <Field label="From">
                <TextInput type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <TextInput type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </Field>
            </>
          )}
          <span className="pb-2.5 text-xs text-slate-500">
            {fmtDate(range.from)} → {fmtDate(range.to)}
          </span>
        </div>
        {/* Tabs */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === t.key
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {anyLoading ? (
        <div className={cardShell}>
          <Spinner label="Loading report data…" />
        </div>
      ) : anyError ? (
        <div className={cardShell}>
          <ErrorBox message="Could not load report data." onRetry={refetchAll} />
        </div>
      ) : (
        <div className="print:block">
          {/* ── Tab 1: Stock position ── */}
          {tab === 'stock' && (
            <div className={`${cardShell} space-y-6`}>
              <CardHeader icon={<Boxes className="h-4 w-4" />} title="Stock Position" subtitle={`As of ${fmtDateTime(range.to)}`} />
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-800">Dry pool</span>
                  <span className="font-semibold tabular-nums text-slate-800">
                    {(dryPool?.balanceQ ?? 0).toLocaleString()} / {(dryPool?.capacityQ ?? 0).toLocaleString()} Qt
                    <span className="ml-2 text-slate-500">{(dryPool?.pct ?? 0).toFixed(1)}%</span>
                  </span>
                </div>
                <UtilizationBar value={dryPool?.pct ?? 0} color="bg-sky-500" />
                {(dryPool?.alerts?.length ?? 0) > 0 && (
                  <div className="mt-2 space-y-1">
                    {dryPool!.alerts.map((a, i) => (
                      <p key={i} className={`text-xs font-medium ${a.level === 'low' ? 'text-red-600' : a.level === 'high' ? 'text-amber-600' : 'text-sky-600'}`}>
                        {a.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3 className="mb-3 text-sm font-bold text-slate-800">Conditioning tanks</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  {tanks.map((t) => (
                    <div key={t.code} className="rounded-xl border border-slate-200/70 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-bold text-slate-800">Tank {t.code}</span>
                        <span className="text-xs text-slate-500">{t.status}</span>
                      </div>
                      <div className="mb-2 text-sm font-semibold tabular-nums text-slate-800">
                        {t.levelQ.toLocaleString()} <span className="font-normal text-slate-500">/ {t.capacityQ.toLocaleString()} Qt</span>
                        <span className="ml-2 text-slate-500">{pct(t.levelQ, t.capacityQ).toFixed(1)}%</span>
                      </div>
                      <UtilizationBar value={pct(t.levelQ, t.capacityQ)} />
                      {t.activeCycle && (
                        <p className="mt-2 text-xs text-slate-500">
                          Batch <span className="font-semibold tabular-nums">{t.activeCycle.batchNo}</span>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-bold text-slate-800">Dry pool wheat type breakdown</h3>
                {Object.keys(dryPool?.breakdown ?? {}).length === 0 ? (
                  <p className="text-sm text-slate-500">No breakdown data available.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[320px] text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                          <th className="pb-2 pr-4 font-semibold">Wheat type</th>
                          <th className="pb-2 pr-4 font-semibold">Quantity (Qt)</th>
                          <th className="pb-2 font-semibold">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(dryPool!.breakdown).map(([type, q]) => (
                          <tr key={type} className="border-t border-slate-100">
                            <td className="py-2.5 pr-4 font-semibold text-slate-800">{type}</td>
                            <td className="py-2.5 pr-4 font-semibold tabular-nums text-slate-800">{q.toLocaleString()}</td>
                            <td className="py-2.5 tabular-nums text-slate-600">{pct(q, dryPool!.balanceQ).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Tab 2: Tank utilization ── */}
          {tab === 'utilization' && (
            <div className={cardShell}>
              <CardHeader icon={<Gauge className="h-4 w-4" />} title="Tank Utilization" subtitle={`${fmtDate(range.from)} → ${fmtDate(range.to)}`} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2 pr-4 font-semibold">Tank</th>
                      <th className="pb-2 pr-4 font-semibold">Capacity (Qt)</th>
                      <th className="pb-2 pr-4 font-semibold">Avg level (Qt)*</th>
                      <th className="pb-2 pr-4 font-semibold">Utilization</th>
                      <th className="pb-2 pr-4 font-semibold">Fills in period</th>
                      <th className="pb-2 font-semibold">Cycles completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {utilization.map((u) => (
                      <tr key={u.tank.code} className="border-t border-slate-100">
                        <td className="py-3 pr-4 font-semibold text-slate-800">Tank {u.tank.code}</td>
                        <td className="py-3 pr-4 font-semibold tabular-nums text-slate-800">{u.tank.capacityQ.toLocaleString()}</td>
                        <td className="py-3 pr-4 tabular-nums text-slate-600">{u.avgLevelQ.toLocaleString()}</td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-24"><UtilizationBar value={pct(u.avgLevelQ, u.tank.capacityQ)} /></div>
                            <span className="text-xs tabular-nums text-slate-500">{pct(u.avgLevelQ, u.tank.capacityQ).toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="py-3 pr-4 font-semibold tabular-nums text-slate-800">{u.fills}</td>
                        <td className="py-3 font-semibold tabular-nums text-slate-800">{u.cyclesCompleted}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                * Average level is approximated from the current tank level; per-fill level history is not retained by the server.
              </p>
            </div>
          )}

          {/* ── Tab 3: Conditioning cycles ── */}
          {tab === 'cycles' && (
            <div className={`${cardShell} space-y-6`}>
              <CardHeader icon={<Timer className="h-4 w-4" />} title="Conditioning Cycles" subtitle={`${fmtDate(range.from)} → ${fmtDate(range.to)}`} />
              {cycleStats ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      { icon: <Wheat className="h-4 w-4 text-amber-600" />, label: 'Cycles', value: String(cycleStats.total), sub: `${cycleStats.completed} completed` },
                      { icon: <Timer className="h-4 w-4 text-sky-600" />, label: 'Avg required vs actual', value: `${cycleStats.avgRequired.toFixed(1)}h / ${cycleStats.avgElapsed.toFixed(1)}h`, sub: 'hours per cycle' },
                      { icon: <Droplets className="h-4 w-4 text-emerald-600" />, label: 'On-time completion', value: `${cycleStats.onTimePct.toFixed(0)}%`, sub: `${cycleStats.onTimeN}/${cycleStats.onTimeD} within required time` },
                      { icon: <Droplets className="h-4 w-4 text-teal-600" />, label: 'Moisture compliance', value: `${cycleStats.moisturePct.toFixed(0)}%`, sub: `${cycleStats.moistN}/${cycleStats.moistD} within ${MOIST_MIN.toFixed(1)}–${MOIST_MAX.toFixed(1)}%` }
                    ].map((k, i) => (
                      <div key={i} className="rounded-xl border border-slate-200/70 p-4">
                        <div className="mb-2 flex items-center gap-2">{k.icon}<span className="text-xs font-semibold text-slate-500">{k.label}</span></div>
                        <div className="text-xl font-bold tabular-nums text-slate-900">{k.value}</div>
                        <div className="mt-1 text-xs text-slate-500">{k.sub}</div>
                      </div>
                    ))}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                          <th className="pb-2 pr-4 font-semibold">Batch</th>
                          <th className="pb-2 pr-4 font-semibold">Tank</th>
                          <th className="pb-2 pr-4 font-semibold">Started</th>
                          <th className="pb-2 pr-4 font-semibold">Required (h)</th>
                          <th className="pb-2 pr-4 font-semibold">Completed</th>
                          <th className="pb-2 pr-4 font-semibold">Elapsed (h)</th>
                          <th className="pb-2 pr-4 font-semibold">Moisture after</th>
                          <th className="pb-2 font-semibold">On time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cycles.map((c) => {
                          const elapsedHrs =
                            c.completedAt && new Date(c.completedAt).getTime() >= new Date(c.startedAt).getTime()
                              ? (new Date(c.completedAt).getTime() - new Date(c.startedAt).getTime()) / 3600000
                              : null;
                          const onTime = elapsedHrs != null && elapsedHrs <= (c.requiredHrs ?? 0);
                          const compliant = c.moistureAfter != null && c.moistureAfter >= MOIST_MIN && c.moistureAfter <= MOIST_MAX;
                          return (
                            <tr key={c.id} className="border-t border-slate-100">
                              <td className="py-2.5 pr-4 font-semibold tabular-nums text-slate-800">{c.batchNo}</td>
                              <td className="py-2.5 pr-4 text-slate-600">Tank {c.tankCode}</td>
                              <td className="py-2.5 pr-4 text-slate-600">{fmtDateTime(c.startedAt)}</td>
                              <td className="py-2.5 pr-4 tabular-nums text-slate-600">{c.requiredHrs}</td>
                              <td className="py-2.5 pr-4 text-slate-600">{fmtDateTime(c.completedAt)}</td>
                              <td className="py-2.5 pr-4 tabular-nums text-slate-600">{elapsedHrs != null ? elapsedHrs.toFixed(1) : '—'}</td>
                              <td className={`py-2.5 pr-4 font-semibold tabular-nums ${c.moistureAfter == null ? 'text-slate-400' : compliant ? 'text-emerald-700' : 'text-amber-700'}`}>
                                {c.moistureAfter != null ? `${c.moistureAfter.toFixed(1)}%` : '—'}
                              </td>
                              <td className="py-2.5">
                                {elapsedHrs == null ? (
                                  <span className="text-xs text-slate-400">running</span>
                                ) : (
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${onTime ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                                    {onTime ? 'Yes' : 'Late'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  No conditioning cycles in this period.
                </p>
              )}
            </div>
          )}

          {/* ── Tab 4: Blend compliance ── */}
          {tab === 'blends' && (
            <div className={cardShell}>
              <CardHeader
                icon={<Shuffle className="h-4 w-4" />}
                title="Blend Compliance"
                subtitle="Current tank blend vs target 50% Hard / 30% Soft / 20% Foreign (±5% tolerance)."
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2 pr-4 font-semibold">Tank</th>
                      <th className="pb-2 pr-4 font-semibold">Batch</th>
                      <th className="pb-2 pr-4 font-semibold">Soft % (target 50)</th>
                      <th className="pb-2 pr-4 font-semibold">Hard % (target 30)</th>
                      <th className="pb-2 pr-4 font-semibold">Foreign % (target 20)</th>
                      <th className="pb-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blendRows.map((r) => (
                      <tr key={r.tank.code} className="border-t border-slate-100">
                        <td className="py-3 pr-4 font-semibold text-slate-800">Tank {r.tank.code}</td>
                        <td className="py-3 pr-4 tabular-nums text-slate-600">{r.batchNo ?? '—'}</td>
                        {(['soft', 'hard', 'foreign'] as const).map((k) => {
                          const d = r.dev?.[k];
                          const bad = d != null && Math.abs(d) > DEVIATION_TOL;
                          return (
                            <td key={k} className={`py-3 pr-4 tabular-nums ${r.blend == null ? 'text-slate-400' : bad ? 'font-semibold text-red-600' : 'text-slate-600'}`}>
                              {r.blend != null ? (
                                <>{r.blend[k].toFixed(1)} <span className="text-xs text-slate-400">({d! >= 0 ? '+' : ''}{d!.toFixed(1)})</span></>
                              ) : (
                                '—'
                              )}
                            </td>
                          );
                        })}
                        <td className="py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.flagged ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                            {r.flagged ? (r.blend == null ? 'No blend data' : 'Deviation') : 'Compliant'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Tab 5: Movement summary ── */}
          {tab === 'movements' && (
            <div className={`${cardShell} space-y-6`}>
              <CardHeader icon={<ChartBar className="h-4 w-4" />} title="Movement Summary" subtitle={`${fmtDate(range.from)} → ${fmtDate(range.to)}`} />
              <div className="grid gap-4 sm:grid-cols-3">
                {([
                  { label: 'IN', icon: <ArrowDownToLine className="h-4 w-4 text-emerald-600" />, value: movementSummary.totals.IN, cls: 'text-emerald-700' },
                  { label: 'OUT', icon: <ArrowUpFromLine className="h-4 w-4 text-red-500" />, value: movementSummary.totals.OUT, cls: 'text-red-600' },
                  { label: 'ADJUST', icon: <Shuffle className="h-4 w-4 text-slate-500" />, value: movementSummary.totals.ADJUST, cls: 'text-slate-700' }
                ] as const).map((k) => (
                  <div key={k.label} className="rounded-xl border border-slate-200/70 p-4">
                    <div className="mb-2 flex items-center gap-2">{k.icon}<span className="text-xs font-semibold text-slate-500">{k.label}</span></div>
                    <div className={`text-xl font-bold tabular-nums ${k.cls}`}>{k.value.toLocaleString()} Qt</div>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="mb-3 text-sm font-bold text-slate-800">By location</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                        <th className="pb-2 pr-4 font-semibold">Location</th>
                        <th className="pb-2 pr-4 font-semibold">IN (Qt)</th>
                        <th className="pb-2 pr-4 font-semibold">OUT (Qt)</th>
                        <th className="pb-2 pr-4 font-semibold">ADJUST (Qt)</th>
                        <th className="pb-2 font-semibold">Net (Qt)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movementSummary.byLoc.length === 0 ? (
                        <tr><td colSpan={5} className="py-4 text-center text-sm text-slate-500">No movements in this period.</td></tr>
                      ) : (
                        movementSummary.byLoc.map(([loc, v]) => (
                          <tr key={loc} className="border-t border-slate-100">
                            <td className="py-2.5 pr-4 font-semibold text-slate-800">{loc}</td>
                            <td className="py-2.5 pr-4 tabular-nums text-emerald-700">{v.IN.toLocaleString()}</td>
                            <td className="py-2.5 pr-4 tabular-nums text-red-600">{v.OUT.toLocaleString()}</td>
                            <td className="py-2.5 pr-4 tabular-nums text-slate-600">{v.ADJUST.toLocaleString()}</td>
                            <td className="py-2.5 font-semibold tabular-nums text-slate-800">{(v.IN - v.OUT).toLocaleString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-bold text-slate-800">By wheat type</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                        <th className="pb-2 pr-4 font-semibold">Wheat type</th>
                        <th className="pb-2 pr-4 font-semibold">IN (Qt)</th>
                        <th className="pb-2 pr-4 font-semibold">OUT (Qt)</th>
                        <th className="pb-2 pr-4 font-semibold">ADJUST (Qt)</th>
                        <th className="pb-2 font-semibold">Net (Qt)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movementSummary.byType.length === 0 ? (
                        <tr><td colSpan={5} className="py-4 text-center text-sm text-slate-500">No movements in this period.</td></tr>
                      ) : (
                        movementSummary.byType.map(([type, v]) => (
                          <tr key={type} className="border-t border-slate-100">
                            <td className="py-2.5 pr-4 font-semibold text-slate-800">{type}</td>
                            <td className="py-2.5 pr-4 tabular-nums text-emerald-700">{v.IN.toLocaleString()}</td>
                            <td className="py-2.5 pr-4 tabular-nums text-red-600">{v.OUT.toLocaleString()}</td>
                            <td className="py-2.5 pr-4 tabular-nums text-slate-600">{v.ADJUST.toLocaleString()}</td>
                            <td className="py-2.5 font-semibold tabular-nums text-slate-800">{(v.IN - v.OUT).toLocaleString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
