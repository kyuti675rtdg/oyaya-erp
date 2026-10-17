import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Plus, Trash2, Truck } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { SalesOrder, TruckLoad, Vehicle } from '../types';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner, TextInput } from '../components/ui';
import { fmtQ } from '../lib/format';

const LOAD_TONE: Record<string, BadgeTone> = {
  BUILDING: 'advisory',
  READY: 'pass',
  LOADED: 'pass',
  DISPATCHED: 'neutral',
  CANCELLED: 'critical'
};

function utilization(load: TruckLoad): { q: number; pct: number } {
  const q = (load.items ?? []).reduce((s, i) => s + Number(i.quintals), 0);
  const cap = Number(load.capacityQuintals) || 1;
  return { q, pct: Math.round((q / cap) * 100) };
}

export function LoadConsolidation() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [vehicleId, setVehicleId] = useState('');
  const [route, setRoute] = useState('');
  const [capacity, setCapacity] = useState('300');
  const [notes, setNotes] = useState('');
  const [addOrderByLoad, setAddOrderByLoad] = useState<Record<string, string>>({});

  const loadsQ = useQuery({
    queryKey: ['truck-loads'],
    queryFn: async () => (await api.get<TruckLoad[]>(E.truckLoads)).data
  });
  const vehiclesQ = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => (await api.get<Vehicle[]>(E.vehicles)).data
  });
  const ordersQ = useQuery({
    queryKey: ['sales-orders'],
    queryFn: async () => (await api.get<SalesOrder[]>(E.salesOrders)).data
  });

  const loadableOrders = useMemo(
    () => (ordersQ.data ?? []).filter((o) => ['OPEN', 'CONFIRMED', 'PROCESSING', 'LOADING'].includes(String(o.status))),
    [ordersQ.data]
  );
  const orderById = useMemo(() => {
    const m = new Map<string, SalesOrder>();
    for (const o of ordersQ.data ?? []) m.set(o.id, o);
    return m;
  }, [ordersQ.data]);

  const expandedLoad = (loadsQ.data ?? []).find((l) => l.id === expandedId) ?? null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['truck-loads'] });
    qc.invalidateQueries({ queryKey: ['sales-orders'] });
  };

  const createLoad = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!route.trim()) {
      setNotice({ ok: false, text: 'Route is required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.truckLoads, {
        vehicleId: vehicleId || undefined,
        route: route.trim(),
        capacityQuintals: Number(capacity) || 300,
        notes: notes.trim() || undefined
      });
      setNotice({ ok: true, text: 'Truck load created — add orders to consolidate.' });
      setVehicleId('');
      setRoute('');
      setNotes('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create load.' });
    } finally {
      setSaving(false);
    }
  };

  const addOrder = async (loadId: string) => {
    const orderId = addOrderByLoad[loadId];
    if (!orderId) {
      setNotice({ ok: false, text: 'Select an order to add.' });
      return;
    }
    setNotice(null);
    try {
      await api.post(E.truckLoadItems(loadId), { orderId });
      setNotice({ ok: true, text: 'Order added to load.' });
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to add order.' });
    }
  };

  const removeItem = async (itemId: string) => {
    try {
      await api.delete(E.truckLoadItemRemove(itemId));
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to remove item.' });
    }
  };

  const finalize = async (loadId: string) => {
    try {
      await api.post(E.truckLoadFinalize(loadId));
      setNotice({ ok: true, text: 'Load finalized and ready for dispatch.' });
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to finalize load.' });
    }
  };

  return (
    <div>
      <SectionTitle title="Truck Load Consolidation" sub="Group customer orders into truck loads by route and capacity" />

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

      <Card className="p-5">
        <CardHeader icon={<Truck className="h-4 w-4" />} title="New truck load" subtitle="One load = one truck on one route" />
        <form onSubmit={createLoad} className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <Field label="Vehicle">
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Select vehicle</option>
              {(vehiclesQ.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNo} ({v.ownership})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Route / destination area" required>
            <TextInput value={route} onChange={(e) => setRoute(e.target.value)} placeholder="e.g. Hawassa corridor" required />
          </Field>
          <Field label="Capacity (q)">
            <NumberInput value={capacity} onChange={(e) => setCapacity(e.target.value)} min={0} step="1" />
          </Field>
          <Field label="Notes">
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={saving} className="w-full">
              <Plus className="mr-1 h-4 w-4" /> Create load
            </Button>
          </div>
        </form>
      </Card>

      <div className="mt-6">
        <SectionTitle title="Loads" />
        {loadsQ.isLoading ? (
          <Spinner label="Loading truck loads..." />
        ) : (
          <DataTable<TruckLoad>
            columns={[
              { key: 'loadNo', label: 'Load', render: (r) => <span className="tnum font-bold">{r.loadNo}</span> },
              { key: 'route', label: 'Route', render: (r) => r.route },
              { key: 'vehicle', label: 'Vehicle', render: (r) => r.vehicle?.plateNo ?? '—' },
              { key: 'orders', label: 'Orders', mono: true, render: (r) => String(r.items?.length ?? 0) },
              {
                key: 'util',
                label: 'Utilization',
                render: (r) => {
                  const u = utilization(r);
                  return (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-20 overflow-hidden rounded-full bg-slate-100">
                        <span
                          className={`block h-full rounded-full ${u.pct > 100 ? 'bg-critical-text' : u.pct >= 80 ? 'bg-pass-text' : 'bg-advisory-text'}`}
                          style={{ width: `${Math.min(100, u.pct)}%` }}
                        />
                      </span>
                      <span className="tnum text-xs font-bold">
                        {u.pct}% · {fmtQ(u.q)} q
                      </span>
                    </span>
                  );
                }
              },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={LOAD_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
              },
              {
                key: 'actions',
                label: '',
                render: (r) => (
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="px-2 py-1 text-xs">
                      {expandedId === r.id ? 'Hide' : 'Manage'}
                    </Button>
                    {r.status === 'BUILDING' ? (
                      <Button variant="secondary" onClick={() => finalize(r.id)} className="px-2 py-1 text-xs">
                        Finalize
                      </Button>
                    ) : null}
                  </div>
                )
              }
            ]}
            rows={loadsQ.data ?? []}
            emptyTitle="No truck loads"
            emptySub="Create a load and consolidate orders by route."
          />
        )}
        {expandedLoad ? (
          <Card className="mt-3 p-5">
            <CardHeader
              icon={<Layers className="h-4 w-4" />}
              title={`${expandedLoad.loadNo} — orders`}
              subtitle={`${expandedLoad.route} · utilization ${utilization(expandedLoad).pct}%`}
              action={
                <Button variant="ghost" onClick={() => setExpandedId(null)} className="px-2 py-1 text-xs">
                  Close
                </Button>
              }
            />
            {expandedLoad.status === 'BUILDING' ? (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Select
                  value={addOrderByLoad[expandedLoad.id] ?? ''}
                  onChange={(e) => setAddOrderByLoad((p) => ({ ...p, [expandedLoad.id]: e.target.value }))}
                  className="!w-64"
                >
                  <option value="">Select order to add</option>
                  {loadableOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.orderNo} — {o.customer?.name ?? o.customerId} — {fmtQ(o.quintals)} q
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" onClick={() => addOrder(expandedLoad.id)} className="text-xs">
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add order
                </Button>
              </div>
            ) : null}
            {(expandedLoad.items ?? []).length > 0 ? (
              <ul className="space-y-1">
                {(expandedLoad.items ?? []).map((it) => {
                  const o = orderById.get(it.orderId);
                  return (
                    <li key={it.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>
                        <span className="tnum font-bold">{o?.orderNo ?? it.orderId}</span>
                        <span className="ml-2 text-slate-500">{o?.customer?.name ?? ''}</span>
                        <span className="tnum ml-2 font-semibold">{fmtQ(it.quintals)} q</span>
                        {it.bags > 0 ? <span className="tnum ml-1 text-xs text-slate-500">({it.bags} bags)</span> : null}
                      </span>
                      {expandedLoad.status === 'BUILDING' ? (
                        <button onClick={() => removeItem(it.id)} className="text-critical-text" aria-label="Remove">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Layers className="h-4 w-4" /> No orders in this load yet.
              </p>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
