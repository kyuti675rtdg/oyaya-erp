import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { JournalEntry } from '../types';
import { DataTable } from '../components/DataTable';
import { SectionTitle, Spinner } from '../components/ui';
import { fmtBirr, fmtDate } from '../lib/format';

type Tab = 'journals' | 'trial' | 'income' | 'balance';

interface TrialBalanceReport {
  accounts: { code: string; name: string; type: string; debit: number; credit: number; balance: number }[];
  totals: { debit: number; credit: number };
}

interface IncomeStatementReport {
  revenue: { total: number; items: unknown[] };
  cogs: { total: number; items: unknown[] };
  grossProfit: number;
  expenses: { total: number; items: unknown[] };
  netIncome: number;
}

interface BalanceSheetReport {
  assets: { total: number; items: unknown[] };
  liabilities: { total: number; items: unknown[] };
  equity: { total: number };
  netIncome: number;
  balanced: boolean;
}

function sumLines(entry: JournalEntry, side: 'debit' | 'credit'): number {
  return (entry.lines ?? []).reduce((s, l) => s + Number(l[side]), 0);
}

function ReportTable({ rows, total }: { rows: Array<[string, number]>; total?: [string, number] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white dark:bg-slate-800">
      <table className="w-full min-w-[560px] text-left text-sm">
        <tbody>
          {rows.map(([label, amount], i) => (
            <tr key={i} className="border-t border-line first:border-t-0">
              <td className="px-4 py-2.5 pl-8 text-slate-700 dark:text-slate-200">{label}</td>
              <td className="tnum px-4 py-2.5 text-right font-medium text-ink dark:text-white">{fmtBirr(amount)}</td>
            </tr>
          ))}
          {total ? (
            <tr className="border-t-2 border-ink bg-alabaster">
              <td className="px-4 py-3 font-bold text-ink dark:text-white">{total[0]}</td>
              <td className="tnum px-4 py-3 text-right font-extrabold text-ink dark:text-white">{fmtBirr(total[1])}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'journals', label: 'Journal entries' },
  { key: 'trial', label: 'Trial balance' },
  { key: 'income', label: 'Income statement' },
  { key: 'balance', label: 'Balance sheet' }
];

export function Finance() {
  const [tab, setTab] = useState<Tab>('journals');

  const journalsQ = useQuery({
    queryKey: ['journals'],
    queryFn: async () => (await api.get<JournalEntry[]>(E.journals)).data,
    enabled: tab === 'journals'
  });
  const trialQ = useQuery({
    queryKey: ['trial-balance'],
    queryFn: async () => (await api.get<TrialBalanceReport>(E.trialBalance)).data,
    enabled: tab === 'trial'
  });
  const incomeQ = useQuery({
    queryKey: ['income-statement'],
    queryFn: async () => (await api.get<IncomeStatementReport>(E.incomeStatement)).data,
    enabled: tab === 'income'
  });
  const balanceQ = useQuery({
    queryKey: ['balance-sheet'],
    queryFn: async () => (await api.get<BalanceSheetReport>(E.balanceSheet)).data,
    enabled: tab === 'balance'
  });

  return (
    <div>
      <SectionTitle
        title="Finance & Accounting"
        sub="Peachtree-aligned general ledger, payables, receivables and financial statements"
      />

      <div className="no-print mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`touch rounded-lg px-4 text-sm font-semibold ${
              tab === t.key ? 'bg-navy text-white' : 'border border-line bg-white text-slate-600 hover:bg-alabaster'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'journals' ? (
        journalsQ.isLoading ? (
          <Spinner label="Loading journal entries..." />
        ) : (
          <DataTable<JournalEntry>
            columns={[
              { key: 'entryNo', label: 'Entry', render: (r) => <span className="tnum font-bold">{r.entryNo}</span> },
              { key: 'entryDate', label: 'Date', render: (r) => fmtDate(r.entryDate) },
              { key: 'memo', label: 'Memo', render: (r) => <span className="block max-w-md">{r.memo ?? '-'}</span> },
              { key: 'module', label: 'Source', render: (r) => r.module },
              { key: 'debit', label: 'Debit', mono: true, render: (r) => fmtBirr(sumLines(r, 'debit')) },
              { key: 'credit', label: 'Credit', mono: true, render: (r) => fmtBirr(sumLines(r, 'credit')) },
              {
                key: 'voucher',
                label: '',
                render: (r) =>
                  r.referenceType === 'APPayment' && r.referenceId ? (
                    <Link to={`/finance/vouchers/${r.referenceId}`} className="font-semibold text-navy hover:underline">
                      Voucher
                    </Link>
                  ) : null
              }
            ]}
            rows={journalsQ.data ?? []}
            emptyTitle="No journal entries yet"
            emptySub="Confirmed intakes, settlements, sales and payroll post here automatically."
          />
        )
      ) : null}

      {tab === 'trial' ? (
        trialQ.isLoading ? (
          <Spinner label="Loading trial balance..." />
        ) : trialQ.data ? (
          <div className="overflow-x-auto rounded-xl border border-line bg-white dark:bg-slate-800">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-line">
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Code</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Account</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Debit</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Credit</th>
                </tr>
              </thead>
              <tbody>
                {trialQ.data.accounts.map((r) => (
                  <tr key={r.code} className="border-t border-line">
                    <td className="tnum px-4 py-2.5 text-slate-500 dark:text-slate-400">{r.code}</td>
                    <td className="px-4 py-2.5 font-medium text-ink dark:text-white">{r.name}</td>
                    <td className="tnum px-4 py-2.5 text-right">{fmtBirr(r.debit)}</td>
                    <td className="tnum px-4 py-2.5 text-right">{fmtBirr(r.credit)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-ink bg-alabaster font-bold">
                  <td colSpan={2} className="px-4 py-3 text-ink dark:text-white">Totals</td>
                  <td className="tnum px-4 py-3 text-right text-ink dark:text-white">{fmtBirr(trialQ.data.totals.debit)}</td>
                  <td className="tnum px-4 py-3 text-right text-ink dark:text-white">{fmtBirr(trialQ.data.totals.credit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null
      ) : null}

      {tab === 'income' ? (
        incomeQ.isLoading ? (
          <Spinner label="Loading income statement..." />
        ) : incomeQ.data ? (
          <ReportTable
            rows={[
              ['Revenue', incomeQ.data.revenue.total],
              ['Cost of goods sold', incomeQ.data.cogs.total],
              ['Gross profit', incomeQ.data.grossProfit],
              ['Operating expenses', incomeQ.data.expenses.total]
            ]}
            total={['Net income', incomeQ.data.netIncome]}
          />
        ) : null
      ) : null}

      {tab === 'balance' ? (
        balanceQ.isLoading ? (
          <Spinner label="Loading balance sheet..." />
        ) : balanceQ.data ? (
          <div>
            <ReportTable
              rows={[
                ['Assets', balanceQ.data.assets.total],
                ['Liabilities', balanceQ.data.liabilities.total],
                ['Equity (incl. net income)', balanceQ.data.equity.total]
              ]}
              total={['Assets − (Liabilities + Equity)', balanceQ.data.assets.total - balanceQ.data.liabilities.total - balanceQ.data.equity.total]}
            />
            <p className={`mt-3 text-sm font-semibold ${balanceQ.data.balanced ? 'text-pass-text' : 'text-critical-text'}`}>
              {balanceQ.data.balanced ? 'Balance sheet balances.' : 'Balance sheet does not balance — investigate.'}
            </p>
          </div>
        ) : null
      ) : null}
    </div>
  );
}
