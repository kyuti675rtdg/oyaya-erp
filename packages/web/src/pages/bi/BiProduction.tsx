import {
  Area,
  AreaChart,
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
import { Activity, Download, Factory, FileText, Gauge as GaugeIcon, Timer, Wheat } from 'lucide-react';
import { E } from '../../lib/endpoints';
import { fmtPct, fmtQ } from '../../lib/format';
import { exportToCSV, exportToPDF } from '../../lib/exportUtils';
import { KpiCard } from '../../components/KpiCard';
import { Button } from '../../components/ui';
import { BiError, BiLoading, BiShell, CHART_COLORS, ChartCard, NoAccessState, fmtPct1, useBiQuery } from './shared';
import type { ProductionBi } from './types';

const CLAIM = 'production:view';

/** Semi-circular gauge for Duket yield vs the 78% target. */
function YieldGauge({ value, target }: { value: number | null; target: number }) {
  const v = value ?? 0;
  const segs = [
    { name: 'Yield', value: Math.min(v, 100) },
    { name: 'Gap', value: Math.max(0, 100 - v) }
  ];
  const ok = value !== null && value >= target;
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={190}>
        <PieChart>
          <Pie
            data={segs}
            dataKey="value"
            startAngle={180}
            endAngle={0}
            innerRadius={70}
            outerRadius={95}
            paddingAngle={2}
            strokeWidth={0}
          >
            <Cell fill={ok ? CHART_COLORS.emerald : CHART_COLORS.amber} />
            <Cell fill="currentColor" className="text-slate-100 dark:text-slate-700" />
          </Pie>
          <Tooltip formatter={(val: unknown) => [`${(Number(val ?? 0)).toFixed(1)}%`, 'Duket yield']} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center">
        <p className="text-3xl font-extrabold tabular-nums tracking-tight text-slate-900 dark:text-white">
          {value === null ? '—' : fmtPct(value)}
        </p>
        <p className="text-xs text-slate-500">
          target {target}% · {ok ? 'on target' : value === null ? 'no data' : 'below target'}
        </p>
      </div>
    </div>
  );
}

export function BiProduction() {
  const { allowed, data, isLoading, isError, refetch } = useBiQuery<ProductionBi>(
    'bi-production',
    E.biProduction,
    [CLAIM]
  );

  if (!allowed) return <NoAccessState domain="Production" />;
  if (isLoading) return <BiLoading />;
  if (isError || !data) return <BiError onRetry={() => refetch()} />;

  const { kpis, charts } = data;
  const trendRows = charts.outputTrend.map((r) => ({
    Date: r.day,
    'Output (Q)': r.outputQ,
    'Extraction %': r.extractionPct ?? '—'
  }));

  const actions = (
    <>
      <Button
        variant="ghost"
        onClick={() => exportToCSV(trendRows, `oyaya-production-trend-${Date.now()}.csv`)}
        title="Export trend as CSV"
      >
        <Download className="mr-1.5 h-4 w-4" /> CSV
      </Button>
      <Button
        variant="ghost"
        onClick={() =>
          exportToPDF('Production & Yield — 14-day trend', ['Date', 'Output (Q)', 'Extraction %'], trendRows)
        }
        title="Export as PDF"
      >
        <FileText className="mr-1.5 h-4 w-4" /> PDF
      </Button>
    </>
  );

  return (
    <BiShell
      icon={<Factory className="h-6 w-6" />}
      title="Production & Yield"
      subtitle="Mill output, extraction efficiency and downtime intelligence"
      actions={actions}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard icon={<Wheat className="h-6 w-6" />} label="Daily output" value={`${fmtQ(kpis.dailyOutputQ)} Q`} index={0} />
        <KpiCard
          icon={<GaugeIcon className="h-6 w-6" />}
          label="Avg extraction (30d)"
          value={kpis.avgExtractionPct === null ? '—' : fmtPct(kpis.avgExtractionPct)}
          tone="green"
          index={1}
        />
        <KpiCard
          icon={<Activity className="h-6 w-6" />}
          label="Duket yield vs 78%"
          value={fmtPct1(kpis.duketYieldPct)}
          tone={kpis.duketYieldPct !== null && kpis.duketYieldPct >= kpis.yieldTargetPct ? 'green' : 'amber'}
          index={2}
        />
        <KpiCard
          icon={<Timer className="h-6 w-6" />}
          label="Downtime (7d)"
          value={`${kpis.downtimeHours7d} h`}
          tone="amber"
          index={3}
        />
        <KpiCard
          icon={<Factory className="h-6 w-6" />}
          label="Shift performance"
          value={fmtPct1(kpis.shiftPerformancePct)}
          tone="blue"
          index={4}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          icon={<Wheat className="h-4 w-4" />}
          title="Flour output — last 14 days"
          subtitle="Quintals logged per day"
        >
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={charts.outputTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: unknown) => [`${fmtQ(Number(v))} Q`, 'Output']} />
              <Area
                type="monotone"
                dataKey="outputQ"
                stroke={CHART_COLORS.violet}
                strokeWidth={2}
                fill={CHART_COLORS.violet}
                fillOpacity={0.15}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard icon={<GaugeIcon className="h-4 w-4" />} title="Duket yield gauge" subtitle="30-day Duket share of flour">
          <YieldGauge value={kpis.duketYieldPct} target={kpis.yieldTargetPct} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          icon={<GaugeIcon className="h-4 w-4" />}
          title="Extraction trend — last 14 days"
          subtitle="Average extraction % per day"
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={charts.outputTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
              <Tooltip formatter={(v: unknown) => [v === null || v === undefined ? '—' : fmtPct(Number(v)), 'Extraction']} />
              <Line type="monotone" dataKey="extractionPct" stroke={CHART_COLORS.sky} strokeWidth={2.5} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard icon={<Timer className="h-4 w-4" />} title="Downtime by reason" subtitle="Last 7 days, hours lost">
          {charts.downtimeByReason.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No downtime recorded this week.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={charts.downtimeByReason} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="reason" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={90} />
                <Tooltip formatter={(v: unknown) => [`${Number(v ?? 0)} h`, 'Downtime']} />
                <Bar dataKey="hours" fill={CHART_COLORS.amber} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </BiShell>
  );
}
