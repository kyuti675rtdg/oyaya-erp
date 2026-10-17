import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, Hourglass, ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, SectionTitle, Spinner } from '../components/ui';
import { Badge } from '../components/Badge';
import type { NcAction, NcSeverity, Nonconformity } from '../types';
import { NC_SEVERITY_LABEL, NC_SOURCE_LABEL, downloadCsv, cardShell, ncStatusTone, severityTone } from './NcShared';

interface AgingRow {
  id: string;
  ncNo: string;
  source: string;
  severity: NcSeverity;
  status: string;
  description: string;
  dateDetected: string;
  ageDays: number;
  batch?: { batchNo: string } | null;
}

interface OverdueRow extends NcAction {
  daysOverdue: number;
}

interface Recurrence {
  total: number;
  bySource: Record<string, number>;
  bySeverity: Record<string, number>;
  byMonth: { month: string; count: number }[];
}

interface Effectiveness {
  totalChecked: number;
  effective: number;
  ineffective: number;
  rate: number | null;
  results: NcAction[];
}

const PIE_COLORS: Record<string, string> = {
  CRITICAL: '#e11d48',
  MAJOR: '#f59e0b',
  MINOR: '#94a3b8'
};

export function NcReports() {
  const [notice, setNotice] = useState<string | null>(null);

  const agingQ = useQuery({
    queryKey: ['nc-reports-aging'],
    queryFn: async () => (await api.get<AgingRow[]>(E.ncReportsAging)).data
  });
  const overdueQ = useQuery({
    queryKey: ['nc-reports-overdue'],
    queryFn: async () => (await api.get<OverdueRow[]>(E.ncReportsOverdue)).data
  });
  const recurrenceQ = useQuery({
    queryKey: ['nc-reports-recurrence'],
    queryFn: async () => (await api.get<Recurrence>(E.ncReportsRecurrence)).data
  });
  const effectivenessQ = useQuery({
    queryKey: ['nc-reports-effectiveness'],
    queryFn: async () => (await api.get<Effectiveness>(E.ncReportsEffectiveness)).data
  });

  const loading = agingQ.isLoading || overdueQ.isLoading || recurrenceQ.isLoading || effectivenessQ.isLoading;
  const failed = agingQ.isError || overdueQ.isError || recurrenceQ.isError || effectivenessQ.isError;

  const sourceChart = useMemo(
    () =>
      Object.entries(recurrenceQ.data?.bySource ?? {}).map(([k, v]) => ({
        name: NC_SOURCE_LABEL[k as keyof typeof NC_SOURCE_LABEL] ?? k,
        count: v
      })),
    [recurrenceQ.data]
  );
  const severityChart = useMemo(
    () =>
      Object.entries(recurrenceQ.data?.bySeverity ?? {}).map(([k, v]) => ({
        name: NC_SEVERITY_LABEL[k as keyof typeof NC_SEVERITY_LABEL] ?? k,
        value: v,
        key: k
      })),
    [recurrenceQ.data]
  );

  const kpis = useMemo(() => {
    const eff = effectivenessQ.data;
    return {
      openNc: agingQ.data?.length ?? 0,
      overdueActions: overdueQ.data?.length ?? 0,
      criticalOpen: (agingQ.data ?? []).filter((r) => r.severity === 'CRITICAL').length,
      effectivenessRate: eff?.rate ?? null
    };
  }, [agingQ.data, overdueQ.data, effectivenessQ.data]);

  const exportCsv = (kind: 'aging' | 'overdue' | 'effectiveness') => {
    try {
      if (kind === 'aging') {
        downloadCsv(
          'nc-aging.csv',
          ['NC no.', 'Source', 'Severity', 'Status', 'Detected', 'Age (days)', 'Batch'],
          (agingQ.data ?? []).map((r) => [
            r.ncNo,
            r.source,
            r.severity,
            r.status,
            fmtDate(r.dateDetected),
            r.ageDays,
            r.batch?.batchNo ?? ''
          ])
        );
      } else if (kind === 'overdue') {
        downloadCsv(
          'nc-overdue-actions.csv',
          ['NC', 'CAPA', 'Type', 'Owner', 'Due', 'Days overdue', 'Status', 'Description'],
          (overdueQ.data ?? []).map((a) => [
            a.nc?.ncNo ?? '',
            a.capa?.capaNo ?? '',
            a.actionType,
            a.owner,
            fmtDate(a.dueDate),
            a.daysOverdue,
            a.status,
            a.description
          ])
        );
      } else {
        downloadCsv(
          'nc-effectiveness.csv',
          ['NC', 'CAPA', 'Type', 'Owner', 'Effective', 'Checked at', 'Note'],
          (effectivenessQ.data?.results ?? []).map((a) => [
            a.nc?.ncNo ?? '',
            a.capa?.capaNo ?? '',
            a.actionType,
            a.owner,
            a.effectivenessOk ? 'Yes' : 'No',
            a.effectivenessAt ? fmtDate(a.effectivenessAt) : '',
            a.effectivenessNote ?? ''
          ])
        );
      }
      setNotice(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'CSV export failed.');
    }
  };

  return (
    <div>
      <SectionTitle
        title="CAPA Tracking & Reports"
        sub="Aging of open nonconformities, overdue actions, recurrence and effectiveness"
      />

      {notice ? (
        <div className="mb-4 rounded-xl border border-critical-text/30 bg-critical-bg px-4 py-3 text-sm font-medium text-critical-text">
          {notice}
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading reports..." />
      ) : failed ? (
        <div className="rounded-xl border border-critical-text/30 bg-critical-bg px-4 py-10 text-center text-sm text-critical-text">
          Failed to load report data. Check your connection and retry.
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: 'Open NCs', value: kpis.openNc, icon: <TriangleAlert size={16} />, tone: 'text-critical-text' },
              { label: 'Overdue actions', value: kpis.overdueActions, icon: <Hourglass size={16} />, tone: 'text-amber-700' },
              { label: 'Critical open', value: kpis.criticalOpen, icon: <ShieldCheck size={16} />, tone: 'text-critical-text' },
              {
                label: 'Effectiveness rate',
                value: kpis.effectivenessRate === null ? '—' : `${kpis.effectivenessRate}%`,
                icon: <BarChart3 size={16} />,
                tone: 'text-slate-800'
              }
            ].map((k) => (
              <div key={k.label} className={cardShell}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{k.label}</p>
                  <span className="text-slate-400 dark:text-slate-500">{k.icon}</span>
                </div>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${k.tone}`}>{k.value}</p>
              </div>
            ))}
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className={cardShell}>
              <CardHeader icon={<BarChart3 size={16} />} title="Recurrence by source" subtitle="All nonconformities" />
              {sourceChart.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No data yet.</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sourceChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#7c3aed" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div className={cardShell}>
              <CardHeader icon={<BarChart3 size={16} />} title="Severity mix" subtitle="All nonconformities" />
              {severityChart.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No data yet.</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={severityChart} dataKey="value" nameKey="name" outerRadius={90} label>
                        {severityChart.map((s) => (
                          <Cell key={s.key} fill={PIE_COLORS[s.key] ?? '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="mb-4">
            <div className={cardShell}>
              <CardHeader
                icon={<Hourglass size={16} />}
                title="Aging of open nonconformities"
                subtitle="Oldest first"
                action={
                  <Button variant="secondary" className="px-3 py-2 text-sm" onClick={() => exportCsv('aging')}>
                    <Download size={14} /> CSV
                  </Button>
                }
              />
              <div className="hidden md:block">
                <DataTable<AgingRow>
                  columns={[
                    { key: 'ncNo', label: 'NC no.', render: (r) => <span className="font-bold tabular-nums">{r.ncNo}</span> },
                    { key: 'source', label: 'Source', render: (r) => NC_SOURCE_LABEL[r.source as keyof typeof NC_SOURCE_LABEL] ?? r.source },
                    { key: 'severity', label: 'Severity', render: (r) => <Badge tone={severityTone(r.severity)}>{r.severity}</Badge> },
                    { key: 'ageDays', label: 'Age (days)', render: (r) => <span className={`font-bold tabular-nums ${r.ageDays > 14 ? 'text-critical-text' : 'text-slate-700'}`}>{r.ageDays}</span> },
                    { key: 'dateDetected', label: 'Detected', render: (r) => fmtDate(r.dateDetected) },
                    { key: 'status', label: 'Status', render: (r) => <Badge tone={ncStatusTone(r.status as Nonconformity['status'])}>{r.status.replace('_', ' ')}</Badge> }
                  ]}
                  rows={agingQ.data ?? []}
                  emptyTitle="No open nonconformities"
                  emptySub="Closed records leave the aging report."
                />
              </div>
              <div className="space-y-3 md:hidden">
                {(agingQ.data ?? []).map((r) => (
                  <div key={r.id} className="rounded-xl border border-line bg-white dark:bg-slate-800 p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-bold tabular-nums text-ink">{r.ncNo}</span>
                      <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {NC_SOURCE_LABEL[r.source as keyof typeof NC_SOURCE_LABEL] ?? r.source} · detected {fmtDate(r.dateDetected)}
                    </p>
                    <p className={`mt-1 text-sm font-bold tabular-nums ${r.ageDays > 14 ? 'text-critical-text' : 'text-slate-700'}`}>
                      {r.ageDays} days open
                    </p>
                  </div>
                ))}
                {(agingQ.data ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No open nonconformities.</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mb-4">
            <div className={cardShell}>
              <CardHeader
                icon={<Hourglass size={16} />}
                title="Overdue actions"
                subtitle="Planned or in-progress past their due date"
                action={
                  <Button variant="secondary" className="px-3 py-2 text-sm" onClick={() => exportCsv('overdue')}>
                    <Download size={14} /> CSV
                  </Button>
                }
              />
              <div className="hidden md:block">
                <DataTable<OverdueRow>
                  columns={[
                    { key: 'ref', label: 'NC / CAPA', render: (r) => <span className="font-bold tabular-nums">{r.nc?.ncNo ?? r.capa?.capaNo ?? '—'}</span> },
                    { key: 'actionType', label: 'Type', render: (r) => <Badge tone={r.actionType === 'CORRECTIVE' ? 'critical' : 'advisory'}>{r.actionType}</Badge> },
                    { key: 'owner', label: 'Owner', render: (r) => r.owner },
                    { key: 'dueDate', label: 'Due', render: (r) => fmtDate(r.dueDate) },
                    { key: 'daysOverdue', label: 'Days overdue', render: (r) => <span className="font-bold tabular-nums text-critical-text">{r.daysOverdue}</span> },
                    { key: 'description', label: 'Description', render: (r) => <span className="block max-w-xs truncate" title={r.description}>{r.description}</span> }
                  ]}
                  rows={overdueQ.data ?? []}
                  emptyTitle="No overdue actions"
                  emptySub="Every action is on schedule."
                />
              </div>
              <div className="space-y-3 md:hidden">
                {(overdueQ.data ?? []).map((a) => (
                  <div key={a.id} className="rounded-xl border border-critical-text/40 bg-white dark:bg-slate-800 p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-bold tabular-nums text-ink">{a.nc?.ncNo ?? a.capa?.capaNo ?? '—'}</span>
                      <span className="text-xs font-bold text-critical-text tabular-nums">{a.daysOverdue}d overdue</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{a.description}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Owner: {a.owner} · due {fmtDate(a.dueDate)}
                    </p>
                  </div>
                ))}
                {(overdueQ.data ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No overdue actions.</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className={cardShell}>
            <CardHeader
              icon={<ShieldCheck size={16} />}
              title="Effectiveness check results"
              subtitle={`${
                effectivenessQ.data?.totalChecked ?? 0
              } checked · ${effectivenessQ.data?.effective ?? 0} effective · ${
                effectivenessQ.data?.ineffective ?? 0
              } ineffective`}
              action={
                <Button variant="secondary" className="px-3 py-2 text-sm" onClick={() => exportCsv('effectiveness')}>
                  <Download size={14} /> CSV
                </Button>
              }
            />
            <DataTable<NcAction>
              columns={[
                { key: 'ref', label: 'NC / CAPA', render: (r) => <span className="font-bold tabular-nums">{r.nc?.ncNo ?? r.capa?.capaNo ?? '—'}</span> },
                { key: 'owner', label: 'Owner', render: (r) => r.owner },
                { key: 'effectivenessOk', label: 'Result', render: (r) => <Badge tone={r.effectivenessOk ? 'pass' : 'critical'}>{r.effectivenessOk ? 'Effective' : 'Not effective'}</Badge> },
                { key: 'effectivenessAt', label: 'Checked', render: (r) => (r.effectivenessAt ? fmtDate(r.effectivenessAt) : '—') },
                { key: 'effectivenessNote', label: 'Note', render: (r) => <span className="block max-w-xs truncate" title={r.effectivenessNote ?? ''}>{r.effectivenessNote ?? '—'}</span> }
              ]}
              rows={effectivenessQ.data?.results ?? []}
              emptyTitle="No effectiveness checks yet"
              emptySub="Checked actions appear here with their outcome."
            />
          </div>
        </>
      )}
    </div>
  );
}
