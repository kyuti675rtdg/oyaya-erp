import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, FileBarChart } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import type { MaintKpis, OverdueReport } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Spinner } from '../components/ui';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-sm p-5';

const CATEGORY_COLORS: Record<string, string> = {
  MECHANICAL: '#f43f5e',
  ELECTRICAL: '#f59e0b',
  PNEUMATIC: '#8b5cf6',
  OTHER: '#64748b'
};

function fmtHours(minutes: number | null): string {
  if (minutes == null) return '—';
  const h = minutes / 60;
  return h >= 100 ? `${Math.round(h)} h` : `${h.toFixed(1)} h`;
}

export function MaintReports() {
  const overdueQ = useQuery({
    queryKey: ['maint-reports-overdue'],
    queryFn: async () => (await api.get<OverdueReport>(E.maintOverdueReport)).data
  });

  const kpisQ = useQuery({
    queryKey: ['maint-reports-kpis'],
    queryFn: async () => (await api.get<MaintKpis>(E.maintKpis)).data
  });

  const chartData = useMemo(
    () =>
      (kpisQ.data?.byCategory ?? []).map((c) => ({
        id: c.category,
        name: c.category.charAt(0) + c.category.slice(1).toLowerCase(),
        count: c.count,
        avgDowntime: c.avgDowntimeMinutes,
        fill: CATEGORY_COLORS[c.category] ?? '#64748b'
      })),
    [kpisQ.data]
  );

  const [notice, setNotice] = useState<string | null>(null);

  const downloadCsv = async (kind: 'overdue' | 'kpis' | 'breakdowns' | 'parts') => {
    // Fetch through the authed api client (Bearer token), then trigger a Blob download.
    try {
      setNotice(null);
      const res = await api.get(E.maintExport(kind), { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind}-maintenance.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setNotice('CSV export failed — check your connection and retry.');
    }
  };

  const kpis = kpisQ.data;
  const overdue = overdueQ.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Overdue Maintenance Reports</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Overdue PMs, MTBF/MTTR summaries, breakdown analysis, and parts consumption.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => downloadCsv('overdue')}>
            <Download size={14} /> Overdue CSV
          </Button>
          <Button variant="secondary" onClick={() => downloadCsv('kpis')}>
            <Download size={14} /> KPIs CSV
          </Button>
          <Button variant="secondary" onClick={() => downloadCsv('breakdowns')}>
            <Download size={14} /> Breakdowns CSV
          </Button>
          <Button variant="secondary" onClick={() => downloadCsv('parts')}>
            <Download size={14} /> Parts CSV
          </Button>
        </div>
      </div>

      {notice ? (
        <div className="rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{notice}</div>
      ) : null}

      {/* KPI cards */}
      {kpisQ.isLoading ? (
        <Spinner />
      ) : kpisQ.isError ? (
        <ErrorBox
          message={isNetworkError(kpisQ.error) ? 'Network error.' : 'Failed to load maintenance KPIs.'}
          onRetry={() => kpisQ.refetch()}
        />
      ) : kpis ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className={cardShell}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">MTBF</p>
            <p className="tabular-nums mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{fmtHours(kpis.mtbfMinutes)}</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Mean time between failures</p>
          </div>
          <div className={cardShell}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">MTTR</p>
            <p className="tabular-nums mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{fmtHours(kpis.mttrMinutes)}</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Mean time to repair</p>
          </div>
          <div className={cardShell}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Total breakdowns</p>
            <p className="tabular-nums mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{kpis.totalBreakdowns}</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              <span className="tabular-nums text-emerald-600">{kpis.resolvedCount} resolved</span>
              {' · '}
              <span className="tabular-nums text-rose-600">{kpis.openCount} open</span>
            </p>
          </div>
          <div className={cardShell}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Total downtime</p>
            <p className="tabular-nums mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{fmtHours(kpis.totalDowntimeMinutes)}</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Across resolved breakdowns</p>
          </div>
        </div>
      ) : null}

      {/* Overdue PMs */}
      <div className={cardShell}>
        <CardHeader
          icon={<AlertTriangle size={16} />}
          title="Overdue preventive maintenance"
          subtitle={overdue ? `${overdue.equipment.length} equipment overdue · ${overdue.pendingBreakdowns.length} breakdowns pending` : ''}
        />
        {overdueQ.isLoading ? (
          <Spinner />
        ) : overdueQ.isError ? (
          <ErrorBox
            message={isNetworkError(overdueQ.error) ? 'Network error.' : 'Failed to load overdue report.'}
            onRetry={() => overdueQ.refetch()}
          />
        ) : (overdue?.equipment.length ?? 0) === 0 ? (
          <EmptyState title="No overdue PMs" sub="All equipment is on schedule." />
        ) : (
          <DataTable
            columns={[
              { key: 'name', label: 'Equipment', render: (r: { name: string }) => <span className="font-medium text-rose-700">{r.name}</span> },
              { key: 'type', label: 'Type', render: (r: { type: string }) => <span className="text-sm">{r.type.replace(/_/g, ' ')}</span> },
              { key: 'nextDueDate', label: 'Due date', render: (r: { nextDueDate: string | null }) => (
                <span className="tabular-nums text-sm font-semibold text-rose-600">
                  {r.nextDueDate ? fmtDate(r.nextDueDate) : '—'}
                </span>
              ) },
              {
                key: 'daysOverdue',
                label: 'Days overdue',
                render: (r: { nextDueDate: string | null }) => {
                  const days = r.nextDueDate
                    ? Math.floor((Date.now() - new Date(r.nextDueDate).getTime()) / 86400000)
                    : 0;
                  return <Badge tone={days > 14 ? 'critical' : 'advisory'}><span className="tabular-nums">{days} days</span></Badge>;
                }
              }
            ]}
            rows={(overdue?.equipment ?? []).map((e) => ({ ...e }))}
            emptyTitle="No overdue PMs."
          />
        )}
      </div>

      {/* Breakdown by category chart */}
      <div className={cardShell}>
        <CardHeader
          icon={<FileBarChart size={16} />}
          title="Breakdowns by category"
          subtitle="Failure counts and average downtime per category."
        />
        {kpisQ.isLoading ? (
          <Spinner />
        ) : chartData.length === 0 ? (
          <EmptyState title="No breakdown data" sub="Breakdown categories will appear here once reported." />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Breakdowns" radius={[6, 6, 0, 0]}>
                    {chartData.map((d) => (
                      <Cell key={d.name} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <DataTable
              columns={[
                { key: 'name', label: 'Category', render: (r: { name: string; fill: string }) => (
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: r.fill }} />
                    {r.name}
                  </span>
                ) },
                { key: 'count', label: 'Count', render: (r: { count: number }) => <span className="tabular-nums text-sm font-semibold">{r.count}</span> },
                { key: 'avgDowntime', label: 'Avg downtime', render: (r: { avgDowntime: number }) => <span className="tabular-nums text-sm">{r.avgDowntime} min</span> }
              ]}
              rows={chartData}
              emptyTitle="No data."
            />
          </div>
        )}
      </div>

      {/* Parts consumption */}
      <div className={cardShell}>
        <CardHeader
          icon={<FileBarChart size={16} />}
          title="Spare parts consumption"
          subtitle="Parts consumed through work orders, most used first."
        />
        {kpisQ.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            columns={[
              { key: 'partNumber', label: 'Part no.', render: (r: { partNumber: string }) => <span className="font-mono text-sm font-semibold">{r.partNumber}</span> },
              { key: 'name', label: 'Name', render: (r: { name: string }) => <span className="text-sm">{r.name}</span> },
              { key: 'qty', label: 'Qty consumed', render: (r: { qty: number }) => <span className="tabular-nums text-sm font-semibold">{r.qty}</span> }
            ]}
            rows={(kpis?.partsConsumed ?? []).map((p) => ({ id: p.partNumber, ...p }))}
            emptyTitle="No parts consumption recorded yet."
          />
        )}
      </div>
    </div>
  );
}
