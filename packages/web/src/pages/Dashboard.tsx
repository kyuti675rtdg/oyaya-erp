import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { FlatKpis } from '../types';
import { StatCard } from '../components/StatCard';
import { ErrorBox, SectionTitle, Spinner } from '../components/ui';
import { fmtBirr, fmtInt, fmtQ } from '../lib/format';

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format a KPI value: money keys in Birr, quantity keys in quintals, else plain. */
function formatKpi(key: string, value: number | string): string {
  if (typeof value === 'string') return value;
  const k = key.toLowerCase();
  if (/(birr|revenue|cash|payable|receivable|amount|balance|pay|voucher|expense)/.test(k)) {
    return fmtBirr(value);
  }
  if (/(quintal|\bq\b|output|stock|inventory|bags)/.test(k)) {
    return `${fmtQ(value)} q`;
  }
  if (/(pct|rate|percent|yield|extraction)/.test(k)) {
    return `${value.toFixed(1)}%`;
  }
  return fmtInt(value);
}

interface Section {
  key: string;
  title: string;
  accent: 'navy' | 'harvest' | 'pass' | 'critical' | 'advisory';
  entries: Array<[string, number | string]>;
}

/** Project the flat /dashboard/kpis response into the seven KPI cockpits. */
function buildSections(k: FlatKpis): Section[] {
  const tankEntries: Array<[string, number | string]> = k.tanks.flatMap((t) => [
    [`Tank ${t.code.replace('TANK_', '')} stock`, t.levelQ] as [string, number],
    [`Tank ${t.code.replace('TANK_', '')} capacity`, `${fmtQ(t.capacityQ)} q`] as [string, string]
  ]);
  const gap: number | string = k.unreconciledGap === 0 ? fmtBirr(0) : fmtBirr(k.unreconciledGap);
  const compliance: number | string =
    k.qcCompliancePct === null ? '—' : `${k.qcCompliancePct.toFixed(1)}%`;
  const extraction: number | string =
    k.extractionToday === null ? '—' : `${k.extractionToday.toFixed(1)}%`;
  return [
    {
      key: 'executive',
      title: 'Executive',
      accent: 'navy',
      entries: [
        ['Month revenue', k.monthRevenue],
        ['Cash received (month)', k.cashReceivedMonth],
        ['Unreconciled gap', gap],
        ['Active employees', k.activeEmployees]
      ]
    },
    {
      key: 'production',
      title: 'Production & Yield',
      accent: 'harvest',
      entries: [
        ['Extraction today', extraction],
        ['Dry pool stock', k.dryPool.balanceQ]
      ]
    },
    {
      key: 'quality',
      title: 'Quality & CAPA',
      accent: 'pass',
      entries: [
        ['Open CAPAs', k.openCapas],
        ['Intakes pending lab', k.pendingLabIntakes],
        ['QC compliance (7d)', compliance]
      ]
    },
    {
      key: 'inventory',
      title: 'Inventory',
      accent: 'advisory',
      entries: [
        ['Dry pool stock', k.dryPool.balanceQ],
        ['Dry pool capacity', `${fmtQ(k.dryPool.capacityQ)} q`],
        ...tankEntries
      ]
    },
    {
      key: 'sales',
      title: 'Sales',
      accent: 'navy',
      entries: [
        ['Month revenue', k.monthRevenue],
        ['Cash received (month)', k.cashReceivedMonth],
        ['Unreconciled gap', gap]
      ]
    },
    {
      key: 'financial',
      title: 'Financial',
      accent: 'harvest',
      entries: [
        ['Month revenue', k.monthRevenue],
        ['Cash received (month)', k.cashReceivedMonth],
        ['Unreconciled gap', gap]
      ]
    },
    {
      key: 'hr',
      title: 'HR & Payroll',
      accent: 'pass',
      entries: [['Active employees', k.activeEmployees]]
    }
  ];
}

export function Dashboard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: async () => (await api.get<FlatKpis>(E.dashboardKpis)).data,
    refetchInterval: 60000
  });

  if (isLoading) return <Spinner label="Loading KPIs..." />;
  if (isError)
    return (
      <ErrorBox
        message={error instanceof Error ? error.message : 'Unknown error'}
        onRetry={() => refetch()}
      />
    );

  const sections = data ? buildSections(data) : [];

  return (
    <div>
      <SectionTitle title="Dashboard" sub="Live KPIs across all mill operations" />

      <div className="space-y-8">
        {sections.map((s) => (
          <section key={s.key}>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-500">
              {s.title}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {s.entries.map(([k, v]) => (
                <StatCard
                  key={k}
                  label={humanize(k)}
                  value={formatKpi(k, v)}
                  accent={s.accent}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
