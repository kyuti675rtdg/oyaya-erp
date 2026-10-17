import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  Clock3,
  CreditCard,
  Search,
  Wallet
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { APInvoice, APPayment, Dec } from '../types';
import { Badge } from '../components/Badge';
import { Button, EmptyState, ErrorBox, Field, NumberInput, Select, Spinner, TextInput } from '../components/ui';
import { fmtBirr, fmtDate } from '../lib/format';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const DAY_MS = 24 * 60 * 60 * 1000;

const money = (d: Dec | null | undefined): number => {
  const n = Number(d);
  return Number.isFinite(n) ? n : 0;
};

const paidTotal = (inv: APInvoice): number =>
  (inv.payments ?? []).reduce((sum, p) => sum + money(p.amountBirr), 0);

const balance = (inv: APInvoice): number => Math.max(0, money(inv.amountBirr) - paidTotal(inv));

const daysOverdue = (inv: APInvoice, now: number): number => {
  if (!inv.dueDate || inv.status === 'PAID') return 0;
  return Math.floor((now - new Date(inv.dueDate).getTime()) / DAY_MS);
};

type AgingBucket = 'Current' | '1-30 days' | '31-60 days' | '61-90 days' | '90+ days';

function agingBucket(overdue: number): AgingBucket {
  if (overdue <= 0) return 'Current';
  if (overdue <= 30) return '1-30 days';
  if (overdue <= 60) return '31-60 days';
  if (overdue <= 90) return '61-90 days';
  return '90+ days';
}

function bucketTone(b: AgingBucket): 'pass' | 'advisory' | 'critical' | 'neutral' {
  switch (b) {
    case 'Current':
      return 'pass';
    case '1-30 days':
      return 'neutral';
    case '31-60 days':
      return 'advisory';
    default:
      return 'critical';
  }
}

function statusTone(s: string): 'pass' | 'advisory' | 'critical' | 'neutral' {
  switch (s) {
    case 'PAID':
      return 'pass';
    case 'PARTIAL':
      return 'advisory';
    case 'OPEN':
      return 'neutral';
    default:
      return 'neutral';
  }
}

type StatusFilter = 'all' | 'OPEN' | 'PARTIAL' | 'PAID' | 'OVERDUE';

/**
 * Accounts payable — supplier invoice balances, aging, and settlement.
 */
