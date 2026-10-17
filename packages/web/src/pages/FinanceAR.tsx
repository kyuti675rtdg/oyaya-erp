import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { ArReport } from '../types';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Card, Spinner } from '../components/ui';
import { fmtBirr, fmtDate } from '../lib/format';
import { errMsg, StatusBadge, BucketBadge } from './finCommon';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`tnum mt-1 text-xl font-extrabold ${tone ?? 'text-ink'}`}>{value}</p>
    </Card>
  );
}

const BUCKET_LABELS: Record<string, string> = {
  current: 'Current (0–30d)',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '90+': 'Over 90 days'
};

export function FinanceAR() {
  const arQ = useQuery({
    queryKey: ['finance-ar'],
    queryFn: async () => (await api.get<ArReport>(E.financeAr)).data
  });

  const s = arQ.data?.summary;

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<Users className="h-4 w-4" />}
          title="Accounts Receivable"
          subtitle="Customer invoices from Sales — aging buckets, balances and collection tracking"
        />

        {arQ.isLoading ? (
          <Spinner label="Loading receivables..." />
        ) : arQ.isError ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {errMsg(arQ.error)}
          </p>
        ) : arQ.data ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Total outstanding" value={fmtBirr(s!.totalOutstanding)} tone="text-critical-text" />
              <Kpi label="Total invoiced" value={fmtBirr(s!.totalInvoiced)} />
              <Kpi label="Collected" value={fmtBirr(s!.totalPaid)} tone="text-pass-text" />
              <Kpi
                label="Collection rate"
                value={s!.totalInvoiced > 0 ? `${((s!.totalPaid / s!.totalInvoiced) * 100).toFixed(1)}%` : '—'}
              />
            </div>

            <div>
              <h3 className="mb-2 text-sm font-bold text-ink">Aging buckets</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(BUCKET_LABELS).map(([key, label]) => {
                  const b = s!.buckets[key] ?? { count: 0, total: 0 };
                  return (
                    <Card key={key} className="p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-500">{label}</p>
                        <BucketBadge bucket={key} />
                      </div>
                      <p className="tnum mt-1 text-lg font-extrabold text-ink">{fmtBirr(b.total)}</p>
                      <p className="text-xs text-slate-400">{b.count} open invoice{b.count === 1 ? '' : 's'}</p>
                    </Card>
                  );
                })}
              </div>
            </div>

            <DataTable
              columns={[
                {
                  key: 'invoiceNo',
                  label: 'Invoice',
                  mono: true,
                  render: (r) => <span className="font-bold text-ink">{r.invoiceNo}</span>
                },
                { key: 'customerName', label: 'Customer', render: (r) => r.customerName },
                { key: 'issuedAt', label: 'Issued', render: (r) => fmtDate(r.issuedAt) },
                { key: 'total', label: 'Invoiced', mono: true, render: (r) => fmtBirr(r.total) },
                { key: 'paid', label: 'Collected', mono: true, render: (r) => fmtBirr(r.paid) },
                {
                  key: 'balance',
                  label: 'Balance',
                  mono: true,
                  render: (r) => <strong className={r.balance > 0.005 ? 'text-critical-text' : 'text-pass-text'}>{fmtBirr(r.balance)}</strong>
                },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                {
                  key: 'aging',
                  label: 'Aging',
                  render: (r) =>
                    r.balance > 0.005 ? (
                      <span className="flex items-center gap-2">
                        <BucketBadge bucket={r.bucket} />
                        <span className="tnum text-xs text-slate-500">{r.daysOpen}d</span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Collected</span>
                    )
                }
              ]}
              rows={arQ.data.rows}
              emptyTitle="No customer invoices"
              emptySub="Sales invoices appear here with aging and collection status."
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
