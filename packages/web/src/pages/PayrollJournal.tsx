import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { FinancePayrollRun, JournalEntry } from '../types';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, Card, Spinner } from '../components/ui';
import { fmtBirr, fmtInt } from '../lib/format';
import { errMsg, StatusBadge } from './finCommon';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export function PayrollJournal() {
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [postedEntry, setPostedEntry] = useState<JournalEntry | null>(null);
  const hasClaim = useAuth((s) => s.hasClaim);
  const canApprove = hasClaim('finance:approve');
  const qc = useQueryClient();

  const runsQ = useQuery({
    queryKey: ['finance-payroll-runs'],
    queryFn: async () => (await api.get<FinancePayrollRun[]>(E.financePayrollRuns)).data
  });

  const postM = useMutation({
    mutationFn: async (runId: string) => (await api.post<JournalEntry>(E.financePayrollPost(runId))).data,
    onSuccess: (entry) => {
      qc.invalidateQueries({ queryKey: ['finance-payroll-runs'] });
      setPostedEntry(entry);
      setNotice({ ok: true, text: `Posted journal ${entry.entryNo} to the general ledger.` });
    },
    onError: (err) => setNotice({ ok: false, text: errMsg(err) })
  });

  const totalPosted = (runsQ.data ?? [])
    .filter((r) => r.journalPosted)
    .reduce((s, r) => s + r.totalBirr, 0);
  const pending = (runsQ.data ?? []).filter((r) => r.status === 'POSTED' && !r.journalPosted);

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<Wallet className="h-4 w-4" />}
          title="Payroll Journal Integration"
          subtitle="Import approved payroll runs — each run posts a balanced journal: debit Payroll Expense (6000), credit Accounts Payable (2000)"
        />

        {notice ? (
          <p
            className={`mb-4 rounded-lg px-4 py-2.5 text-sm font-semibold ${
              notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {notice.text}
          </p>
        ) : null}

        {runsQ.isLoading ? (
          <Spinner label="Loading payroll runs..." />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Posted to GL</p>
                <p className="tnum mt-1 text-xl font-extrabold text-pass-text">{fmtBirr(totalPosted)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Approved, awaiting posting</p>
                <p className="tnum mt-1 text-xl font-extrabold text-advisory-text">{fmtInt(pending.length)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Total runs</p>
                <p className="tnum mt-1 text-xl font-extrabold text-ink">{fmtInt(runsQ.data?.length ?? 0)}</p>
              </Card>
            </div>

            <DataTable<FinancePayrollRun>
              columns={[
                {
                  key: 'period',
                  label: 'Period',
                  render: (r) => (
                    <span className="font-bold text-ink">
                      {MONTHS[r.periodMonth - 1] ?? r.periodMonth} {r.periodYear}
                    </span>
                  )
                },
                { key: 'status', label: 'Run status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'lineCount', label: 'Employees', mono: true, render: (r) => fmtInt(r.lineCount) },
                { key: 'totalBirr', label: 'Gross payroll', mono: true, render: (r) => fmtBirr(r.totalBirr) },
                {
                  key: 'journal',
                  label: 'GL journal',
                  render: (r) =>
                    r.journalPosted ? (
                      <span className="tnum font-bold text-pass-text">{r.journalEntryNo ?? 'Posted'}</span>
                    ) : (
                      <span className="text-sm text-slate-400 dark:text-slate-500">Not posted</span>
                    )
                },
                {
                  key: 'actions',
                  label: '',
                  render: (r) =>
                    r.status === 'POSTED' && !r.journalPosted && canApprove ? (
                      <Button
                        className="!px-4 !py-2 !text-sm"
                        loading={postM.isPending}
                        onClick={() => postM.mutate(r.id)}
                      >
                        Post to GL
                      </Button>
                    ) : null
                }
              ]}
              rows={runsQ.data ?? []}
              emptyTitle="No payroll runs"
              emptySub="Payroll runs created in the Payroll module appear here for GL posting."
            />

            <p className="text-xs text-slate-400 dark:text-slate-500">
              Only approved (POSTED) runs can be posted. Each run posts once — duplicates are
              rejected. Approve runs in <Link to="/payroll" className="font-semibold text-violet-700 hover:underline">Payroll</Link> first.
            </p>
          </div>
        )}
      </div>

      {postedEntry ? (
        <div className={cardShell}>
          <h3 className="mb-3 text-base font-bold text-ink">Posted entry preview</h3>
          <DataTable
            columns={[
              {
                key: 'account',
                label: 'Account',
                render: (r) => (
                  <span className="font-semibold text-ink">
                    <span className="tnum mr-2 text-slate-400 dark:text-slate-500">{r.account.code}</span>
                    {r.account.name}
                  </span>
                )
              },
              { key: 'debit', label: 'Debit', mono: true, render: (r) => fmtBirr(r.debit) },
              { key: 'credit', label: 'Credit', mono: true, render: (r) => fmtBirr(r.credit) }
            ]}
            rows={postedEntry.lines ?? []}
            emptyTitle="No lines"
          />
        </div>
      ) : null}
    </div>
  );
}
