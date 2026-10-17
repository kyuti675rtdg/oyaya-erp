import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRightLeft, CheckCircle2, Plus, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { WhTransferDetail, WhTransferList } from '../types';
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

export function StockTransfers() {
  const { canManage, canApprove } = useWhPerms();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<WhLine[]>([emptyWhLine()]);

  const productsQ = useProducts();
  const locationsQ = useLocations();

  const listQ = useQuery({
    queryKey: ['wh-transfers', statusFilter],
    queryFn: async () =>
      (await api.get<WhTransferList[]>(E.stockTransfers + (statusFilter ? `?status=${statusFilter}` : ''))).data
  });

  const detailQ = useQuery({
    queryKey: ['wh-transfer', selectedId],
    queryFn: async () => (await api.get<WhTransferDetail>(E.stockTransfer(selectedId!))).data,
    enabled: !!selectedId
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['wh-transfers'] });
    qc.invalidateQueries({ queryKey: ['wh-transfer'] });
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
          bags: l.bags === '' ? 0 : Number(l.bags)
        }));
      if (!fromId || !toId) throw new Error('Choose source and destination locations.');
      if (fromId === toId) throw new Error('Source and destination must differ.');
      if (!items.length) throw new Error('Add at least one valid line.');
      return (
        await api.post(E.stockTransfers, {
          fromLocationId: fromId,
          toLocationId: toId,
          reason: reason.trim() || null,
          items
        })
      ).data as WhTransferDetail;
    },
    onSuccess: (doc) => {
      invalidate();
      setShowCreate(false);
      setFromId('');
      setToId('');
      setReason('');
      setLines([emptyWhLine()]);
      setSelectedId(doc.id);
    }
  });

  const actionMut = useMutation({
    mutationFn: async (action: 'approve' | 'complete' | 'reject' | 'cancel') =>
      (await api.post(E.stockTransferAction(selectedId!, action))).data as WhTransferDetail,
    onSuccess: invalidate
  });

  const activeLocs = (locationsQ.data ?? []).filter((l) => l.isActive);

  // ── Detail ───────────────────────────────────────────────────────
  if (selectedId) {
    const doc = detailQ.data;
    return (
      <div className="space-y-5">
        <button
          onClick={() => setSelectedId(null)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft size={15} /> Back to transfers
        </button>
        <div className={cardShell}>
          {detailQ.isLoading && <WhListState isLoading isError={false} isEmpty={false} emptyTitle="" onRetry={() => {}} />}
          {detailQ.isError && <WhListState isLoading={false} isError isEmpty={false} emptyTitle="" onRetry={() => detailQ.refetch()} />}
          {doc && (
            <>
              <CardHeader
                icon={<ArrowRightLeft size={16} />}
                title={`Transfer ${doc.docNo}`}
                subtitle={`${doc.fromCode} → ${doc.toCode} · requested ${fmtDateTime(doc.createdAt)}`}
                action={<StatusBadge tone={docStatusTone(doc.status)} label={doc.status} />}
              />
              {doc.reason && <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{doc.reason}</p>}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3">Product</th>
                      <th className="py-2 pr-3">Batch</th>
                      <th className="py-2 pr-3 text-right">Quintals</th>
                      <th className="py-2 text-right">Bags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.items.map((it) => (
                      <tr key={it.id} className="border-b border-slate-50">
                        <td className="py-2.5 pr-3 font-semibold text-slate-800">{it.productName}</td>
                        <td className="py-2.5 pr-3 text-slate-500">{it.batchNo ?? '—'}</td>
                        <td className="py-2.5 pr-3 text-right font-bold tabular-nums">{fmtQ(it.quintals)}</td>
                        <td className="py-2.5 text-right tabular-nums">{it.bags}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {doc.status === 'REQUESTED' && canApprove && (
                  <>
                    <Button variant="secondary" onClick={() => actionMut.mutate('reject')}>
                      <XCircle size={15} /> Reject
                    </Button>
                    <Button onClick={() => actionMut.mutate('approve')}>
                      <CheckCircle2 size={15} /> Approve
                    </Button>
                  </>
                )}
                {doc.status === 'APPROVED' && canManage && (
                  <>
                    <Button variant="secondary" onClick={() => actionMut.mutate('cancel')}>
                      Cancel
                    </Button>
                    <Button onClick={() => actionMut.mutate('complete')}>
                      <CheckCircle2 size={15} /> Complete transfer
                    </Button>
                  </>
                )}
                {doc.status === 'REQUESTED' && canManage && (
                  <Button variant="secondary" onClick={() => actionMut.mutate('cancel')}>
                    Cancel
                  </Button>
                )}
              </div>
              {actionMut.isError && (
                <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {(actionMut.error as Error)?.message ?? 'Action failed'}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── List + create ────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<ArrowRightLeft size={16} />}
          title="Stock Transfers"
          subtitle="Move stock between locations: Requested → Approved → Completed"
          action={
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-auto !py-2 !text-sm">
                <option value="">All statuses</option>
                <option value="REQUESTED">Requested</option>
                <option value="APPROVED">Approved</option>
                <option value="COMPLETED">Completed</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
              {canManage && (
                <Button className="!px-4 !py-2 !text-sm" onClick={() => setShowCreate((v) => !v)}>
                  <Plus size={15} /> New transfer
                </Button>
              )}
            </div>
          }
        />

        {showCreate && canManage && (
          <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="From location" required>
                <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
                  <option value="">Select…</option>
                  {activeLocs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="To location" required>
                <Select value={toId} onChange={(e) => setToId(e.target.value)}>
                  <option value="">Select…</option>
                  {activeLocs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reason">
                <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={1} placeholder="Replenish FG store…" />
              </Field>
            </div>
            <WhLineEditor lines={lines} setLines={setLines} products={productsQ.data ?? []} locations={activeLocs} />
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
                Request transfer
              </Button>
            </div>
          </div>
        )}

        <WhListState
          isLoading={listQ.isLoading}
          isError={listQ.isError}
          isEmpty={!listQ.isLoading && !listQ.isError && (listQ.data ?? []).length === 0}
          emptyTitle="No stock transfers yet"
          emptySub="Request a transfer to move stock between locations."
          onRetry={() => listQ.refetch()}
        />

        {(listQ.data ?? []).length > 0 && (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Doc no</th>
                    <th className="py-2 pr-3">Route</th>
                    <th className="py-2 pr-3">Requested</th>
                    <th className="py-2 pr-3 text-right">Total (Qt)</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQ.data ?? []).map((d) => (
                    <tr key={d.id} onClick={() => setSelectedId(d.id)} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="py-2.5 pr-3 font-mono text-xs font-bold text-violet-700">{d.docNo}</td>
                      <td className="py-2.5 pr-3 text-slate-700">
                        <span className="font-mono text-xs font-semibold">{d.fromCode}</span>
                        <span className="mx-1.5 text-slate-400">→</span>
                        <span className="font-mono text-xs font-semibold">{d.toCode}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600">{fmtDateTime(d.createdAt)}</td>
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
                      <p className="text-sm font-semibold text-slate-700">
                        <span className="font-mono text-xs">{d.fromCode}</span>
                        <span className="mx-1 text-slate-400">→</span>
                        <span className="font-mono text-xs">{d.toCode}</span>
                      </p>
                    </div>
                    <StatusBadge tone={docStatusTone(d.status)} label={d.status} />
                  </div>
                  <p className="mt-2 text-sm tabular-nums text-slate-600">
                    <span className="font-bold text-slate-800">{fmtQ(d.totalQ)} Qt</span> · {fmtDateTime(d.createdAt)}
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
