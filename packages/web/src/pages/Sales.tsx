import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { Customer, Dispatch, Product, ReconReport, SalesOrder, Vehicle } from '../types';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner, TextInput } from '../components/ui';
import { fmtBirr, fmtDate, fmtQ } from '../lib/format';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const ORDER_STATUS_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  OPEN: 'advisory',
  LOADED: 'pass',
  INVOICED: 'pass',
  CLOSED: 'neutral'
};

export function Sales() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Order form
  const [customerId, setCustomerId] = useState('');
  const [productId, setProductId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(todayISO());
  const [orderQ, setOrderQ] = useState('');
  const [unitPrice, setUnitPrice] = useState('');

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

  const customerNameBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customersQ.data ?? []) m.set(c.id, c.name);
    return m;
  }, [customersQ.data]);

  const openOrders = useMemo(
    () => (ordersQ.data ?? []).filter((o) => o.status === 'OPEN'),
    [ordersQ.data]
  );
  const pickedTotal = useMemo(
    () =>
      openOrders.filter((o) => pickedOrders.includes(o.id)).reduce((s, o) => s + Number(o.quintals), 0),
    [openOrders, pickedOrders]
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ['sales-orders'] });

  const createOrder = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      const q = Number(orderQ);
      const p = Number(unitPrice);
      if (!customerId || !productId || !Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p <= 0) {
        setNotice({ ok: false, text: 'Customer, product, positive quantity and a positive price are required.' });
        return;
      }
      const r = await submitOrQueue('sales-order', E.salesOrders, {
        customerId,
        productId,
        quintals: q,
        priceBirr: p,
        requestedDate: new Date(`${deliveryDate}T00:00:00`).toISOString(),
        orderDate: new Date().toISOString()
      });
      setNotice({
        ok: true,
        text: r.queued ? 'Order saved offline — will sync automatically.' : 'Customer order created.'
      });
      setOrderQ('');
      setUnitPrice('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create order.' });
    } finally {
      setSaving(false);
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
    const lines = [];
    for (const o of picked) {
      const batchNo = (lineBatchNos[o.id] ?? '').trim();
      if (!batchNo) {
        setNotice({ ok: false, text: `Enter the finished-goods batch number for order ${o.orderNo}.` });
        return;
      }
      lines.push({ orderId: o.id, productId: o.productId, batchNo, quintals: Number(o.quintals) });
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
      <SectionTitle
        title="Sales & Distribution"
        sub="Orders, advances, consolidated dispatch and revenue reconciliation"
      />

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
        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">New customer order</h3>
          <form onSubmit={createOrder} className="space-y-4">
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
            <Field label="Product" required>
              <Select value={productId} onChange={(e) => setProductId(e.target.value)} required>
                <option value="">Select product</option>
                {(productsQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Requested delivery date" required>
              <TextInput type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity (q)" required>
                <NumberInput value={orderQ} onChange={(e) => setOrderQ(e.target.value)} min={0} step="0.1" placeholder="0.0" />
              </Field>
              <Field label="Unit price (ETB/q)" required hint="Customer-specific price">
                <NumberInput value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} min={0} step="0.01" placeholder="0.00" />
              </Field>
            </div>
            <Button type="submit" loading={saving} className="w-full">
              Create order
            </Button>
          </form>
        </Card>

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
          <p className="mb-3 text-sm text-slate-500">
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
                <span className="text-slate-500">Invoiced sales</span>
                <span className="tnum font-bold text-ink">{fmtBirr(recon.totals.invoiced)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Cash received</span>
                <span className="tnum font-bold text-ink">{fmtBirr(recon.totals.received)}</span>
              </div>
              <div className="flex justify-between border-t border-line pt-2 text-sm">
                <span className="font-semibold text-slate-700">Unreconciled gap</span>
                <span className={`tnum font-bold ${recon.totals.gap !== 0 ? 'text-critical-text' : 'text-pass-text'}`}>
                  {fmtBirr(recon.totals.gap)}
                </span>
              </div>
              {recon.totals.gap !== 0 ? (
                <Badge tone="critical">Unreconciled gap flagged</Badge>
              ) : (
                <Badge tone="pass">Fully reconciled</Badge>
              )}
              {recon.rows.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-slate-500">
                  {recon.rows.map((l) => (
                    <li key={l.customerId} className="flex justify-between">
                      <span>{l.customerName}</span>
                      <span className="tnum">
                        {fmtBirr(l.invoiced)} / {fmtBirr(l.received)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No reconciliation data.</p>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <SectionTitle title="Customer orders" />
        {ordersQ.isLoading ? (
          <Spinner label="Loading orders..." />
        ) : (
          <DataTable<SalesOrder>
            columns={[
              { key: 'orderNo', label: 'Order', render: (r) => <span className="tnum font-bold">{r.orderNo}</span> },
              { key: 'customer', label: 'Customer', render: (r) => customerNameBy.get(r.customerId) ?? r.customerId },
              { key: 'requestedDate', label: 'Delivery', render: (r) => (r.requestedDate ? fmtDate(r.requestedDate) : '-') },
              { key: 'quintals', label: 'Qty (q)', mono: true, render: (r) => fmtQ(r.quintals) },
              { key: 'priceBirr', label: 'Unit price', mono: true, render: (r) => fmtBirr(r.priceBirr) },
              {
                key: 'total',
                label: 'Total',
                mono: true,
                render: (r) => fmtBirr(Number(r.quintals) * Number(r.priceBirr))
              },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={ORDER_STATUS_TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge>
              }
            ]}
            rows={ordersQ.data ?? []}
            emptyTitle="No orders yet"
            emptySub="Create a customer order to begin."
          />
        )}
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
                <p className="mb-3 text-sm text-slate-500">Select open orders to consolidate into one load.</p>
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
                      </span>
                    </label>
                  ))}
                  {openOrders.length === 0 ? (
                    <p className="text-sm text-slate-500">No open orders available.</p>
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
                <p className="mb-3 text-sm text-slate-500">Review the consolidated load — enter the finished-goods batch number for each line.</p>
                <ul className="mb-4 space-y-2 text-sm">
                  {openOrders
                    .filter((o) => pickedOrders.includes(o.id))
                    .map((o) => (
                      <li key={o.id} className="rounded-lg border border-line px-4 py-2">
                        <div className="flex justify-between">
                          <span>
                            <span className="tnum font-bold">{o.orderNo}</span> — {customerNameBy.get(o.customerId)}
                          </span>
                          <span className="tnum font-semibold">{fmtQ(o.quintals)} q</span>
                        </div>
                        <div className="mt-2">
                          <Field label="FG batch number" required>
                            <TextInput
                              value={lineBatchNos[o.id] ?? ''}
                              onChange={(e) => setLineBatchNos((p) => ({ ...p, [o.id]: e.target.value }))}
                              placeholder="BATCH-2026-0001"
                            />
                          </Field>
                        </div>
                      </li>
                    ))}
                </ul>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Vehicle</dt>
                    <dd className="tnum font-semibold">{(vehiclesQ.data ?? []).find((v) => v.id === vehicleId)?.plateNo ?? '-'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Destination area</dt>
                    <dd className="font-semibold">{destinationArea}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Total load</dt>
                    <dd className="tnum font-bold">{fmtQ(pickedTotal)} q</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Trip count</dt>
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
