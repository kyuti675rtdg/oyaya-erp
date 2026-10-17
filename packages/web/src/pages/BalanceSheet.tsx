import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { CardHeader } from '../components/CardHeader';
import { Badge } from '../components/Badge';
import { Field, Spinner, TextInput } from '../components/ui';
import { fmtBirr } from '../lib/format';
import { errMsg, todayInput } from './finCommon';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

interface Section {
  total: number;
  items: { code: string; name: string; amount: number }[];
}

interface BalanceReport {
  assets: Section;
  liabilities: Section;
  equity: { total: number; equityBase: Section };
  netIncome: number;
  balanced: boolean;
  asOf: string;
}

function AccountSection({
  title,
  section,
  totalLabel
}: {
  title: string;
  section: Section;
  totalLabel: string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      <div className="overflow-x-auto rounded-xl border border-line bg-white dark:bg-slate-800">
        <table className="w-full min-w-[480px] text-left text-sm">
          <tbody>
            {section.items.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-slate-400 dark:text-slate-500">No balances as of this date.</td>
              </tr>
            ) : (
              section.items.map((r) => (
                <tr key={r.code} className="border-t border-line first:border-t-0">
                  <td className="px-4 py-2.5 pl-6 text-slate-700 dark:text-slate-200">
                    <span className="tnum mr-2 text-slate-400 dark:text-slate-500">{r.code}</span>
                    {r.name}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right text-ink dark:text-white">{fmtBirr(r.amount)}</td>
                </tr>
              ))
            )}
            <tr className="border-t-2 border-ink bg-alabaster font-bold">
              <td className="px-4 py-3 text-ink dark:text-white">{totalLabel}</td>
              <td className="tnum px-4 py-3 text-right text-ink dark:text-white">{fmtBirr(section.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BalanceSheet() {
  const [asOf, setAsOf] = useState(todayInput());

  const bsQ = useQuery({
    queryKey: ['balance-sheet', asOf],
    queryFn: async () =>
      (await api.get<BalanceReport>(`${E.balanceSheet}?asOf=${asOf || todayInput()}`)).data
  });

  const d = bsQ.data;

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<Landmark className="h-4 w-4" />}
          title="Balance Sheet"
          subtitle="Assets = liabilities + equity, as of the selected date"
          action={
            d ? (
              d.balanced ? (
                <Badge tone="pass">Balances</Badge>
              ) : (
                <Badge tone="critical">Out of balance</Badge>
              )
            ) : null
          }
        />

        <div className="mb-4 max-w-xs">
          <Field label="As of">
            <TextInput type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
        </div>

        {bsQ.isLoading ? (
          <Spinner label="Loading balance sheet..." />
        ) : bsQ.isError ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {errMsg(bsQ.error)}
          </p>
        ) : d ? (
          <div className="space-y-6">
            <AccountSection title="Assets" section={d.assets} totalLabel="Total assets" />
            <AccountSection title="Liabilities" section={d.liabilities} totalLabel="Total liabilities" />
            <AccountSection
              title="Equity"
              section={d.equity.equityBase}
              totalLabel="Equity (before net income)"
            />

            <div className="rounded-xl border border-line bg-white dark:bg-slate-800 px-4 py-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-300">Net income (current period)</span>
                <span className="tnum font-bold text-ink dark:text-white">{fmtBirr(d.netIncome)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                <span className="font-bold text-ink dark:text-white">Total equity (incl. net income)</span>
                <span className="tnum text-lg font-extrabold text-ink dark:text-white">{fmtBirr(d.equity.total)}</span>
              </div>
            </div>

            <div className="rounded-xl bg-navy px-4 py-4">
              <div className="flex items-center justify-between text-white">
                <span className="font-extrabold">Assets − (Liabilities + Equity)</span>
                <span className="tnum text-xl font-extrabold">
                  {fmtBirr(d.assets.total - (d.liabilities.total + d.equity.total))}
                </span>
              </div>
              <p className={`mt-1 text-sm font-semibold ${d.balanced ? 'text-emerald-300' : 'text-red-300'}`}>
                {d.balanced
                  ? 'Balance sheet balances.'
                  : 'Balance sheet does not balance — investigate postings.'}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
