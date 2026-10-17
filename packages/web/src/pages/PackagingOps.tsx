import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, Gauge, Package, Plus, Timer, Users } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { PackagingRun, PackingEfficiencyRow, PackagingSize, Product, ProductionBatch } from '../types';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Field, NumberInput, Select, TextInput } from '../components/ui';
import { fmtDate, fmtDateTime, fmtQ } from '../lib/format';
import {
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

function runDuration(r: PackagingRun): string {
  if (!r.startedAt || !r.endedAt) return '—';
  const ms = new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime();
  if (ms < 0) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function bagsPerHour(r: PackagingRun): number | null {
  if (!r.startedAt || !r.endedAt) return null;
  const hrs = (new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 3600000;
  return hrs > 0 ? r.bags / hrs : null;
}

export function PackagingOps() {
  const { canManage } = useFgPerms();
  const hasClaim = useAuth((s) => s.hasClaim);
  const queryClient = useQueryClient();
  const [lineFilter, setLineFilter] = useState('');
  const [showRun, setShowRun] = useState(false);
  const [bags, setBags] = useState('');
  const [sizeId, setSizeId] = useState('');
  const [runError, setRunError] = useState<string | null>(null);

  const runsQ = useQuery({
    queryKey: ['fg-packaging-runs'],
    queryFn: async () => (await api.get<PackagingRun[]>(E.fgPackagingRuns)).data,
    enabled: hasClaim('fg:view')
  });
  const effQ = useQuery({
    queryKey: ['fg-packing-efficiency'],
    queryFn: async () => (await api.get<PackingEfficiencyRow[]>(E.fgPackingEfficiency)).data,
    enabled: hasClaim('fg:view')
  });
  const batchesQ = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(E.batches)).data,
    enabled: hasClaim('fg:view') && showRun
  });
  const productsQ = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get<Product[]>(E.products)).data,
    enabled: hasClaim('fg:view') && showRun
  });
  const sizesQ = useQuery({
    queryKey: ['packaging-sizes'],
    queryFn: async () => (await api.get<PackagingSize[]>(E.packagingSizes)).data,
    enabled: hasClaim('fg:view') && showRun
  });

  const runs = runsQ.data ?? [];
  const approvedBatches = (batchesQ.data ?? []).filter((b) => b.status === 'APPROVED');
  const sizes = useMemo(
    () => (sizesQ.data ?? []).filter((s) => s.isActive).sort((a, b) => Number(a.kg) - Number(b.kg)),
    [sizesQ.data]
  );
  const selectedSize = sizes.find((s) => s.id === sizeId);
  const autoQ = useMemo(() => {
    const n = Number(bags);
    if (!Number.isFinite(n) || n <= 0 || !selectedSize) return null;
    return (n * Number(selectedSize.kg)) / 100;
  }, [bags, selectedSize]);

  const lines = useMemo(() => [...new Set(runs.map((r) => r.line).filter(Boolean) as string[])], [runs]);
  const filteredRuns = lineFilter ? runs.filter((r) => r.line === lineFilter) : runs;

  const todayKey = new Date().toISOString().slice(0, 10);
  const today = runs.filter((r) => String(r.productionDate).slice(0, 10) === todayKey);
  const todayBags = today.reduce((s, r) => s + r.bags, 0);
  const todayQ = today.reduce((s, r) => s + Number(r.quintals), 0);
  const withRate = runs.map(bagsPerHour).filter((v): v is number => v !== null);
  const avgRate = withRate.length > 0 ? withRate.reduce((s, v) => s + v, 0) / withRate.length : null;

  const effRows = useMemo(() => {
    const all = effQ.data ?? [];
    return (lineFilter ? all.filter((e) => e.line === lineFilter) : all).slice(-30);
  }, [effQ.data, lineFilter]);

  const createMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await api.post(E.fgPackagingRuns, payload)).data,
    onSuccess: () => {
      setShowRun(false);
      setRunError(null);
      setBags('');
      setSizeId('');
      queryClient.invalidateQueries({ queryKey: ['fg-packaging-runs'] });
      queryClient.invalidateQueries({ queryKey: ['fg-packing-efficiency'] });
      queryClient.invalidateQueries({ queryKey: ['fg-inventory'] });
    },
    onError: (e: unknown) =>
      setRunError(e instanceof Error ? e.message : 'Failed to record packing run')
  });

  if (!hasClaim('fg:view')) {
    return (
      <div className="space-y-4">
        <FgPageHeader title="Packaging & Bagging Operations" subtitle="Packing runs by batch, line and operator" />
        <FgError message="You do not have permission to view packaging operations (fg:view)." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FgPageHeader
        title="Packaging & Bagging Operations"
        subtitle="Packing runs: batch, product, bag size, bags packed, line, operator — Qt auto-computed"
        actions={
          <>
            {lines.length > 0 && (
              <Select value={lineFilter} onChange={(e) => setLineFilter(e.target.value)} className="max-w-[180px]">
                <option value="">All lines</option>
                {lines.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </Select>
            )}
            {canManage ? (
              <button className={violetBtn} onClick={() => setShowRun(true)}>
                <Plus size={15} /> New packing run
              </button>
            ) : null}
          </>
        }
      />

      {runsQ.isLoading ? (
        <FgKpiSkeleton />
      ) : runsQ.isError ? (
        <FgError message="Failed to load packing runs" onRetry={() => runsQ.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <FgKpi label="Runs today" value={String(today.length)} sub={todayKey} icon={<Package size={16} />} tone="violet" />
          <FgKpi label="Bags today" value={todayBags.toLocaleString('en-US')} sub="packed today" icon={<Gauge size={16} />} tone="slate" />
          <FgKpi label="Qt packed today" value={fmtQ(todayQ)} sub="quintals" icon={<Timer size={16} />} tone="emerald" />
          <FgKpi label="Avg speed" value={avgRate === null ? '—' : `${Math.round(avgRate).toLocaleString('en-US')}/h`} sub="bags per hour (timed runs)" icon={<Users size={16} />} tone="amber" />
        </div>
      )}

      {/* Efficiency */}
      <div className={cardShell}>
        <CardHeader icon={<Gauge size={16} />} title="Line efficiency" subtitle="Bags per hour per packing line and day" />
        {effQ.isLoading ? (
          <FgSkeleton rows={4} />
        ) : effQ.isError ? (
          <FgError message="Failed to load efficiency" onRetry={() => effQ.refetch()} />
        ) : effRows.length === 0 ? (
          <FgEmpty title="No efficiency data" sub="Start/end times on packing runs unlock bags-per-hour tracking." />
        ) : (
          <DataTable<PackingEfficiencyRow>
            keyOf={(r) => `${r.date}-${r.line}`}
            columns={[
              { key: 'date', label: 'Date', mono: true, render: (r) => fmtDate(r.date) },
              { key: 'line', label: 'Line', render: (r) => <span className="font-semibold">{r.line}</span> },
              { key: 'runs', label: 'Runs', mono: true },
              { key: 'bags', label: 'Bags', mono: true, render: (r) => r.bags.toLocaleString('en-US') },
              { key: 'quintals', label: 'Qt', mono: true, render: (r) => fmtQ(r.quintals) },
              { key: 'hours', label: 'Hours', mono: true, render: (r) => (r.hours > 0 ? r.hours.toFixed(1) : '—') },
              {
                key: 'bagsPerHour',
                label: 'Bags/h',
                mono: true,
                render: (r) =>
                  r.bagsPerHour === null ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <span className={`font-bold ${r.bagsPerHour >= 400 ? 'text-emerald-700' : r.bagsPerHour >= 200 ? 'text-amber-700' : 'text-rose-700'}`}>
                      {Math.round(r.bagsPerHour).toLocaleString('en-US')}
                    </span>
                  )
              }
            ]}
            rows={effRows}
          />
        )}
      </div>

      {/* Runs */}
      <div className={cardShell}>
        <CardHeader icon={<Package size={16} />} title="Packing runs" subtitle="Inflow into finished goods — only APPROVED batches can be packed" />
        {runsQ.isLoading ? (
          <FgSkeleton rows={6} />
        ) : runsQ.isError ? (
          <FgError message="Failed to load packing runs" onRetry={() => runsQ.refetch()} />
        ) : filteredRuns.length === 0 ? (
          <FgEmpty title="No packing runs" sub="Record the first packing run to move approved batches into finished goods." />
        ) : (
          <DataTable<PackagingRun>
            columns={[
              { key: 'batchNo', label: 'Batch', mono: true, render: (r) => <span className="font-semibold">{r.batch?.batchNo ?? r.batchId.slice(0, 8)}</span> },
              { key: 'productName', label: 'Product', render: (r) => r.product?.name ?? '—' },
              { key: 'line', label: 'Line', render: (r) => r.line ?? <span className="text-slate-400">—</span> },
              { key: 'operator', label: 'Operator', render: (r) => r.operator ?? <span className="text-slate-400">—</span> },
              { key: 'bags', label: 'Bags', mono: true, render: (r) => r.bags.toLocaleString('en-US') },
              { key: 'quintals', label: 'Qt', mono: true, render: (r) => <span className="font-bold">{fmtQ(r.quintals)}</span> },
              {
                key: 'timing',
                label: 'Timing',
                render: (r) => (
                  <span className="tnum inline-flex items-center gap-1 text-xs text-slate-600">
                    <Clock3 size={13} /> {runDuration(r)}
                    {bagsPerHour(r) !== null ? ` · ${Math.round(bagsPerHour(r)!).toLocaleString('en-US')}/h` : ''}
                  </span>
                )
              },
              { key: 'productionDate', label: 'Prod. date', render: (r) => fmtDate(r.productionDate) },
              { key: 'packedAt', label: 'Packed at', render: (r) => fmtDateTime(r.packedAt) }
            ]}
            rows={filteredRuns}
          />
        )}
      </div>

      {/* New run modal */}
      {showRun && (
        <FgModal
          title="New packing run"
          subtitle="Qt is auto-computed from bags × bag weight. Stock posts to FG_WH_1 on save."
          onClose={() => {
            setShowRun(false);
            setRunError(null);
          }}
          wide
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const started = String(fd.get('startedAt') || '');
              const ended = String(fd.get('endedAt') || '');
              if (started && ended && new Date(ended) < new Date(started)) {
                setRunError('End time cannot be before start time.');
                return;
              }
              createMut.mutate({
                batchId: String(fd.get('batchId')),
                productId: String(fd.get('productId')),
                packagingSizeId: String(fd.get('packagingSizeId')),
                bags: Number(fd.get('bags')),
                productionDate: String(fd.get('productionDate')),
                line: String(fd.get('line') || '').trim() || undefined,
                operator: String(fd.get('operator') || '').trim() || undefined,
                startedAt: started || undefined,
                endedAt: ended || undefined
              });
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Batch (approved)" required>
                <Select name="batchId" required defaultValue="">
                  <option value="" disabled>Select batch</option>
                  {approvedBatches.map((b) => (
                    <option key={b.id} value={b.id}>{b.batchNo}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Product" required>
                <Select name="productId" required defaultValue="">
                  <option value="" disabled>Select product</option>
                  {(productsQ.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Bag size" required>
                <Select name="packagingSizeId" required value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
                  <option value="" disabled>Select size</option>
                  {sizes.map((s) => (
                    <option key={s.id} value={s.id}>{s.label} ({Number(s.kg)} kg)</option>
                  ))}
                </Select>
              </Field>
              <Field label="Bags packed" required hint={autoQ !== null ? `Auto Qt: ${fmtQ(autoQ)} q` : undefined}>
                <NumberInput name="bags" required min={1} step={1} value={bags} onChange={(e) => setBags(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Packing line">
                <TextInput name="line" placeholder="e.g. Line 1" list="fg-lines" />
                <datalist id="fg-lines">
                  {lines.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </Field>
              <Field label="Operator">
                <TextInput name="operator" placeholder="Operator name" />
              </Field>
              <Field label="Production date" required>
                <TextInput name="productionDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
              </Field>
              <Field label="Started at">
                <TextInput name="startedAt" type="datetime-local" />
              </Field>
              <Field label="Ended at">
                <TextInput name="endedAt" type="datetime-local" />
              </Field>
            </div>
            {runError ? <p className="text-sm font-semibold text-rose-700">{runError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryBtn} onClick={() => setShowRun(false)}>Cancel</button>
              <button type="submit" className={violetBtn} disabled={createMut.isPending}>
                {createMut.isPending ? 'Saving…' : 'Record run'}
              </button>
            </div>
          </form>
        </FgModal>
      )}
    </div>
  );
}
