import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, RefreshCw, Tags } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { LabelPrint, LabelQueueRow } from '../types';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Field, NumberInput, TextArea } from '../components/ui';
import { fmtDate } from '../lib/format';
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

function LabelPreview({
  batchNo,
  productName,
  bagLabel,
  bagKg,
  productionDate,
  expiryDate,
  copies
}: {
  batchNo: string;
  productName: string;
  bagLabel: string;
  bagKg: number | null;
  productionDate: string;
  expiryDate: string;
  copies: number;
}) {
  return (
    <div className="rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Label preview</p>
      <div className="tnum mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <p className="text-slate-500 dark:text-slate-400">Product</p>
        <p className="font-bold text-slate-900 dark:text-slate-100">{productName}</p>
        <p className="text-slate-500 dark:text-slate-400">Batch no</p>
        <p className="font-bold text-slate-900 dark:text-slate-100">{batchNo}</p>
        <p className="text-slate-500 dark:text-slate-400">Net weight</p>
        <p className="font-bold text-slate-900 dark:text-slate-100">{bagLabel}{bagKg !== null ? ` (${bagKg} kg)` : ''}</p>
        <p className="text-slate-500 dark:text-slate-400">Production date</p>
        <p className="font-bold text-slate-900 dark:text-slate-100">{fmtDate(productionDate)}</p>
        <p className="text-slate-500 dark:text-slate-400">Expiry date</p>
        <p className="font-bold text-slate-900 dark:text-slate-100">{fmtDate(expiryDate)}</p>
        <p className="text-slate-500 dark:text-slate-400">Copies</p>
        <p className="font-bold text-slate-900 dark:text-slate-100">{copies}</p>
      </div>
    </div>
  );
}

