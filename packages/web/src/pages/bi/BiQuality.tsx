import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { AlertTriangle, BadgeCheck, Download, FileText, FlaskConical, Hourglass, ClipboardCheck } from 'lucide-react';
import { E } from '../../lib/endpoints';
import { fmtInt, fmtPct } from '../../lib/format';
import { exportToCSV, exportToPDF } from '../../lib/exportUtils';
import { KpiCard } from '../../components/KpiCard';
import { Button } from '../../components/ui';
import { BiError, BiLoading, BiShell, CHART_COLORS, ChartCard, NoAccessState, PIE_COLORS, fmtPct1, useBiQuery } from './shared';
import type { QualityBi } from './types';

const CLAIM = 'qc:view';

export function BiQuality() {
  const { allowed, data, isLoading, isError, refetch } = useBiQuery<QualityBi>('bi-quality', E.biQuality, [CLAIM]);

  if (!allowed) return <NoAccessState domain="Quality & CAPA" />;
  if (isLoading) return <BiLoading />;
  if (isError || !data) return <BiError onRetry={() => refetch()} />;

  const { kpis, charts } = data;
  const trendRows = charts.passRateTrend.map((r) => ({
    Date: r.day,
    'Pass rate %': r.passRate ?? '—',
    Tests: r.tests
  }));

  const actions = (
    <>
      <Button
        variant="ghost"
        onClick={() => exportToCSV(trendRows, `oyaya-quality-trend-${Date.now()}.csv`)}
        title="Export trend as CSV"
      >
        <Download className="mr-1.5 h-4 w-4" /> CSV
      </Button>
      <Button
        variant="ghost"
        onClick={() => exportToPDF('Quality & CAPA — 14-day pass-rate trend', ['Date', 'Pass rate %', 'Tests'], trendRows)}
        title="Export as PDF"
      >
        <FileText className="mr-1.5 h-4 w-4" /> PDF
      </Button>
    </>
  );

  return (
    <BiShell
      icon={<FlaskConical className="h-6 w-6" />}
      title="Quality & CAPA"
      subtitle="Lab compliance, CAPA pipeline and defect analysis"
      actions={actions}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<BadgeCheck className="h-6 w-6" />}
          label="Lab pass rate (30d)"
          value={kpis.passRatePct === null ? '—' : fmtPct(kpis.passRatePct)}
          tone="green"
          index={0}
        />
        <KpiCard
          icon={<AlertTriangle className="h-6 w-6" />}
          label="Open CAPAs"
          value={fmtInt(kpis.openCapas)}
          tone={kpis.openCapas > 0 ? 'amber' : 'green'}
          index={1}
        />
        <KpiCard
          icon={<Hourglass className="h-6 w-6" />}
          label="Overdue CAPAs (14d+)"
          value={fmtInt(kpis.overdueCapas)}
          tone={kpis.overdueCapas > 0 ? 'amber' : 'green'}
          index={2}
        />
        <KpiCard
          icon={<ClipboardCheck className="h-6 w-6" />}
          label="Inspections today"
          value={fmtInt(kpis.inspectionsToday)}
          tone="blue"
          index={3}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          icon={<BadgeCheck className="h-4 w-4" />}
          title="Pass-rate trend — last 14 days"
          subtitle="Share of flour quality tests passing"
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={charts.passRateTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 100]} />
              <Tooltip formatter={(v: unknown) => [v === null || v === undefined ? '—' : fmtPct(Number(v)), 'Pass rate']} />
              <Line type="monotone" dataKey="passRate" stroke={CHART_COLORS.emerald} strokeWidth={2.5} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard icon={<Hourglass className="h-4 w-4" />} title="CAPA aging" subtitle="Open CAPAs by age">
          {charts.capaAging.every((b) => b.count === 0) ? (
            <p className="py-10 text-center text-sm text-slate-400">No open CAPAs.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={charts.capaAging} dataKey="count" nameKey="bucket" innerRadius={55} outerRadius={85} paddingAngle={3} strokeWidth={0}>
                  {charts.capaAging.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: unknown) => [fmtInt(Number(v)), 'CAPAs']} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="mt-2 grid grid-cols-2 gap-1">
            {charts.capaAging.map((b, i) => (
              <div key={b.bucket} className="flex items-center gap-2 text-xs text-slate-600">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                <span className="truncate">{b.bucket}</span>
                <span className="ml-auto font-bold tabular-nums">{b.count}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <ChartCard icon={<AlertTriangle className="h-4 w-4" />} title="Defect pareto — last 30 days" subtitle="Nonconformities by severity">
        {charts.defectPareto.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No nonconformities recorded.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.defectPareto} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="severity" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip formatter={(v: unknown) => [fmtInt(Number(v)), 'Defects']} />
              <Bar dataKey="count" fill={CHART_COLORS.rose} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </BiShell>
  );
}