export function AccountsPayable() {
  const queryClient = useQueryClient();
  const now = Date.now();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [payTarget, setPayTarget] = useState<APInvoice | null>(null);

  const invoicesQ = useQuery({
    queryKey: ['ap-invoices'],
    queryFn: async () => (await api.get<APInvoice[]>(E.apInvoices)).data
  });

  const invoices = useMemo(
    () => (Array.isArray(invoicesQ.data) ? invoicesQ.data : []),
    [invoicesQ.data]
  );

  const enriched = useMemo(
    () =>
      invoices.map((inv) => ({
        inv,
        paid: paidTotal(inv),
        bal: balance(inv),
        overdue: daysOverdue(inv, now),
        bucket: agingBucket(daysOverdue(inv, now))
      })),
    [invoices, now]
  );

  const summary = useMemo(() => {
    const weekFromNow = now + 7 * DAY_MS;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let outstanding = 0;
    let overdue = 0;
    let dueThisWeek = 0;
    let paidThisMonth = 0;
    for (const inv of invoices) {
      const b = balance(inv);
      const od = daysOverdue(inv, now);
      if (inv.status !== 'PAID') outstanding += b;
      if (od > 0) overdue += b;
      if (inv.status !== 'PAID' && inv.dueDate) {
        const due = new Date(inv.dueDate).getTime();
        if (due >= now && due <= weekFromNow) dueThisWeek += b;
      }
      for (const p of inv.payments ?? []) {
        if (p.paidAt && new Date(p.paidAt).getTime() >= monthStart.getTime()) {
          paidThisMonth += money(p.amountBirr);
        }
      }
    }
    return { outstanding, overdue, dueThisWeek, paidThisMonth };
  }, [invoices, now]);

  const supplierBalances = useMemo(() => {
    const map = new Map<string, { name: string; outstanding: number; invoices: number }>();
    for (const inv of invoices) {
      const name = inv.intake?.supplier?.name ?? 'Unknown supplier';
      const entry = map.get(name) ?? { name, outstanding: 0, invoices: 0 };
      const b = balance(inv);
      if (b > 0) {
        entry.outstanding += b;
        entry.invoices += 1;
      }
      map.set(name, entry);
    }
    return [...map.values()]
      .filter((s) => s.outstanding > 0)
      .sort((a, b2) => b2.outstanding - a.outstanding);
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    return enriched
      .filter((row) => {
        if (statusFilter === 'OVERDUE' && row.overdue <= 0) return false;
        if (statusFilter !== 'all' && statusFilter !== 'OVERDUE' && row.inv.status !== statusFilter)
          return false;
        if (q) {
          const name = (row.inv.intake?.supplier?.name ?? '').toLowerCase();
          if (!name.includes(q) && !row.inv.invoiceNo.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.overdue - a.overdue || (b.bal - a.bal));
  }, [enriched, statusFilter, supplierSearch]);

  const summaryCards = [
    {
      label: 'Total outstanding',
      value: fmtBirr(summary.outstanding),
      icon: Wallet,
      accent: 'bg-violet-100 text-violet-700'
    },
    {
      label: 'Overdue amount',
      value: fmtBirr(summary.overdue),
      icon: AlertTriangle,
      accent: 'bg-red-100 text-red-700'
    },
    {
      label: 'Due this week',
      value: fmtBirr(summary.dueThisWeek),
      icon: CalendarClock,
      accent: 'bg-amber-100 text-amber-700'
    },
    {
      label: 'Paid this month',
      value: fmtBirr(summary.paidThisMonth),
      icon: Clock3,
      accent: 'bg-emerald-100 text-emerald-700'
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">Accounts Payable</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Supplier invoice balances, aging and settlement for wheat procurement.
        </p>
      </div>

      {invoicesQ.isError ? (
        <ErrorBox
          message="Could not load payables. Check your connection and try again."
          onRetry={() => invoicesQ.refetch()}
        />
      ) : null}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((c) => (
          <div key={c.label} className={cardShell}>
            <div className="flex items-center gap-3">
              <span className={`rounded-xl p-2.5 ${c.accent}`}>
                <c.icon className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{c.label}</p>
            </div>
            <p className="tnum mt-3 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
              {invoicesQ.isLoading ? '—' : c.value}
            </p>
          </div>
        ))}
      </div>

      {invoicesQ.isLoading ? (
        <Spinner label="Loading payables..." />
      ) : invoices.length === 0 ? (
        <EmptyState
          title="No supplier invoices"
          sub="Invoices are created automatically when a wheat intake is accepted."
        />
      ) : (
        <>
          {/* Filters */}
          <div className={`${cardShell} flex flex-wrap items-end gap-4`}>
            <div className="min-w-44">
              <Field label="Status">
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                >
                  <option value="all">All invoices</option>
                  <option value="OPEN">Open</option>
                  <option value="PARTIAL">Partially paid</option>
                  <option value="PAID">Paid</option>
                  <option value="OVERDUE">Overdue</option>
                </Select>
              </Field>
            </div>
            <div className="min-w-56 flex-1 sm:max-w-xs">
              <Field label="Search supplier / invoice">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                  <TextInput
                    value={supplierSearch}
                    onChange={(e) => setSupplierSearch(e.target.value)}
                    placeholder="Supplier name or invoice no."
                    className="pl-9"
                  />
                </div>
              </Field>
            </div>
          </div>

          {/* Aging table */}
          <div className={cardShell}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">AP aging</h2>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {filtered.length} of {enriched.length} invoices
              </span>
            </div>
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3">Invoice</th>
                    <th className="py-2 pr-3">Supplier</th>
                    <th className="py-2 pr-3">Intake</th>
                    <th className="py-2 pr-3">Issued</th>
                    <th className="py-2 pr-3">Due</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2 pr-3 text-right">Paid</th>
                    <th className="py-2 pr-3 text-right">Balance</th>
                    <th className="py-2 pr-3 text-right">Overdue</th>
                    <th className="py-2 pr-3">Aging</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ inv, paid, bal, overdue, bucket }) => (
                    <tr
                      key={inv.id}
                      className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                    >
                      <td className="tnum py-3 pr-3 font-bold text-slate-900 dark:text-slate-100">{inv.invoiceNo}</td>
                      <td className="py-3 pr-3">{inv.intake?.supplier?.name ?? '—'}</td>
                      <td className="tnum py-3 pr-3 text-slate-600 dark:text-slate-300">
                        {inv.intake?.intakeNo ?? '—'}
                      </td>
                      <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">{fmtDate(inv.issuedAt)}</td>
                      <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">
                        {inv.dueDate ? fmtDate(inv.dueDate) : '—'}
                      </td>
                      <td className="tnum py-3 pr-3 text-right">{fmtBirr(inv.amountBirr)}</td>
                      <td className="tnum py-3 pr-3 text-right text-slate-600 dark:text-slate-300">{fmtBirr(paid)}</td>
                      <td className="tnum py-3 pr-3 text-right font-bold text-slate-900 dark:text-slate-100">
                        {fmtBirr(bal)}
                      </td>
                      <td className="tnum py-3 pr-3 text-right">
                        {overdue > 0 ? (
                          <span className="font-semibold text-red-600">{overdue} d</span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        <Badge tone={bucketTone(bucket)}>{bucket}</Badge>
                      </td>
                      <td className="py-3 pr-3">
                        <Badge tone={statusTone(inv.status)}>{inv.status}</Badge>
                      </td>
                      <td className="py-3 text-right">
                        {inv.status !== 'PAID' ? (
                          <button
                            onClick={() => setPayTarget(inv)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"
                          >
                            <CreditCard className="h-3.5 w-3.5" />
                            Pay
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">Settled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 ? (
              <div className="py-4">
                <EmptyState title="No invoices match" sub="Try adjusting the status filter or search." />
              </div>
            ) : null}
          </div>

          {/* Payments with voucher links */}
          <div className={cardShell}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-slate-100">Recent payments</h2>
            {enriched.every((r) => (r.inv.payments ?? []).length === 0) ? (
              <EmptyState title="No payments recorded yet" sub="Recorded payments will appear here with links to their printable vouchers." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3">Voucher</th>
                      <th className="py-2 pr-3">Invoice</th>
                      <th className="py-2 pr-3">Supplier</th>
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Method</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enriched
                      .flatMap((r) =>
                        (r.inv.payments ?? []).map((p) => ({ p, inv: r.inv }))
                      )
                      .sort((a, b) => new Date(b.p.paidAt).getTime() - new Date(a.p.paidAt).getTime())
                      .slice(0, 25)
                      .map(({ p, inv }) => (
                        <tr
                          key={p.id}
                          className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                        >
                          <td className="py-2.5 pr-3">
                            <Link
                              to={`/finance/vouchers/${p.id}`}
                              className="tnum font-bold text-violet-700 hover:underline"
                            >
                              {p.voucherNo}
                            </Link>
                          </td>
                          <td className="tnum py-2.5 pr-3 text-slate-600 dark:text-slate-300">{inv.invoiceNo}</td>
                          <td className="py-2.5 pr-3">{inv.intake?.supplier?.name ?? '—'}</td>
                          <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">{fmtDate(p.paidAt)}</td>
                          <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">
                            {p.method === 'BANK_TRANSFER' ? 'Bank transfer' : p.method === 'CHEQUE' ? 'Cheque' : p.method}
                          </td>
                          <td className="tnum py-2.5 text-right font-bold">{fmtBirr(p.amountBirr)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Supplier balances */}
          <div className={cardShell}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-slate-100">Supplier balances</h2>
            {supplierBalances.length === 0 ? (
              <EmptyState title="No outstanding supplier balances" sub="All supplier invoices are settled." />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {supplierBalances.map((s) => (
                  <div
                    key={s.name}
                    className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 p-4"
                  >
                    <p className="truncate font-bold text-slate-900 dark:text-slate-100">{s.name}</p>
                    <p className="tnum mt-1 text-xl font-extrabold text-violet-700">
                      {fmtBirr(s.outstanding)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {s.invoices} open invoice{s.invoices === 1 ? '' : 's'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {payTarget ? (
        <PayModal
          invoice={payTarget}
          remaining={balance(payTarget)}
          onClose={() => setPayTarget(null)}
          onSuccess={() => {
            setPayTarget(null);
            void queryClient.invalidateQueries({ queryKey: ['ap-invoices'] });
          }}
        />
      ) : null}
    </div>
  );
}

function PayModal({
  invoice,
  remaining,
  onClose,
  onSuccess
}: {
  invoice: APInvoice;
  remaining: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'BANK_TRANSFER' | 'CHEQUE'>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');

  const payM = useMutation({
    mutationFn: async () =>
      api.post<APPayment>(E.apPay(invoice.id), {
        amountBirr: Number(amount),
        method,
        reference: reference.trim() || undefined
      }),
    onSuccess: () => onSuccess(),
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : 'Payment could not be recorded.')
  });

  const submit = () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }
    if (n > remaining + 0.005) {
      setError(`Amount exceeds the remaining balance of ${fmtBirr(remaining)}.`);
      return;
    }
    setError('');
    payM.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Record payment for ${invoice.invoiceNo}`}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-100">Record payment</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Invoice <span className="tnum font-bold text-slate-700 dark:text-slate-200">{invoice.invoiceNo}</span> —{' '}
          {invoice.intake?.supplier?.name ?? 'Supplier'}
        </p>
        <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-800 px-4 py-3 text-sm">
          <div className="flex justify-between text-slate-600 dark:text-slate-300">
            <span>Invoice total</span>
            <span className="tnum font-semibold">{fmtBirr(invoice.amountBirr)}</span>
          </div>
          <div className="mt-1 flex justify-between font-bold text-slate-900 dark:text-slate-100">
            <span>Remaining</span>
            <span className="tnum">{fmtBirr(remaining)}</span>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <Field label="Amount (ETB)" required>
            <NumberInput
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
            />
          </Field>
          <Field label="Method" required>
            <Select
              value={method}
              onChange={(e) => setMethod(e.target.value as 'BANK_TRANSFER' | 'CHEQUE')}
            >
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CHEQUE">Cheque</option>
            </Select>
          </Field>
          <Field label="Reference" hint="Cheque number or transfer reference">
            <TextInput
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. CHQ-102934"
            />
          </Field>
          {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}
        </div>

        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" loading={payM.isPending} onClick={submit}>
            Record payment
          </Button>
        </div>
      </div>
    </div>
  );
}
