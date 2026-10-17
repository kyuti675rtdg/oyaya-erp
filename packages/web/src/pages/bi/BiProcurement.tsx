import {
  Area,
  AreaChart,
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
import { Download, FileText, ShoppingCart, Truck, Wallet, Users } from 'lucide-react';
import { E } from '../../lib/endpoints';
import { fmtBirr, fmtInt, fmtQ } from '../../lib/format';
import { exportToCSV, exportToPDF } from '../../lib/exportUtils';
import { KpiCard } from '../../components/KpiCard';
import { Button } from '../../components/ui';
import { BiError, BiLoading, BiShell, CHART_COLORS, ChartCard, NoAccessState, PIE_COLORS, useBiQuery } from './shared';
import type { ProcurementBi } from './types';

const CLAIM = 'procurement:view';

function categoryLabel(c: string): string {
  return c === 'SOFT' ? 'Soft' : c === 'HARD' ? 'Hard' : c === 'FOREIGN' ? 'Foreign' : c;
}

export function BiProcurement() {
  const { allowed, data, isLoading, isError, refetch } = useBiQuery<ProcurementBi>(
    'bi-procurement',
    E.biProcurement,
    [CLAIM]
  );

  if (!allowed) return <NoAccessState domain="Procurement & Raw Material" />;
  if (isLoading) return <BiLoading />;
  if (isError || !data) return <BiError onRetry={() => refetch()} />;

  const { kpis, charts } = data;
  const intakeRows = charts.intakeTrend.map((r) => ({
    Date: r.day,
    'Soft (Q)': r.soft,
    'Hard (Q)': r.hard,
    'Foreign (Q)': r.foreign
  }));

  const actions = (
    <>
      <Button
        variant="ghost"
        onClick={() => exportToCSV(intakeRows, `oyaya-intake-trend-${Date.now()}.csv`)}
        title="Export intake trend as CSV"
      >
        <Download className="mr-1.5 h-4 w-4" /> CSV
      </Button>
      <Button
        variant="ghost"
        onClick={() =>
          exportToPDF('Procurement — 14-day wheat intake', ['Date', 'Soft (Q)', 'Hard (Q)', 'Foreign (Q)'], intakeRows)
        }
        title="Export as PDF"
      >
        <FileText className="mr-1.5 h-4 w-4" /> PDF
      </Button>
    </>
  );

  return (
    <BiShell
      icon={<ShoppingCart className="h-6 w-6" />}
      title="Procurement & Raw Material"
      subtitle="Wheat intake, suppliers, purchase orders and payables"
      actions={actions}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Truck className="h-6 w-6" />} label="Wheat intake today" value={`${fmtQ(kpis.intakeTodayQ)} Q`} index={0} />
        <KpiCard icon={<ShoppingCart className="h-6 w-6" />} label="Pending POs" value={fmtInt(kpis.pendingPOs)} tone="amber" index={1} />
        <KpiCard icon={<Wallet className="h-6 w-6" />} label="Payables outstanding" value={fmtBirr(kpis.payablesBirr)} tone="blue" index={2} />
        <KpiCard icon={<Users className="h-6 w-6" />} label="Active suppliers" value={fmtInt(kpis.supplierCount)} tone="green" index={3} />
      </div>

      <ChartCard icon={<Truck className="h-4 w-4" />} title="Wheat intake — last 14 days" subtitle="Quintals per day by wheat type">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={charts.intakeTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip formatter={(v: unknown, name: unknown) => [`${fmtQ(Number(v))} Q`, String(name)]} />
            <Area type="monotone" dataKey="soft" name="Soft" stackId="1" stroke={CHART_COLORS.violet} fill={CHART_COLORS.violet} fillOpacity={0.7} />
            <Area type="monotone" dataKey="hard" name="Hard" stackId="1" stroke={CHART_COLORS.amber} fill={CHART_COLORS.amber} fillOpacity={0.7} />
            <Area type="monotone" dataKey="foreign" name="Foreign" stackId="1" stroke={CHART_COLORS.sky} fill={CHART_COLORS.sky} fillOpacity={0.7} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard icon={<Truck className="h-4 w-4" />} title="Wheat-type mix — last 30 days" subtitle="Share of intake by category">
          {charts.wheatMix.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No intake in the last 30 days.</p>
          ) : (
            <div className="flex flex-col items-center sm:flex-row sm:justify-around">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={charts.wheatMix} dataKey="quintals" nameKey="category" innerRadius={55} outerRadius={85} paddingAngle={3} strokeWidth={0}>
                    {charts.wheatMix.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: unknown, name: unknown) => [`${fmtQ(Number(v))} Q`, categoryLabel(String(name))]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="w-full space-y-1.5 sm:max-w-[180px]">
                {charts.wheatMix.map((m, i) => (
                  <div key={m.category} className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span>{categoryLabel(m.category)}</span>
                    <span className="ml-auto font-bold tabular-nums">{fmtQ(m.quintals)} Q</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard icon={<Wallet className="h-4 w-4" />} title="Wheat price trend — last 12 weeks" subtitle="Average PO price per quintal (ETB)">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={charts.priceTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval={2} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
              <Tooltip formatter={(v: unknown) => [fmtBirr(Number(v)), 'Avg price/Q']} />
              <Line type="monotone" dataKey="price" stroke={CHART_COLORS.emerald} strokeWidth={2.5} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </BiShell>
  );
}
