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
import { Boxes, Download, FileText, Package, Wallet, Waves } from 'lucide-react';
import { E } from '../../lib/endpoints';
import { fmtBirr, fmtQ } from '../../lib/format';
import { exportToCSV, exportToPDF } from '../../lib/exportUtils';
import { KpiCard } from '../../components/KpiCard';
import { Button } from '../../components/ui';
import { BiError, BiLoading, BiShell, CHART_COLORS, ChartCard, NoAccessState, fmtPct1, useBiQuery } from './shared';
import type { InventoryBi } from './types';

const CLAIM = 'storage:view';

export function BiInventory() {
  const { allowed, data, isLoading, isError, refetch } = useBiQuery<InventoryBi>(
    'bi-inventory',
    E.biInventory,
    [CLAIM]
  );

  if (!allowed) return <NoAccessState domain="Inventory" />;
  if (isLoading) return <BiLoading />;
  if (isError || !data) return <BiError onRetry={() => refetch()} />;

  const { kpis, charts } = data;
  const stockRows = charts.stockLevels.map((s) => ({
    Location: s.name,
    'Stock (Q)': s.quintals,
    'Capacity (Q)': s.capacity > 0 ? s.capacity : '—',
    'Utilization %': s.capacity > 0 ? fmtPct1((s.quintals / s.capacity) * 100) : '—'
  }));

  const actions = (
    <>
      <Button variant="ghost" onClick={() => exportToCSV(stockRows, `oyaya-stock-levels-${Date.now()}.csv`)} title="Export stock levels as CSV">
        <Download className="mr-1.5 h-4 w-4" /> CSV
      </Button>
      <Button
        variant="ghost"
        onClick={() => exportToPDF('Inventory — stock levels', ['Location', 'Stock (Q)', 'Capacity (Q)', 'Utilization %'], stockRows)}
        title="Export as PDF"
      >
        <FileText className="mr-1.5 h-4 w-4" /> PDF
      </Button>
    </>
  );

  return (
    <BiShell
      icon={<Boxes className="h-6 w-6" />}
      title="Inventory"
      subtitle="Wheat storage, conditioning tanks and finished goods"
      actions={actions}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Boxes className="h-6 w-6" />}
          label={`Dry pool (${fmtQ(kpis.dryPoolCapacityQ)} Q cap)`}
          value={`${fmtQ(kpis.dryPoolQ)} Q`}
          index={0}
        />
        <KpiCard
          icon={<Waves className="h-6 w-6" />}
          label="Tank utilization"
          value={fmtPct1(kpis.tankUtilizationPct)}
          tone="blue"
          index={1}
        />
        <KpiCard
          icon={<Package className="h-6 w-6" />}
          label="Finished goods stock"
          value={`${fmtQ(kpis.finishedGoodsQ)} Q`}
          tone="green"
          index={2}
        />
        <KpiCard
          icon={<Wallet className="h-6 w-6" />}
          label="Est. stock value"
          value={fmtBirr(kpis.stockValueBirr)}
          tone="amber"
          index={3}
        />
      </div>

      <ChartCard icon={<Boxes className="h-4 w-4" />} title="Stock levels by location" subtitle="Current quintals vs capacity">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={charts.stockLevels} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip formatter={(v: unknown) => [`${fmtQ(Number(v))} Q`, 'Stock']} />
            <Bar dataKey="quintals" radius={[6, 6, 0, 0]}>
              {charts.stockLevels.map((_, i) => (
                <Cell
                  key={i}
                  fill={i === 0 ? CHART_COLORS.violet : i === charts.stockLevels.length - 1 ? CHART_COLORS.emerald : CHART_COLORS.sky}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard icon={<Package className="h-4 w-4" />} title="Finished goods by product" subtitle="Quintals per flour product">
          {charts.finishedGoodsByProduct.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No finished goods on hand.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={charts.finishedGoodsByProduct} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="product" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={120} />
                <Tooltip formatter={(v: unknown) => [`${fmtQ(Number(v))} Q`, 'Stock']} />
                <Bar dataKey="quintals" fill={CHART_COLORS.violet} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard icon={<Waves className="h-4 w-4" />} title="Movement trend — last 14 days" subtitle="Dry-pool receipts vs issues (Q)">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={charts.movementTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: unknown, name: unknown) => [`${fmtQ(Number(v))} Q`, name === 'in' ? 'Receipts' : 'Issues']} />
              <Line type="monotone" dataKey="in" stroke={CHART_COLORS.emerald} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="out" stroke={CHART_COLORS.rose} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </BiShell>
  );
}
