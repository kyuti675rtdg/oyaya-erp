import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Plus, Printer, Truck, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { WhDispatchDetail, WhDispatchList } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, Field, Select, TextArea, TextInput } from '../components/ui';
import {
  StatusBadge,
  WhLineEditor,
  WhListState,
  cardShell,
  docStatusTone,
  emptyWhLine,
  fmtDateTime,
  fmtQ,
  useLocations,
  useProducts,
  useWhPerms,
  type WhLine
} from './WhShared';

export function StockDispatch() {
  const { canManage } = useWhPerms();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [reference, setReference] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [driverName, setDriverName] = useState('');
  const [lines, setLines] = useState<WhLine[]>([emptyWhLine()]);
  const [reservationIds, setReservationIds] = useState('');
  const [printing, setPrinting] = useState(false);

  const productsQ = useProducts();
  const locationsQ = useLocations();

  const listQ = useQuery({
    queryKey: ['wh-dispatches', statusFilter],
    queryFn: async () =>
      (await api.get<WhDispatchList[]>(E.whDispatches + (statusFilter ? `?status=${statusFilter}` : ''))).data
  });

  const detailQ = useQuery({
    queryKey: ['wh-dispatch', selectedId],
    queryFn: async () => (await api.get<WhDispatchDetail>(E.whDispatch(selectedId!))).data,
    enabled: !!selectedId
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['wh-dispatches'] });
    qc.invalidateQueries({ queryKey: ['wh-dispatch'] });
    qc.invalidateQueries({ queryKey: ['wh-locations'] });
    qc.invalidateQueries({ queryKey: ['wh-reservations'] });
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const items = lines
        .filter((l) => l.productId && l.locationId && Number(l.quintals) > 0)
        .map((l) => ({
          productId: l.productId,
          batchNo: l.batchNo.trim() || null,
          locationId: l.locationId,
          quintals: Number(l.quintals),
          bags: l.bags === '' ? 0 : Number(l.bags)
        }));
      if (!items.length) throw new Error('Add at least one valid line (product + location + quantity).');
      return (
        await api.post(E.whDispatches, {
          reference: reference.trim() || null,
          vehiclePlate: vehiclePlate.trim() || null,
          driverName: driverName.trim() || null,
          items
        })
      ).data as WhDispatchDetail;
    },
    onSuccess: (doc) => {
      invalidate();
      setShowCreate(false);
      setReference('');
      setVehiclePlate('');
      setDriverName('');
      setLines([emptyWhLine()]);
      setSelectedId(doc.id);
    }
  });

  const pickMut = useMutation({
    mutationFn: async () =>
      (
        await api.post(E.whDispatchPick(selectedId!), {
          reservationIds: reservationIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        })
      ).data as WhDispatchDetail,
    onSuccess: () => {
      invalidate();
      setReservationIds('');
    }
  });

  const shipMut = useMutation({
    mutationFn: async () => (await api.post(E.whDispatchShip(selectedId!))).data as WhDispatchDetail,
    onSuccess: invalidate
  });

  const cancelMut = useMutation({
    mutationFn: async () => (await api.post(E.whDispatchCancel(selectedId!))).data as WhDispatchDetail,
    onSuccess: invalidate
  });

  const activeLocs = (locationsQ.data ?? []).filter((l) => l.isActive);
  const doc = detailQ.data;
  const totalQ = (doc?.items ?? []).reduce((s, i) => s + i.quintals, 0);

  const printNote = () => {
    setPrinting(true);
    setTimeout(() => window.print(), 50);
  };

  // ── Detail ───────────────────────────────────────────────────────
  if (selectedId) {
    return (
      <div className="space-y-5">
        {/* Screen content (hidden when printing) */}
        <div className="print:hidden">
          <button
            onClick={() => setSelectedId(null)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft size={15} /> Back to dispatches
          </button>
        </div>

        <div className={`${cardShell} print:hidden`}>
          {detailQ.isLoading && <WhListState isLoading isError={false} isEmpty={false} emptyTitle="" onRetry={() => {}} />}
          {detailQ.isError && <WhListState isLoading={false} isError isEmpty={false} emptyTitle="" onRetry={() => detailQ.refetch()} />}
          {doc && (
            <>
              <CardHeader
                icon={<Truck size={16} />}
                title={`Dispatch ${doc.docNo}`}
                subtitle={`Created ${fmtDateTime(doc.createdAt)}${doc.dispatchedAt ? ` · dispatched ${fmtDateTime(doc.dispatchedAt)}` : ''}`}
                action={<StatusBadge tone={docStatusTone(doc.status)} label={doc.status} />}
              />
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Sales order ref', value: doc.reference ?? '—' },
                  { label: 'Vehicle / plate', value: doc.vehiclePlate ?? '—' },
                  { label: 'Driver', value: doc.driverName ?? '—' },
                  { label: 'Total quantity', value: `${fmtQ(totalQ)} Qt` }
                ].map((k) => (
                  <div key={k.label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{k.label}</p>
                    <p className="mt-1 text-sm font-bold tabular-nums text-slate-800">{k.value}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3">Product</th>
                      <th className="py-2 pr-3">Batch</th>
                      <th className="py-2 pr-3">Location</th>
                      <th className="py-2 pr-3 text-right">Quintals</th>
                      <th className="py-2 text-right">Bags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.items.map((it) => (
                      <tr key={it.id} className="border-b border-slate-50">
                        <td className="py-2.5 pr-3 font-semibold text-slate-800">{it.productName}</td>
                        <td className="py-2.5 pr-3 text-slate-500">{it.batchNo ?? '—'}</td>
                        <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-slate-700">{it.locationCode}</td>
                        <td className="py-2.5 pr-3 text-right font-bold tabular-nums">{fmtQ(it.quintals)}</td>
                        <td className="py-2.5 text-right tabular-nums">{it.bags}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {doc.status === 'DRAFT' && canManage && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <Field label="Consume reservations on pick" hint="Comma-separated reservation record IDs (optional)">
                    <TextInput
                      value={reservationIds}
                      onChange={(e) => setReservationIds(e.target.value)}
                      placeholder="uuid-1, uuid-2…"
                      className="font-mono !text-xs"
                    />
                  </Field>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => cancelMut.mutate()}>
                      <XCircle size={15} /> Cancel
                    </Button>
                    <Button loading={pickMut.isPending} onClick={() => pickMut.mutate()}>
                      <CheckCircle2 size={15} /> Mark picked
                    </Button>
                  </div>
                </div>
              )}
              {doc.status === 'PICKED' && canManage && (
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => cancelMut.mutate()}>
                    Cancel
                  </Button>
                  <Button loading={shipMut.isPending} onClick={() => shipMut.mutate()}>
                    <Truck size={15} /> Dispatch & post stock
                  </Button>
                </div>
              )}
              {(doc.status === 'DISPATCHED' || doc.status === 'PICKED') && (
                <div className="mt-4 flex justify-end">
                  <Button variant="secondary" onClick={printNote}>
                    <Printer size={15} /> Print dispatch note
                  </Button>
                </div>
              )}
              {(pickMut.isError || shipMut.isError || cancelMut.isError) && (
                <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {((pickMut.error ?? shipMut.error ?? cancelMut.error) as Error)?.message ?? 'Action failed'}
                </p>
              )}
            </>
          )}
        </div>

        {/* Printable dispatch note */}
        {doc && printing && (
          <div className="hidden print:block">
            <div className="mx-auto max-w-2xl p-6 text-slate-900">
              <div className="border-b-2 border-slate-900 pb-4 text-center">
                <h1 className="text-xl font-bold">OYAYA FLOUR MILL — DISPATCH NOTE</h1>
                <p className="text-sm text-slate-600">Orbit Technology Solution PLC · Dispatch document {doc.docNo}</p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <p><b>Doc no:</b> {doc.docNo}</p>
                <p><b>Date:</b> {fmtDateTime(doc.dispatchedAt ?? doc.createdAt)}</p>
                <p><b>Sales order:</b> {doc.reference ?? '—'}</p>
                <p><b>Vehicle plate:</b> {doc.vehiclePlate ?? '—'}</p>
                <p><b>Driver:</b> {doc.driverName ?? '—'}</p>
                <p><b>Status:</b> {doc.status}</p>
              </div>
              <table className="mt-4 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-slate-300">
                    <th className="py-2 text-left">#</th>
                    <th className="py-2 text-left">Product</th>
                    <th className="py-2 text-left">Batch</th>
                    <th className="py-2 text-right">Qt</th>
                    <th className="py-2 text-right">Bags</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.items.map((it, i) => (
                    <tr key={it.id} className="border-b border-slate-200">
                      <td className="py-2">{i + 1}</td>
                      <td className="py-2">{it.productName}</td>
                      <td className="py-2">{it.batchNo ?? '—'}</td>
                      <td className="py-2 text-right">{fmtQ(it.quintals)}</td>
                      <td className="py-2 text-right">{it.bags}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td className="py-2" colSpan={3}>Total</td>
                    <td className="py-2 text-right">{fmtQ(totalQ)}</td>
                    <td className="py-2 text-right">{doc.items.reduce((s, i) => s + i.bags, 0)}</td>
                  </tr>
                </tfoot>
              </table>
              <div className="mt-10 grid grid-cols-3 gap-6 text-center text-sm">
                {['Store keeper', 'Driver', 'Security'].map((r) => (
                  <div key={r}>
                    <div className="border-b border-slate-400 pb-8" />
                    <p className="mt-1 font-semibold">{r}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {printing && (
          <div className="print:hidden text-center">
            <Button variant="secondary" onClick={() => setPrinting(false)}>
              Close print preview
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── List + create ────────────────────────────────────────────────
  return (
    <div className="space-y-5 print:hidden">
      <div className={cardShell}>
        <CardHeader
          icon={<Truck size={16} />}
          title="Stock Issuance & Dispatch"
          subtitle="Pick from locations, load the vehicle, dispatch and post stock out"
          action={
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-auto !py-2 !text-sm">
                <option value="">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="PICKED">Picked</option>
                <option value="DISPATCHED">Dispatched</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
              {canManage && (
                <Button className="!px-4 !py-2 !text-sm" onClick={() => setShowCreate((v) => !v)}>
                  <Plus size={15} /> New dispatch
                </Button>
              )}
            </div>
          }
        />

        {showCreate && canManage && (
          <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Sales order reference">
                <TextInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="SO-2026-…" />
              </Field>
              <Field label="Vehicle plate">
                <TextInput value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} placeholder="AA-3-…" />
              </Field>
              <Field label="Driver name">
                <TextInput value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Driver name" />
              </Field>
            </div>
            <WhLineEditor
              lines={lines}
              setLines={setLines}
              products={productsQ.data ?? []}
              locations={activeLocs}
              opts={{ showLocation: true }}
            />
            {createMut.isError && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {(createMut.error as Error)?.message ?? 'Create failed'}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button loading={createMut.isPending} onClick={() => createMut.mutate()}>
                Create dispatch
              </Button>
            </div>
          </div>
        )}

        <WhListState
          isLoading={listQ.isLoading}
          isError={listQ.isError}
          isEmpty={!listQ.isLoading && !listQ.isError && (listQ.data ?? []).length === 0}
          emptyTitle="No dispatches yet"
          emptySub="Create a dispatch to issue stock against a sales order."
          onRetry={() => listQ.refetch()}
        />

        {(listQ.data ?? []).length > 0 && (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Doc no</th>
                    <th className="py-2 pr-3">Sales order</th>
                    <th className="py-2 pr-3">Vehicle / Driver</th>
                    <th className="py-2 pr-3 text-right">Total (Qt)</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQ.data ?? []).map((d) => (
                    <tr key={d.id} onClick={() => setSelectedId(d.id)} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="py-2.5 pr-3 font-mono text-xs font-bold text-violet-700">{d.docNo}</td>
                      <td className="py-2.5 pr-3 text-slate-600">{d.reference ?? '—'}</td>
                      <td className="py-2.5 pr-3 text-slate-600">
                        {d.vehiclePlate ?? '—'}
                        {d.driverName ? ` · ${d.driverName}` : ''}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-bold tabular-nums">{fmtQ(d.totalQ)}</td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge tone={docStatusTone(d.status)} label={d.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {(listQ.data ?? []).map((d) => (
                <button key={d.id} onClick={() => setSelectedId(d.id)} className="w-full rounded-xl border border-slate-200 p-4 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs font-bold text-violet-700">{d.docNo}</p>
                      <p className="text-xs text-slate-500">
                        {d.reference ?? 'No order ref'}
                        {d.vehiclePlate ? ` · ${d.vehiclePlate}` : ''}
                      </p>
                    </div>
                    <StatusBadge tone={docStatusTone(d.status)} label={d.status} />
                  </div>
                  <p className="mt-2 text-sm tabular-nums text-slate-600">
                    <span className="font-bold text-slate-800">{fmtQ(d.totalQ)} Qt</span>
                  </p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
