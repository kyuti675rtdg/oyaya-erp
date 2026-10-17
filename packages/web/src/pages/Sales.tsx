import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import { useAuth } from '../store/auth';
import type { Customer, Dispatch, OrderStatus, PackagingSize, Product, ReconReport, SalesOrder, Vehicle } from '../types';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner, TextInput } from '../components/ui';
import { fmtBirr, fmtDate, fmtQ } from '../lib/format';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const ORDER_STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  CONFIRMED: 'advisory',
  PROCESSING: 'advisory',
  LOADING: 'advisory',
  DISPATCHED: 'pass',
  DELIVERED: 'pass',
  CANCELLED: 'critical',
  OPEN: 'advisory',
  LOADED: 'pass',
  INVOICED: 'pass',
  CLOSED: 'neutral'
};

const NEXT_STATUS: Record<string, Array<{ to: OrderStatus; label: string }>> = {
  DRAFT: [{ to: 'CONFIRMED', label: 'Confirm' }],
  OPEN: [{ to: 'CONFIRMED', label: 'Confirm' }],
  CONFIRMED: [{ to: 'PROCESSING', label: 'Start processing' }],
  PROCESSING: [{ to: 'LOADING', label: 'Send to loading' }],
  LOADING: [{ to: 'DISPATCHED', label: 'Mark dispatched' }],
  DISPATCHED: [{ to: 'DELIVERED', label: 'Mark delivered' }]
};

interface DraftLine {
  productId: string;
  packagingSizeId: string;
  bags: string;
  quintals: string;
  priceBirr: string;
}

