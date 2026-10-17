import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, Layers, Plus, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { ByproductAlert, ByproductMovement, ByproductStockRow } from '../types';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Field, NumberInput, Select, TextArea, TextInput } from '../components/ui';
import { fmtDate, fmtQ } from '../lib/format';
import {
  FgBadge,
  FgEmpty,
  FgError,
  FgKpi,
  FgKpiSkeleton,
  FgModal,
  FgPageHeader,
  FgSkeleton,
  cardShell,
  secondaryBtn,
  useFgPerms,
  violetBtn
} from './FgShared';

const TYPES = ['BRAN', 'SHORTS'] as const;

export function ByproductInventory() {
  const { canManage } = useFgPerms();
  const hasClaim = useAuth((s) => s.hasClaim);
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('');
  const [showMove, setShowMove] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const stockQ = useQuery({
    queryKey: ['fg-byproducts', typeFilter],
    queryFn: async () =>
      (await api.get<ByproductStockRow[]>(`${E.fgByproducts}${typeFilter ? `?type=${typeFilter}` : ''}`)).data,
    enabled: hasClaim('fg:view')
  });
  const alertsQ = useQuery({
    queryKey: ['fg-byproduct-alerts'],
    queryFn: async () => (await api.get<{ alerts: ByproductAlert[]; thresholdQ: number }>(E.fgByproductAlerts)).data,
    enabled: hasClaim('fg:view')
  });
  const movesQ = useQuery({
    queryKey: ['fg-byproduct-movements'],
    queryFn: async () => (await api.get<ByproductMovement[]>(E.fgByproductMovements)).data,
    enabled: hasClaim('fg:view')
  });

  const stock = stockQ.data ?? [];
  const alerts = alertsQ.data?.alerts ?? [];

  const totals = useMemo(() => {
    let bran = 0;
    let shorts = 0;
    for (const r of stock) {
      if (r.type === 'BRAN') bran += r.quintals;
      else shorts += r.quintals;
    }
    return { bran, shorts, total: bran + shorts };
  }, [stock]);

  const moveMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await api.post(E.fgByproductMovements, payload)).data,
    onSuccess: () => {
      setShowMove(false);
      setMoveError(null);
      queryClient.invalidateQueries({ queryKey: ['fg-byproducts'] });
      queryClient.invalidateQueries({ queryKey: ['fg-byproduct-movements'] });
      queryClient.invalidateQueries({ queryKey: ['fg-byproduct-alerts'] });
    },
    onError: (e: unknown) =>
      setMoveError(e instanceof Error ? e.message : 'Failed to record movement')
  });

  if (!hasClaim('fg:view')) {
    return (
      <div className="space-y-4">
        <FgPageHeader title="Byproduct Inventory" subtitle="Bran and shorts / middlings" />
        <FgError message="You do not have permission to view byproducts (fg:view)." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FgPageHeader
        title="Byproduct Inventory"
        subtitle="Bran and shorts/middlings — inflow from milling, outflow via sales or disposal"
        actions={
          <>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="max-w-[180px]">
              <option value="">All types</option>
              <option value="BRAN">Bran</option>
              <option value="SHORTS">Shorts / Middlings</option>
            </Select>
            {canManage ? (
              <button className={violetBtn} onClick={() => setShowMove(true)}>
                <Plus size={15} /> Record movement
              </button>
            ) : null}
          </>
        }
      />

      {stockQ.isLoading ? (
        <FgKpiSkeleton />
      ) : stockQ.isError ? (
        <FgError message="Failed to load byproduct stock" onRetry={() => stockQ.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <FgKpi label="Bran on hand" value={`${fmtQ(totals.bran)} q`} sub="wheat bran" icon={<Layers size={16} />} tone="amber" />
          <FgKpi label="Shorts on hand" value={`${fmtQ(totals.shorts)} q`} sub="shorts / middlings" icon={<Layers size={16} />} tone="violet" />
          <FgKpi label="Combined" value={`${fmtQ(totals.total)} q`} sub={`${stock.length} lot(s)`} icon={<Layers size={16} />} tone="slate" />
          <FgKpi
            label="Active alerts"
            value={String(alerts.length)}
            sub={alerts.length > 0 ? 'low stock / stale lots' : 'no alerts'}
            icon={<TriangleAlert size={16} />}
            tone={alerts.length > 0 ? 'rose' : 'emerald'}
          />
        </div>
      )}

      {/* Alerts */}
      {!alertsQ.isLoading && !alertsQ.isError && alerts.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <TriangleAlert size={16} className="text-amber-700" />
            <h2 className="text-sm font-bold text-amber-900">Stock alerts</h2>
          </div>
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2">
                <p className="tnum text-sm text-amber-900">{a.detail}</p>
                {a.kind === 'LOW_STOCK' ? <FgBadge tone="rose">Low stock</FgBadge> : <FgBadge tone="amber">Stale ({a.agingDays}d)</FgBadge>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Stock */}
        <div className={cardShell}>
          <CardHeader icon={<Layers size={16} />} title="Stock on hand" subtitle="Oldest lots first (FEFO consumption order)" />
          {stockQ.isLoading ? (
            <FgSkeleton rows={4} />
          ) : stockQ.isError ? (
            <FgError message="Failed to load stock" onRetry={() => stockQ.refetch()} />
          ) : stock.length === 0 ? (
            <FgEmpty title="No byproduct stock" sub="Record an IN movement to add bran or shorts from milling." />
          ) : (
            <DataTable<ByproductStockRow>
              columns={[
                { key: 'type', label: 'Type', render: (r) => <span className="font-semibold">{r.typeLabel}</span> },
                { key: 'batchNo', label: 'Batch', mono: true, render: (r) => r.batchNo ?? <span className="text-slate-400">—</span> },
                { key: 'locationCode', label: 'Location', mono: true },
                { key: 'quintals', label: 'Qt', mono: true, render: (r) => <span className="font-bold">{fmtQ(r.quintals)}</span> },
                {
                  key: 'agingDays',
                  label: 'Age',
                  mono: true,
                  render: (r) =>
                    r.agingDays > 30 ? (
                      <span className="font-bold text-amber-700">{r.agingDays}d</span>
                    ) : (
                      `${r.agingDays}d`
                    )
                },
                { key: 'receivedAt', label: 'Received', render: (r) => fmtDate(r.receivedAt) }
              ]}
              rows={stock}
            />
          )}
        </div>

        {/* Movements */}
        <div className={cardShell}>
          <CardHeader icon={<ArrowDownToLine size={16} />} title="Movements" subtitle="Milling inflow and sales/disposal outflow" />
          {movesQ.isLoading ? (
            <FgSkeleton rows={4} />
          ) : movesQ.isError ? (
            <FgError message="Failed to load movements" onRetry={() => movesQ.refetch()} />
          ) : (movesQ.data ?? []).length === 0 ? (
            <FgEmpty title="No movements" sub="Milling inflow and sales/disposal outflow will appear here." />
          ) : (
            <DataTable<ByproductMovement>
              columns={[
                {
                  key: 'direction',
                  label: '',
                  render: (r) =>
                    r.direction === 'IN' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700"><ArrowDownToLine size={14} /></span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-700"><ArrowUpFromLine size={14} /></span>
                    )
                },
                { key: 'typeLabel', label: 'Type' },
                { key: 'quintals', label: 'Qt', mono: true, render: (r) => <span className="font-bold">{fmtQ(r.quintals)}</span> },
                { key: 'reference', label: 'Reference', mono: true, render: (r) => r.reference ?? <span className="text-slate-400">—</span> },
                { key: 'reason', label: 'Reason' },
                { key: 'movedAt', label: 'Moved', render: (r) => fmtDate(r.movedAt) }
              ]}
              rows={movesQ.data ?? []}
            />
          )}
        </div>
      </div>

      {/* Movement modal */}
      {showMove && (
        <FgModal
          title="Record byproduct movement"
          subtitle="IN adds stock from milling · OUT consumes oldest lots first (FEFO)"
          onClose={() => {
            setShowMove(false);
            setMoveError(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              if (!Number.isFinite(Number(fd.get('quintals'))) || Number(fd.get('quintals')) <= 0) {
                setMoveError('Quintals must be a positive number.');
                return;
              }
              moveMut.mutate({
                type: String(fd.get('type')),
                direction: String(fd.get('direction')),
                quintals: Number(fd.get('quintals')),
                reference: String(fd.get('reference') || '').trim() || undefined,
                reason: String(fd.get('reason')).trim(),
                batchNo: String(fd.get('batchNo') || '').trim() || undefined,
                locationCode: String(fd.get('locationCode') || '').trim() || undefined
              });
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Type" required>
                <Select name="type" required defaultValue="BRAN">
                  {TYPES.map((t) => (
                    <option key={t} value={t}>{t === 'BRAN' ? 'Bran' : 'Shorts / Middlings'}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Direction" required>
                <Select name="direction" required defaultValue="IN">
                  <option value="IN">IN — milling inflow</option>
                  <option value="OUT">OUT — sale / disposal</option>
                </Select>
              </Field>
              <Field label="Quintals" required>
                <NumberInput name="quintals" required min={0.1} step={0.1} placeholder="0.0" />
              </Field>
              <Field label="Reference" hint="Batch no, sales order, disposal note">
                <TextInput name="reference" placeholder="e.g. B-2026-041" />
              </Field>
              <Field label="Source batch (IN only)">
                <TextInput name="batchNo" placeholder="Milling batch no" />
              </Field>
              <Field label="Location">
                <TextInput name="locationCode" defaultValue="BP_WH_1" />
              </Field>
            </div>
            <Field label="Reason" required>
              <TextArea name="reason" required placeholder="e.g. milling output shift 1 / sold to feed buyer…" />
            </Field>
            {moveError ? <p className="text-sm font-semibold text-rose-700">{moveError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryBtn} onClick={() => setShowMove(false)}>Cancel</button>
              <button type="submit" className={violetBtn} disabled={moveMut.isPending}>
                {moveMut.isPending ? 'Saving…' : 'Record movement'}
              </button>
            </div>
          </form>
        </FgModal>
      )}
    </div>
  );
}
