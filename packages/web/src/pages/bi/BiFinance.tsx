import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Banknote, Download, FileText, Scale, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { E } from '../../lib/endpoints';
import { fmtBirr } from '../../lib/format';
import { exportToCSV, exportToPDF } from '../../lib/exportUtils';
import { KpiCard } from '../../components/KpiCard';
import { Button } from '../../components/ui';
import { BiError, BiLoading, BiShell, CHART_COLORS, ChartCard, NoAccessState, PIE_COLORS, useBiQuery } from './shared';
import type { FinanceBi } from './types';

const CLAIM = 'finance:view';

export function BiFinance() {
  const { allowed, data, isLoading, isError, refetch } = useBiQuery<FinanceBi>('bi-finance', E.biFinance, [CLAIM]);

  if (!allowed) return <NoAccessState domain="Finance" />;
  if (isLoading) return <BiLoading />;
  if (isError || !data) return <BiError onRetry={() => refetch()} />;

  const { kpis, charts } = data;
  const cashRows = charts.cashFlow.map((r) => ({
    Week: r.week,
    'Inflow (ETB)': r.inflow,
    'Outflow (ETB)': r.outflow
  }));

  const actions = (
    <>
      <Button variant="ghost" onClick={() => exportToCSV(cashRows, `oyaya-cash-flow-${Date.now()}.csv`)} title="Export cash flow as CSV">
        <Download className="mr-1.5 h-4 w-4" /> CSV
      </Button>
      <Button
        variant="ghost"
        onClick={() => exportToPDF('Finance — 12-week cash flow', ['Week', 'Inflow (ETB)', 'Outflow (ETB)'], cashRows)}
        title="Export as PDF"
      >
        <FileText className="mr-1.5 h-4 w-4" /> PDF
      </Button>
    </>
  );

  return (
    <BiShell
      icon={<Banknote className="h-6 w-6" />}
      title="Finance"
      subtitle="Cash position, receivables, payables and margin proxy"
      actions={actions}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          icon={<Wallet className="h-6 w-6" />}
          label="Net cash position"
          value={fmtBirr(kpis.cashBalance)}
          tone={kpis.cashBalance >= 0 ? 'green' : 'amber'}
          index={0}
        />
        <KpiCard icon={<TrendingUp className="h-6 w-6" />} label="Cash in (MTD)" value={fmtBirr(kpis.cashInMTD)} tone="green" index={1} />
        <KpiCard icon={<TrendingDown className="h-6 w-6" />} label="Cash out (MTD)" value={fmtBirr(kpis.cashOutMTD)} tone="amber" index={2} />
        <KpiCard icon={<Banknote className="h-6 w-6" />} label="Receivables" value={fmtBirr(kpis.receivablesBirr)} tone="blue" index={3} />
        <KpiCard icon={<Scale className="h-6 w-6" />} label="Payables" value={fmtBirr(kpis.payablesBirr)} tone="blue" index={4} />
        <KpiCard
          icon={<TrendingUp className="h-6 w-6" />}
          label="Est. profit (MTD)"
          value={fmtBirr(kpis.profitMTD)}
          tone={kpis.profitMTD >= 0 ? 'green' : 'amber'}
          index={5}
        />
      </div>

      <ChartCard icon={<Wallet className="h-4 w-4" />} title="Cash flow — last 12 weeks" subtitle="Customer receipts vs supplier payments (ETB)">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={charts.cashFlow} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval={1} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
            />
            <Tooltip formatter={(v: unknown, name: unknown) => [fmtBirr(Number(v)), name === 'inflow' ? 'Inflow' : 'Outflow']} />
            <Line type="monotone" dataKey="inflow" stroke={CHART_COLORS.emerald} strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="outflow" stroke={CHART_COLORS.rose} strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard icon={<Scale className="h-4 w-4" />} title="Top supplier spend — last 90 days" subtitle="AP invoice value by supplier (ETB)">
        {charts.expenseBreakdown.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No supplier invoices in the last 90 days.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.expenseBreakdown} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
              />
              <YAxis type="category" dataKey="supplier" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={150} />
              <Tooltip formatter={(v: unknown) => [fmtBirr(Number(v)), 'Spend']} />
              <Bar dataKey="amount" radius={[0, 6, 6, 0]}>
                {charts.expenseBreakdown.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </BiShell>
  );
}