export function Sales() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { hasClaim } = useAuth();
  const canApprove = hasClaim('sales:approve');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Order form
  const [customerId, setCustomerId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(todayISO());
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);

  // Line editor
  const [lineProductId, setLineProductId] = useState('');
  const [linePackId, setLinePackId] = useState('');
  const [lineBags, setLineBags] = useState('');
  const [lineQ, setLineQ] = useState('');
  const [linePrice, setLinePrice] = useState('');

  // Advance form
  const [advCustomerId, setAdvCustomerId] = useState('');
  const [advAmount, setAdvAmount] = useState('');

  // Dispatch wizard
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [pickedOrders, setPickedOrders] = useState<string[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [destinationArea, setDestinationArea] = useState('');
  const [lineBatchNos, setLineBatchNos] = useState<Record<string, string>>({});

  const customersQ = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await api.get<Customer[]>(E.customers)).data
  });
  const productsQ = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get<Product[]>(E.products)).data
  });
  const packsQ = useQuery({
    queryKey: ['packaging-sizes'],
    queryFn: async () => (await api.get<PackagingSize[]>(E.packagingSizes)).data
  });
  const vehiclesQ = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => (await api.get<Vehicle[]>(E.vehicles)).data
  });
  const ordersQ = useQuery({
    queryKey: ['sales-orders'],
    queryFn: async () => (await api.get<SalesOrder[]>(E.salesOrders)).data
  });
  const reconQ = useQuery({
    queryKey: ['sales-reconciliation'],
    queryFn: async () => (await api.get<ReconReport>(E.salesReconciliation)).data
  });

  const packKgBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of packsQ.data ?? []) m.set(p.id, Number(p.kg));
    return m;
  }, [packsQ.data]);

  const productNameBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of productsQ.data ?? []) m.set(p.id, p.name);
    return m;
  }, [productsQ.data]);

  const packLabelBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of packsQ.data ?? []) m.set(p.id, p.label);
    return m;
  }, [packsQ.data]);

  const customerNameBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customersQ.data ?? []) m.set(c.id, c.name);
    return m;
  }, [customersQ.data]);

  const LOADABLE = ['OPEN', 'CONFIRMED', 'PROCESSING', 'LOADING'];
  const openOrders = useMemo(
    () => (ordersQ.data ?? []).filter((o) => LOADABLE.includes(String(o.status))),
    [ordersQ.data]
  );
  const pickedTotal = useMemo(
    () =>
      openOrders.filter((o) => pickedOrders.includes(o.id)).reduce((s, o) => s + Number(o.quintals), 0),
    [openOrders, pickedOrders]
  );

  const draftTotalQ = draftLines.reduce((s, l) => s + (Number(l.quintals) || 0), 0);
  const draftTotalV = draftLines.reduce((s, l) => s + (Number(l.quintals) || 0) * (Number(l.priceBirr) || 0), 0);

  const expandedOrder = (ordersQ.data ?? []).find((o) => o.id === expandedId) ?? null;

  const refresh = () => qc.invalidateQueries({ queryKey: ['sales-orders'] });

  const addDraftLine = () => {
    const q = Number(lineQ);
    const p = Number(linePrice);
    if (!lineProductId || !Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p <= 0) {
      setNotice({ ok: false, text: 'Product, positive quantity and positive price are required for a line.' });
      return;
    }
    setDraftLines((prev) => [
      ...prev,
      { productId: lineProductId, packagingSizeId: linePackId, bags: lineBags, quintals: lineQ, priceBirr: linePrice }
    ]);
    setLineProductId('');
    setLinePackId('');
    setLineBags('');
    setLineQ('');
    setLinePrice('');
  };

  const createOrder = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!customerId || draftLines.length === 0) {
      setNotice({ ok: false, text: 'Customer and at least one order line are required.' });
      return;
    }
    setSaving(true);
    try {
      const lines = draftLines.map((l) => ({
        productId: l.productId,
        packagingSizeId: l.packagingSizeId || null,
        bags: Math.round(Number(l.bags) || 0),
        quintals: Number(l.quintals),
        priceBirr: Number(l.priceBirr)
      }));
      const first = lines[0];
      const r = await submitOrQueue('sales-order', E.salesOrders, {
        customerId,
        productId: first.productId,
        quintals: draftTotalQ,
        priceBirr: draftTotalV / draftTotalQ,
        requestedDate: new Date(`${deliveryDate}T00:00:00`).toISOString(),
        orderDate: new Date().toISOString(),
        lines
      });
      setNotice({
        ok: true,
        text: r.queued
          ? 'Order saved offline — will sync automatically.'
          : 'Customer order created as DRAFT.'
      });
      setDraftLines([]);
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create order.' });
    } finally {
      setSaving(false);
    }
  };

  const moveStatus = async (order: SalesOrder, to: OrderStatus) => {
    setNotice(null);
    try {
      await api.patch(E.salesOrderStatus(order.id), { status: to });
      setNotice({ ok: true, text: `Order ${order.orderNo} → ${to}.` });
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Status change failed.' });
    }
  };

  const cancelOrder = async (order: SalesOrder) => {
    setNotice(null);
    try {
      await api.post(E.salesOrderCancel(order.id));
      setNotice({ ok: true, text: `Order ${order.orderNo} cancelled.` });
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Cancel failed.' });
    }
  };

  const recordAdvance = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      const a = Number(advAmount);
      if (!advCustomerId || !Number.isFinite(a) || a <= 0) {
        setNotice({ ok: false, text: 'Customer and a positive amount are required.' });
        return;
      }
      const r = await submitOrQueue('advance-payment', E.advances, {
        customerId: advCustomerId,
        amountBirr: a
      });
      setNotice({
        ok: true,
        text: r.queued
          ? 'Advance saved offline — will sync automatically.'
          : 'Advance recorded — customer outstanding balance reduced.'
      });
      setAdvAmount('');
      qc.invalidateQueries({ queryKey: ['customers'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record advance.' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDispatch = async () => {
    setNotice(null);
    if (pickedOrders.length === 0 || !vehicleId || !destinationArea.trim()) {
      setNotice({ ok: false, text: 'Select at least one order, a vehicle and a destination area.' });
      return;
    }
    const picked = openOrders.filter((o) => pickedOrders.includes(o.id));
    const customerIds = new Set(picked.map((o) => o.customerId));
    if (customerIds.size > 1) {
      setNotice({ ok: false, text: 'All orders in one dispatch must belong to the same customer.' });
      return;
    }
    const lines: Array<{ orderId: string; productId: string; packagingSizeId: string | null; batchNo: string; bags: number; quintals: number }> = [];
    for (const o of picked) {
      const srcLines =
        o.lines && o.lines.length > 0
          ? o.lines.map((l) => ({ productId: l.productId, packagingSizeId: l.packagingSizeId ?? null, bags: l.bags, quintals: Number(l.quintals) }))
          : [{ productId: o.productId, packagingSizeId: null as string | null, bags: 0, quintals: Number(o.quintals) }];
      for (let i = 0; i < srcLines.length; i++) {
        const sl = srcLines[i];
        const key = `${o.id}:${i}`;
        const batchNo = (lineBatchNos[key] ?? '').trim();
        if (!batchNo) {
          setNotice({ ok: false, text: `Enter the finished-goods batch number for order ${o.orderNo} line ${i + 1}.` });
          return;
        }
        lines.push({ orderId: o.id, productId: sl.productId, packagingSizeId: sl.packagingSizeId, batchNo, bags: sl.bags, quintals: sl.quintals });
      }
    }
    setSaving(true);
    try {
      const r = await submitOrQueue<Dispatch>('dispatch', E.dispatches, {
        vehicleId,
        area: destinationArea.trim(),
        orderIds: pickedOrders,
        lines,
        departureDate: new Date().toISOString()
      });
      if (r.queued) {
        setNotice({ ok: true, text: 'Dispatch saved offline — the exit note will sync and generate automatically.' });
        setWizardOpen(false);
        setWizardStep(1);
        setPickedOrders([]);
        setLineBatchNos({});
      } else if (r.data) {
        navigate(`/sales/dispatches/${r.data.id}`);
      }
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to confirm dispatch.' });
    } finally {
      setSaving(false);
    }
  };

  const toggleOrder = (id: string) =>
    setPickedOrders((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const recon = reconQ.data;

  return (
    <div>
      <SectionTitle title="Sales & Distribution" sub="Customer orders, advances, dispatch and revenue reconciliation" />

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-4 text-base font-bold text-ink">New customer order (multi-line)</h3>
          <form onSubmit={createOrder} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Customer" required>
                <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                  <option value="">Select customer</option>
                  {(customersQ.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Requested delivery date" required>
                <TextInput type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} required />
              </Field>
            </div>

            <div className="rounded-xl border border-line p-4">
              <h4 className="mb-3 text-sm font-bold text-ink">Order lines</h4>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <Field label="Product">
                  <Select value={lineProductId} onChange={(e) => setLineProductId(e.target.value)}>
                    <option value="">Select</option>
                    {(productsQ.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Pack size">
                  <Select
                    value={linePackId}
                    onChange={(e) => {
                      setLinePackId(e.target.value);
                      const kg = packKgBy.get(e.target.value) ?? 0;
                      if (kg > 0 && lineBags) setLineQ(String(((Number(lineBags) * kg) / 100).toFixed(2)));
                    }}
                  >
                    <option value="">Bulk</option>
                    {(packsQ.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Bags">
                  <NumberInput
                    value={lineBags}
                    onChange={(e) => {
                      setLineBags(e.target.value);
                      const kg = packKgBy.get(linePackId) ?? 0;
                      if (kg > 0) setLineQ(String(((Number(e.target.value) * kg) / 100).toFixed(2)));
                    }}
                    min={0}
                    step="1"
                    placeholder="0"
                  />
                </Field>
                <Field label="Quintals">
                  <NumberInput value={lineQ} onChange={(e) => setLineQ(e.target.value)} min={0} step="0.01" placeholder="0.00" />
                </Field>
                <Field label="Price (ETB/q)">
                  <NumberInput value={linePrice} onChange={(e) => setLinePrice(e.target.value)} min={0} step="0.01" placeholder="0.00" />
                </Field>
                <div className="flex items-end">
                  <Button type="button" variant="secondary" onClick={addDraftLine} className="w-full">
                    <Plus className="mr-1 h-4 w-4" /> Add
                  </Button>
                </div>
              </div>
              {draftLines.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {draftLines.map((l, i) => (
                    <li key={i} className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
                      <span>
                        {productNameBy.get(l.productId)}
                        {l.packagingSizeId ? ` · ${packLabelBy.get(l.packagingSizeId)}` : ''}
                        {l.bags ? ` · ${l.bags} bags` : ''} — <span className="tnum font-bold">{fmtQ(l.quintals)} q</span> @{' '}
                        <span className="tnum">{fmtBirr(l.priceBirr)}/q</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setDraftLines((p) => p.filter((_, j) => j !== i))}
                        className="text-critical-text"
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Total: <span className="tnum font-bold text-ink">{fmtQ(draftTotalQ)} q</span> —{' '}
                <span className="tnum font-bold text-ink">{fmtBirr(draftTotalV)}</span>
              </p>
              <Button type="submit" loading={saving} disabled={draftLines.length === 0}>
                Create order (DRAFT)
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-4 text-base font-bold text-ink">Advance payment</h3>
            <form onSubmit={recordAdvance} className="space-y-4">
              <Field label="Customer" required>
                <Select value={advCustomerId} onChange={(e) => setAdvCustomerId(e.target.value)} required>
                  <option value="">Select customer</option>
                  {(customersQ.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount (ETB)" required hint="Reduces the outstanding balance before loading.">
                <NumberInput value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} min={0} step="0.01" placeholder="0.00" className="text-xl" />
              </Field>
              <Button type="submit" loading={saving} variant="secondary" className="w-full">
                Record advance
              </Button>
            </form>

            <h3 className="mb-2 mt-6 text-base font-bold text-ink">Dispatch</h3>
            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
              Loading is confirmed separately from order placement. Multiple orders for the same or nearby
              destination area can be consolidated up to vehicle capacity.
            </p>
            <Button
              onClick={() => {
                setWizardOpen(true);
                setWizardStep(1);
              }}
              className="w-full"
            >
              Start dispatch wizard
            </Button>
          </Card>

          <Card className="p-5">
            <h3 className="mb-4 text-base font-bold text-ink">Sales-to-cash reconciliation</h3>
            {reconQ.isLoading ? (
              <Spinner label="Loading reconciliation..." />
            ) : recon ? (
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Invoiced sales</span>
                  <span className="tnum font-bold text-ink">{fmtBirr(recon.totals.invoiced)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Cash received</span>
                  <span className="tnum font-bold text-ink">{fmtBirr(recon.totals.received)}</span>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-sm">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Unreconciled gap</span>
                  <span className={`tnum font-bold ${recon.totals.gap !== 0 ? 'text-critical-text' : 'text-pass-text'}`}>
                    {fmtBirr(recon.totals.gap)}
                  </span>
                </div>
                {recon.totals.gap !== 0 ? (
                  <Badge tone="critical">Unreconciled gap flagged</Badge>
                ) : (
                  <Badge tone="pass">Fully reconciled</Badge>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No reconciliation data.</p>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-6">
        <SectionTitle title="Customer orders" sub="Draft → Confirmed → Processing → Loading → Dispatched → Delivered" />
        {ordersQ.isLoading ? (
          <Spinner label="Loading orders..." />
        ) : (
          <DataTable<SalesOrder>
            columns={[
              { key: 'orderNo', label: 'Order', render: (r) => <span className="tnum font-bold">{r.orderNo}</span> },
              { key: 'customer', label: 'Customer', render: (r) => r.customer?.name ?? customerNameBy.get(r.customerId) ?? r.customerId },
              { key: 'requestedDate', label: 'Delivery', render: (r) => (r.requestedDate ? fmtDate(r.requestedDate) : '-') },
              {
                key: 'lines',
                label: 'Lines',
                mono: true,
                render: (r) => String(r.lines && r.lines.length > 0 ? r.lines.length : 1)
              },
              { key: 'quintals', label: 'Qty (q)', mono: true, render: (r) => fmtQ(r.quintals) },
              {
                key: 'total',
                label: 'Total',
                mono: true,
                render: (r) =>
                  fmtBirr(
                    r.lines && r.lines.length > 0
                      ? r.lines.reduce((s, l) => s + Number(l.quintals) * Number(l.priceBirr), 0)
                      : Number(r.quintals) * Number(r.priceBirr)
                  )
              },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={ORDER_STATUS_TONE[String(r.status)] ?? 'neutral'}>{String(r.status).replace('_', ' ')}</Badge>
              },
              {
                key: 'actions',
                label: '',
                render: (r) => (
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button variant="ghost" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="px-2 py-1 text-xs">
                      {expandedId === r.id ? 'Hide' : 'Lines'}
                    </Button>
                    {(NEXT_STATUS[String(r.status)] ?? []).map((n) => (
                      <Button key={n.to} variant="secondary" onClick={() => moveStatus(r, n.to)} className="px-2 py-1 text-xs">
                        {n.label}
                      </Button>
                    ))}
                    {!['CANCELLED', 'DELIVERED', 'DISPATCHED'].includes(String(r.status)) && canApprove ? (
                      <Button variant="ghost" onClick={() => cancelOrder(r)} className="px-2 py-1 text-xs text-critical-text">
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                )
              }
            ]}
            rows={ordersQ.data ?? []}
            emptyTitle="No orders yet"
            emptySub="Create a customer order to begin."
          />
        )}
        {expandedOrder && expandedOrder.lines && expandedOrder.lines.length > 0 ? (
          <Card className="mt-3 p-5">
            <h3 className="mb-3 text-sm font-bold text-ink">
              Order {expandedOrder.orderNo} — lines
              <Button variant="ghost" onClick={() => setExpandedId(null)} className="float-right px-2 py-1 text-xs">
                Close
              </Button>
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-1">Product</th>
                  <th className="py-1">Pack</th>
                  <th className="py-1 text-right">Bags</th>
                  <th className="py-1 text-right">Quintals</th>
                  <th className="py-1 text-right">Price/q</th>
                  <th className="py-1 text-right">Line total</th>
                </tr>
              </thead>
              <tbody>
                {expandedOrder.lines.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="py-1">{l.product?.name ?? productNameBy.get(l.productId) ?? l.productId}</td>
                    <td className="py-1">{l.packagingSize?.label ?? packLabelBy.get(l.packagingSizeId ?? '') ?? 'Bulk'}</td>
                    <td className="tnum py-1 text-right">{l.bags}</td>
                    <td className="tnum py-1 text-right">{fmtQ(l.quintals)}</td>
                    <td className="tnum py-1 text-right">{fmtBirr(l.priceBirr)}</td>
                    <td className="tnum py-1 text-right font-bold">{fmtBirr(Number(l.quintals) * Number(l.priceBirr))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
      </div>

      {/* Dispatch wizard */}
      {wizardOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">Dispatch wizard — step {wizardStep} of 3</h3>
              <Button variant="ghost" onClick={() => setWizardOpen(false)} className="px-3">
                Cancel
              </Button>
            </div>

            {wizardStep === 1 ? (
              <div>
                <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Select loadable orders to consolidate into one dispatch.</p>
                <div className="space-y-2">
                  {openOrders.map((o) => (
                    <label
                      key={o.id}
                      className={`touch flex cursor-pointer items-center gap-3 rounded-lg border px-4 ${
                        pickedOrders.includes(o.id) ? 'border-harvest bg-harvest-light' : 'border-line'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={pickedOrders.includes(o.id)}
                        onChange={() => toggleOrder(o.id)}
                        className="h-6 w-6 accent-amber-600"
                      />
                      <span className="flex-1 text-sm">
                        <span className="tnum font-bold">{o.orderNo}</span> — {customerNameBy.get(o.customerId)} —{' '}
                        <span className="tnum">{fmtQ(o.quintals)} q</span>
                        <span className="ml-2">
                          <Badge tone={ORDER_STATUS_TONE[String(o.status)] ?? 'neutral'}>{String(o.status)}</Badge>
                        </span>
                      </span>
                    </label>
                  ))}
                  {openOrders.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">No loadable orders available.</p>
                  ) : null}
                </div>
                <Button onClick={() => setWizardStep(2)} disabled={pickedOrders.length === 0} className="mt-4 w-full">
                  Continue — vehicle & area
                </Button>
              </div>
            ) : null}

            {wizardStep === 2 ? (
              <div className="space-y-4">
                <Field label="Vehicle" required>
                  <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
                    <option value="">Select vehicle</option>
                    {(vehiclesQ.data ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plateNo} ({v.ownership})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Destination area" required hint="Same or nearby destination areas load together.">
                  <TextInput value={destinationArea} onChange={(e) => setDestinationArea(e.target.value)} placeholder="e.g. Addis Ababa — CMC" required />
                </Field>
                <div className="rounded-lg bg-advisory-bg px-4 py-3 text-sm font-medium text-advisory-text">
                  Trip rule: multiple stops within the same or nearby destination area on a single loaded
                  departure count and pay as one trip, regardless of stop count or quantity delivered.
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setWizardStep(1)} className="flex-1">
                    Back
                  </Button>
                  <Button onClick={() => setWizardStep(3)} className="flex-1">
                    Review
                  </Button>
                </div>
              </div>
            ) : null}

            {wizardStep === 3 ? (
              <div>
                <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Review the consolidated dispatch — enter the finished-goods batch number for each line.</p>
                <ul className="mb-4 space-y-2 text-sm">
                  {openOrders
                    .filter((o) => pickedOrders.includes(o.id))
                    .flatMap((o) => {
                      const srcLines =
                        o.lines && o.lines.length > 0
                          ? o.lines.map((l, i) => ({ key: `${o.id}:${i}`, label: `${productNameBy.get(l.productId) ?? l.productId} — ${fmtQ(l.quintals)} q` }))
                          : [{ key: `${o.id}:0`, label: `${fmtQ(o.quintals)} q` }];
                      return srcLines.map((sl) => (
                        <li key={sl.key} className="rounded-lg border border-line px-4 py-2">
                          <div className="flex justify-between">
                            <span>
                              <span className="tnum font-bold">{o.orderNo}</span> — {customerNameBy.get(o.customerId)}
                            </span>
                            <span className="text-slate-500 dark:text-slate-400">{sl.label}</span>
                          </div>
                          <div className="mt-2">
                            <Field label="FG batch number" required>
                              <TextInput
                                value={lineBatchNos[sl.key] ?? ''}
                                onChange={(e) => setLineBatchNos((p) => ({ ...p, [sl.key]: e.target.value }))}
                                placeholder="BATCH-2026-0001"
                              />
                            </Field>
                          </div>
                        </li>
                      ));
                    })}
                </ul>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Vehicle</dt>
                    <dd className="tnum font-semibold">{(vehiclesQ.data ?? []).find((v) => v.id === vehicleId)?.plateNo ?? '-'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Destination area</dt>
                    <dd className="font-semibold">{destinationArea}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Total load</dt>
                    <dd className="tnum font-bold">{fmtQ(pickedTotal)} q</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Trip count</dt>
                    <dd className="tnum font-bold">1 trip (fixed area rule)</dd>
                  </div>
                </dl>
                <div className="mt-4 flex gap-2">
                  <Button variant="secondary" onClick={() => setWizardStep(2)} className="flex-1">
                    Back
                  </Button>
                  <Button onClick={confirmDispatch} loading={saving} className="flex-1">
                    Confirm dispatch
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
