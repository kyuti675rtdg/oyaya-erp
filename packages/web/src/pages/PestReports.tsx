import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
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
import { fmtPct } from '../lib/format';
import type { PestEvidenceReport, PestInspectionReport, PestTreatmentEffectiveness } from '../types';
import { Button, ErrorBox, Field, SectionTitle, Spinner, TextInput } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { cardShell, downloadCsv, PestCardHeader, PestKpi, pretty } from './PestCommon';

const PIE_COLORS = ['#7c3aed', '#059669', '#d97706', '#e11d48', '#0ea5e9', '#64748b'];

export function PestReports() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (from) p.from = from;
    if (to) p.to = to;
    return p;
  }, [from, to]);

  const inspectionsQ = useQuery({
    queryKey: ['pest-report-inspections', from || undefined, to || undefined],
    queryFn: async () => (await api.get<PestInspectionReport>(E.pestReportInspections, { params })).data
  });
  const evidenceQ = useQuery({
    queryKey: ['pest-report-evidence', from || undefined, to || undefined],
    queryFn: async () => (await api.get<PestEvidenceReport>(E.pestReportEvidence, { params })).data
  });
  const effectivenessQ = useQuery({
    queryKey: ['pest-report-effectiveness'],
    queryFn: async () => (await api.get<PestTreatmentEffectiveness>(E.pestReportEffectiveness)).data
  });

  const loading = inspectionsQ.isLoading || evidenceQ.isLoading || effectivenessQ.isLoading;
  const error = inspectionsQ.isError || evidenceQ.isError || effectivenessQ.isError;

  const exportInspections = () => {
    const r = inspectionsQ.data;
    if (!r) return;
    downloadCsv(
      'pest-inspections-by-area.csv',
      ['Area', 'Scheduled', 'Done', 'Overdue'],
      r.byArea.map((x) => [x.area, x.scheduled, x.done, x.overdue])
    );
    downloadCsv(
      'pest-inspections-by-month.csv',
      ['Month', 'Scheduled', 'Done'],
      r.byMonth.map((x) => [x.month, x.scheduled, x.done])
    );
  };

  const exportEvidence = () => {
    const r = evidenceQ.data;
    if (!r) return;
    downloadCsv(
      'pest-evidence-by-type.csv',
      ['Pest type', 'Count'],
      r.byPestType.map((x) => [pretty(x.pestType), x.count])
    );
    downloadCsv(
      'pest-evidence-by-location.csv',
      ['Location', 'Count'],
      r.byLocation.map((x) => [x.location, x.count])
    );
  };

  const exportEffectiveness = () => {
    const r = effectivenessQ.data;
    if (!r) return;
    downloadCsv(
      'pest-treatment-effectiveness.csv',
      ['Treatment', 'Treated', 'Cleared', 'Clearance %'],
      r.byTreatment.map((x) => [
        pretty(x.treatment),
        x.treated,
        x.cleared,
        x.pct === null ? '' : x.pct.toFixed(1)
      ])
    );
  };

  return (
    <div>
      <SectionTitle
        title="Pest Control Reports"
        sub="Inspection coverage, evidence trends and treatment effectiveness — export to CSV"
      />

      <div className={`${cardShell} mb-4`}>
        <PestCardHeader
          icon={<BarChart3 size={16} />}
          title="Report period"
          subtitle="Leave blank for all-time"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading reports..." />
      ) : error ? (
        <ErrorBox
          message="Could not load report data."
          onRetry={() => {
            inspectionsQ.refetch();
            evidenceQ.refetch();
            effectivenessQ.refetch();
          }}
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <PestKpi
              label="Scheduled inspections"
              value={inspectionsQ.data?.totals.schedules ?? 0}
              tone="violet"
              sub="In period"
            />
            <PestKpi
              label="Risk-area inspections"
              value={inspectionsQ.data?.totals.riskInspections ?? 0}
              tone="slate"
              sub="High-risk areas"
            />
            <PestKpi
              label="Evidence records"
              value={(evidenceQ.data?.byPestType ?? []).reduce((n, x) => n + x.count, 0)}
              tone="amber"
              sub="In period"
            />
            <PestKpi
              label="Treatment clearance"
              value={effectivenessQ.data?.overall.pct === null || effectivenessQ.data?.overall.pct === undefined ? '—' : fmtPct(effectivenessQ.data.overall.pct)}
              tone="emerald"
              sub="Cleared / treated"
            />
          </div>

          {/* Inspections by area / month */}
          <div className={`${cardShell} mb-4`}>
            <PestCardHeader
              icon={<BarChart3 size={16} />}
              title="Inspections by area and month"
              subtitle="Scheduled vs completed inspections"
              action={
                <Button variant="secondary" className="px-4 py-2 text-sm" onClick={exportInspections}>
                  <span className="inline-flex items-center gap-1.5">
                    <Download size={14} /> CSV
                  </span>
                </Button>
              }
            />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">By area</p>
                {(inspectionsQ.data?.byArea.length ?? 0) === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No data in period.</p>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={(inspectionsQ.data?.byArea ?? []).map((x) => ({ name: x.area, scheduled: x.scheduled, done: x.done, overdue: x.overdue }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="scheduled" fill="#7c3aed" name="Scheduled" />
                        <Bar dataKey="done" fill="#059669" name="Done" />
                        <Bar dataKey="overdue" fill="#e11d48" name="Overdue" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">By month</p>
                {(inspectionsQ.data?.byMonth.length ?? 0) === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No data in period.</p>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={inspectionsQ.data?.byMonth ?? []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="scheduled" fill="#7c3aed" name="Scheduled" />
                        <Bar dataKey="done" fill="#059669" name="Done" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
            {(inspectionsQ.data?.riskByArea.length ?? 0) > 0 ? (
              <div className="mt-6">
                <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">High-risk area inspection outcomes</p>
                <DataTable
                  columns={[
                    { key: 'area', label: 'Area', render: (r) => <span className="font-semibold capitalize">{r.area}</span> },
                    { key: 'inspections', label: 'Inspections', render: (r) => <span className="tnum">{r.inspections}</span>, mono: true },
                    { key: 'passed', label: 'Passed', render: (r) => <span className="tnum text-emerald-700">{r.passed}</span>, mono: true },
                    { key: 'failed', label: 'Failed', render: (r) => <span className="tnum text-rose-700">{r.failed}</span>, mono: true }
                  ]}
                  rows={(inspectionsQ.data?.riskByArea ?? []).map((x) => ({ id: x.area, ...x }))}
                />
              </div>
            ) : null}
          </div>

          {/* Evidence by pest type */}
          <div className={`${cardShell} mb-4`}>
            <PestCardHeader
              icon={<BarChart3 size={16} />}
              title="Evidence by pest type"
              subtitle="Which pests are being found, and where"
              action={
                <Button variant="secondary" className="px-4 py-2 text-sm" onClick={exportEvidence}>
                  <span className="inline-flex items-center gap-1.5">
                    <Download size={14} /> CSV
                  </span>
                </Button>
              }
            />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={(evidenceQ.data?.byPestType ?? []).map((x) => ({ name: pretty(x.pestType), value: x.count }))}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={90}
                      label
                    >
                      {(evidenceQ.data?.byPestType ?? []).map((x, i) => (
                        <Cell key={x.pestType} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Top locations</p>
                <DataTable
                  columns={[
                    { key: 'location', label: 'Location', render: (r) => <span className="capitalize">{r.location}</span> },
                    { key: 'count', label: 'Records', render: (r) => <span className="tnum">{r.count}</span>, mono: true }
                  ]}
                  rows={(evidenceQ.data?.byLocation ?? []).map((x) => ({ id: x.location, ...x }))}
                  emptyTitle="No evidence in period"
                />
              </div>
            </div>
          </div>

          {/* Treatment effectiveness */}
          <div className={cardShell}>
            <PestCardHeader
              icon={<BarChart3 size={16} />}
              title="Treatment effectiveness"
              subtitle="Share of treated evidence records cleared, by treatment method"
              action={
                <Button variant="secondary" className="px-4 py-2 text-sm" onClick={exportEffectiveness}>
                  <span className="inline-flex items-center gap-1.5">
                    <Download size={14} /> CSV
                  </span>
                </Button>
              }
            />
            {(effectivenessQ.data?.byTreatment.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No treated evidence records yet.</p>
            ) : (
              <>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(effectivenessQ.data?.byTreatment ?? []).map((x) => ({
                        name: pretty(x.treatment),
                        clearance: x.pct === null ? 0 : Math.round(x.pct * 10) / 10,
                        treated: x.treated
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip formatter={(value) => `${value}%`} />
                      <Bar dataKey="clearance" name="Clearance %" fill="#7c3aed" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4">
                  <DataTable
                    columns={[
                      { key: 'treatment', label: 'Treatment', render: (r) => <span className="font-semibold">{pretty(r.treatment)}</span> },
                      { key: 'treated', label: 'Treated', render: (r) => <span className="tnum">{r.treated}</span>, mono: true },
                      { key: 'cleared', label: 'Cleared', render: (r) => <span className="tnum text-emerald-700">{r.cleared}</span>, mono: true },
                      { key: 'pct', label: 'Clearance', render: (r) => <span className="tnum">{r.pct === null ? '—' : fmtPct(r.pct)}</span>, mono: true }
                    ]}
                    rows={(effectivenessQ.data?.byTreatment ?? []).map((x) => ({ id: x.treatment, ...x }))}
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
