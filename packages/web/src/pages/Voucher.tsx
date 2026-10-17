import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  Download,
  FileText,
  Plus,
  Printer,
  Stamp,
  X
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { APInvoice, APPayment, CashBankAccount, ChartOfAccount, FinanceVoucher } from '../types';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import {
  Button,
  Card,
  EmptyState,
  Field,
  NumberInput,
  Select,
  Spinner,
  TextArea,
  TextInput
} from '../components/ui';
import { fmtBirr, fmtDateTime } from '../lib/format';
import { errMsg, StatusBadge } from './finCommon';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

function BackLink() {
  return (
    <Link
      to="/finance/vouchers"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:underline"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to vouchers
    </Link>
  );
}

// ─── Voucher list + creation ─────────────────────────────────────

type KindTab = 'PAYMENT' | 'RECEIPT';

export function Vouchers() {
  const [kind, setKind] = useState<KindTab>('PAYMENT');
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({
    counterparty: '',
    amountBirr: '',
    method: 'CASH',
    reference: '',
    cashBankAccountId: '',
    accountCode: '',
    memo: ''
  });
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('finance:create');
  const canApprove = hasClaim('finance:approve');
  const qc = useQueryClient();

  const vouchersQ = useQuery({
    queryKey: ['finance-vouchers', kind],
    queryFn: async () => (await api.get<FinanceVoucher[]>(`${E.financeVouchers}?kind=${kind}`)).data
  });
  const coaQ = useQuery({
    queryKey: ['coa'],
    queryFn: async () => (await api.get<ChartOfAccount[]>(E.coa)).data
  });
  const cbQ = useQuery({
    queryKey: ['cash-bank-accounts'],
    queryFn: async () => (await api.get<CashBankAccount[]>(E.cashBankAccounts)).data
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['finance-vouchers'] });

  const createM = useMutation({
    mutationFn: async () =>
      (
        await api.post<FinanceVoucher>(E.financeVouchers, {
          kind,
          counterparty: form.counterparty.trim(),
          amountBirr: Number(form.amountBirr),
          method: form.method,
          reference: form.reference.trim() || undefined,
          cashBankAccountId: form.cashBankAccountId || undefined,
          accountCode: form.accountCode,
          memo: form.memo.trim() || undefined
        })
      ).data,
    onSuccess: (v) => {
      invalidate();
      setModalOpen(false);
      setForm({ counterparty: '', amountBirr: '', method: 'CASH', reference: '', cashBankAccountId: '', accountCode: '', memo: '' });
      setNotice({ ok: true, text: `Voucher ${v.voucherNo} created as DRAFT.` });
    },
    onError: (err) => setNotice({ ok: false, text: errMsg(err) })
  });

  const transitionM = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'approve' | 'post' | 'cancel' }) =>
      (
        await api.post<FinanceVoucher>(
          action === 'approve' ? E.financeVoucherApprove(id) : action === 'post' ? E.financeVoucherPost(id) : E.financeVoucherCancel(id)
        )
      ).data,
    onSuccess: (v) => {
      invalidate();
      setNotice({ ok: true, text: `Voucher ${v.voucherNo} → ${v.status}.` });
    },
    onError: (err) => setNotice({ ok: false, text: errMsg(err) })
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.counterparty.trim()) {
      setNotice({ ok: false, text: kind === 'PAYMENT' ? 'Payee is required.' : 'Payer is required.' });
      return;
    }
    if (!(Number(form.amountBirr) > 0)) {
      setNotice({ ok: false, text: 'Enter a positive amount.' });
      return;
    }
    if (!form.accountCode) {
      setNotice({ ok: false, text: 'Choose the GL account on the other side.' });
      return;
    }
    createM.mutate();
  };

  const glHint =
    kind === 'PAYMENT'
      ? 'Account to debit — e.g. Accounts Payable, Rent Expense'
      : 'Account to credit — e.g. Sales Revenue, Accounts Receivable';

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<FileText className="h-4 w-4" />}
          title="Payment & Receipt Vouchers"
          subtitle="Draft → approve → post. Posting writes a balanced journal entry to the general ledger."
          action={
            canManage ? (
              <Button onClick={() => setModalOpen(true)} className="!px-4">
                <Plus className="h-4 w-4" /> New {kind === 'PAYMENT' ? 'payment' : 'receipt'} voucher
              </Button>
            ) : null
          }
        />

        <div className="no-print mb-5 flex flex-wrap gap-2">
          {(
            [
              { key: 'PAYMENT', label: 'Payment vouchers' },
              { key: 'RECEIPT', label: 'Receipt vouchers' }
            ] as { key: KindTab; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setKind(t.key)}
              className={`touch rounded-lg px-4 text-sm font-semibold ${
                kind === t.key
                  ? 'bg-navy text-white'
                  : 'border border-line bg-white text-slate-600 hover:bg-alabaster'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {notice ? (
          <p
            className={`mb-4 rounded-lg px-4 py-2.5 text-sm font-semibold ${
              notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {notice.text}
          </p>
        ) : null}

        {vouchersQ.isLoading ? (
          <Spinner label="Loading vouchers..." />
        ) : (
          <DataTable<FinanceVoucher>
            columns={[
              {
                key: 'voucherNo',
                label: 'Voucher',
                mono: true,
                render: (r) => (
                  <Link
                    to={`/finance/vouchers/${r.id}`}
                    className="font-bold text-violet-700 hover:underline"
                  >
                    {r.voucherNo}
                  </Link>
                )
              },
              { key: 'counterparty', label: kind === 'PAYMENT' ? 'Payee' : 'Payer', render: (r) => r.counterparty },
              { key: 'amountBirr', label: 'Amount', mono: true, render: (r) => fmtBirr(r.amountBirr) },
              { key: 'method', label: 'Method', render: (r) => r.method },
              {
                key: 'cash',
                label: 'Cash / bank',
                render: (r) => r.cashBankAccount?.name ?? <span className="text-slate-400 dark:text-slate-500">Cash & Bank</span>
              },
              {
                key: 'posting',
                label: 'Posting',
                mono: true,
                render: (r) => (
                  <span className="text-xs">
                    Dr {r.debitAccountCode} · Cr {r.creditAccountCode}
                  </span>
                )
              },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              {
                key: 'actions',
                label: '',
                render: (r) => (
                  <div className="flex flex-wrap items-center gap-2">
                    {r.status === 'DRAFT' && canApprove ? (
                      <button
                        onClick={() => transitionM.mutate({ id: r.id, action: 'approve' })}
                        className="text-sm font-semibold text-emerald-700 hover:underline"
                      >
                        Approve
                      </button>
                    ) : null}
                    {r.status === 'APPROVED' && canApprove ? (
                      <button
                        onClick={() => transitionM.mutate({ id: r.id, action: 'post' })}
                        className="text-sm font-semibold text-navy hover:underline"
                      >
                        Post to GL
                      </button>
                    ) : null}
                    {(r.status === 'DRAFT' || r.status === 'APPROVED') && canApprove ? (
                      <button
                        onClick={() => transitionM.mutate({ id: r.id, action: 'cancel' })}
                        className="text-sm font-semibold text-red-600 hover:underline"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                )
              }
            ]}
            rows={vouchersQ.data ?? []}
            emptyTitle={kind === 'PAYMENT' ? 'No payment vouchers' : 'No receipt vouchers'}
            emptySub={
              kind === 'PAYMENT'
                ? 'Record payments to suppliers and expense payees here.'
                : 'Record cash receipts from customers and other income here.'
            }
          />
        )}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink">
                  New {kind === 'PAYMENT' ? 'payment' : 'receipt'} voucher
                </h3>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  {kind === 'PAYMENT'
                    ? 'Debit an expense/payable account, credit cash or bank.'
                    : 'Debit cash or bank, credit a revenue/receivable account.'}
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <Field label={kind === 'PAYMENT' ? 'Payee' : 'Payer'} required>
                <TextInput
                  value={form.counterparty}
                  onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
                  placeholder={kind === 'PAYMENT' ? 'Supplier or payee name' : 'Customer or payer name'}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount (ETB)" required>
                  <NumberInput
                    value={form.amountBirr}
                    onChange={(e) => setForm({ ...form, amountBirr: e.target.value })}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </Field>
                <Field label="Method" required>
                  <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                    <option value="CHEQUE">Cheque</option>
                  </Select>
                </Field>
              </div>
              <Field label="Cash / bank account" hint="The cash side of the posting. Defaults to Cash and Bank.">
                <Select
                  value={form.cashBankAccountId}
                  onChange={(e) => setForm({ ...form, cashBankAccountId: e.target.value })}
                >
                  <option value="">Default — Cash and Bank (1000)</option>
                  {(cbQ.data ?? [])
                    .filter((a) => a.isActive)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.glAccountCode})
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="GL account" required hint={glHint}>
                <Select
                  value={form.accountCode}
                  onChange={(e) => setForm({ ...form, accountCode: e.target.value })}
                >
                  <option value="">Select...</option>
                  {(coaQ.data ?? [])
                    .filter((a) => a.isActive)
                    .map((a) => (
                      <option key={a.id} value={a.code}>
                        {a.code} — {a.name} ({a.type})
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Reference" hint="Cheque number, transfer reference, etc.">
                <TextInput
                  value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                />
              </Field>
              <Field label="Memo">
                <TextArea
                  value={form.memo}
                  onChange={(e) => setForm({ ...form, memo: e.target.value })}
                />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={createM.isPending}>
                  Create voucher
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

// ─── Voucher detail / print ──────────────────────────────────────
// Resolves the :id parameter first as a finance voucher (PV/RV series),
// then falls back to the legacy AP-payment lookup for supplier settlements.

function useResolvedVoucher(id: string | undefined) {
  const financeQ = useQuery({
    queryKey: ['finance-voucher', id],
    queryFn: async () => (await api.get<FinanceVoucher>(E.financeVoucher(id!))).data,
    enabled: !!id,
    retry: false
  });
  const apQ = useQuery({
    queryKey: ['voucher-ap', id],
    queryFn: async () => {
      const invoices = (await api.get<APInvoice[]>(E.apInvoices)).data;
      if (!Array.isArray(invoices)) return null;
      for (const inv of invoices) {
        const payment = (inv.payments ?? []).find((p) => p.id === id);
        if (payment) return { payment, invoice: inv };
      }
      return null;
    },
    enabled: !!id && financeQ.isError,
    staleTime: 60_000
  });
  return { financeQ, apQ };
}

export function Voucher() {
  const { id } = useParams<{ id: string }>();
  const { financeQ, apQ } = useResolvedVoucher(id);
  const print = () => window.print();

  if (financeQ.isLoading)
    return (
      <div className={cardShell}>
        <Spinner label="Loading voucher..." />
      </div>
    );
  if (financeQ.data) return <FinanceVoucherDetail voucher={financeQ.data} onPrint={print} />;

  if (apQ.isLoading)
    return (
      <div className={cardShell}>
        <Spinner label="Loading voucher..." />
      </div>
    );
  if (apQ.data)
    return <ApPaymentVoucherDetail payment={apQ.data.payment} invoice={apQ.data.invoice} onPrint={print} />;

  return (
    <div className="space-y-4">
      <BackLink />
      <EmptyState title="Voucher not found" sub={`No voucher with id "${id ?? '—'}" was found.`} />
    </div>
  );
}

function FinanceVoucherDetail({ voucher: v, onPrint }: { voucher: FinanceVoucher; onPrint: () => void }) {
  const isPayment = v.kind === 'PAYMENT';
  const hasClaim = useAuth((s) => s.hasClaim);
  const canApprove = hasClaim('finance:approve');
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const transitionM = useMutation({
    mutationFn: async (action: 'approve' | 'post') =>
      (
        await api.post<FinanceVoucher>(
          action === 'approve' ? E.financeVoucherApprove(v.id) : E.financeVoucherPost(v.id)
        )
      ).data,
    onSuccess: (updated) => {
      qc.setQueryData(['finance-voucher', v.id], updated);
      qc.invalidateQueries({ queryKey: ['finance-vouchers'] });
      setNotice(`Voucher ${updated.status === 'POSTED' ? 'posted to the general ledger' : 'approved'}.`);
    },
    onError: (err) => setNotice(errMsg(err))
  });

  const stages = [
    { label: 'Prepared', desc: 'Voucher recorded as draft', done: true, when: fmtDateTime(v.createdAt) },
    {
      label: 'Approved',
      desc: 'Finance sign-off',
      done: v.status === 'APPROVED' || v.status === 'POSTED',
      when: v.approvedAt ? fmtDateTime(v.approvedAt) : 'Awaiting approval'
    },
    {
      label: 'Posted',
      desc: 'Balanced journal written to the GL',
      done: v.status === 'POSTED',
      when: v.postedAt ? fmtDateTime(v.postedAt) : 'Pending'
    }
  ];

  return (
    <div className="space-y-6">
      <div className={`${cardShell} no-print`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <BackLink />
            <div className="mt-2 flex items-center gap-3">
              <span className="rounded-xl bg-violet-100 p-2.5 text-violet-700">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  {isPayment ? 'Payment' : 'Receipt'} voucher{' '}
                  <span className="tnum font-mono text-violet-700">{v.voucherNo}</span>
                </h1>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  {fmtBirr(v.amountBirr)} {isPayment ? 'to' : 'from'} {v.counterparty}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {v.status === 'DRAFT' && canApprove ? (
              <Button onClick={() => transitionM.mutate('approve')} loading={transitionM.isPending} className="!px-4">
                <Stamp className="h-4 w-4" /> Approve
              </Button>
            ) : null}
            {v.status === 'APPROVED' && canApprove ? (
              <Button onClick={() => transitionM.mutate('post')} loading={transitionM.isPending} className="!px-4">
                <BadgeCheck className="h-4 w-4" /> Post to GL
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onPrint} className="!px-4">
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button onClick={onPrint} className="!px-4">
              <Download className="h-4 w-4" /> Download PDF
            </Button>
          </div>
        </div>
        {notice ? <p className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">{notice}</p> : null}
      </div>

      <div className={`${cardShell} no-print`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Approval workflow</h2>
          <StatusBadge status={v.status} />
        </div>
        <ol className="grid gap-3 sm:grid-cols-3">
          {stages.map((s) => (
            <li
              key={s.label}
              className={`rounded-xl border p-4 ${
                s.done ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    s.done ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-600'
                  }`}
                >
                  {s.done ? <Check className="h-3.5 w-3.5" /> : '•'}
                </span>
                <p className="font-bold text-slate-900 dark:text-slate-100">{s.label}</p>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.desc}</p>
              <p className={`tnum mt-2 text-xs font-semibold ${s.done ? 'text-emerald-700' : 'text-slate-400'}`}>
                {s.when}
              </p>
            </li>
          ))}
        </ol>
      </div>

      <div className="print-sheet mx-auto max-w-3xl rounded-xl border border-line bg-white dark:bg-slate-800 p-8 shadow-sm">
        <div className="border-b-2 border-ink pb-4 text-center">
          <h1 className="text-2xl font-extrabold text-ink">OYAYA FLOUR FACTORY</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{isPayment ? 'Payment Voucher' : 'Receipt Voucher'}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <p>
            <span className="font-semibold">Voucher No:</span>{' '}
            <span className="tnum font-bold">{v.voucherNo}</span>
          </p>
          <p>
            <span className="font-semibold">Date:</span> {fmtDateTime(v.createdAt)}
          </p>
          <p>
            <span className="font-semibold">{isPayment ? 'Payee:' : 'Received from:'}</span>{' '}
            {v.counterparty}
          </p>
          <p>
            <span className="font-semibold">Method:</span> {v.method}
            {v.reference ? <span className="tnum"> ({v.reference})</span> : null}
          </p>
          <p>
            <span className="font-semibold">Cash / bank:</span> {v.cashBankAccount?.name ?? 'Cash and Bank'}
          </p>
          <p className="tnum">
            <span className="font-semibold">Posting:</span> Dr {v.debitAccountCode} · Cr {v.creditAccountCode}
          </p>
          {v.memo ? (
            <p className="col-span-2">
              <span className="font-semibold">Memo:</span> {v.memo}
            </p>
          ) : null}
        </div>
        <table className="mt-6">
          <thead>
            <tr>
              <th>Description</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {isPayment ? 'Paid to' : 'Received from'} {v.counterparty}
                {v.memo ? ` — ${v.memo}` : ''}
              </td>
              <td className="tnum font-bold">{fmtBirr(v.amountBirr)}</td>
            </tr>
            <tr>
              <td className="text-right font-bold">Total</td>
              <td className="tnum font-extrabold">{fmtBirr(v.amountBirr)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-10 grid grid-cols-3 gap-4 text-center text-sm">
          <div>
            <div className="border-t border-slate-400 pt-2">Prepared by</div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-2">Approved by</div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-2">{isPayment ? 'Received by' : 'Authorized by'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Legacy AP-payment voucher detail (supplier settlements generated by Procurement).
function ApPaymentVoucherDetail({
  payment: v,
  invoice: inv,
  onPrint
}: {
  payment: APPayment;
  invoice: APInvoice;
  onPrint: () => void;
}) {
  const payee = inv.intake?.supplier?.name ?? 'Supplier';
  const linkedDelivery = inv.intake?.intakeNo;
  const isPaid = Boolean(v.paidAt);

  const stages = [
    { label: 'Prepared', desc: 'Payment recorded in accounts payable', done: true, when: fmtDateTime(v.paidAt) },
    {
      label: 'Approved',
      desc: 'Procurement sign-off',
      done: isPaid,
      when: isPaid ? 'Approved with settlement' : 'Awaiting approval'
    },
    { label: 'Paid', desc: 'Funds disbursed to supplier', done: isPaid, when: isPaid ? fmtDateTime(v.paidAt) : 'Pending' }
  ];

  return (
    <div className="space-y-6">
      <div className={`${cardShell} no-print`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <BackLink />
            <div className="mt-2 flex items-center gap-3">
              <span className="rounded-xl bg-violet-100 p-2.5 text-violet-700">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  Payment voucher <span className="tnum font-mono text-violet-700">{v.voucherNo}</span>
                </h1>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  {fmtBirr(v.amountBirr)} to {payee} — {inv.invoiceNo} (supplier settlement)
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onPrint} className="!px-4">
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button onClick={onPrint} className="!px-4">
              <Download className="h-4 w-4" /> Download PDF
            </Button>
          </div>
        </div>
      </div>

      <div className={`${cardShell} no-print`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Approval workflow</h2>
          {isPaid ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700">
              <BadgeCheck className="h-4 w-4" /> Approved
            </span>
          ) : null}
        </div>
        <ol className="grid gap-3 sm:grid-cols-3">
          {stages.map((s) => (
            <li
              key={s.label}
              className={`rounded-xl border p-4 ${
                s.done ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    s.done ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-600'
                  }`}
                >
                  {s.done ? <Check className="h-3.5 w-3.5" /> : '•'}
                </span>
                <p className="font-bold text-slate-900 dark:text-slate-100">{s.label}</p>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.desc}</p>
              <p className={`tnum mt-2 text-xs font-semibold ${s.done ? 'text-emerald-700' : 'text-slate-400'}`}>
                {s.when}
              </p>
            </li>
          ))}
        </ol>
      </div>

      <div className="print-sheet mx-auto max-w-3xl rounded-xl border border-line bg-white dark:bg-slate-800 p-8 shadow-sm">
        <div className="border-b-2 border-ink pb-4 text-center">
          <h1 className="text-2xl font-extrabold text-ink">OYAYA FLOUR FACTORY</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">Payment Voucher</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <p>
            <span className="font-semibold">Voucher No:</span>{' '}
            <span className="tnum font-bold">{v.voucherNo}</span>
          </p>
          <p>
            <span className="font-semibold">Date:</span> {fmtDateTime(v.paidAt)}
          </p>
          <p>
            <span className="font-semibold">Payee:</span> {payee}
          </p>
          <p>
            <span className="font-semibold">Method:</span>{' '}
            {v.method === 'BANK_TRANSFER' ? 'Bank transfer' : v.method === 'CHEQUE' ? 'Cheque' : v.method}
            {v.reference ? <span className="tnum"> ({v.reference})</span> : null}
          </p>
          {linkedDelivery ? (
            <p className="col-span-2">
              <span className="font-semibold">Linked delivery:</span>{' '}
              <span className="tnum">{linkedDelivery}</span>
            </p>
          ) : null}
        </div>
        <table className="mt-6">
          <thead>
            <tr>
              <th>Description</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Supplier settlement — {payee}</td>
              <td className="tnum font-bold">{fmtBirr(v.amountBirr)}</td>
            </tr>
            <tr>
              <td className="text-right font-bold">Total</td>
              <td className="tnum font-extrabold">{fmtBirr(v.amountBirr)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-10 grid grid-cols-3 gap-4 text-center text-sm">
          <div>
            <div className="border-t border-slate-400 pt-2">Prepared by</div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-2">Approved by</div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-2">Received by</div>
          </div>
        </div>
      </div>
    </div>
  );
}
