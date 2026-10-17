import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Download, FileText, PackageCheck, Send, TrendingUp, Wallet } from 'lucide-react';
import { E } from '../../lib/endpoints';
import { fmtBirr, fmtInt, fmtQ } from '../../lib/format';
import { exportToCSV, exportToPDF } from '../../lib/exportUtils';
import { KpiCard } from '../../components/KpiCard';
import { Button } from '../../components/ui';
import { BiError, BiLoading, BiShell, CHART_COLORS, ChartCard, NoAccessState, fmtPct1, useBiQuery } from './shared';
import type { SalesBi } from './types';

const CLAIM = 'sales:view';

export function BiSales() {
  const { allowed, data, isLoading, isError, refetch } = useBiQuery<SalesBi>('bi-sales', E.biSales, [CLAIM]);

  if (!allowed) return <NoAccessState domain="Sales & Distribution" />;
  if (isLoading) return <BiLoading />;
  if (isError || !data) return <BiError onRetry={() => refetch()} />;

  const { kpis, charts } = data;
  const revenueRows = charts.revenueTrend.map((r) => ({
    Month: r.month,
    'Revenue (ETB)': r.revenue
  }));

  const actions = (
    <>
      <Button variant="ghost" onClick={() => exportToCSV(revenueRows, `oyaya-revenue-trend-${Date.now()}.csv`)} title="Export revenue trend as CSV">
        <Download className="mr-1.5 h-4 w-4" /> CSV
      </Button>
      <Button
        variant="ghost"
        onClick={() => exportToPDF('Sales — 12-month revenue trend', ['Month', 'Revenue (ETB)'], revenueRows)}
        title="Export as PDF"
      >
        <FileText className="mr-1.5 h-4 w-4" /> PDF
      </Button>
    </>
  );

  return (
    <BiShell
      icon={<TrendingUp className="h-6 w-6" />}
      title="Sales & Distribution"
      subtitle="Revenue, orders, delivery performance and receivables"
      actions={actions}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Wallet className="h-6 w-6" />} label="Revenue MTD" value={fmtBirr(kpis.revenueMTD)} index={0} />
        <KpiCard icon={<Send className="h-6 w-6" />} label="Orders pending" value={fmtInt(kpis.ordersPending)} tone="amber" index={1} />
        <KpiCard
          icon={<PackageCheck className="h-6 w-6" />}
          label="Delivery OTIF"
          value={fmtPct1(kpis.otifPct)}
          tone={kpis.otifPct !== null && kpis.otifPct >= 95 ? 'green' : 'amber'}
          index={2}
        />
        <KpiCard icon={<TrendingUp className="h-6 w-6" />} label="Receivables" value={fmtBirr(kpis.receivablesBirr)} tone="blue" index={3} />
      </div>

      <ChartCard icon={<Wallet className="h-4 w-4" />} title="Revenue trend — last 12 months" subtitle="Recognized invoice revenue (ETB)">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={charts.revenueTrend} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
            />
            <Tooltip formatter={(v: unknown) => [fmtBirr(Number(v)), 'Revenue']} />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke={CHART_COLORS.violet}
              strokeWidth={2}
              fill={CHART_COLORS.violet}
              fillOpacity={0.15}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard icon={<Send className="h-4 w-4" />} title="Sales by product — MTD" subtitle="Dispatched quintals per product">
        {charts.salesByProduct.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No dispatches this month yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.salesByProduct} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="product" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={140} />
              <Tooltip formatter={(v: unknown) => [`${fmtQ(Number(v))} Q`, 'Dispatched']} />
              <Bar dataKey="quintals" radius={[0, 6, 6, 0]}>
                {charts.salesByProduct.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? CHART_COLORS.violet : CHART_COLORS.sky} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </BiShell>
  );
}
