import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, Printer } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { DailyProductionReport, ShiftProductionReport } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import {
  Button,
  EmptyState,
  ErrorBox,
  Field,
  SectionTitle,
  Select,
  Spinner,
  TextInput
} from '../components/ui';
import { fmtDate, fmtDateTime, fmtInt, fmtQ } from '../lib/format';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const EXTRACTION_MIN = 78;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ProdProductionReports() {
  const [date, setDate] = useState(todayISO());
  const [shift, setShift] = useState<'' | 'MORNING' | 'NIGHT'>('');

  const dailyQ = useQuery({
    queryKey: ['prod-report-daily', date],
    queryFn: async () => (await api.get<DailyProductionReport>(E.prodReportDaily(date))).data,
    enabled: !!date
  });
  const shiftQ = useQuery({
    queryKey: ['prod-report-shift', date, shift],
    queryFn: async () =>
      (await api.get<ShiftProductionReport>(E.prodReportShift(date, shift))).data,
    enabled: !!date && shift !== ''
  });

  const report = dailyQ.data;
  const shiftReport = shift !== '' ? shiftQ.data : null;

  const chartData = useMemo(
    () =>
      (report?.perBatch ?? [])
        .filter((b) => b.extractionPct !== null)
        .map((b) => ({
          name: b.batchNo,
          extraction: Number((b.extractionPct as number).toFixed(1))
        })),
    [report]
  );

  const exportCsv = () => {
    if (!report) return;
    const rows: (string | number)[][] = [
      ['Oyaya Flour Mill — Daily Production Report', report.date],
      [],
      ['KPI', 'Value'],
      ['Wheat intake (q)', report.kpis.intakeQ],
      ['Flour output (q)', report.kpis.totalFlourOutputQ],
      ['Weighted extraction (%)', report.kpis.weightedExtractionPct ?? ''],
      ['Batches worked', report.kpis.batchesWorked],
      ['Downtime (min)', report.kpis.totalDowntimeMin],
      ['Plans completed', report.kpis.plansCompleted],
      ['Open alerts', report.kpis.openAlerts],
      [],
      ['BATCH', 'Product', 'Wheat (q)', 'Flour (q)', 'Extraction (%)', 'Flagged'],
      ...report.perBatch.map((b) => [
        b.batchNo,
        b.productType,
        b.wheatWeighedQ,
        b.flourOutputQ,
        b.extractionPct ?? '',
        b.flagged ? 'YES' : 'NO'
      ]),
      [],
      ['SHIFT', 'Batch', 'Operators', 'Output (q)', 'Extraction (%)', 'Downtime (min)'],
      ...report.perShift.map((s) => [
        s.shift,
        s.batchNo ?? '',
        s.operators.join('; '),
        s.outputQ,
        s.extractionPct ?? '',
        s.downtimeMin
      ])
    ];
    downloadCsv(`production-report-${report.date}.csv`, rows);
  };

  return (
    <div>
      <SectionTitle
        title="Daily & Shift Production Reports"
        sub="Summary KPIs, per-batch and per-shift tables — CSV export and print"
        action={
          <div className="no-print flex items-center gap-2">
            <TextInput
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Report date"
            />
            <Select
              value={shift}
              onChange={(e) => setShift(e.target.value as '' | 'MORNING' | 'NIGHT')}
              aria-label="Shift filter"
            >
              <option value="">Both shifts</option>
              <option value="MORNING">Morning</option>
              <option value="NIGHT">Night</option>
            </Select>
            <Button variant="secondary" onClick={exportCsv} disabled={!report}>
              <Download size={14} /> CSV
            </Button>
            <Button variant="secondary" onClick={() => window.print()} disabled={!report}>
              <Printer size={14} /> Print
            </Button>
          </div>
        }
      />

      <div className="mb-4 print:hidden">
        <Field label="Report date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-[200px]" />
        </Field>
      </div>

      {dailyQ.isLoading ? (
        <Spinner label="Building report..." />
      ) : dailyQ.isError ? (
        <ErrorBox message="Failed to build the report." onRetry={() => dailyQ.refetch()} />
      ) : report ? (
        <>
          <div className="print:mb-4">
            <h2 className="hidden print:block text-xl font-bold text-slate-900 dark:text-slate-100">
              Oyaya Flour Mill — Daily Production Report
            </h2>
            <p className="hidden print:block text-sm text-slate-500 dark:text-slate-400 tabular-nums">{fmtDate(report.date)}</p>
          </div>

          {/* KPIs */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'Wheat intake', value: `${fmtQ(report.kpis.intakeQ)} q`, tone: 'text-slate-800' },
              { label: 'Flour output', value: `${fmtQ(report.kpis.totalFlourOutputQ)} q`, tone: 'text-slate-800' },
              {
                label: 'Weighted extraction',
                value: report.kpis.weightedExtractionPct !== null ? `${report.kpis.weightedExtractionPct.toFixed(1)}%` : '—',
                tone:
                  report.kpis.weightedExtractionPct === null
                    ? 'text-slate-800'
                    : report.kpis.weightedExtractionPct < EXTRACTION_MIN
                      ? 'text-rose-600'
                      : 'text-emerald-700'
              },
              {
                label: 'Downtime',
                value: report.kpis.totalDowntimeMin >= 60
                  ? `${Math.floor(report.kpis.totalDowntimeMin / 60)}h ${report.kpis.totalDowntimeMin % 60}m`
                  : `${report.kpis.totalDowntimeMin} min`,
                tone: report.kpis.totalDowntimeMin > 120 ? 'text-amber-700' : 'text-slate-800'
              },
              { label: 'Batches worked', value: fmtInt(report.kpis.batchesWorked), tone: 'text-slate-800' },
              { label: 'Plans completed', value: fmtInt(report.kpis.plansCompleted), tone: 'text-slate-800' },
              {
                label: 'Open alerts',
                value: fmtInt(report.kpis.openAlerts),
                tone: report.kpis.openAlerts > 0 ? 'text-amber-700' : 'text-slate-800'
              },
              {
                label: 'Red alerts',
                value: fmtInt(report.kpis.redAlerts),
                tone: report.kpis.redAlerts > 0 ? 'text-rose-600' : 'text-slate-800'
              }
            ].map((k) => (
              <div key={k.label} className={`${cardShell} !p-4`}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{k.label}</p>
                <p className={`tabular-nums mt-1 text-2xl font-bold ${k.tone}`}>{k.value}</p>
              </div>
            ))}
          </div>

          {/* Extraction chart */}
          {chartData.length > 0 ? (
            <div className={`${cardShell} mb-4 no-print`}>
              <CardHeader
                icon={<BarChart3 size={16} />}
                title="Extraction by batch"
                subtitle={`Target ≥ ${EXTRACTION_MIN}%`}
              />
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} dy={10} height={48} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip />
                    <ReferenceLine y={EXTRACTION_MIN} stroke="#dc2626" strokeDasharray="5 4" label={{ value: `${EXTRACTION_MIN}%`, fontSize: 10, fill: '#dc2626' }} />
                    <Bar dataKey="extraction" radius={[4, 4, 0, 0]}>
                      {chartData.map((d) => (
                        <Cell key={d.name} fill={d.extraction < EXTRACTION_MIN ? '#f43f5e' : '#10b981'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}

          {/* Per-batch table */}
          <div className={`${cardShell} mb-4`}>
            <CardHeader icon={<BarChart3 size={16} />} title="Per-batch summary" subtitle="Flour output vs weighed wheat" />
            {report.perBatch.length === 0 ? (
              <EmptyState title="No batch output this day" sub="Record flour output to populate this report." />
            ) : (
              <>
                <div className="hidden md:block">
                  <DataTable
                    keyOf={(r) => r.batchId}
                    columns={[
                      { key: 'batchNo', label: 'Batch', render: (r) => <span className="tabular-nums font-bold text-slate-800 dark:text-slate-100">{r.batchNo}</span> },
                      { key: 'productType', label: 'Product', render: (r) => r.productType.replace('_', ' ') },
                      { key: 'wheatWeighedQ', label: 'Wheat (q)', mono: true, render: (r) => fmtQ(r.wheatWeighedQ) },
                      { key: 'flourOutputQ', label: 'Flour (q)', mono: true, render: (r) => fmtQ(r.flourOutputQ) },
                      {
                        key: 'extractionPct',
                        label: 'Extraction',
                        mono: true,
                        render: (r) =>
                          r.extractionPct === null ? (
                            '-'
                          ) : (
                            <span className={`font-bold ${r.extractionPct < EXTRACTION_MIN ? 'text-rose-600' : 'text-emerald-700'}`}>
                              {r.extractionPct.toFixed(1)}%
                            </span>
                          )
                      },
                      {
                        key: 'flagged',
                        label: 'Flag',
                        render: (r) => (r.flagged ? <Badge tone="critical">Low yield</Badge> : <Badge tone="pass">OK</Badge>)
                      }
                    ]}
                    rows={report.perBatch}
                    emptyTitle="No batch output"
                    emptySub="—"
                  />
                </div>
                <div className="space-y-3 md:hidden print:hidden">
                  {report.perBatch.map((b) => (
                    <div key={b.batchId} className="rounded-xl border border-slate-200/70 p-4">
                      <div className="flex items-center justify-between">
                        <span className="tabular-nums font-bold text-slate-800 dark:text-slate-100">{b.batchNo}</span>
                        {b.flagged ? <Badge tone="critical">Low yield</Badge> : <Badge tone="pass">OK</Badge>}
                      </div>
                      <p className="tabular-nums mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {fmtQ(b.flourOutputQ)} q flour / {fmtQ(b.wheatWeighedQ)} q wheat
                      </p>
                      <p className={`tabular-nums text-lg font-bold ${(b.extractionPct ?? 100) < EXTRACTION_MIN ? 'text-rose-600' : 'text-emerald-700'}`}>
                        {b.extractionPct !== null ? `${b.extractionPct.toFixed(1)}%` : '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Per-shift table */}
          <div className={cardShell}>
            <CardHeader
              icon={<BarChart3 size={16} />}
              title={shiftReport ? `${shiftReport.shift === 'MORNING' ? 'Morning' : 'Night'} shift detail` : 'Per-shift summary'}
              subtitle={shiftReport ? `${fmtDate(shiftReport.date)} — ${shiftReport.rows.length} shift run(s)` : 'All shift runs this day'}
            />
            {shift !== '' && shiftQ.isLoading ? (
              <Spinner label="Loading shift report..." />
            ) : shift !== '' && shiftQ.isError ? (
              <ErrorBox message="Failed to load shift report." onRetry={() => shiftQ.refetch()} />
            ) : (
              (() => {
                const rows = shiftReport ? shiftReport.rows : report.perShift;
                if (rows.length === 0) {
                  return <EmptyState title="No shift runs" sub="Start a shift to populate this report." />;
                }
                return (
                  <div className="hidden md:block">
                    <DataTable
                      keyOf={(r) => r.shiftRunId}
                      columns={[
                        { key: 'shiftDate', label: 'Date', render: (r) => fmtDateTime(r.shiftDate) },
                        { key: 'shift', label: 'Shift' },
                        { key: 'batchNo', label: 'Batch', render: (r) => r.batchNo ?? '—' },
                        { key: 'operators', label: 'Operators', render: (r) => r.operators.join(', ') || '—' },
                        { key: 'outputQ', label: 'Output (q)', mono: true, render: (r) => fmtQ(r.outputQ) },
                        {
                          key: 'extractionPct',
                          label: 'Extraction',
                          mono: true,
                          render: (r) =>
                            r.extractionPct === null ? (
                              '-'
                            ) : (
                              <span className={`font-bold ${r.extractionPct < EXTRACTION_MIN ? 'text-rose-600' : 'text-emerald-700'}`}>
                                {r.extractionPct.toFixed(1)}%
                              </span>
                            )
                        },
                        {
                          key: 'downtimeMin',
                          label: 'Downtime',
                          mono: true,
                          render: (r) => (r.downtimeMin > 0 ? `${r.downtimeMin} min` : '—')
                        }
                      ]}
                      rows={rows}
                      emptyTitle="No shift runs"
                      emptySub="—"
                    />
                  </div>
                );
              })()
            )}
            {(() => {
              const rows = shiftReport ? shiftReport.rows : report.perShift;
              return (
                <div className="mt-3 space-y-3 md:hidden print:hidden">
                  {rows.map((s) => (
                    <div key={s.shiftRunId} className="rounded-xl border border-slate-200/70 p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 dark:text-slate-100">{s.shift} shift</span>
                        <span className="tabular-nums text-xs text-slate-500 dark:text-slate-400">{fmtDateTime(s.shiftDate)}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        Batch {s.batchNo ?? '—'} · {s.operators.join(', ') || 'no operators'}
                      </p>
                      <p className="tabular-nums mt-1 text-sm">
                        Output <span className="font-bold">{fmtQ(s.outputQ)} q</span>
                        {s.extractionPct !== null ? (
                          <span className={`ml-2 font-bold ${s.extractionPct < EXTRACTION_MIN ? 'text-rose-600' : 'text-emerald-700'}`}>
                            {s.extractionPct.toFixed(1)}%
                          </span>
                        ) : null}
                      </p>
                      {s.downtimeMin > 0 ? (
                        <p className="tabular-nums text-xs text-amber-700">Downtime {s.downtimeMin} min</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              );
            })()}
            {shiftReport ? (
              <div className="mt-4 flex gap-4 border-t border-slate-100 dark:border-slate-700 pt-4 text-sm">
                <p className="tabular-nums">
                  Shift total output: <span className="font-bold">{fmtQ(shiftReport.totalOutputQ)} q</span>
                </p>
                <p className="tabular-nums">
                  Shift downtime: <span className="font-bold">{shiftReport.totalDowntimeMin} min</span>
                </p>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
