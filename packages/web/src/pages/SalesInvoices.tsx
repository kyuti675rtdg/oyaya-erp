import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Landmark, ReceiptText } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { useAuth } from '../store/auth';
import type { SalesInvoice, SalesOrder } from '../types';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, SectionTitle, Select, Spinner } from '../components/ui';
import { fmtBirr, fmtDate, fmtQ } from '../lib/format';

const INV_TONE: Record<string, BadgeTone> = { PLACEMENT: 'advisory', INVOICED: 'neutral', PAID: 'pass' };

export function SalesInvoices() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canPost = hasClaim('sales:approve');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [pickedOrders, setPickedOrders] = useState<string[]>([]);
  const [receiptInvoiceId, setReceiptInvoiceId] = useState('');
  const [receiptAmount, setReceiptAmount] = useState('');

  const invoicesQ = useQuery({
    queryKey: ['sales-invoices'],
    queryFn: async () => (await api.get<SalesInvoice[]>(E.salesInvoices)).data
  });

  const expanded = (invoicesQ.data ?? []).find((i) => i.id === expandedId) ?? null;
  const ordersQ = useQuery({
    queryKey: ['sales-orders'],
    queryFn: async () => (await api.get<SalesOrder[]>(E.salesOrders)).data
  });

  const invoiceableOrders = useMemo(
    () => (ordersQ.data ?? []).filter((o) => ['DISPATCHED', 'DELIVERED'].includes(String(o.status))),
    [ordersQ.data]
  );
  const orderById = useMemo(() => {
    const m = new Map<string, SalesOrder>();
    for (const o of ordersQ.data ?? []) m.set(o.id, o);
    return m;
  }, [ordersQ.data]);

  const toggle = (id: string) =>
    setPickedOrders((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const pickedTotal = useMemo(
    () =>
      invoiceableOrders
        .filter((o) => pickedOrders.includes(o.id))
        .reduce((s, o) => s + Number(o.quintals) * Number(o.priceBirr), 0),
    [invoiceableOrders, pickedOrders]
  );

  const createInvoice = async () => {
    setNotice(null);
    if (pickedOrders.length === 0) {
      setNotice({ ok: false, text: 'Select at least one delivered order.' });
      return;
    }
    setSaving(true);
    try {
      const r = await api.post<SalesInvoice>(E.salesInvoices, { orderIds: pickedOrders });
      setNotice({ ok: true, text: `Invoice ${r.data.invoiceNo} created as PLACEMENT.` });
      setPickedOrders([]);
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create invoice.' });
    } finally {
      setSaving(false);
    }
  };

  const postInvoice = async (id: string) => {
    setNotice(null);
    try {
      await api.post(E.salesInvoicePost(id));
      setNotice({ ok: true, text: 'Invoice finalized — Dr 1100 / Cr 4000 posted to the finance GL.' });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to post invoice.' });
    }
  };

  const recordReceipt = async () => {
    setNotice(null);
    const a = Number(receiptAmount);
    if (!receiptInvoiceId || !Number.isFinite(a) || a <= 0) {
      setNotice({ ok: false, text: 'Select an invoice and enter a positive amount.' });
      return;
    }
    const inv = (invoicesQ.data ?? []).find((i) => i.id === receiptInvoiceId);
    if (!inv) return;
    setSaving(true);
    try {
      await api.post(E.receipts, { customerId: inv.customerId, invoiceId: inv.id, amountBirr: a });
      setNotice({ ok: true, text: 'Cash receipt recorded against the invoice.' });
      setReceiptAmount('');
      setReceiptInvoiceId('');
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record receipt.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle title="Sales Invoicing & Revenue Recognition" sub="Invoice delivered orders, finalize to the finance GL, track receipts" />

      {notice ? (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
            notice.ok
              ? 'border-pass-text/30 bg-pass-bg text-pass-text'
              : 'border-critical-text/30 bg-critical-bg text-critical-text'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <CardHeader
            icon={<ReceiptText className="h-4 w-4" />}
            title="Invoice from delivered orders"
            subtitle="Select DISPATCHED or DELIVERED orders"
            action={
              <Button onClick={createInvoice} loading={saving} disabled={pickedOrders.length === 0} className="text-xs">
                Create invoice — {fmtBirr(pickedTotal)}
              </Button>
            }
          />
          {ordersQ.isLoading ? (
            <Spinner label="Loading orders..." />
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {invoiceableOrders.map((o) => (
                <label
                  key={o.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-2.5 ${
                    pickedOrders.includes(o.id) ? 'border-harvest bg-harvest-light' : 'border-line'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={pickedOrders.includes(o.id)}
                    onChange={() => toggle(o.id)}
                    className="h-5 w-5 accent-amber-600"
                  />
                  <span className="flex-1 text-sm">
                    <span className="tnum font-bold">{o.orderNo}</span> — {o.customer?.name ?? o.customerId}{' '}
                    <Badge tone="neutral">{String(o.status)}</Badge>
                  </span>
                  <span className="tnum text-sm font-bold">{fmtBirr(Number(o.quintals) * Number(o.priceBirr))}</span>
                </label>
              ))}
              {invoiceableOrders.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No delivered orders awaiting invoicing.</p>
              ) : null}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader icon={<Landmark className="h-4 w-4" />} title="Record cash receipt" subtitle="Payment against an invoice (posts cash journal)" />
          <div className="space-y-4">
            <Field label="Invoice">
              <Select value={receiptInvoiceId} onChange={(e) => setReceiptInvoiceId(e.target.value)}>
                <option value="">Select invoice</option>
                {(invoicesQ.data ?? [])
                  .filter((i) => i.status !== 'PAID')
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.invoiceNo} — {fmtBirr(i.amountBirr)} ({i.status})
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Amount (ETB)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={receiptAmount}
                onChange={(e) => setReceiptAmount(e.target.value)}
                placeholder="0.00"
                className="tnum w-full rounded-lg border border-line px-3 py-2 text-xl"
              />
            </Field>
            <Button onClick={recordReceipt} loading={saving} variant="secondary" className="w-full">
              Record receipt
            </Button>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <SectionTitle title="Invoices" />
        {invoicesQ.isLoading ? (
          <Spinner label="Loading invoices..." />
        ) : (
          <DataTable<SalesInvoice>
            columns={[
              { key: 'invoiceNo', label: 'Invoice', render: (r) => <span className="tnum font-bold">{r.invoiceNo}</span> },
              {
                key: 'source',
                label: 'Source',
                render: (r) => <span className="text-xs text-slate-500 dark:text-slate-400">{r.source === 'ORDER' ? `Orders (${(r.orderIds ?? []).length})` : 'Dispatch'}</span>
              },
              { key: 'amountBirr', label: 'Amount', mono: true, render: (r) => fmtBirr(r.amountBirr) },
              { key: 'createdAt', label: 'Created', render: (r) => fmtDate(r.createdAt) },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={INV_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
              },
              {
                key: 'actions',
                label: '',
                render: (r) => (
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="px-2 py-1 text-xs">
                      {expandedId === r.id ? 'Hide' : 'Lines'}
                    </Button>
                    {r.status === 'PLACEMENT' && canPost ? (
                      <Button variant="secondary" onClick={() => postInvoice(r.id)} className="px-2 py-1 text-xs">
                        <FileText className="mr-1 h-3 w-3" /> Post to GL
                      </Button>
                    ) : null}
                  </div>
                )
              }
            ]}
            rows={invoicesQ.data ?? []}
            emptyTitle="No invoices"
            emptySub="Invoice delivered orders to recognize revenue."
          />
        )}
        {expanded ? (
          <Card className="mt-3 p-5">
            <CardHeader
              icon={<FileText className="h-4 w-4" />}
              title={`${expanded.invoiceNo} — lines & payments`}
              subtitle={`${fmtBirr(expanded.amountBirr)} · ${expanded.status}`}
              action={
                <Button variant="ghost" onClick={() => setExpandedId(null)} className="px-2 py-1 text-xs">
                  Close
                </Button>
              }
            />
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-1">Order</th>
                  <th className="py-1">Product</th>
                  <th className="py-1 text-right">Bags</th>
                  <th className="py-1 text-right">Quintals</th>
                  <th className="py-1 text-right">Unit price</th>
                  <th className="py-1 text-right">Line total</th>
                </tr>
              </thead>
              <tbody>
                {(expanded.lines ?? []).map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="tnum py-1">{orderById.get(l.orderId ?? '')?.orderNo ?? '—'}</td>
                    <td className="py-1">
                      {l.product?.name ?? l.productId}
                      {l.packagingSize ? ` · ${l.packagingSize.label}` : ''}
                    </td>
                    <td className="tnum py-1 text-right">{l.bags}</td>
                    <td className="tnum py-1 text-right">{fmtQ(l.quintals)}</td>
                    <td className="tnum py-1 text-right">{fmtBirr(l.unitPriceBirr)}</td>
                    <td className="tnum py-1 text-right font-bold">{fmtBirr(l.lineTotalBirr)}</td>
                  </tr>
                ))}
                {(expanded.lines ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-2 text-sm text-slate-500 dark:text-slate-400">
                      Dispatch-sourced invoice — line detail lives on the dispatch.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {(expanded.receipts ?? []).length > 0 || (expanded.applications ?? []).length > 0 ? (
              <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                <p className="font-bold text-ink">Payments</p>
                {(expanded.receipts ?? []).map((x) => (
                  <p key={x.id} className="tnum">
                    Receipt {x.receiptNo} — {fmtBirr(x.amountBirr)} ({fmtDate(x.receivedAt)})
                  </p>
                ))}
                {(expanded.applications ?? []).map((x) => (
                  <p key={x.id} className="tnum">
                    Advance applied — {fmtBirr(x.amountBirr)} ({fmtDate(x.appliedAt)})
                  </p>
                ))}
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
