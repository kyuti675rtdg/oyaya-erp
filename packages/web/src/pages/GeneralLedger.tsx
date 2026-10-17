import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { ChartOfAccount, JournalEntry, LedgerReport } from '../types';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, Field, Select, Spinner, TextInput } from '../components/ui';
import { fmtBirr, fmtDate, fmtDateTime } from '../lib/format';
import { errMsg, firstOfMonth, todayInput, AccountTypeBadge } from './finCommon';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

export function GeneralLedger() {
  const [accountCode, setAccountCode] = useState('1000');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayInput());
  const [entryId, setEntryId] = useState<string | null>(null);

  const coaQ = useQuery({
    queryKey: ['coa'],
    queryFn: async () => (await api.get<ChartOfAccount[]>(E.coa)).data
  });

  const ledgerQ = useQuery({
    queryKey: ['ledger', accountCode, from, to],
    queryFn: async () =>
      (await api.get<LedgerReport>(E.ledger(accountCode, from || undefined, to || undefined))).data,
    enabled: accountCode.length > 0,
    retry: false
  });

  const entryQ = useQuery({
    queryKey: ['journal', entryId],
    queryFn: async () => (await api.get<JournalEntry>(E.journal(entryId!))).data,
    enabled: entryId !== null
  });

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<BookOpen className="h-4 w-4" />}
          title="General Ledger"
          subtitle="Account drill-down with running balance — click a row to inspect the full journal entry"
        />

        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Field label="Account">
              <Select value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
                {(coaQ.data ?? []).map((a) => (
                  <option key={a.id} value={a.code}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        {ledgerQ.isLoading ? (
          <Spinner label="Loading ledger..." />
        ) : ledgerQ.isError ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {errMsg(ledgerQ.error)}
          </p>
        ) : ledgerQ.data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <AccountTypeBadge type={ledgerQ.data.account.type} />
              <span className="text-sm font-bold text-ink">
                {ledgerQ.data.account.code} — {ledgerQ.data.account.name}
              </span>
              <span className="tnum ml-auto text-sm text-slate-500">
                Opening balance: <strong className="text-ink">{fmtBirr(ledgerQ.data.openingBalance)}</strong>
              </span>
            </div>
            <DataTable
              columns={[
                { key: 'entryDate', label: 'Date', render: (r) => fmtDate(r.entryDate) },
                {
                  key: 'entryNo',
                  label: 'Entry',
                  mono: true,
                  render: (r) => <span className="font-bold">{r.entryNo}</span>
                },
                { key: 'memo', label: 'Memo', render: (r) => <span className="block max-w-xs">{r.memo ?? '—'}</span> },
                { key: 'module', label: 'Source', render: (r) => r.module },
                { key: 'debit', label: 'Debit', mono: true, render: (r) => fmtBirr(r.debit) },
                { key: 'credit', label: 'Credit', mono: true, render: (r) => fmtBirr(r.credit) },
                {
                  key: 'balance',
                  label: 'Balance',
                  mono: true,
                  render: (r) => <strong className="text-ink">{fmtBirr(r.balance)}</strong>
                },
                {
                  key: 'go',
                  label: '',
                  render: (r) => <ChevronRight className="h-4 w-4 text-slate-400" />
                }
              ]}
              rows={ledgerQ.data.lines}
              keyOf={(r) => r.id}
              onRowClick={(r) => setEntryId(r.entryId)}
              emptyTitle="No postings in this period"
              emptySub="Journal entries posting to this account will appear here."
            />
            <div className="flex flex-wrap justify-end gap-6 rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <span className="tnum">
                Total debit: <strong>{fmtBirr(ledgerQ.data.totals.debit)}</strong>
              </span>
              <span className="tnum">
                Total credit: <strong>{fmtBirr(ledgerQ.data.totals.credit)}</strong>
              </span>
              <span className="tnum">
                Closing balance: <strong>{fmtBirr(ledgerQ.data.totals.closingBalance)}</strong>
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Drill-down entry detail */}
      {entryId ? (
        <div className={cardShell}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold text-ink">
              Journal entry {entryQ.data?.entryNo ?? ''}
            </h3>
            <Button variant="secondary" className="!px-4" onClick={() => setEntryId(null)}>
              <ArrowLeft className="h-4 w-4" /> Back to ledger
            </Button>
          </div>
          {entryQ.isLoading ? (
            <Spinner label="Loading entry..." />
          ) : entryQ.data ? (
            <div>
              <p className="mb-3 text-sm text-slate-500">
                {fmtDateTime(entryQ.data.entryDate)} · {entryQ.data.memo ?? '—'} · source{' '}
                <strong>{entryQ.data.module}</strong>
              </p>
              <DataTable
                columns={[
                  {
                    key: 'account',
                    label: 'Account',
                    render: (r) => (
                      <span className="font-semibold text-ink">
                        <span className="tnum mr-2 text-slate-400">{r.account.code}</span>
                        {r.account.name}
                      </span>
                    )
                  },
                  { key: 'debit', label: 'Debit', mono: true, render: (r) => fmtBirr(r.debit) },
                  { key: 'credit', label: 'Credit', mono: true, render: (r) => fmtBirr(r.credit) }
                ]}
                rows={entryQ.data.lines}
                emptyTitle="No lines"
              />
            </div>
          ) : (
            <p className="text-sm text-red-600">{errMsg(entryQ.error)}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
