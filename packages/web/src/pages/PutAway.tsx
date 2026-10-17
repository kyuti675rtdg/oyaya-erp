import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, PackagePlus, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { WhPutAwayDetail, WhPutAwayList } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, Field, Select, TextInput } from '../components/ui';
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

export function PutAway() {
  const { canManage } = useWhPerms();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [referenceDoc, setReferenceDoc] = useState('');
  const [lines, setLines] = useState<WhLine[]>([emptyWhLine()]);
  const [placements, setPlacements] = useState<Record<string, string>>({});

  const productsQ = useProducts();
  const locationsQ = useLocations();

  const listQ = useQuery({
    queryKey: ['wh-putaways', statusFilter],
    queryFn: async () =>
      (await api.get<WhPutAwayList[]>(E.putaways + (statusFilter ? `?status=${statusFilter}` : ''))).data
  });

  const detailQ = useQuery({
    queryKey: ['wh-putaway', selectedId],
    queryFn: async () => (await api.get<WhPutAwayDetail>(E.putaway(selectedId!))).data,
    enabled: !!selectedId
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['wh-putaways'] });
    qc.invalidateQueries({ queryKey: ['wh-putaway'] });
    qc.invalidateQueries({ queryKey: ['wh-locations'] });
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const items = lines
        .filter((l) => l.productId && Number(l.quintals) > 0)
        .map((l) => ({
          productId: l.productId,
          batchNo: l.batchNo.trim() || null,
          quintals: Number(l.quintals),
          bags: l.bags === '' ? 0 : Number(l.bags),
          packagingKg: l.packagingKg === '' ? null : Number(l.packagingKg),
          unitCostBirr: l.unitCostBirr === '' ? null : Number(l.unitCostBirr)
        }));
      if (!items.length) throw new Error('Add at least one valid line (product + quantity).');
      return (
        await api.post(E.putaways, { referenceDoc: referenceDoc.trim() || null, items })
      ).data as WhPutAwayDetail;
    },
    onSuccess: (doc) => {
      invalidate();
      setShowCreate(false);
      setReferenceDoc('');
      setLines([emptyWhLine()]);
      setSelectedId(doc.id);
      setPlacements({});
    }
  });

  const placeMut = useMutation({
    mutationFn: async () => {
      const doc = detailQ.data;
      if (!doc) throw new Error('No document loaded');
      const pls = doc.items.map((it) => ({
        itemId: it.id,
        locationId: placements[it.id] || it.suggestedLocationId || ''
      }));
      if (pls.some((p) => !p.locationId)) throw new Error('Choose a placement location for every line.');
      return (await api.post(E.putawayPlace(doc.id), { placements: pls })).data as WhPutAwayDetail;
    },
    onSuccess: invalidate
  });

  const activeLocs = (locationsQ.data ?? []).filter((l) => l.isActive);

  // ── Detail view ────────────────────────────────────────────────────
  if (selectedId) {
    const doc = detailQ.data;
    return (
      <div className="space-y-5">
        <button
          onClick={() => setSelectedId(null)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft size={15} /> Back to receiving
        </button>
        <div className={cardShell}>
          {detailQ.isLoading && <WhListState isLoading isError={false} isEmpty={false} emptyTitle="" onRetry={() => {}} />}
          {detailQ.isError && <WhListState isLoading={false} isError isEmpty={false} emptyTitle="" onRetry={() => detailQ.refetch()} />}
          {doc && (
            <>
              <CardHeader
                icon={<PackagePlus size={16} />}
                title={`Put-away ${doc.docNo}`}
                subtitle={`Received ${fmtDateTime(doc.receivedAt)}${doc.referenceDoc ? ` · Ref ${doc.referenceDoc}` : ''}`}
                action={<StatusBadge tone={docStatusTone(doc.status)} label={doc.status} />}
              />
              <div className="space-y-3">
                {doc.items.map((it) => (
                  <div key={it.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-800">{it.productName}</p>
                        <p className="text-xs text-slate-500">
                          <span className="font-bold tabular-nums text-slate-700">{fmtQ(it.quintals)} Qt</span>
                          {' · '}
                          {it.bags} bags
                          {it.packagingKg ? ` · ${it.packagingKg} kg` : ''}
                          {it.batchNo ? ` · Batch ${it.batchNo}` : ''}
                          {it.unitCostBirr != null ? ` · ${it.unitCostBirr} Br/Qt` : ''}
                        </p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-slate-500">Suggested</p>
                        <p className="font-mono font-bold text-violet-700">{it.suggestedCode ?? '—'}</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      {doc.status === 'DRAFT' && canManage ? (
                        <label className="block max-w-xs">
                          <span className="mb-1 block text-[11px] font-semibold text-slate-500">Place at location</span>
                          <Select
                            value={placements[it.id] ?? it.suggestedLocationId ?? ''}
                            onChange={(e) => setPlacements({ ...placements, [it.id]: e.target.value })}
                          >
                            <option value="">Select location…</option>
                            {activeLocs.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.code} — {l.name}
                              </option>
                            ))}
                          </Select>
                        </label>
                      ) : (
                        <p className="text-xs text-slate-500">
                          Placed at{' '}
                          <span className="font-mono font-bold text-emerald-700">{it.placedCode ?? '—'}</span>
                          {it.placedAt ? ` · ${fmtDateTime(it.placedAt)}` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {doc.status === 'DRAFT' && canManage && (
                <div className="mt-4 flex justify-end">
                  <Button loading={placeMut.isPending} onClick={() => placeMut.mutate()}>
                    <CheckCircle2 size={16} /> Confirm placement
                  </Button>
                </div>
              )}
              {placeMut.isError && (
                <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {(placeMut.error as Error)?.message ?? 'Placement failed'}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── List + create view ─────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<PackagePlus size={16} />}
          title="Goods Receiving & Put-Away"
          subtitle="Receive goods, accept the suggested location, confirm placement into stock"
          action={
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-auto !py-2 !text-sm">
                <option value="">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="PLACED">Placed</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
              {canManage && (
                <Button className="!px-4 !py-2 !text-sm" onClick={() => setShowCreate((v) => !v)}>
                  <Plus size={15} /> Receive goods
                </Button>
              )}
            </div>
          }
        />

        {showCreate && canManage && (
          <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Reference document" hint="PO / GRN / intake number">
                <TextInput value={referenceDoc} onChange={(e) => setReferenceDoc(e.target.value)} placeholder="PO-2026-…" />
              </Field>
            </div>
            <WhLineEditor
              lines={lines}
              setLines={setLines}
              products={productsQ.data ?? []}
              locations={activeLocs}
              opts={{ showCost: true, showPackaging: true }}
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
                Create receiving document
              </Button>
            </div>
          </div>
        )}

        <WhListState
          isLoading={listQ.isLoading}
          isError={listQ.isError}
          isEmpty={!listQ.isLoading && !listQ.isError && (listQ.data ?? []).length === 0}
          emptyTitle="No receiving documents yet"
          emptySub="Receive goods to create the first put-away document."
          onRetry={() => listQ.refetch()}
        />

        {(listQ.data ?? []).length > 0 && (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Doc no</th>
                    <th className="py-2 pr-3">Reference</th>
                    <th className="py-2 pr-3">Received</th>
                    <th className="py-2 pr-3 text-right">Lines</th>
                    <th className="py-2 pr-3 text-right">Total (Qt)</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQ.data ?? []).map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedId(d.id)}
                      className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/60"
                    >
                      <td className="py-2.5 pr-3 font-mono text-xs font-bold text-violet-700">{d.docNo}</td>
                      <td className="py-2.5 pr-3 text-slate-600">{d.referenceDoc ?? '—'}</td>
                      <td className="py-2.5 pr-3 text-slate-600">{fmtDateTime(d.receivedAt)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{d.itemCount}</td>
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
                <button
                  key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  className="w-full rounded-xl border border-slate-200 p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs font-bold text-violet-700">{d.docNo}</p>
                      <p className="text-xs text-slate-500">{d.referenceDoc ?? 'No reference'} · {fmtDateTime(d.receivedAt)}</p>
                    </div>
                    <StatusBadge tone={docStatusTone(d.status)} label={d.status} />
                  </div>
                  <p className="mt-2 text-sm tabular-nums text-slate-700">
                    {d.itemCount} line(s) · <span className="font-bold">{fmtQ(d.totalQ)} Qt</span>
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
