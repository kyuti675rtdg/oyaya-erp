import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Landmark } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { ApSummary } from '../types';
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

export function FinanceAP() {
  const apQ = useQuery({
    queryKey: ['finance-ap-summary'],
    queryFn: async () => (await api.get<ApSummary>(E.financeApSummary)).data
  });

  const s = apQ.data?.summary;

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<Landmark className="h-4 w-4" />}
          title="Accounts Payable"
          subtitle="Finance view of supplier invoices booked by Procurement — aging, balances and payment progress"
          action={
            <Link
              to="/accounts-payable"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-slate-50"
            >
              Manage in Procurement <ArrowUpRight className="h-4 w-4" />
            </Link>
          }
        />

        {apQ.isLoading ? (
          <Spinner label="Loading payables..." />
        ) : apQ.isError ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {errMsg(apQ.error)}
          </p>
        ) : apQ.data ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Total outstanding" value={fmtBirr(s!.totalOutstanding)} tone="text-critical-text" />
              <Kpi label="Open invoices" value={String(s!.openCount)} />
              <Kpi label="Total invoiced" value={fmtBirr(s!.totalInvoiced)} />
              <Kpi label="Total paid" value={fmtBirr(s!.totalPaid)} tone="text-pass-text" />
            </div>

            <DataTable
              columns={[
                {
                  key: 'invoiceNo',
                  label: 'Invoice',
                  mono: true,
                  render: (r) => <span className="font-bold text-ink">{r.invoiceNo}</span>
                },
                { key: 'issuedAt', label: 'Issued', render: (r) => fmtDate(r.issuedAt) },
                {
                  key: 'dueDate',
                  label: 'Due',
                  render: (r) => (r.dueDate ? fmtDate(r.dueDate) : <span className="text-slate-400">—</span>)
                },
                { key: 'total', label: 'Invoiced', mono: true, render: (r) => fmtBirr(r.total) },
                { key: 'paid', label: 'Paid', mono: true, render: (r) => fmtBirr(r.paid) },
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
                      <span className="text-xs text-slate-400">Settled</span>
                    )
                }
              ]}
              rows={apQ.data.rows}
              emptyTitle="No supplier invoices"
              emptySub="Procurement intakes create AP invoices that appear here for finance follow-up."
            />

            <p className="text-xs text-slate-400">
              Payment scheduling and settlements happen in Procurement → Accounts Payable; this
              page is the finance-side aging and balance view of the same invoices.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
