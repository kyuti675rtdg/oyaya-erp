import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { CardHeader } from '../components/CardHeader';
import { Badge } from '../components/Badge';
import { Button, Field, Spinner, TextInput } from '../components/ui';
import { fmtBirr } from '../lib/format';
import { errMsg, firstOfMonth, todayInput } from './finCommon';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

interface TrialBalanceReport {
  accounts: { code: string; name: string; type: string; debit: number; credit: number; balance: number }[];
  totals: { debit: number; credit: number };
}

export function TrialBalance() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayInput());

  const tbQ = useQuery({
    queryKey: ['trial-balance', from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return (await api.get<TrialBalanceReport>(`${E.trialBalance}?${params}`)).data;
    }
  });

  const balanced =
    tbQ.data != null && Math.abs(tbQ.data.totals.debit - tbQ.data.totals.credit) <= 0.01;

  const setPreset = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<Scale className="h-4 w-4" />}
          title="Trial Balance"
          subtitle="Every account's debit and credit totals — the books balance when both columns agree"
          action={
            tbQ.data ? (
              balanced ? (
                <Badge tone="pass">Balanced</Badge>
              ) : (
                <Badge tone="critical">Out of balance</Badge>
              )
            ) : null
          }
        />

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="!px-3 !py-2 !text-sm"
              onClick={() => setPreset(firstOfMonth(), todayInput())}
            >
              This month
            </Button>
            <Button
              variant="secondary"
              className="!px-3 !py-2 !text-sm"
              onClick={() => setPreset('', todayInput())}
            >
              Year to date
            </Button>
            <Button variant="secondary" className="!px-3 !py-2 !text-sm" onClick={() => setPreset('', '')}>
              All time
            </Button>
          </div>
        </div>

        {tbQ.isLoading ? (
          <Spinner label="Loading trial balance..." />
        ) : tbQ.isError ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {errMsg(tbQ.error)}
          </p>
        ) : tbQ.data ? (
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-line">
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Code</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Account</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Type</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Debit</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Credit</th>
                </tr>
              </thead>
              <tbody>
                {tbQ.data.accounts.map((r) => (
                  <tr key={r.code} className="border-t border-line">
                    <td className="tnum px-4 py-2.5 text-slate-500">{r.code}</td>
                    <td className="px-4 py-2.5 font-medium text-ink">{r.name}</td>
                    <td className="px-4 py-2.5 text-xs font-semibold uppercase text-slate-400">{r.type}</td>
                    <td className="tnum px-4 py-2.5 text-right">{fmtBirr(r.debit)}</td>
                    <td className="tnum px-4 py-2.5 text-right">{fmtBirr(r.credit)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-ink bg-alabaster font-bold">
                  <td colSpan={3} className="px-4 py-3 text-ink">Totals</td>
                  <td className="tnum px-4 py-3 text-right text-ink">{fmtBirr(tbQ.data.totals.debit)}</td>
                  <td className="tnum px-4 py-3 text-right text-ink">{fmtBirr(tbQ.data.totals.credit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
