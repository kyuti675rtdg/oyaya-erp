import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileBarChart2, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { JournalEntry, LedgerReport } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, Card, Field, TextInput } from '../components/ui';
import { fmtBirr, fmtDate } from '../lib/format';
import { downloadCsv, errMsg, firstOfMonth, todayInput } from './finCommon';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

interface TrialBalanceReport {
  accounts: { code: string; name: string; type: string; debit: number; credit: number; balance: number }[];
  totals: { debit: number; credit: number };
}

function ReportCard({
  title,
  sub,
  onCsv,
  onPrint,
  loading
}: {
  title: string;
  sub: string;
  onCsv: () => void;
  onPrint: () => void;
  loading: boolean;
}) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <h3 className="font-bold text-ink dark:text-white">{title}</h3>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{sub}</p>
      </div>
      <div className="mt-auto flex gap-2">
        <Button variant="secondary" className="!px-4 !py-2 !text-sm" onClick={onCsv} loading={loading}>
          <Download className="h-4 w-4" /> CSV
        </Button>
        <Button className="!px-4 !py-2 !text-sm" onClick={onPrint} loading={loading}>
          <Printer className="h-4 w-4" /> Print / PDF
        </Button>
      </div>
    </Card>
  );
}

export function FinancialReports() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayInput());
  const [asOf, setAsOf] = useState(todayInput());
  const [accountCode, setAccountCode] = useState('1000');
  const [printTarget, setPrintTarget] = useState<string | null>(null);

  const q = (qs: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (qs) params.set('q', qs);
    return params.toString();
  };

  const tbQ = useQuery({
    queryKey: ['reports-tb'],
    queryFn: async () => (await api.get<TrialBalanceReport>(`${E.trialBalance}?${q('')}`)).data,
    enabled: false
  });
  const journalsQ = useQuery({
    queryKey: ['reports-journals'],
    queryFn: async () => (await api.get<JournalEntry[]>(`${E.journals}?${q('')}`)).data,
    enabled: false
  });
  const ledgerQ = useQuery({
    queryKey: ['reports-ledger'],
    queryFn: async () =>
      (await api.get<LedgerReport>(E.ledger(accountCode, from || undefined, to || undefined))).data,
    enabled: false
  });
  const incomeQ = useQuery({
    queryKey: ['reports-income'],
    queryFn: async () => (await api.get(`${E.incomeStatement}?${q('')}`)).data,
    enabled: false
  });
  const balanceQ = useQuery({
    queryKey: ['reports-balance'],
    queryFn: async () => (await api.get(`${E.balanceSheet}?asOf=${asOf || todayInput()}`)).data,
    enabled: false
  });

  const printTrialBalance = () => run(tbQ, () => setPrintTarget('trial-balance'));
  const printJournals = () => run(journalsQ, () => setPrintTarget('journals'));
  const printIncome = () => run(incomeQ, () => setPrintTarget('income'));
  const printBalance = () => run(balanceQ, () => setPrintTarget('balance'));

  const run = <T,>(query: { refetch: () => Promise<{ data?: T }> }, use: (data: T) => void) =>
    query.refetch().then((r) => {
      if (r.data) use(r.data);
    });

  const csvTrialBalance = () =>
    run(tbQ, (d) =>
      downloadCsv(`trial-balance_${from || 'all'}_${to || 'all'}.csv`,
        ['Code', 'Account', 'Type', 'Debit (ETB)', 'Credit (ETB)', 'Balance (ETB)'],
        [
          ...d.accounts.map((a) => [a.code, a.name, a.type, a.debit.toFixed(2), a.credit.toFixed(2), a.balance.toFixed(2)]),
          ['TOTAL', '', '', d.totals.debit.toFixed(2), d.totals.credit.toFixed(2), '']
        ])
    );

  const csvJournals = () =>
    run(journalsQ, (rows) => {
      const out: (string | number)[][] = [];
      for (const e of rows) {
        for (const l of e.lines ?? []) {
          out.push([
            e.entryNo,
            fmtDate(e.entryDate),
            e.memo ?? '',
            e.module,
            (l.account as { code: string }).code,
            (l.account as { name: string }).name,
            Number(l.debit).toFixed(2),
            Number(l.credit).toFixed(2)
          ]);
        }
      }
      downloadCsv(`journal-entries_${from || 'all'}_${to || 'all'}.csv`,
        ['Entry', 'Date', 'Memo', 'Source', 'Account code', 'Account', 'Debit (ETB)', 'Credit (ETB)'], out);
    });

  const csvLedger = () =>
    run(ledgerQ, (d) =>
      downloadCsv(`ledger_${d.account.code}_${from || 'all'}_${to || 'all'}.csv`,
        ['Date', 'Entry', 'Memo', 'Debit (ETB)', 'Credit (ETB)', 'Balance (ETB)'],
        [
          ['', '', 'Opening balance', '', '', d.openingBalance.toFixed(2)],
          ...d.lines.map((l) => [
            fmtDate(l.entryDate), l.entryNo, l.memo ?? '', l.debit.toFixed(2), l.credit.toFixed(2), l.balance.toFixed(2)
          ]),
          ['', '', 'Closing balance', d.totals.debit.toFixed(2), d.totals.credit.toFixed(2), d.totals.closingBalance.toFixed(2)]
        ])
    );

  const csvIncome = () =>
    run(incomeQ, (d: { revenue: { total: number; items: { code: string; name: string; amount: number }[] }; cogs: { total: number; items: { code: string; name: string; amount: number }[] }; grossProfit: number; expenses: { total: number; items: { code: string; name: string; amount: number }[] }; netIncome: number }) =>
      downloadCsv(`income-statement_${from || 'all'}_${to || 'all'}.csv`,
        ['Section', 'Account code', 'Account', 'Amount (ETB)'],
        [
          ...d.revenue.items.map((i) => ['Revenue', i.code, i.name, i.amount.toFixed(2)]),
          ['Revenue', '', 'Total revenue', d.revenue.total.toFixed(2)],
          ...d.cogs.items.map((i) => ['Cost of goods sold', i.code, i.name, i.amount.toFixed(2)]),
          ['Cost of goods sold', '', 'Total COGS', d.cogs.total.toFixed(2)],
          ['Summary', '', 'Gross profit', d.grossProfit.toFixed(2)],
          ...d.expenses.items.map((i) => ['Operating expenses', i.code, i.name, i.amount.toFixed(2)]),
          ['Operating expenses', '', 'Total expenses', d.expenses.total.toFixed(2)],
          ['Summary', '', 'Net income', d.netIncome.toFixed(2)]
        ])
    );

  const csvBalance = () =>
    run(balanceQ, (d: { assets: { total: number; items: { code: string; name: string; amount: number }[] }; liabilities: { total: number; items: { code: string; name: string; amount: number }[] }; equity: { total: number; equityBase: { items: { code: string; name: string; amount: number }[] } }; netIncome: number }) =>
      downloadCsv(`balance-sheet_${asOf}.csv`,
        ['Section', 'Account code', 'Account', 'Amount (ETB)'],
        [
          ...d.assets.items.map((i) => ['Assets', i.code, i.name, i.amount.toFixed(2)]),
          ['Assets', '', 'Total assets', d.assets.total.toFixed(2)],
          ...d.liabilities.items.map((i) => ['Liabilities', i.code, i.name, i.amount.toFixed(2)]),
          ['Liabilities', '', 'Total liabilities', d.liabilities.total.toFixed(2)],
          ...d.equity.equityBase.items.map((i) => ['Equity', i.code, i.name, i.amount.toFixed(2)]),
          ['Equity', '', 'Net income', d.netIncome.toFixed(2)],
          ['Equity', '', 'Total equity', d.equity.total.toFixed(2)]
        ])
    );

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<FileBarChart2 className="h-4 w-4" />}
          title="Financial Reports"
          subtitle="Export center — period-based statements as CSV or print-ready PDF"
        />

        <div className="mb-5 grid gap-3 sm:grid-cols-4">
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="As of (balance sheet)">
            <TextInput type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
          <Field label="Ledger account">
            <TextInput
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              placeholder="e.g. 1000"
            />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <ReportCard
            title="Trial balance"
            sub="Debit/credit columns per account with a balanced check."
            onCsv={csvTrialBalance}
            onPrint={printTrialBalance}
            loading={tbQ.isFetching}
          />
          <ReportCard
            title="General ledger"
            sub="Full account drill-down with running balance."
            onCsv={csvLedger}
            onPrint={() => run(ledgerQ, () => setPrintTarget('ledger'))}
            loading={ledgerQ.isFetching}
          />
          <ReportCard
            title="Journal entries"
            sub="Line-by-line posting register for the period."
            onCsv={csvJournals}
            onPrint={printJournals}
            loading={journalsQ.isFetching}
          />
          <ReportCard
            title="Income statement"
            sub="Revenue − COGS − expenses with per-account breakdowns."
            onCsv={csvIncome}
            onPrint={printIncome}
            loading={incomeQ.isFetching}
          />
          <ReportCard
            title="Balance sheet"
            sub="Assets, liabilities and equity as of the selected date."
            onCsv={csvBalance}
            onPrint={printBalance}
            loading={balanceQ.isFetching}
          />
        </div>

        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          Fiscal year follows the Ethiopian calendar year (approx.). CSV exports open in Excel;
          Print renders a clean statement you can save as PDF.
        </p>
      </div>

      {/* Print previews */}
      {printTarget && tbQ.data && printTarget === 'trial-balance' ? (
        <PrintSheet title="Trial Balance" period={`${from || '—'} to ${to || '—'}`} onClose={() => setPrintTarget(null)}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th>Debit</th>
                <th>Credit</th>
              </tr>
            </thead>
            <tbody>
              {tbQ.data.accounts.map((a) => (
                <tr key={a.code}>
                  <td className="tnum">{a.code}</td>
                  <td>{a.name}</td>
                  <td className="tnum">{fmtBirr(a.debit)}</td>
                  <td className="tnum">{fmtBirr(a.credit)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} className="font-bold">Totals</td>
                <td className="tnum font-bold">{fmtBirr(tbQ.data.totals.debit)}</td>
                <td className="tnum font-bold">{fmtBirr(tbQ.data.totals.credit)}</td>
              </tr>
            </tbody>
          </table>
        </PrintSheet>
      ) : null}

      {printTarget && journalsQ.data && printTarget === 'journals' ? (
        <PrintSheet title="Journal Entries" period={`${from || '—'} to ${to || '—'}`} onClose={() => setPrintTarget(null)}>
          <table>
            <thead>
              <tr>
                <th>Entry</th>
                <th>Date</th>
                <th>Account</th>
                <th>Debit</th>
                <th>Credit</th>
              </tr>
            </thead>
            <tbody>
              {journalsQ.data.flatMap((e) =>
                (e.lines ?? []).map((l) => (
                  <tr key={`${e.id}-${l.id}`}>
                    <td className="tnum">{e.entryNo}</td>
                    <td>{fmtDate(e.entryDate)}</td>
                    <td>
                      <span className="tnum">{(l.account as { code: string }).code}</span> —{' '}
                      {(l.account as { name: string }).name}
                    </td>
                    <td className="tnum">{fmtBirr(l.debit)}</td>
                    <td className="tnum">{fmtBirr(l.credit)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </PrintSheet>
      ) : null}

      {printTarget === 'income' && incomeQ.data ? (
        <PrintSheet title="Income Statement" period={`${from || '—'} to ${to || '—'}`} onClose={() => setPrintTarget(null)}>
          <StatementRows
            rows={[
              ['Total revenue', incomeQ.data.revenue.total],
              ['Cost of goods sold', incomeQ.data.cogs.total],
              ['Gross profit', incomeQ.data.grossProfit],
              ['Operating expenses', incomeQ.data.expenses.total]
            ]}
            total={['Net income', incomeQ.data.netIncome]}
          />
        </PrintSheet>
      ) : null}

      {printTarget === 'balance' && balanceQ.data ? (
        <PrintSheet title="Balance Sheet" period={`As of ${asOf}`} onClose={() => setPrintTarget(null)}>
          <StatementRows
            rows={[
              ['Total assets', balanceQ.data.assets.total],
              ['Total liabilities', balanceQ.data.liabilities.total],
              ['Total equity (incl. net income)', balanceQ.data.equity.total]
            ]}
            total={[
              'Check: assets − (liabilities + equity)',
              balanceQ.data.assets.total - (balanceQ.data.liabilities.total + balanceQ.data.equity.total)
            ]}
          />
          <p className="mt-3 text-sm font-semibold">
            {balanceQ.data.balanced ? 'Balance sheet balances.' : 'Does not balance — investigate.'}
          </p>
        </PrintSheet>
      ) : null}

      {printTarget === 'ledger' && ledgerQ.data ? (
        <PrintSheet
          title={`General Ledger — ${ledgerQ.data.account.code} ${ledgerQ.data.account.name}`}
          period={`${from || '—'} to ${to || '—'}`}
          onClose={() => setPrintTarget(null)}
        >
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry</th>
                <th>Memo</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={3} className="font-semibold">Opening balance</td>
                <td />
                <td />
                <td className="tnum font-bold">{fmtBirr(ledgerQ.data.openingBalance)}</td>
              </tr>
              {ledgerQ.data.lines.map((l) => (
                <tr key={l.id}>
                  <td>{fmtDate(l.entryDate)}</td>
                  <td className="tnum">{l.entryNo}</td>
                  <td>{l.memo ?? '—'}</td>
                  <td className="tnum">{fmtBirr(l.debit)}</td>
                  <td className="tnum">{fmtBirr(l.credit)}</td>
                  <td className="tnum font-bold">{fmtBirr(l.balance)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="font-bold">Closing balance</td>
                <td className="tnum font-bold">{fmtBirr(ledgerQ.data.totals.debit)}</td>
                <td className="tnum font-bold">{fmtBirr(ledgerQ.data.totals.credit)}</td>
                <td className="tnum font-bold">{fmtBirr(ledgerQ.data.totals.closingBalance)}</td>
              </tr>
            </tbody>
          </table>
        </PrintSheet>
      ) : null}
    </div>
  );
}

function PrintSheet({
  title,
  period,
  children,
  onClose
}: {
  title: string;
  period: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className={`${cardShell} no-print flex items-center justify-between`}>
        <h3 className="font-bold text-ink dark:text-white">Print preview — {title}</h3>
        <div className="flex gap-2">
          <Button variant="secondary" className="!px-4" onClick={onClose}>
            Close
          </Button>
          <Button className="!px-4" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print / Save PDF
          </Button>
        </div>
      </div>
      <div className="print-sheet mx-auto max-w-4xl rounded-xl border border-line bg-white dark:bg-slate-800 p-8 shadow-sm">
        <div className="border-b-2 border-ink pb-4 text-center">
          <h1 className="text-2xl font-extrabold text-ink dark:text-white">OYAYA FLOUR FACTORY</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{title}</p>
          <p className="tnum mt-1 text-xs text-slate-500 dark:text-slate-400">{period}</p>
        </div>
        <div className="mt-4">{children}</div>
        <p className="tnum mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
          Generated {new Date().toLocaleString('en-GB')}
        </p>
      </div>
    </div>
  );
}

function StatementRows({ rows, total }: { rows: [string, number][]; total: [string, number] }) {
  return (
    <table>
      <tbody>
        {rows.map(([label, amount]) => (
          <tr key={label} className="border-t border-line first:border-t-0">
            <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">{label}</td>
            <td className="tnum px-4 py-2.5 text-right font-medium text-ink dark:text-white">{fmtBirr(amount)}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-ink bg-alabaster">
          <td className="px-4 py-3 font-bold text-ink dark:text-white">{total[0]}</td>
          <td className="tnum px-4 py-3 text-right font-extrabold text-ink dark:text-white">{fmtBirr(total[1])}</td>
        </tr>
      </tbody>
    </table>
  );
}
