import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Clock3, Plus, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { WhReservation } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, ErrorBox, Field, NumberInput, Select, TextInput } from '../components/ui';
import {
  StatusBadge,
  WhListState,
  cardShell,
  docStatusTone,
  fmtDate,
  fmtQ,
  useLocations,
  useProducts,
  useWhPerms
} from './WhShared';

export function StockReservation() {
  const { canManage } = useWhPerms();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [showCreate, setShowCreate] = useState(false);
  const [reference, setReference] = useState('');
  const [productId, setProductId] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quintals, setQuintals] = useState('');
  const [bags, setBags] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const productsQ = useProducts();
  const locationsQ = useLocations();

  const listQ = useQuery({
    queryKey: ['wh-reservations', statusFilter],
    queryFn: async () =>
      (await api.get<WhReservation[]>(E.reservations + (statusFilter ? `?status=${statusFilter}` : ''))).data,
    refetchInterval: 120000
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['wh-reservations'] });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!productId || !locationId || !(Number(quintals) > 0)) {
        throw new Error('Product, location and a positive quantity are required.');
      }
      return (
        await api.post(E.reservations, {
          reference: reference.trim() || null,
          productId,
          batchNo: batchNo.trim() || null,
          locationId,
          quintals: Number(quintals),
          bags: bags === '' ? 0 : Number(bags),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
        })
      ).data;
    },
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setReference('');
      setProductId('');
      setBatchNo('');
      setLocationId('');
      setQuintals('');
      setBags('');
      setExpiresAt('');
    }
  });

  const rowMut = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'release' | 'consume' }) =>
      (await api.post(action === 'release' ? E.reservationRelease(id) : E.reservationConsume(id))).data,
    onSuccess: invalidate
  });

  const sweepMut = useMutation({
    mutationFn: async () => (await api.post(E.reservationExpireSweep)).data as { expired: number },
    onSuccess: invalidate
  });

  const now = useMemo(() => Date.now(), []);
  const activeLocs = (locationsQ.data ?? []).filter((l) => l.isActive);

  const isExpiringSoon = (r: WhReservation) => {
    if (r.status !== 'ACTIVE' || !r.expiresAt) return false;
    const ms = new Date(r.expiresAt).getTime() - now;
    return ms > 0 && ms < 3 * 24 * 3600 * 1000;
  };

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<BookmarkPlus size={16} />}
          title="Stock Reservations"
          subtitle="Hold stock for sales orders or production — reservations reduce available quantity"
          action={
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-auto !py-2 !text-sm">
                <option value="ACTIVE">Active</option>
                <option value="">All</option>
                <option value="RELEASED">Released</option>
                <option value="EXPIRED">Expired</option>
                <option value="CONSUMED">Consumed</option>
              </Select>
              {canManage && (
                <>
                  <Button
                    variant="secondary"
                    className="!px-4 !py-2 !text-sm"
                    loading={sweepMut.isPending}
                    onClick={() => sweepMut.mutate()}
                    title="Mark overdue active reservations as expired"
                  >
                    <Clock3 size={15} /> Expire overdue
                  </Button>
                  <Button className="!px-4 !py-2 !text-sm" onClick={() => setShowCreate((v) => !v)}>
                    <Plus size={15} /> New reservation
                  </Button>
                </>
              )}
            </div>
          }
        />

        {sweepMut.data && (
          <p className="mb-4 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
            Expiry sweep: {sweepMut.data.expired} reservation(s) marked expired.
          </p>
        )}

        {showCreate && canManage && (
          <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Reference" hint="Sales order / production order no">
                <TextInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="SO-2026-…" />
              </Field>
              <Field label="Product" required>
                <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Select…</option>
                  {(productsQ.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Batch no">
                <TextInput value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Location" required>
                <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Select…</option>
                  {activeLocs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quintals" required>
                <NumberInput value={quintals} min="0" step="0.01" onChange={(e) => setQuintals(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Bags">
                <NumberInput value={bags} min="0" step="1" onChange={(e) => setBags(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Expires at" hint="Empty = no expiry">
                <TextInput type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </Field>
            </div>
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
                Reserve stock
              </Button>
            </div>
          </div>
        )}

        <WhListState
          isLoading={listQ.isLoading}
          isError={listQ.isError}
          isEmpty={!listQ.isLoading && !listQ.isError && (listQ.data ?? []).length === 0}
          emptyTitle={statusFilter === 'ACTIVE' ? 'No active reservations' : 'No reservations found'}
          emptySub="Reserve stock to hold it for a sales order or production run."
          onRetry={() => listQ.refetch()}
        />

        {(listQ.data ?? []).length > 0 && (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Ref no</th>
                    <th className="py-2 pr-3">Reference</th>
                    <th className="py-2 pr-3">Product</th>
                    <th className="py-2 pr-3">Location</th>
                    <th className="py-2 pr-3 text-right">Qty (Qt)</th>
                    <th className="py-2 pr-3">Expires</th>
                    <th className="py-2 pr-3">Status</th>
                    {canManage && <th className="py-2 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {(listQ.data ?? []).map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="py-2.5 pr-3 font-mono text-xs font-bold text-violet-700">{r.refNo}</td>
                      <td className="py-2.5 pr-3 text-slate-600">{r.reference ?? '—'}</td>
                      <td className="py-2.5 pr-3">
                        <span className="font-semibold text-slate-800">{r.productName}</span>
                        {r.batchNo && <span className="text-xs text-slate-500"> · {r.batchNo}</span>}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-slate-700">{r.locationCode}</td>
                      <td className="py-2.5 pr-3 text-right font-bold tabular-nums">{fmtQ(r.quintals)}</td>
                      <td className="py-2.5 pr-3 text-slate-600">
                        {r.expiresAt ? (
                          <span className={isExpiringSoon(r) ? 'font-bold text-amber-700' : ''}>{fmtDate(r.expiresAt)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge tone={docStatusTone(r.status)} label={r.status} />
                      </td>
                      {canManage && (
                        <td className="py-2.5 text-right">
                          {r.status === 'ACTIVE' ? (
                            <div className="inline-flex gap-1.5">
                              <button
                                onClick={() => rowMut.mutate({ id: r.id, action: 'release' })}
                                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                <span className="inline-flex items-center gap-1">
                                  <RotateCcw size={12} /> Release
                                </span>
                              </button>
                              <button
                                onClick={() => rowMut.mutate({ id: r.id, action: 'consume' })}
                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                              >
                                Consume
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {(listQ.data ?? []).map((r) => (
                <div key={r.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs font-bold text-violet-700">{r.refNo}</p>
                      <p className="font-semibold text-slate-800">{r.productName}</p>
                      <p className="text-xs text-slate-500">
                        {r.locationCode}
                        {r.reference ? ` · ${r.reference}` : ''}
                        {r.expiresAt ? ` · exp ${fmtDate(r.expiresAt)}` : ''}
                      </p>
                    </div>
                    <StatusBadge tone={docStatusTone(r.status)} label={r.status} />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm font-bold tabular-nums text-slate-800">{fmtQ(r.quintals)} Qt</span>
                    {canManage && r.status === 'ACTIVE' && (
                      <div className="inline-flex gap-1.5">
                        <button
                          onClick={() => rowMut.mutate({ id: r.id, action: 'release' })}
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                        >
                          Release
                        </button>
                        <button
                          onClick={() => rowMut.mutate({ id: r.id, action: 'consume' })}
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700"
                        >
                          Consume
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {rowMut.isError && (
          <ErrorBox message={(rowMut.error as Error)?.message ?? 'Action failed'} onRetry={() => rowMut.reset()} />
        )}
        <p className="mt-4 text-[11px] text-slate-400">
          Tip: "Consume" marks the reservation used when its goods are picked into a dispatch.
        </p>
      </div>
    </div>
  );
}
