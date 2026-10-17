import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { CardHeader } from '../components/CardHeader';
import { Button, Field, Spinner, TextInput } from '../components/ui';
import { fmtBirr } from '../lib/format';
import { errMsg, firstOfMonth, todayInput } from './finCommon';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

interface Breakdown {
  total: number;
  items: { code: string; name: string; amount: number }[];
}

interface IncomeReport {
  revenue: Breakdown;
  cogs: Breakdown;
  grossProfit: number;
  expenses: Breakdown;
  netIncome: number;
  previous: { revenue: number; expenses: number; netIncome: number } | null;
}

function Section({
  label,
  rows,
  totalLabel,
  total,
  bold = false
}: {
  label: string;
  rows: { code: string; name: string; amount: number }[];
  totalLabel: string;
  total: number;
  bold?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{label}</h3>
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[480px] text-left text-sm">
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-slate-400">No postings in this period.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.code} className="border-t border-line first:border-t-0">
                  <td className="px-4 py-2.5 pl-6 text-slate-700">
                    <span className="tnum mr-2 text-slate-400">{r.code}</span>
                    {r.name}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right text-ink">{fmtBirr(r.amount)}</td>
                </tr>
              ))
            )}
            <tr className={`border-t-2 border-ink bg-alabaster ${bold ? 'font-extrabold' : 'font-bold'}`}>
              <td className="px-4 py-3 text-ink">{totalLabel}</td>
              <td className="tnum px-4 py-3 text-right text-ink">{fmtBirr(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function IncomeStatement() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayInput());
  const [compare, setCompare] = useState(false);

  const prevRange = useMemo(() => {
    if (!compare || !from || !to) return null;
    const f = new Date(from);
    const t = new Date(to);
    const days = Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1;
    const pf = new Date(f);
    pf.setDate(pf.getDate() - days);
    const pt = new Date(f);
    pt.setDate(pt.getDate() - 1);
    return { from: pf.toISOString().slice(0, 10), to: pt.toISOString().slice(0, 10) };
  }, [compare, from, to]);

  const incQ = useQuery({
    queryKey: ['income-statement', from, to, prevRange?.from, prevRange?.to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (prevRange) {
        params.set('compareFrom', prevRange.from);
        params.set('compareTo', prevRange.to);
      }
      return (await api.get<IncomeReport>(`${E.incomeStatement}?${params}`)).data;
    }
  });

  const d = incQ.data;
  const variance = (cur: number, prev: number) =>
    prev !== 0 ? `${(((cur - prev) / Math.abs(prev)) * 100).toFixed(1)}%` : '—';

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<TrendingUp className="h-4 w-4" />}
          title="Income Statement"
          subtitle="Revenue − cost of goods sold − operating expenses = net income"
        />

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Button
            variant="secondary"
            className="!px-3 !py-2 !text-sm"
            onClick={() => setCompare((c) => !c)}
          >
            {compare ? 'Hide comparison' : 'Compare with previous period'}
          </Button>
        </div>

        {incQ.isLoading ? (
          <Spinner label="Loading income statement..." />
        ) : incQ.isError ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {errMsg(incQ.error)}
          </p>
        ) : d ? (
          <div className="space-y-6">
            {d.previous ? (
              <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Previous revenue</p>
                  <p className="tnum mt-1 text-lg font-extrabold text-ink">{fmtBirr(d.previous.revenue)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Previous expenses</p>
                  <p className="tnum mt-1 text-lg font-extrabold text-ink">{fmtBirr(d.previous.expenses)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Previous net income</p>
                  <p className="tnum mt-1 text-lg font-extrabold text-ink">{fmtBirr(d.previous.netIncome)}</p>
                  <p className="tnum mt-0.5 text-xs text-slate-500">
                    Change: {variance(d.netIncome, d.previous.netIncome)}
                  </p>
                </div>
              </div>
            ) : null}

            <Section label="Revenue" rows={d.revenue.items} totalLabel="Total revenue" total={d.revenue.total} />
            <Section label="Cost of goods sold" rows={d.cogs.items} totalLabel="Total COGS" total={d.cogs.total} />

            <div className="rounded-xl border border-line bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-ink">Gross profit</span>
                <span className="tnum text-lg font-extrabold text-ink">{fmtBirr(d.grossProfit)}</span>
              </div>
            </div>

            <Section label="Operating expenses" rows={d.expenses.items} totalLabel="Total expenses" total={d.expenses.total} />

            <div className="rounded-xl bg-navy px-4 py-4">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-white">Net income</span>
                <span className="tnum text-xl font-extrabold text-white">{fmtBirr(d.netIncome)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
