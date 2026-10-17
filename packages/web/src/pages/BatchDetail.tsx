import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { ProductionBatch } from '../types';
import { Badge } from '../components/Badge';
import { Button, Card, Field, NumberInput, SectionTitle, Spinner } from '../components/ui';
import { fmtDateTime, fmtPct, fmtQ } from '../lib/format';

export function BatchDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [softQ, setSoftQ] = useState('');
  const [hardQ, setHardQ] = useState('');
  const [foreignQ, setForeignQ] = useState('');

  const batchQ = useQuery({
    queryKey: ['batch', id],
    queryFn: async () => (await api.get<ProductionBatch>(E.batch(id ?? ''))).data,
    enabled: !!id
  });

  const batch = batchQ.data;
  const batchError = batchQ.isError ? batchQ.error : null;
  const editable = batch?.status === 'OPEN';

  const saveBlend = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setNotice(null);
    setSaving(true);
    try {
      const s = Number(softQ);
      const h = Number(hardQ);
      const f = Number(foreignQ);
      if (![s, h, f].every((v) => Number.isFinite(v) && v >= 0) || s + h + f <= 0) {
        setNotice({ ok: false, text: 'Enter non-negative quintal quantities with a positive total.' });
        return;
      }
      const total = s + h + f;
      const r = await submitOrQueue('batch-blend', E.batch(id), {
        batchId: id,
        blendSoftQ: s,
        blendHardQ: h,
        blendForeignQ: f,
        blendSoftPct: (s / total) * 100,
        blendHardPct: (h / total) * 100,
        blendForeignPct: (f / total) * 100
      }, 'put');
      setNotice({
        ok: true,
        text: r.queued
          ? 'Blend saved offline — will sync automatically.'
          : 'Blend ratio recorded and locked to this batch.'
      });
      qc.invalidateQueries({ queryKey: ['batch', id] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save blend.' });
    } finally {
      setSaving(false);
    }
  };

  if (batchQ.isLoading) return <Spinner label="Loading batch..." />;
  if (batchQ.isLoading)
    return (
      <div>
        <Link to="/batches" className="font-semibold text-navy hover:underline">
          Back to batches
        </Link>
        <p className="mt-4 text-slate-500 dark:text-slate-400">Loading batch…</p>
      </div>
    );

  if (batchError)
    return (
      <div>
        <Link to="/batches" className="font-semibold text-navy hover:underline">
          Back to batches
        </Link>
        <p className="mt-4 text-red-600">
          Could not load batch. Check your connection and try again.
        </p>
      </div>
    );

  if (!batch)
    return (
      <div>
        <Link to="/batches" className="font-semibold text-navy hover:underline">
          Back to batches
        </Link>
        <p className="mt-4 text-slate-500 dark:text-slate-400">Batch not found.</p>
      </div>
    );

  const blendRows: Array<[string, number | string, number | string]> = [
    ['Soft wheat', batch.blendSoftPct, batch.blendSoftQ],
    ['Hard wheat', batch.blendHardPct, batch.blendHardQ],
    ['Foreign wheat', batch.blendForeignPct, batch.blendForeignQ]
  ];

  const chain: Array<[string, string]> = [
    ['Intake source(s)', (batch.sources ?? []).map((s) => `${s.intake?.intakeNo ?? s.intakeId} (${fmtQ(s.quintals)} q)`).join(', ') || 'Not recorded yet'],
    ['Blend ratio', blendRows.map(([l, p, q]) => `${l} ${fmtPct(Number(p))} / ${fmtQ(q)} q`).join(' · ')],
    ['Conditioning tank history', `${(batch.shifts ?? []).length} shift run(s) recorded`],
    ['Quality checks', `${(batch.labChecks ?? []).length} lab check(s) recorded`],
    ['CAPA records', `${(batch.capas ?? []).length} CAPA record(s)`],
    ['Packaging', `${(batch.packRuns ?? []).length} packaging run(s)`]
  ];

  return (
    <div>
      <Link to="/batches" className="font-semibold text-navy hover:underline">
        Back to batches
      </Link>
      <div className="mt-2">
        <SectionTitle
          title={`Batch ${batch.batchNo}`}
          sub={`${batch.productType.replace('_', ' ')} — weighed ${fmtQ(batch.wheatWeighedQ)} q on ${fmtDateTime(batch.createdAt)}`}
        />
      </div>

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Blend ratio */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold text-ink">Wheat blend ratio</h3>
            {editable ? <Badge tone="advisory">Set per batch</Badge> : <Badge tone="pass">Locked</Badge>}
          </div>

          <div className="space-y-3">
            {blendRows.map(([label, pct, q]) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
                  <span className="tnum font-bold text-ink">
                    {fmtPct(Number(pct))} ({fmtQ(q)} q)
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-harvest" style={{ width: `${Math.min(100, Number(pct))}%` }} />
                </div>
              </div>
            ))}
            <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">
              The blend ratio is set fresh for every batch by the laboratory and locked permanently.
            </p>
          </div>

          {editable ? (
            <form onSubmit={saveBlend} className="mt-5 space-y-4 border-t border-line pt-5">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Update the blend while the batch is still OPEN — percentages are computed automatically.
              </p>
              <Field label="Soft wheat (q)" required>
                <NumberInput value={softQ} onChange={(e) => setSoftQ(e.target.value)} min={0} step="0.1" placeholder="0.0" />
              </Field>
              <Field label="Hard wheat (q)" required>
                <NumberInput value={hardQ} onChange={(e) => setHardQ(e.target.value)} min={0} step="0.1" placeholder="0.0" />
              </Field>
              <Field label="Foreign wheat (q)" required>
                <NumberInput value={foreignQ} onChange={(e) => setForeignQ(e.target.value)} min={0} step="0.1" placeholder="0.0" />
              </Field>
              <Button type="submit" loading={saving} className="w-full">
                Save blend ratio
              </Button>
            </form>
          ) : null}
        </Card>

        {/* Farm-to-bag chain */}
        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">Farm-to-bag traceability chain</h3>
          <ol className="space-y-3">
            {chain.map(([label, text], i) => (
              <li key={label} className="flex gap-3">
                <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{label}</p>
                  <p className="truncate text-sm text-slate-500 dark:text-slate-400" title={text}>
                    {text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