export function BatchLabeling() {
  const { canManage } = useFgPerms();
  const hasClaim = useAuth((s) => s.hasClaim);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'queue' | 'history'>('queue');
  const [printTarget, setPrintTarget] = useState<LabelQueueRow | null>(null);
  const [reprintTarget, setReprintTarget] = useState<LabelPrint | null>(null);
  const [copies, setCopies] = useState('');
  const [shelfLife, setShelfLife] = useState('180');
  const [reason, setReason] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);

  const queueQ = useQuery({
    queryKey: ['fg-label-queue'],
    queryFn: async () => (await api.get<LabelQueueRow[]>(E.fgLabelQueue)).data,
    enabled: hasClaim('fg:view')
  });
  const historyQ = useQuery({
    queryKey: ['fg-labels'],
    queryFn: async () => (await api.get<LabelPrint[]>(E.fgLabels)).data,
    enabled: hasClaim('fg:view')
  });

  const queue = queueQ.data ?? [];
  const history = historyQ.data ?? [];

  const stats = useMemo(() => {
    const pending = queue.reduce((s, r) => s + r.pending, 0);
    const todayKey = new Date().toISOString().slice(0, 10);
    const printedToday = history
      .filter((h) => String(h.printedAt).slice(0, 10) === todayKey)
      .reduce((s, h) => s + h.copies, 0);
    const reprints = history.filter((h) => h.status === 'REPRINTED').length;
    return { pending, batches: queue.length, printedToday, reprints };
  }, [queue, history]);

  const expiryPreview = useMemo(() => {
    if (!printTarget) return null;
    const life = Number(shelfLife);
    if (!Number.isFinite(life) || life <= 0) return null;
    const d = new Date(printTarget.productionDate);
    d.setUTCDate(d.getUTCDate() + life);
    return d.toISOString();
  }, [printTarget, shelfLife]);

  const printMut = useMutation({
    mutationFn: async () =>
      (
        await api.post(E.fgLabelPrint, {
          packagingRunId: printTarget!.packagingRunId,
          copies: Number(copies),
          shelfLifeDays: Number(shelfLife)
        })
      ).data,
    onSuccess: () => {
      setPrintTarget(null);
      setCopies('');
      setModalError(null);
      queryClient.invalidateQueries({ queryKey: ['fg-label-queue'] });
      queryClient.invalidateQueries({ queryKey: ['fg-labels'] });
    },
    onError: (e: unknown) =>
      setModalError(e instanceof Error ? e.message : 'Failed to record label print')
  });

  const reprintMut = useMutation({
    mutationFn: async () =>
      (await api.post(E.fgLabelReprint(reprintTarget!.id), { reason: reason.trim() })).data,
    onSuccess: () => {
      setReprintTarget(null);
      setReason('');
      setModalError(null);
      queryClient.invalidateQueries({ queryKey: ['fg-labels'] });
    },
    onError: (e: unknown) =>
      setModalError(e instanceof Error ? e.message : 'Failed to record reprint')
  });

  if (!hasClaim('fg:view')) {
    return (
      <div className="space-y-4">
        <FgPageHeader title="Production Date & Batch Labeling" subtitle="Label queue and print records" />
        <FgError message="You do not have permission to view labeling (fg:view)." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FgPageHeader
        title="Production Date & Batch Labeling"
        subtitle="Batches awaiting labels, label print records with production and expiry dates, reprints"
      />

      {queueQ.isLoading || historyQ.isLoading ? (
        <FgKpiSkeleton />
      ) : queueQ.isError || historyQ.isError ? (
        <FgError
          message="Failed to load labeling data"
          onRetry={() => {
            queueQ.refetch();
            historyQ.refetch();
          }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <FgKpi label="Labels pending" value={stats.pending.toLocaleString('en-US')} sub={`${stats.batches} batches in queue`} icon={<Tags size={16} />} tone={stats.pending > 0 ? 'amber' : 'emerald'} />
          <FgKpi label="Printed today" value={stats.printedToday.toLocaleString('en-US')} sub="labels" icon={<Printer size={16} />} tone="violet" />
          <FgKpi label="Reprints" value={String(stats.reprints)} sub="all time" icon={<RefreshCw size={16} />} tone="slate" />
          <FgKpi label="Total prints" value={history.length.toLocaleString('en-US')} sub="print records" icon={<Tags size={16} />} tone="slate" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {(['queue', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              tab === t ? 'bg-violet-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t === 'queue' ? `Label queue (${queue.length})` : `Print history (${history.length})`}
          </button>
        ))}
      </div>

      {tab === 'queue' ? (
        <div className={cardShell}>
          <CardHeader icon={<Tags size={16} />} title="Batches awaiting labels" subtitle="One label per packed bag — pending = bags packed − labels printed" />
          {queueQ.isLoading ? (
            <FgSkeleton rows={5} />
          ) : queueQ.isError ? (
            <FgError message="Failed to load queue" onRetry={() => queueQ.refetch()} />
          ) : queue.length === 0 ? (
            <FgEmpty title="Queue is clear" sub="All packed bags have their labels printed." />
          ) : (
            <DataTable<LabelQueueRow>
              keyOf={(r) => r.packagingRunId}
              columns={[
                { key: 'batchNo', label: 'Batch', mono: true, render: (r) => <span className="font-semibold">{r.batchNo}</span> },
                { key: 'productName', label: 'Product' },
                { key: 'productionDate', label: 'Prod. date', render: (r) => fmtDate(r.productionDate) },
                { key: 'bagLabel', label: 'Bag' },
                { key: 'bagsPacked', label: 'Packed', mono: true, render: (r) => r.bagsPacked.toLocaleString('en-US') },
                { key: 'labelsPrinted', label: 'Printed', mono: true, render: (r) => r.labelsPrinted.toLocaleString('en-US') },
                {
                  key: 'pending',
                  label: 'Pending',
                  mono: true,
                  render: (r) => <span className="font-bold text-amber-700">{r.pending.toLocaleString('en-US')}</span>
                },
                {
                  key: 'actions',
                  label: '',
                  render: (r) =>
                    canManage ? (
                      <button
                        className={violetBtn + ' !px-3 !py-1.5 !text-xs'}
                        onClick={() => {
                          setPrintTarget(r);
                          setCopies(String(r.pending));
                          setShelfLife('180');
                          setModalError(null);
                        }}
                      >
                        <Printer size={13} /> Print
                      </button>
                    ) : null
                }
              ]}
              rows={queue}
            />
          )}
        </div>
      ) : (
        <div className={cardShell}>
          <CardHeader icon={<Printer size={16} />} title="Print history" subtitle="Production date, expiry, batch no, product, weight" />
          {historyQ.isLoading ? (
            <FgSkeleton rows={5} />
          ) : historyQ.isError ? (
            <FgError message="Failed to load history" onRetry={() => historyQ.refetch()} />
          ) : history.length === 0 ? (
            <FgEmpty title="No print records" sub="Label prints will be recorded here." />
          ) : (
            <DataTable<LabelPrint>
              columns={[
                { key: 'printedAt', label: 'Printed', render: (r) => fmtDate(r.printedAt) },
                { key: 'batchNo', label: 'Batch', mono: true, render: (r) => <span className="font-semibold">{r.batchNo}</span> },
                { key: 'productName', label: 'Product', render: (r) => r.product?.name ?? '—' },
                { key: 'bagKg', label: 'Weight', mono: true, render: (r) => `${Number(r.bagKg)} kg` },
                { key: 'productionDate', label: 'Prod. date', render: (r) => fmtDate(r.productionDate) },
                { key: 'expiryDate', label: 'Expiry', render: (r) => fmtDate(r.expiryDate) },
                { key: 'copies', label: 'Copies', mono: true, render: (r) => r.copies.toLocaleString('en-US') },
                {
                  key: 'status',
                  label: 'Status',
                  render: (r) =>
                    r.status === 'REPRINTED' ? <FgBadge tone="amber">Reprint</FgBadge> : <FgBadge tone="emerald">Printed</FgBadge>
                },
                {
                  key: 'actions',
                  label: '',
                  render: (r) =>
                    canManage ? (
                      <button
                        className={secondaryBtn + ' !px-3 !py-1.5 !text-xs'}
                        onClick={() => {
                          setReprintTarget(r);
                          setReason('');
                          setModalError(null);
                        }}
                      >
                        <RefreshCw size={13} /> Reprint
                      </button>
                    ) : null
                }
              ]}
              rows={history}
            />
          )}
        </div>
      )}

      {/* Print modal */}
      {printTarget && (
        <FgModal
          title="Print labels"
          subtitle={`${printTarget.batchNo} · ${printTarget.productName}`}
          onClose={() => setPrintTarget(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!Number.isFinite(Number(copies)) || Number(copies) <= 0) {
                setModalError('Copies must be a positive number.');
                return;
              }
              if (!Number.isFinite(Number(shelfLife)) || Number(shelfLife) <= 0) {
                setModalError('Shelf life must be a positive number of days.');
                return;
              }
              printMut.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <Field label="Copies" required hint={`Pending: ${printTarget.pending}`}>
                <NumberInput value={copies} onChange={(e) => setCopies(e.target.value)} min={1} step={1} required />
              </Field>
              <Field label="Shelf life (days)" required>
                <NumberInput value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} min={1} step={1} required />
              </Field>
            </div>
            {expiryPreview ? (
              <LabelPreview
                batchNo={printTarget.batchNo}
                productName={printTarget.productName}
                bagLabel={printTarget.bagLabel}
                bagKg={printTarget.bagKg}
                productionDate={printTarget.productionDate}
                expiryDate={expiryPreview}
                copies={Number(copies) || 0}
              />
            ) : null}
            {modalError ? <p className="text-sm font-semibold text-rose-700">{modalError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryBtn} onClick={() => setPrintTarget(null)}>Cancel</button>
              <button type="submit" className={violetBtn} disabled={printMut.isPending}>
                {printMut.isPending ? 'Recording…' : 'Record print'}
              </button>
            </div>
          </form>
        </FgModal>
      )}

      {/* Reprint modal */}
      {reprintTarget && (
        <FgModal
          title="Reprint labels"
          subtitle={`${reprintTarget.batchNo} · ${reprintTarget.copies} copies`}
          onClose={() => setReprintTarget(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason.trim()) {
                setModalError('A reprint reason is required.');
                return;
              }
              reprintMut.mutate();
            }}
            className="space-y-4"
          >
            <LabelPreview
              batchNo={reprintTarget.batchNo}
              productName={reprintTarget.product?.name ?? '—'}
              bagLabel="—"
              bagKg={Number(reprintTarget.bagKg)}
              productionDate={reprintTarget.productionDate}
              expiryDate={reprintTarget.expiryDate}
              copies={reprintTarget.copies}
            />
            <Field label="Reprint reason" required hint="Recorded on the audit trail">
              <TextArea value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="e.g. smudged print, printer jam, damaged labels…" />
            </Field>
            {modalError ? <p className="text-sm font-semibold text-rose-700">{modalError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryBtn} onClick={() => setReprintTarget(null)}>Cancel</button>
              <button type="submit" className={violetBtn} disabled={reprintMut.isPending}>
                {reprintMut.isPending ? 'Recording…' : 'Record reprint'}
              </button>
            </div>
          </form>
        </FgModal>
      )}
    </div>
  );
}
