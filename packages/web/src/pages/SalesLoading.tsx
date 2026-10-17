import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Forklift, PackageCheck } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { Dispatch, PackagingSize, SalesOrder, TruckLoad, Vehicle } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner, TextInput } from '../components/ui';
import { fmtQ } from '../lib/format';

const LOADABLE = ['OPEN', 'CONFIRMED', 'PROCESSING', 'LOADING'];

const CHECKLIST = [
  'Truck inspected — clean bed, no contamination risk',
  'Bag counts verified against each order line',
  'Finished-goods batch numbers match warehouse stock',
  'Weighbridge ticket captured for the loaded truck',
  'Driver identity and delivery documents checked',
  'Security seals available for gate exit'
];

interface DraftLine {
  key: string;
  orderId: string;
  orderNo: string;
  productId: string;
  productName: string;
  packagingSizeId: string | null;
  packLabel: string;
  bags: number;
  quintals: number;
  batchNo: string;
}

export function SalesLoading() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [picked, setPicked] = useState<string[]>([]);
  const [loadId, setLoadId] = useState('');
  const [newLoad, setNewLoad] = useState(false);
  const [route, setRoute] = useState('');
  const [capacity, setCapacity] = useState('300');
  const [vehicleId, setVehicleId] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST.map(() => false));

  const ordersQ = useQuery({
    queryKey: ['sales-orders'],
    queryFn: async () => (await api.get<SalesOrder[]>(E.salesOrders)).data
  });
  const loadsQ = useQuery({
    queryKey: ['truck-loads'],
    queryFn: async () => (await api.get<TruckLoad[]>(E.truckLoads)).data
  });
  const vehiclesQ = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => (await api.get<Vehicle[]>(E.vehicles)).data
  });
  const packsQ = useQuery({
    queryKey: ['packaging-sizes'],
    queryFn: async () => (await api.get<PackagingSize[]>(E.packagingSizes)).data
  });

  const loadableOrders = useMemo(
    () => (ordersQ.data ?? []).filter((o) => LOADABLE.includes(String(o.status))),
    [ordersQ.data]
  );
  const buildingLoads = useMemo(
    () => (loadsQ.data ?? []).filter((l) => l.status === 'BUILDING'),
    [loadsQ.data]
  );

  const packKgBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of packsQ.data ?? []) m.set(p.id, Number(p.kg));
    return m;
  }, [packsQ.data]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  /** Build the editable loading lines (bag counts) from picked orders. */
  const buildLines = () => {
    const orders = loadableOrders.filter((o) => picked.includes(o.id));
    const lines: DraftLine[] = [];
    for (const o of orders) {
      if (o.lines && o.lines.length > 0) {
        for (const l of o.lines) {
          lines.push({
            key: `${o.id}:${l.id}`,
            orderId: o.id,
            orderNo: o.orderNo,
            productId: l.productId,
            productName: l.product?.name ?? l.productId,
            packagingSizeId: l.packagingSizeId ?? l.packagingSize?.id ?? null,
            packLabel: l.packagingSize?.label ?? 'Bulk',
            bags: l.bags,
            quintals: Number(l.quintals),
            batchNo: ''
          });
        }
      } else {
        lines.push({
          key: `${o.id}:legacy`,
          orderId: o.id,
          orderNo: o.orderNo,
          productId: o.productId,
          productName: o.productId,
          packagingSizeId: null,
          packLabel: 'Bulk',
          bags: 0,
          quintals: Number(o.quintals),
          batchNo: ''
        });
      }
    }
    setDraftLines(lines);
    setChecks(CHECKLIST.map(() => false));
  };

  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setDraftLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const totalBags = draftLines.reduce((s, l) => s + l.bags, 0);
  const totalQ = draftLines.reduce((s, l) => s + l.quintals, 0);
  const allChecked = checks.every(Boolean);

  const confirmLoading = async () => {
    setNotice(null);
    if (picked.length === 0) {
      setNotice({ ok: false, text: 'Select at least one order to load.' });
      return;
    }
    if (draftLines.some((l) => !l.batchNo.trim())) {
      setNotice({ ok: false, text: 'Enter the finished-goods batch number for every line.' });
      return;
    }
    if (!allChecked) {
      setNotice({ ok: false, text: 'Complete the loading checklist before confirming.' });
      return;
    }
    const chosenVehicle = vehicleId || (loadId ? (loadsQ.data ?? []).find((l) => l.id === loadId)?.vehicleId : '') || '';
    const chosenRoute = newLoad ? route.trim() : (loadsQ.data ?? []).find((l) => l.id === loadId)?.route ?? '';
    if (!chosenVehicle || !chosenRoute) {
      setNotice({ ok: false, text: 'A vehicle and a route are required.' });
      return;
    }
    setSaving(true);
    try {
      let targetLoadId = loadId;
      if (newLoad || !loadId) {
        const r = await api.post<TruckLoad>(E.truckLoads, {
          vehicleId: chosenVehicle,
          route: chosenRoute,
          capacityQuintals: Number(capacity) || 300
        });
        targetLoadId = r.data.id;
        // Attach orders to the load plan
        for (const oid of picked) {
          await api.post(E.truckLoadItems(targetLoadId), { orderId: oid });
        }
      }
      const r = await api.post<Dispatch>(E.dispatches, {
        vehicleId: chosenVehicle,
        area: chosenRoute,
        orderIds: picked,
        lines: draftLines.map((l) => ({
          orderId: l.orderId,
          productId: l.productId,
          packagingSizeId: l.packagingSizeId,
          batchNo: l.batchNo.trim(),
          bags: l.bags,
          quintals: l.quintals
        })),
        departureDate: new Date().toISOString()
      });
      if (targetLoadId) {
        await api.post(E.truckLoadFinalize(targetLoadId)).catch(() => null);
      }
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['truck-loads'] });
      navigate(`/sales/dispatches/${r.data.id}`);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to confirm loading.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle title="Order Processing & Loading" sub="Pick orders, assign to a truck load, verify bag counts and run the loading checklist" />

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
          <CardHeader icon={<PackageCheck className="h-4 w-4" />} title="1 — Pick loadable orders" subtitle="CONFIRMED, PROCESSING or LOADING orders" />
          {ordersQ.isLoading ? (
            <Spinner label="Loading orders..." />
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {loadableOrders.map((o) => (
                <label
                  key={o.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 ${
                    picked.includes(o.id) ? 'border-harvest bg-harvest-light' : 'border-line'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={picked.includes(o.id)}
                    onChange={() => toggle(o.id)}
                    className="h-5 w-5 accent-amber-600"
                  />
                  <span className="flex-1 text-sm">
                    <span className="tnum font-bold">{o.orderNo}</span> — {o.customer?.name ?? o.customerId}
                    <span className="ml-2">
                      <Badge tone="neutral">{String(o.status)}</Badge>
                    </span>
                    <span className="tnum ml-2 text-slate-500 dark:text-slate-400">
                      {o.lines && o.lines.length > 0 ? `${o.lines.reduce((s, l) => s + l.bags, 0)} bags` : ''} · {fmtQ(o.quintals)} q
                    </span>
                  </span>
                </label>
              ))}
              {loadableOrders.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No loadable orders.</p> : null}
            </div>
          )}
          <Button onClick={buildLines} disabled={picked.length === 0} className="mt-4 w-full">
            Build loading sheet ({picked.length} order{picked.length === 1 ? '' : 's'})
          </Button>
        </Card>

        <Card className="p-5">
          <CardHeader icon={<Forklift className="h-4 w-4" />} title="2 — Assign to truck load" subtitle="New load or an existing BUILDING load" />
          <div className="space-y-4">
            <Field label="Load plan">
              <Select
                value={newLoad ? '__new__' : loadId}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setNewLoad(true);
                    setLoadId('');
                  } else {
                    setNewLoad(false);
                    setLoadId(e.target.value);
                  }
                }}
              >
                <option value="__new__">New load</option>
                {buildingLoads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.loadNo} — {l.route} ({l.items?.length ?? 0} orders)
                  </option>
                ))}
              </Select>
            </Field>
            {newLoad || !loadId ? (
              <>
                <Field label="Vehicle" required>
                  <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">Select vehicle</option>
                    {(vehiclesQ.data ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plateNo} ({v.ownership})
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Route / destination area" required>
                    <TextInput value={route} onChange={(e) => setRoute(e.target.value)} placeholder="e.g. Addis Ababa — CMC" />
                  </Field>
                  <Field label="Capacity (q)">
                    <NumberInput value={capacity} onChange={(e) => setCapacity(e.target.value)} min={0} step="1" />
                  </Field>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Orders will be added to the existing load plan. Vehicle and route come from the load.
              </p>
            )}
          </div>
        </Card>
      </div>

      {draftLines.length > 0 ? (
        <Card className="mt-4 p-5">
          <CardHeader
            icon={<ClipboardCheck className="h-4 w-4" />}
            title="3 — Bag counts & loading checklist"
            subtitle={`${draftLines.length} line(s) · ${totalBags} bags · ${fmtQ(totalQ)} q`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-2">Order</th>
                  <th className="py-2">Product</th>
                  <th className="py-2">Pack</th>
                  <th className="py-2 text-right">Bags</th>
                  <th className="py-2 text-right">Quintals</th>
                  <th className="py-2">FG batch number</th>
                </tr>
              </thead>
              <tbody>
                {draftLines.map((l) => (
                  <tr key={l.key} className="border-t border-line">
                    <td className="tnum py-2 font-semibold">{l.orderNo}</td>
                    <td className="py-2">{l.productName}</td>
                    <td className="py-2">{l.packLabel}</td>
                    <td className="py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        value={l.bags}
                        onChange={(e) => {
                          const bags = Math.max(0, Math.round(Number(e.target.value) || 0));
                          const kg = l.packagingSizeId ? (packKgBy.get(l.packagingSizeId) ?? 0) : 0;
                          setLine(l.key, { bags, quintals: kg > 0 ? (bags * kg) / 100 : l.quintals });
                        }}
                        className="tnum w-24 rounded-lg border border-line px-2 py-1 text-right"
                      />
                    </td>
                    <td className="tnum py-2 text-right font-semibold">{fmtQ(l.quintals)}</td>
                    <td className="py-2">
                      <TextInput value={l.batchNo} onChange={(e) => setLine(l.key, { batchNo: e.target.value })} placeholder="BATCH-2026-0001" className="!py-1" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 className="mb-2 mt-5 text-sm font-bold text-ink">Loading checklist</h4>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {CHECKLIST.map((c, i) => (
              <label
                key={i}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-2.5 text-sm ${
                  checks[i] ? 'border-pass-text/40 bg-pass-bg' : 'border-line'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checks[i]}
                  onChange={() => setChecks((p) => p.map((v, j) => (j === i ? !v : v)))}
                  className="h-5 w-5 accent-emerald-600"
                />
                {c}
              </label>
            ))}
          </div>

          <Button onClick={confirmLoading} loading={saving} disabled={!allChecked} className="mt-5 w-full">
            Confirm loading & dispatch — {fmtQ(totalQ)} q
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
