import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Info, Plus, SlidersHorizontal, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { WhAdjustmentDetail, WhAdjustmentList } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, Field, Select, TextArea } from '../components/ui';
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

const REASONS = ['DAMAGE', 'FOUND', 'RECOUNT', 'SPOILAGE', 'OTHER'];
const AUTO_POST_Q = 10;

export function InventoryAdjustments() {
  const { canManage, canApprove } = useWhPerms();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<WhLine[]>([emptyWhLine()]);

  const productsQ = useProducts();
  const locationsQ = useLocations();

  const listQ = useQuery({
    queryKey: ['wh-adjustments', statusFilter],
    queryFn: async () =>
      (await api.get<WhAdjustmentList[]>(E.adjustments + (statusFilter ? `?status=${statusFilter}` : ''))).data
  });

  const detailQ = useQuery({
    queryKey: ['wh-adjustment', selectedId],
    queryFn: async () => (await api.get<WhAdjustmentDetail>(E.adjustment(selectedId!))).data,
    enabled: !!selectedId
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['wh-adjustments'] });
    qc.invalidateQueries({ queryKey: ['wh-adjustment'] });
    qc.invalidateQueries({ queryKey: ['wh-locations'] });
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const items = lines
        .filter((l) => l.productId && Math.abs(Number(l.quintals)) >= 0.005)
        .map((l) => ({
          productId: l.productId,
          batchNo: l.batchNo.trim() || null,
          quintals: Number(l.quintals),
          bags: l.bags === '' ? 0 : Number(l.bags),
          unitCostBirr: l.unitCostBirr === '' ? null : Number(l.unitCostBirr),
          reason: l.reason
        }));
      if (!locationId) throw new Error('Choose a location.');
      if (!items.length) throw new Error('Add at least one valid line (product + non-zero quantity).');
      return (
        await api.post(E.adjustments, { locationId, reason: note.trim() || null, items })
      ).data as { docNo: string; posted: boolean; adjustment: WhAdjustmentDetail };
    },
    onSuccess: (r) => {
      invalidate();
      setShowCreate(false);
      setLocationId('');
      setNote('');
      setLines([emptyWhLine()]);
      setSelectedId(r.adjustment.id);
    }
  });

  const decisionMut = useMutation({
    mutationFn: async (decision: 'approve' | 'reject') =>
      (await api.post(decision === 'approve' ? E.whAdjustmentApprove(selectedId!) : E.whAdjustmentReject(selectedId!)))
        .data as WhAdjustmentDetail,
    onSuccess: invalidate
  });

  const activeLocs = (locationsQ.data ?? []).filter((l) => l.isActive);

  if (selectedId) {
    const doc = detailQ.data;
    return (
      <div className="space-y-5">
        <button
          onClick={() => setSelectedId(null)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900"
        >
          <ArrowLeft size={15} /> Back to adjustments
        </button>
        <div className={cardShell}>
          {detailQ.isLoading && <WhListState isLoading isError={false} isEmpty={false} emptyTitle="" onRetry={() => {}} />}
          {detailQ.isError && <WhListState isLoading={false} isError isEmpty={false} emptyTitle="" onRetry={() => detailQ.refetch()} />}
          {doc && (
            <>
              <CardHeader
                icon={<SlidersHorizontal size={16} />}
                title={`Adjustment ${doc.docNo}`}
                subtitle={`${doc.locationCode} · ${doc.locationName} · ${fmtDateTime(doc.createdAt)}`}
                action={<StatusBadge tone={docStatusTone(doc.status)} label={doc.status} />}
              />
              {doc.reason && <p className="mb-4 rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">{doc.reason}</p>}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3">Product</th>
                      <th className="py-2 pr-3">Batch</th>
                      <th className="py-2 pr-3">Reason</th>
                      <th className="py-2 pr-3 text-right">Quintals</th>
                      <th className="py-2 text-right">Bags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.items.map((it) => (
                      <tr key={it.id} className="border-b border-slate-50">
                        <td className="py-2.5 pr-3 font-semibold text-slate-800 dark:text-slate-100">{it.productName}</td>
                        <td className="py-2.5 pr-3 text-slate-500 dark:text-slate-400">{it.batchNo ?? '—'}</td>
                        <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">{it.reason}</td>
                        <td
                          className={`py-2.5 pr-3 text-right font-bold tabular-nums ${
                            it.quintals > 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {it.quintals > 0 ? '+' : ''}
                          {fmtQ(it.quintals)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {it.bags > 0 ? '+' : ''}
                          {it.bags}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {doc.status === 'PENDING' && canApprove && (
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => decisionMut.mutate('reject')}>
                    <XCircle size={15} /> Reject
                  </Button>
                  <Button loading={decisionMut.isPending} onClick={() => decisionMut.mutate('approve')}>
                    <CheckCircle2 size={15} /> Approve & post
                  </Button>
                </div>
              )}
              {decisionMut.isError && (
                <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {(decisionMut.error as Error)?.message ?? 'Action failed'}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<SlidersHorizontal size={16} />}
          title="Inventory Adjustments"
          subtitle="Positive/negative corrections — large adjustments need approval"
          action={
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-auto !py-2 !text-sm">
                <option value="">All statuses</option>
                <option value="PENDING">Pending approval</option>
                <option value="POSTED">Posted</option>
                <option value="REJECTED">Rejected</option>
              </Select>
              {canManage && (
                <Button className="!px-4 !py-2 !text-sm" onClick={() => setShowCreate((v) => !v)}>
                  <Plus size={15} /> New adjustment
                </Button>
              )}
            </div>
          }
        />

        {showCreate && canManage && (
          <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>
                Use a <b>negative</b> quantity for losses (damage, spoilage) and a <b>positive</b> quantity for gains
                (found stock). Lines up to {AUTO_POST_Q} Qt post immediately; larger lines require{' '}
                <b>warehouse:approve</b>.
              </span>
            </div>
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <Field label="Note">
                <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={1} placeholder="Damage found during weekly check…" />
              </Field>
            </div>
            <WhLineEditor
              lines={lines}
              setLines={setLines}
              products={productsQ.data ?? []}
              locations={activeLocs}
              opts={{ allowNegativeQty: true, showReason: true, showCost: true, reasonOptions: REASONS }}
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
                Submit adjustment
              </Button>
            </div>
          </div>
        )}

        <WhListState
          isLoading={listQ.isLoading}
          isError={listQ.isError}
          isEmpty={!listQ.isLoading && !listQ.isError && (listQ.data ?? []).length === 0}
          emptyTitle="No adjustments yet"
          emptySub="Record damage, found stock or recount corrections."
          onRetry={() => listQ.refetch()}
        />

        {(listQ.data ?? []).length > 0 && (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3">Doc no</th>
                    <th className="py-2 pr-3">Location</th>
                    <th className="py-2 pr-3">Created</th>
                    <th className="py-2 pr-3 text-right">Net (Qt)</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQ.data ?? []).map((d) => (
                    <tr key={d.id} onClick={() => setSelectedId(d.id)} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="py-2.5 pr-3 font-mono text-xs font-bold text-violet-700">{d.docNo}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{d.locationCode}</td>
                      <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">{fmtDateTime(d.createdAt)}</td>
                      <td className="py-2.5 pr-3 text-right font-bold tabular-nums">{fmtQ(d.totalAbsQ)}</td>
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
                <button key={d.id} onClick={() => setSelectedId(d.id)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs font-bold text-violet-700">{d.docNo}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {d.locationCode} · {fmtDateTime(d.createdAt)}
                      </p>
                    </div>
                    <StatusBadge tone={docStatusTone(d.status)} label={d.status} />
                  </div>
                  <p className="mt-2 text-sm tabular-nums text-slate-600 dark:text-slate-300">
                    Net <span className="font-bold text-slate-800 dark:text-slate-100">{fmtQ(d.totalAbsQ)} Qt</span>
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
