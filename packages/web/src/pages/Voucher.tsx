import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { APInvoice, APPayment } from '../types';
import { Button, Spinner } from '../components/ui';
import { fmtBirr, fmtDateTime } from '../lib/format';

/**
 * Printable Payment Voucher (A4) — generated automatically on supplier settlement.
 * The :id route parameter is the AP payment id (journal referenceId for APPayment
 * postings); the payment is resolved through the AP invoice list, which the
 * backend returns with payments, intake and supplier included.
 */
export function Voucher() {
  const { id } = useParams<{ id: string }>();

  const voucherQ = useQuery({
    queryKey: ['voucher', id],
    queryFn: async () => {
      const invoices = (await api.get<APInvoice[]>(E.apInvoices)).data;
      for (const inv of invoices) {
        const payment = (inv.payments ?? []).find((p) => p.id === id);
        if (payment) return { payment, invoice: inv };
      }
      return null;
    },
    enabled: !!id
  });

  const print = () => window.print();

  if (voucherQ.isLoading) return <Spinner label="Loading voucher..." />;
  const found = voucherQ.data;
  if (voucherQ.isError)
    return (
      <div>
        <Link to="/finance" className="font-semibold text-navy hover:underline">
          Back to finance
        </Link>
        <p className="mt-4 text-red-600">Could not load voucher. Check your connection and try again.</p>
      </div>
    );
  if (!found)
    return (
      <div>
        <Link to="/finance" className="font-semibold text-navy hover:underline">
          Back to finance
        </Link>
        <p className="mt-4 text-slate-500">Voucher not found.</p>
      </div>
    );

  const v: APPayment = found.payment;
  const payee = found.invoice.intake?.supplier?.name ?? 'Supplier';
  const linkedDelivery = found.invoice.intake?.intakeNo;

  return (
    <div>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link to="/finance" className="font-semibold text-navy hover:underline">
          Back to finance
        </Link>
        <Button onClick={print} className="px-6">
          Print voucher
        </Button>
      </div>

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
