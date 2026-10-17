import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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
import { BarChart3, Download, FileCheck2, Printer, TrendingUp, Wheat } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { QcReportSummary } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, Field, SectionTitle, Select, Spinner } from '../components/ui';
import { fmtDate } from '../lib/format';

const cardShell = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-sm p-5';

function isoDay(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TREND_PARAMS: Array<{ key: string; label: string; thresholdCode: string }> = [
  { key: 'impurityPct', label: 'Impurity (%)', thresholdCode: 'inprocess.impurity' },
  { key: 'wheatMoistureBefore', label: 'Wheat moisture before conditioning (%)', thresholdCode: 'inprocess.wheatMoistureBefore' },
  { key: 'wheatMoistureAfter', label: 'Wheat moisture after conditioning (%)', thresholdCode: 'inprocess.wheatMoistureAfter' },
  { key: 'flourMoisturePct', label: 'Flour moisture (%)', thresholdCode: 'inprocess.flourMoisture' },
  { key: 'wetGlutenPct', label: 'Wet gluten (%)', thresholdCode: 'inprocess.wetGluten' },
  { key: 'dryGlutenPct', label: 'Dry gluten (%)', thresholdCode: 'inprocess.dryGluten' },
  { key: 'ashPct', label: 'Ash (%)', thresholdCode: 'inprocess.ash' },
  { key: 'colorScore', label: 'Color', thresholdCode: 'inprocess.color' },
  { key: 'granulationPct', label: 'Granulation (%)', thresholdCode: 'inprocess.granulation' }
];

/* ── CSV export ───────────────────────────────────────────────────────────── */

function csvEscape(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function QualityReports() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return isoDay(d);
  });
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [trendParam, setTrendParam] = useState(TREND_PARAMS[0].key);

  const summaryQ = useQuery({
    queryKey: ['qc-reports-summary', from, to],
    queryFn: async () =>
      (
        await api.get<QcReportSummary>(E.qcReportsSummary, {
          params: {
            from: new Date(`${from}T00:00:00`).toISOString(),
            to: new Date(`${to}T23:59:59`).toISOString()
          }
        })
      ).data
  });

  const summary = summaryQ.data;

  const dailyChart = useMemo(() => {
    if (!summary) return [];
    const map = new Map<string, { date: string; labPass: number; labFail: number; flourPass: number; flourFail: number }>();
    for (const d of summary.labChecks.byDay) {
      map.set(d.date, { date: d.date.slice(5), labPass: d.total - d.failed, labFail: d.failed, flourPass: 0, flourFail: 0 });
    }
    for (const d of summary.flourTests.byDay) {
      const cur = map.get(d.date) ?? { date: d.date.slice(5), labPass: 0, labFail: 0, flourPass: 0, flourFail: 0 };
      cur.flourPass = d.total - d.failed;
      cur.flourFail = d.failed;
      map.set(d.date, cur);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v);
  }, [summary]);

  const trendData = useMemo(() => {
    if (!summary) return [];
    return (summary.paramTrends[trendParam] ?? []).map((p) => ({
      ...p,
      label: fmtDate(p.t)
    }));
  }, [summary, trendParam]);

  const trendThreshold = useMemo(() => {
    if (!summary) return null;
    const code = TREND_PARAMS.find((t) => t.key === trendParam)?.thresholdCode;
    return summary.thresholds.find((t) => t.code === code) ?? null;
  }, [summary, trendParam]);

  const typeCounts = useMemo(() => {
    if (!summary) return [];
    return [
      { name: '2h lab checks', value: summary.labChecks.total, fill: '#7c3aed' },
      { name: 'Flour tests', value: summary.flourTests.total, fill: '#10b981' },
      { name: 'Intake tests', value: summary.intakeTests.total, fill: '#f59e0b' }
    ];
  }, [summary]);

  const exportCsv = () => {
    if (!summary) return;
    const rows: (string | number)[][] = [];
    rows.push(['SECTION', 'DATE', 'TOTAL', 'PASSED', 'FAILED', 'PASS RATE %']);
    for (const d of summary.labChecks.byDay) {
      rows.push(['2h lab checks', d.date, d.total, d.total - d.failed, d.failed, d.total ? Number((((d.total - d.failed) / d.total) * 100).toFixed(1)) : 0]);
    }
    for (const d of summary.flourTests.byDay) {
      rows.push(['Flour tests', d.date, d.total, d.total - d.failed, d.failed, d.total ? Number((((d.total - d.failed) / d.total) * 100).toFixed(1)) : 0]);
    }
    rows.push([]);
    rows.push(['PARAMETER TREND', trendParam]);
    rows.push(['TIMESTAMP', 'VALUE']);
    for (const p of summary.paramTrends[trendParam] ?? []) rows.push([p.t, p.v]);
    downloadCSV(`quality-report-${from}-to-${to}.csv`, ['Quality inspection report', `${from} to ${to}`], rows);
  };

  const kpis = summary
    ? [
        { label: '2h lab checks', total: summary.labChecks.total, rate: summary.labChecks.passRate, icon: <Wheat size={15} /> },
        { label: 'Flour tests', total: summary.flourTests.total, rate: summary.flourTests.passRate, icon: <FileCheck2 size={15} /> },
        { label: 'Intake tests', total: summary.intakeTests.total, rate: summary.intakeTests.passRate, icon: <TrendingUp size={15} /> }
      ]
    : [];

  return (
    <div>
      <SectionTitle
        title="Quality Trends & Inspection Reports"
        sub="Pass/fail rates, parameter trends and inspection counts"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={exportCsv} disabled={!summary} className="px-4 py-2 text-sm">
              <Download size={15} /> CSV
            </Button>
            <Button variant="secondary" onClick={() => window.print()} className="px-4 py-2 text-sm">
              <Printer size={15} /> Print
            </Button>
          </div>
        }
      />

      <div className={`mb-4 ${cardShell}`}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Field label="From">
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="touch w-full rounded-lg border border-line bg-white dark:bg-slate-800 px-4 py-2 text-base focus:border-navy focus:outline-none"
              />
            </Field>
          </div>
          <div className="w-44">
            <Field label="To">
              <input
                type="date"
                value={to}
                min={from}
                max={isoDay(new Date())}
                onChange={(e) => setTo(e.target.value)}
                className="touch w-full rounded-lg border border-line bg-white dark:bg-slate-800 px-4 py-2 text-base focus:border-navy focus:outline-none"
              />
            </Field>
          </div>
          <div className="w-64">
            <Field label="Trend parameter">
              <Select value={trendParam} onChange={(e) => setTrendParam(e.target.value)}>
                {TREND_PARAMS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </div>

      {summaryQ.isLoading ? (
        <Spinner label="Loading quality report..." />
      ) : summaryQ.isError ? (
        <ErrorBox message="Could not load the quality report." onRetry={() => summaryQ.refetch()} />
      ) : !summary ? (
        <div className={cardShell}>
          <EmptyState title="No data" sub="No inspection data in this range." />
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {kpis.map((k) => (
              <div key={k.label} className={cardShell}>
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span className="text-violet-600">{k.icon}</span> {k.label}
                </p>
                <div className="mt-2 flex items-end justify-between">
                  <p className="tabular-nums text-2xl font-bold text-ink">{k.total}</p>
                  <Badge tone={k.rate >= 95 ? 'pass' : k.rate >= 80 ? 'advisory' : 'critical'}>
                    {k.rate.toFixed(1)}% pass
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">inspections in range</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className={`xl:col-span-2 ${cardShell}`}>
              <CardHeader
                icon={<BarChart3 size={16} />}
                title="Daily pass / fail"
                subtitle="2-hour lab checks and flour tests per day"
              />
              {dailyChart.length === 0 ? (
                <EmptyState title="No inspections in range" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={dailyChart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="labPass" name="Lab checks · pass" stackId="lab" fill="#7c3aed" />
                    <Bar dataKey="labFail" name="Lab checks · fail" stackId="lab" fill="#f43f5e" />
                    <Bar dataKey="flourPass" name="Flour tests · pass" stackId="flour" fill="#10b981" />
                    <Bar dataKey="flourFail" name="Flour tests · fail" stackId="flour" fill="#fb7185" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className={cardShell}>
              <CardHeader
                icon={<FileCheck2 size={16} />}
                title="Inspections by type"
                subtitle="Share of each inspection kind"
              />
              {typeCounts.every((t) => t.value === 0) ? (
                <EmptyState title="No inspections in range" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={typeCounts} dataKey="value" nameKey="name" outerRadius={95} label={{ fontSize: 11 }}>
                      {typeCounts.map((t) => (
                        <Cell key={t.name} fill={t.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className={`mt-4 ${cardShell}`}>
            <CardHeader
              icon={<TrendingUp size={16} />}
              title={`Parameter trend — ${TREND_PARAMS.find((t) => t.key === trendParam)?.label}`}
              subtitle={
                trendThreshold
                  ? `Standard: ${
                      trendThreshold.minValue !== null && trendThreshold.maxValue !== null
                        ? `${trendThreshold.minValue} – ${trendThreshold.maxValue}`
                        : trendThreshold.minValue !== null
                          ? `≥ ${trendThreshold.minValue}`
                          : `≤ ${trendThreshold.maxValue}`
                    }${trendThreshold.unit ? ` ${trendThreshold.unit}` : ''}`
                  : 'No configured threshold'
              }
              action={
                <Badge tone="neutral" className="tabular-nums">
                  {trendData.length} points
                </Badge>
              }
            />
            {trendData.length === 0 ? (
              <EmptyState title="No measurements" sub="No 2-hour lab checks recorded in this range." />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={40} />
                  <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                  <Tooltip labelFormatter={(_, payload) => (payload[0]?.payload?.t ? fmtDate(String(payload[0].payload.t)) : '')} />
                  <Line type="monotone" dataKey="v" name="Measured" stroke="#7c3aed" strokeWidth={2} dot={false} />
                  {trendThreshold?.minValue !== null && trendThreshold?.minValue !== undefined ? (
                    <ReferenceLine
                      y={trendThreshold.minValue}
                      stroke="#f59e0b"
                      strokeDasharray="5 5"
                      label={{ value: `min ${trendThreshold.minValue}`, fontSize: 11, fill: '#b45309' }}
                    />
                  ) : null}
                  {trendThreshold?.maxValue !== null && trendThreshold?.maxValue !== undefined ? (
                    <ReferenceLine
                      y={trendThreshold.maxValue}
                      stroke="#f43f5e"
                      strokeDasharray="5 5"
                      label={{ value: `max ${trendThreshold.maxValue}`, fontSize: 11, fill: '#be123c' }}
                    />
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  );
}
