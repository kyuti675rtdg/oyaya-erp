import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, Check, Download, FileText, Printer, Stamp } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { APInvoice, APPayment } from '../types';
import { Button, EmptyState, ErrorBox, Spinner } from '../components/ui';
import { fmtBirr, fmtDateTime } from '../lib/format';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

/**
 * Printable Payment Voucher (A4) — generated automatically on supplier settlement.
 * The :id route parameter is the AP payment id; the payment is resolved through
 * the AP invoice list, which the backend returns with payments, intake and
 * supplier included.
 *
 * NOTE: the backend has no approval endpoint for AP payments, so the approval
 * stage of the workflow below is a frontend-only display driven by the
 * payment record itself (paidAt present => paid; approved is recorded manually
 * per session and is not persisted).
 */
export function Voucher() {
  const { id } = useParams<{ id: string }>();
  const [approvedLocally, setApprovedLocally] = useState(false);

  const voucherQ = useQuery({
    queryKey: ['voucher', id],
    queryFn: async () => {
      const invoices = (await api.get<APInvoice[]>(E.apInvoices)).data;
      if (!Array.isArray(invoices)) return null;
      for (const inv of invoices) {
        const payment = (inv.payments ?? []).find((p) => p.id === id);
        if (payment) return { payment, invoice: inv };
      }
      return null;
    },
    enabled: !!id,
    staleTime: 60_000
  });

  const print = () => window.print();

  if (voucherQ.isLoading)
    return (
      <div className={cardShell}>
        <Spinner label="Loading voucher..." />
      </div>
    );
  const found = voucherQ.data;
  if (voucherQ.isError)
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorBox
          message="Could not load voucher. Check your connection and try again."
          onRetry={() => voucherQ.refetch()}
        />
      </div>
    );
  if (!found)
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState
          title="Voucher not found"
          sub={`No payment with id "${id ?? '—'}" was found among the recorded AP invoices.`}
        />
      </div>
    );

  const v: APPayment = found.payment;
  const inv: APInvoice = found.invoice;
  const payee = inv.intake?.supplier?.name ?? 'Supplier';
  const linkedDelivery = inv.intake?.intakeNo;
  const isPaid = Boolean(v.paidAt);

  const stages = [
    {
      label: 'Prepared',
      desc: 'Payment recorded in accounts payable',
      done: true,
      when: fmtDateTime(v.paidAt)
    },
    {
      label: 'Approved',
      desc: 'Procurement sign-off',
      done: isPaid || approvedLocally,
      when: isPaid ? 'Approved with settlement' : approvedLocally ? 'Marked approved (this session)' : 'Awaiting approval'
    },
    {
      label: 'Paid',
      desc: 'Funds disbursed to supplier',
      done: isPaid,
      when: isPaid ? fmtDateTime(v.paidAt) : 'Pending'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Page chrome */}
      <div className={`${cardShell} no-print`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <BackLink />
            <div className="mt-2 flex items-center gap-3">
              <span className="rounded-xl bg-violet-100 p-2.5 text-violet-700">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-xl font-extrabold text-slate-900">
                  Payment voucher{' '}
                  <span className="tnum font-mono text-violet-700">{v.voucherNo}</span>
                </h1>
                <p className="mt-0.5 text-sm text-slate-500">
                  {fmtBirr(v.amountBirr)} to {payee} — {inv.invoiceNo}
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={print} className="!px-4">
              <Printer className="h-4 w-4" />
              Print
            </Button>
            <Button onClick={print} className="!px-4">
              <Download className="h-4 w-4" />
              Download PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Approval workflow */}
      <div className={`${cardShell} no-print`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">Approval workflow</h2>
          {!stages[1].done ? (
            <Button
              variant="secondary"
              className="!px-4"
              onClick={() => setApprovedLocally(true)}
              title="No backend approval endpoint exists — this marks approval for this session only."
            >
              <Stamp className="h-4 w-4" />
              Approve payment
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700">
              <BadgeCheck className="h-4 w-4" />
              Approved
            </span>
          )}
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
                <p className="font-bold text-slate-900">{s.label}</p>
              </div>
              <p className="mt-1 text-xs text-slate-500">{s.desc}</p>
              <p className={`tnum mt-2 text-xs font-semibold ${s.done ? 'text-emerald-700' : 'text-slate-400'}`}>
                {s.when}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-slate-400">
          Approval status is display-only: the backend records no approval timestamp for AP
          payments, so a settled payment is treated as approved. Manual approvals here are
          session-local and are not persisted.
        </p>
      </div>

      {/* A4 print sheet (unchanged layout) */}
      <div className="print-sheet mx-auto max-w-3xl rounded-xl border border-line bg-white p-8 shadow-sm">
        <div className="border-b-2 border-ink pb-4 text-center">
          <h1 className="text-2xl font-extrabold text-ink">OYAYA FLOUR FACTORY</h1>
          <p className="text-sm text-slate-600">Payment Voucher</p>
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

function BackLink() {
  return (
    <Link
      to="/finance"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:underline"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to finance
    </Link>
  );
}
