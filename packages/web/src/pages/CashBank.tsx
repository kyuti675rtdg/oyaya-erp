import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Landmark, Plus, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { CashBankAccount, CashTransfer, ChartOfAccount } from '../types';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import {
  Button,
  Card,
  Field,
  NumberInput,
  Select,
  Spinner,
  TextArea,
  TextInput
} from '../components/ui';
import { fmtBirr, fmtDate } from '../lib/format';
import { errMsg } from './finCommon';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

export function CashBank() {
  const [accountModal, setAccountModal] = useState(false);
  const [transferModal, setTransferModal] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [accForm, setAccForm] = useState({
    name: '',
    kind: 'CASH',
    bankName: '',
    accountNo: '',
    glAccountCode: '1000'
  });
  const [trForm, setTrForm] = useState({
    fromAccountId: '',
    toAccountId: '',
    amountBirr: '',
    memo: ''
  });
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('finance:create');
  const qc = useQueryClient();

  const accountsQ = useQuery({
    queryKey: ['cash-bank-accounts'],
    queryFn: async () => (await api.get<CashBankAccount[]>(E.cashBankAccounts)).data
  });
  const coaQ = useQuery({
    queryKey: ['coa'],
    queryFn: async () => (await api.get<ChartOfAccount[]>(E.coa)).data
  });
  const transfersQ = useQuery({
    queryKey: ['cash-transfers'],
    queryFn: async () => (await api.get<CashTransfer[]>(E.cashTransfers)).data
  });

  const assetAccounts = (coaQ.data ?? []).filter((a) => a.type === 'ASSET' && a.isActive);

  const saveAccountM = useMutation({
    mutationFn: async () =>
      (
        await api.post<CashBankAccount>(E.cashBankAccounts, {
          name: accForm.name.trim(),
          kind: accForm.kind,
          bankName: accForm.bankName.trim() || undefined,
          accountNo: accForm.accountNo.trim() || undefined,
          glAccountCode: accForm.glAccountCode
        })
      ).data,
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['cash-bank-accounts'] });
      setAccountModal(false);
      setAccForm({ name: '', kind: 'CASH', bankName: '', accountNo: '', glAccountCode: '1000' });
      setNotice({ ok: true, text: `Account "${saved.name}" added.` });
    },
    onError: (err) => setNotice({ ok: false, text: errMsg(err) })
  });

  const transferM = useMutation({
    mutationFn: async () =>
      (
        await api.post<CashTransfer>(E.cashTransfers, {
          fromAccountId: trForm.fromAccountId,
          toAccountId: trForm.toAccountId,
          amountBirr: Number(trForm.amountBirr),
          memo: trForm.memo.trim() || undefined
        })
      ).data,
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['cash-transfers'] });
      qc.invalidateQueries({ queryKey: ['cash-bank-accounts'] });
      setTransferModal(false);
      setTrForm({ fromAccountId: '', toAccountId: '', amountBirr: '', memo: '' });
      setNotice({ ok: true, text: `Transfer ${t.transferNo} posted to the ledger.` });
    },
    onError: (err) => setNotice({ ok: false, text: errMsg(err) })
  });

  const submitAccount = (e: FormEvent) => {
    e.preventDefault();
    if (!accForm.name.trim()) {
      setNotice({ ok: false, text: 'Account name is required.' });
      return;
    }
    saveAccountM.mutate();
  };

  const submitTransfer = (e: FormEvent) => {
    e.preventDefault();
    if (!trForm.fromAccountId || !trForm.toAccountId) {
      setNotice({ ok: false, text: 'Choose both source and destination accounts.' });
      return;
    }
    if (trForm.fromAccountId === trForm.toAccountId) {
      setNotice({ ok: false, text: 'Source and destination must be different.' });
      return;
    }
    if (!(Number(trForm.amountBirr) > 0)) {
      setNotice({ ok: false, text: 'Enter a positive amount.' });
      return;
    }
    transferM.mutate();
  };

  const activeAccounts = (accountsQ.data ?? []).filter((a) => a.isActive);
  const totalCash = activeAccounts.reduce((s, a) => s + (a.balance ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<Landmark className="h-4 w-4" />}
          title="Cash & Bank Management"
          subtitle="Cash drawers and bank accounts — balances derive from the general ledger"
          action={
            canManage ? (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setTransferModal(true)} className="!px-4">
                  <ArrowLeftRight className="h-4 w-4" /> Transfer
                </Button>
                <Button onClick={() => setAccountModal(true)} className="!px-4">
                  <Plus className="h-4 w-4" /> Add account
                </Button>
              </div>
            ) : null
          }
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

        {accountsQ.isLoading ? (
          <Spinner label="Loading accounts..." />
        ) : (
          <div className="space-y-4">
            <Card className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 p-4">
              <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">Total cash & bank position</span>
              <span className="tnum text-xl font-extrabold text-ink dark:text-white">{fmtBirr(totalCash)}</span>
            </Card>
            <DataTable<CashBankAccount>
              columns={[
                { key: 'name', label: 'Account', render: (r) => <span className="font-bold text-ink dark:text-white">{r.name}</span> },
                {
                  key: 'kind',
                  label: 'Kind',
                  render: (r) => <Badge tone={r.kind === 'BANK' ? 'advisory' : 'pass'}>{r.kind}</Badge>
                },
                {
                  key: 'bank',
                  label: 'Bank / No.',
                  render: (r) =>
                    r.kind === 'BANK' ? (
                      <span className="tnum">
                        {r.bankName ?? '—'}
                        {r.accountNo ? <span className="text-slate-400 dark:text-slate-500"> · {r.accountNo}</span> : null}
                      </span>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">—</span>
                    )
                },
                {
                  key: 'gl',
                  label: 'GL account',
                  mono: true,
                  render: (r) => `${r.glAccountCode} — ${r.glAccountName ?? ''}`
                },
                {
                  key: 'balance',
                  label: 'Balance',
                  mono: true,
                  render: (r) => <strong className="text-ink dark:text-white">{fmtBirr(r.balance ?? 0)}</strong>
                }
              ]}
              rows={accountsQ.data ?? []}
              emptyTitle="No cash/bank accounts yet"
              emptySub="Add cash drawers and bank accounts, each linked to an Asset GL account."
            />
          </div>
        )}
      </div>

      <div className={cardShell}>
        <CardHeader
          icon={<ArrowLeftRight className="h-4 w-4" />}
          title="Transfers"
          subtitle="Movements between cash and bank accounts — each transfer posts a balanced journal entry"
        />
        {transfersQ.isLoading ? (
          <Spinner label="Loading transfers..." />
        ) : (
          <DataTable<CashTransfer>
            columns={[
              {
                key: 'transferNo',
                label: 'Transfer',
                mono: true,
                render: (r) => <span className="font-bold">{r.transferNo}</span>
              },
              { key: 'transferDate', label: 'Date', render: (r) => fmtDate(r.transferDate) },
              { key: 'from', label: 'From', render: (r) => r.fromAccount?.name ?? '—' },
              { key: 'to', label: 'To', render: (r) => r.toAccount?.name ?? '—' },
              { key: 'amountBirr', label: 'Amount', mono: true, render: (r) => fmtBirr(r.amountBirr) },
              { key: 'memo', label: 'Memo', render: (r) => r.memo ?? '—' }
            ]}
            rows={transfersQ.data ?? []}
            emptyTitle="No transfers yet"
            emptySub="Transfers move funds between accounts and post automatically to the ledger."
          />
        )}
      </div>

      {accountModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink dark:text-white">Add cash / bank account</h3>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  Link the account to an Asset GL account; the balance is computed from postings.
                </p>
              </div>
              <button
                onClick={() => setAccountModal(false)}
                className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitAccount} className="space-y-4">
              <Field label="Account name" required>
                <TextInput
                  value={accForm.name}
                  onChange={(e) => setAccForm({ ...accForm, name: e.target.value })}
                  placeholder="e.g. Main cash drawer, CBE mill account"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Kind" required>
                  <Select value={accForm.kind} onChange={(e) => setAccForm({ ...accForm, kind: e.target.value })}>
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank</option>
                  </Select>
                </Field>
                <Field label="GL account (Asset)" required>
                  <Select
                    value={accForm.glAccountCode}
                    onChange={(e) => setAccForm({ ...accForm, glAccountCode: e.target.value })}
                  >
                    {assetAccounts.map((a) => (
                      <option key={a.id} value={a.code}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {accForm.kind === 'BANK' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Bank name">
                    <TextInput
                      value={accForm.bankName}
                      onChange={(e) => setAccForm({ ...accForm, bankName: e.target.value })}
                      placeholder="e.g. Commercial Bank of Ethiopia"
                    />
                  </Field>
                  <Field label="Account number">
                    <TextInput
                      value={accForm.accountNo}
                      onChange={(e) => setAccForm({ ...accForm, accountNo: e.target.value })}
                    />
                  </Field>
                </div>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setAccountModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saveAccountM.isPending}>
                  Add account
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {transferModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink dark:text-white">New transfer</h3>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  Posts a balanced journal: debit destination, credit source.
                </p>
              </div>
              <button
                onClick={() => setTransferModal(false)}
                className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitTransfer} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="From" required>
                  <Select
                    value={trForm.fromAccountId}
                    onChange={(e) => setTrForm({ ...trForm, fromAccountId: e.target.value })}
                  >
                    <option value="">Select...</option>
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="To" required>
                  <Select
                    value={trForm.toAccountId}
                    onChange={(e) => setTrForm({ ...trForm, toAccountId: e.target.value })}
                  >
                    <option value="">Select...</option>
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Amount (ETB)" required>
                <NumberInput
                  value={trForm.amountBirr}
                  onChange={(e) => setTrForm({ ...trForm, amountBirr: e.target.value })}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </Field>
              <Field label="Memo">
                <TextArea
                  value={trForm.memo}
                  onChange={(e) => setTrForm({ ...trForm, memo: e.target.value })}
                  placeholder="Reason for the transfer"
                />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setTransferModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={transferM.isPending}>
                  Post transfer
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
