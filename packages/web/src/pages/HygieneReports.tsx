import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, CalendarCheck2, Download, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { HygieneReportSummary } from '../types';
import { CardHeader } from '../components/CardHeader';
import { useAuth } from '../store/auth';
import { fmtInt, fmtPct } from '../lib/format';
import { cardShell, todayISO } from './HygieneCommon';
import {
  Button,
  EmptyState,
  Field,
  SectionTitle,
  Spinner,
  TextInput
} from '../components/ui';

const PASS_COLOR = '#10b981';
const FAIL_COLOR = '#f43f5e';

export function HygieneReports() {
  const hasClaim = useAuth((s) => s.hasClaim);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(todayISO());
  const [exporting, setExporting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const summaryQ = useQuery({
    queryKey: ['hygiene', 'reports-summary', from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return (await api.get<HygieneReportSummary>(`${E.hygReportsSummary}?${params}`)).data;
    }
  });

  const exportCsv = async (type: 'cleanings' | 'inspections' | 'actions') => {
    setExporting(type);
    setNotice(null);
    try {
      const res = await api.get<string>(E.hygReportsCsv(type, from || undefined, to || undefined), {
        responseType: 'blob'
      });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sanitation-${type}${from ? `-${from}` : ''}${to ? `-${to}` : ''}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setNotice({ ok: true, text: `CSV exported: sanitation-${type}.` });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Export failed.' });
    } finally {
      setExporting(null);
    }
  };

  const s = summaryQ.data;
  const chartData = (s?.passRatesByArea ?? []).map((r) => ({
    name: r.target.length > 28 ? `${r.target.slice(0, 26)}…` : r.target,
    passPct: Math.round(r.passPct * 10) / 10,
    pass: r.pass,
    total: r.total
  }));

  const kpis = [
    {
      icon: <CalendarCheck2 size={16} />,
      label: 'Cleaning compliance',
      value: fmtPct(s?.cleaningCompliancePct ?? 0),
      sub: s ? `${fmtInt(s.doneCleanings)} of ${fmtInt(s.totalCleanings)} scheduled cleanings done` : '—',
      tone: (s?.cleaningCompliancePct ?? 0) >= 90 ? 'text-emerald-700' : (s?.cleaningCompliancePct ?? 0) >= 70 ? 'text-amber-700' : 'text-rose-700'
    },
    {
      icon: <TriangleAlert size={16} />,
      label: 'Overdue cleanings',
      value: fmtInt(s?.overdueCleanings ?? 0),
      sub: 'Past date, never completed',
      tone: (s?.overdueCleanings ?? 0) === 0 ? 'text-emerald-700' : 'text-rose-700'
    },
    {
      icon: <ShieldCheck size={16} />,
      label: 'Inspection pass rate',
      value: fmtPct(s?.inspectionPassPct ?? 0),
      sub: s ? `${fmtInt(s.passedInspections)} of ${fmtInt(s.totalInspections)} inspections passed` : '—',
      tone: (s?.inspectionPassPct ?? 0) >= 90 ? 'text-emerald-700' : (s?.inspectionPassPct ?? 0) >= 70 ? 'text-amber-700' : 'text-rose-700'
    },
    {
      icon: <BarChart3 size={16} />,
      label: 'Open follow-up actions',
      value: fmtInt(s?.openActions ?? 0),
      sub: 'Open or in progress',
      tone: 'text-slate-800'
    }
  ];

  if (!hasClaim('hygiene:view')) {
    return (
      <div className="space-y-4">
        <SectionTitle title="Sanitation Reports" sub="Cleaning compliance and inspection performance" />
        <EmptyState title="No access" sub="You need the hygiene:view permission to see sanitation reports." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Sanitation Reports"
        sub="Cleaning compliance, overdue cleanings and inspection pass rates"
        action={
          <div className="flex flex-wrap gap-2">
            <Field label="">
              <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-auto !py-1.5 !text-sm" aria-label="From date" />
            </Field>
            <Field label="">
              <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-auto !py-1.5 !text-sm" aria-label="To date" />
            </Field>
          </div>
        }
      />

      {notice ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      {summaryQ.isLoading ? (
        <Spinner label="Loading sanitation report..." />
      ) : summaryQ.isError ? (
        <EmptyState title="Failed to load report" sub="Check your connection and try again." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className={cardShell}>
                <div className="flex items-center gap-2 text-slate-500">
                  {k.icon}
                  <p className="text-xs font-semibold uppercase tracking-wide">{k.label}</p>
                </div>
                <p className={`mt-2 text-3xl font-bold tabular-nums ${k.tone}`}>{k.value}</p>
                <p className="mt-1 text-xs text-slate-500">{k.sub}</p>
              </div>
            ))}
          </div>

          <div className={cardShell}>
            <CardHeader
              icon={<BarChart3 size={16} />}
              title="Inspection pass rate by area / equipment"
              subtitle={`${fmtInt(chartData.length)} targets inspected in the selected period`}
            />
            {chartData.length === 0 ? (
              <EmptyState title="No inspection data" sub="Record inspections to see pass rates per area." />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${v}%`} />
                    <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value: any, _name: any, props: any) => [
                        `${fmtPct(Number(value) || 0)} (${props?.payload?.pass ?? 0}/${props?.payload?.total ?? 0} passed)`,
                        'Pass rate'
                      ]}
                    />
                    <Bar dataKey="passPct" radius={[0, 4, 4, 0]}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={d.passPct >= 70 ? PASS_COLOR : FAIL_COLOR} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className={cardShell}>
            <CardHeader
              icon={<Download size={16} />}
              title="Export"
              subtitle="Download sanitation data as CSV for the selected period"
            />
            <div className="flex flex-wrap gap-2">
              {(['cleanings', 'inspections', 'actions'] as const).map((t) => (
                <Button
                  key={t}
                  variant="secondary"
                  loading={exporting === t}
                  onClick={() => exportCsv(t)}
                  className="capitalize"
                >
                  <Download size={14} /> {t} CSV
                </Button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
