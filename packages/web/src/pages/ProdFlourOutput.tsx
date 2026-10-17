import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, PackageCheck } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import { useAuth } from '../store/auth';
import type { FlourOutput, FlourProductType, ProductionBatch } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import {
  Button,
  EmptyState,
  ErrorBox,
  Field,
  NumberInput,
  SectionTitle,
  Select,
  Spinner
} from '../components/ui';
import { fmtDateTime, fmtQ } from '../lib/format';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const PRODUCT_OPTIONS: { value: FlourProductType; label: string }[] = [
  { value: 'DUKET_NORMAL', label: 'Duket — Normal grade' },
  { value: 'DUKET_SPECIAL', label: 'Duket — Special grade' },
  { value: 'FURISHKA', label: 'Furishka' },
  { value: 'FINO', label: 'Fino' },
  { value: 'FERNACHO', label: 'Fernacho' }
];

const EXTRACTION_MIN = 78;

function productLabel(v: string): string {
  return PRODUCT_OPTIONS.find((o) => o.value === v)?.label ?? v.replace('_', ' ');
}

function isDuket(v: string): boolean {
  return v === 'DUKET_NORMAL' || v === 'DUKET_SPECIAL';
}

interface BatchExtraction {
  id: string;
  batchId: string;
  batchNo: string;
  wheatQ: number;
  flourQ: number;
  extraction: number | null;
  flagged: boolean;
}

export function ProdFlourOutput() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('production:manage');

  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastResult, setLastResult] = useState<{
    extractionPct: number;
    belowYieldFlag: boolean;
    productType: FlourProductType;
  } | null>(null);

  const [batchId, setBatchId] = useState('');
  const [productType, setProductType] = useState<FlourProductType>('DUKET_NORMAL');
  const [quintals, setQuintals] = useState('');

  const outputsQ = useQuery({
    queryKey: ['prod-flour-outputs'],
    queryFn: async () => (await api.get<FlourOutput[]>(E.prodFlourOutputs)).data
  });
  const batchesQ = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(E.batches)).data
  });

  const batchById = useMemo(() => {
    const m = new Map<string, ProductionBatch>();
    for (const b of batchesQ.data ?? []) m.set(b.id, b);
    return m;
  }, [batchesQ.data]);

  const perBatch: BatchExtraction[] = useMemo(() => {
    const m = new Map<string, BatchExtraction>();
    for (const o of outputsQ.data ?? []) {
      const b = batchById.get(o.batchId);
      if (!b) continue;
      const row =
        m.get(o.batchId) ??
        ({
          id: o.batchId,
          batchId: o.batchId,
          batchNo: b.batchNo,
          wheatQ: Number(b.wheatWeighedQ),
          flourQ: 0,
          extraction: null,
          flagged: false
        } as BatchExtraction);
      row.flourQ += Number(o.quintals);
      row.extraction = row.wheatQ > 0 ? (row.flourQ / row.wheatQ) * 100 : null;
      row.flagged = row.flagged || o.belowYieldFlag;
      m.set(o.batchId, row);
    }
    return [...m.values()].sort((a, b) => a.batchNo.localeCompare(b.batchNo));
  }, [outputsQ.data, batchById]);

  const selectedBatch = batchId ? batchById.get(batchId) : undefined;
  const previewExtraction =
    selectedBatch && Number(selectedBatch.wheatWeighedQ) > 0 && Number(quintals) > 0
      ? (Number(quintals) / Number(selectedBatch.wheatWeighedQ)) * 100
      : null;

  const record = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setLastResult(null);
    setSaving(true);
    try {
      const q = Number(quintals);
      if (!batchId) {
        setNotice({ ok: false, text: 'Select a production batch.' });
        return;
      }
      if (!Number.isFinite(q) || q <= 0) {
        setNotice({ ok: false, text: 'Enter a positive output quantity.' });
        return;
      }
      const r = await submitOrQueue<{ extractionPct: number; belowYieldFlag: boolean }>(
        'prod-flour-output',
        E.prodFlourOutputs,
        { batchId, productType, quintals: q }
      );
      if (r.queued) {
        setNotice({ ok: true, text: 'Output saved offline — extraction will be computed on sync.' });
      } else {
        const res = r.data ?? { extractionPct: 0, belowYieldFlag: false };
        setLastResult({ ...res, productType });
        setNotice({
          ok: !res.belowYieldFlag,
          text: res.belowYieldFlag
            ? `Recorded — extraction ${res.extractionPct.toFixed(1)}% is BELOW ${EXTRACTION_MIN}%. A yield alert was raised.`
            : `Recorded — extraction ${res.extractionPct.toFixed(1)}%.`
        });
      }
      setQuintals('');
      qc.invalidateQueries({ queryKey: ['prod-flour-outputs'] });
      qc.invalidateQueries({ queryKey: ['prod-yield-alerts'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record output.' });
    } finally {
      setSaving(false);
    }
  };

  const outputs = outputsQ.data ?? [];

  return (
    <div>
      <SectionTitle
        title="Flour Output & Extraction Rate"
        sub={`Extraction = flour ÷ wheat × 100 — Duket below ${EXTRACTION_MIN}% is auto-flagged`}
      />

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {canManage ? (
          <div className={cardShell}>
            <CardHeader
              icon={<PackageCheck size={16} />}
              title="Record flour output"
              subtitle="Per batch, per product"
            />
            <form onSubmit={record} className="space-y-4">
              <Field label="Production batch" required>
                <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} required>
                  <option value="">Select batch</option>
                  {(batchesQ.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNo} — {fmtQ(b.wheatWeighedQ)} q weighed
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Product" required>
                <Select
                  value={productType}
                  onChange={(e) => setProductType(e.target.value as FlourProductType)}
                >
                  {PRODUCT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Output (quintals)" required>
                <NumberInput
                  value={quintals}
                  onChange={(e) => setQuintals(e.target.value)}
                  min={0}
                  step="0.1"
                  placeholder="0.0"
                />
              </Field>
              {previewExtraction !== null ? (
                <div
                  className={`rounded-xl border px-4 py-3 ${
                    previewExtraction < EXTRACTION_MIN
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-emerald-200 bg-emerald-50'
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Preview extraction
                  </p>
                  <p
                    className={`tabular-nums text-2xl font-bold ${
                      previewExtraction < EXTRACTION_MIN ? 'text-amber-700' : 'text-emerald-700'
                    }`}
                  >
                    {previewExtraction.toFixed(1)}%
                  </p>
                  {previewExtraction < EXTRACTION_MIN && isDuket(productType) ? (
                    <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700">
                      <AlertTriangle size={12} /> This will raise a RED yield alert (Duket &lt; {EXTRACTION_MIN}%).
                    </p>
                  ) : null}
                  {previewExtraction < EXTRACTION_MIN && !isDuket(productType) ? (
                    <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700">
                      <AlertTriangle size={12} /> This will raise an AMBER yield alert.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <Button type="submit" loading={saving} className="w-full">
                Record output
              </Button>
            </form>

            {lastResult ? (
              <div
                className={`mt-4 rounded-xl border p-4 ${
                  lastResult.belowYieldFlag
                    ? lastResult.productType.startsWith('DUKET')
                      ? 'border-critical-text/50 bg-critical-bg'
                      : 'border-advisory-text/40 bg-advisory-bg'
                    : 'border-emerald-200 bg-emerald-50'
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Last entry</p>
                <p className="tabular-nums text-xl font-bold text-slate-800 dark:text-slate-100">
                  {lastResult.extractionPct.toFixed(1)}%
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {productLabel(lastResult.productType)}{' '}
                  {lastResult.belowYieldFlag ? '— flagged' : '— within target'}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={canManage ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <div className={cardShell}>
            <CardHeader
              icon={<PackageCheck size={16} />}
              title="Extraction per batch"
              subtitle="Cumulative flour output vs weighed wheat"
            />
            {outputsQ.isLoading || batchesQ.isLoading ? (
              <Spinner label="Loading extraction data..." />
            ) : outputsQ.isError ? (
              <ErrorBox message="Failed to load outputs." onRetry={() => outputsQ.refetch()} />
            ) : (
              <>
                <div className="hidden md:block">
                  <DataTable<BatchExtraction>
                    keyOf={(r) => r.batchId}
                    columns={[
                      {
                        key: 'batchNo',
                        label: 'Batch',
                        render: (r) => <span className="tabular-nums font-bold text-slate-800 dark:text-slate-100">{r.batchNo}</span>
                      },
                      { key: 'wheatQ', label: 'Wheat (q)', mono: true, render: (r) => fmtQ(r.wheatQ) },
                      { key: 'flourQ', label: 'Flour (q)', mono: true, render: (r) => fmtQ(r.flourQ) },
                      {
                        key: 'extraction',
                        label: 'Extraction',
                        mono: true,
                        render: (r) =>
                          r.extraction === null ? (
                            '-'
                          ) : (
                            <span
                              className={`font-bold ${
                                r.extraction < EXTRACTION_MIN ? 'text-rose-600' : 'text-emerald-700'
                              }`}
                            >
                              {r.extraction.toFixed(1)}%
                            </span>
                          )
                      },
                      {
                        key: 'flag',
                        label: 'Flag',
                        render: (r) =>
                          r.flagged ? (
                            <Badge tone="critical">Low yield</Badge>
                          ) : r.extraction !== null ? (
                            <Badge tone="pass">OK</Badge>
                          ) : (
                            <Badge tone="neutral">—</Badge>
                          )
                      }
                    ]}
                    rows={perBatch}
                    emptyTitle="No flour output recorded"
                    emptySub="Record flour output per batch to compute extraction."
                  />
                </div>
                <div className="space-y-3 md:hidden">
                  {perBatch.length === 0 ? (
                    <EmptyState title="No flour output recorded" sub="Record flour output per batch to compute extraction." />
                  ) : (
                    perBatch.map((r) => (
                      <div key={r.batchId} className="rounded-xl border border-slate-200/70 p-4">
                        <div className="flex items-center justify-between">
                          <span className="tabular-nums font-bold text-slate-800 dark:text-slate-100">{r.batchNo}</span>
                          {r.flagged ? (
                            <Badge tone="critical">Low yield</Badge>
                          ) : (
                            <Badge tone="pass">OK</Badge>
                          )}
                        </div>
                        <p className="tabular-nums mt-1 text-sm text-slate-600 dark:text-slate-300">
                          Flour {fmtQ(r.flourQ)} q / Wheat {fmtQ(r.wheatQ)} q
                        </p>
                        <p
                          className={`tabular-nums mt-1 text-lg font-bold ${
                            (r.extraction ?? 100) < EXTRACTION_MIN ? 'text-rose-600' : 'text-emerald-700'
                          }`}
                        >
                          {r.extraction !== null ? `${r.extraction.toFixed(1)}%` : '—'}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <div className={`${cardShell} mt-4`}>
            <CardHeader icon={<PackageCheck size={16} />} title="Output entries" subtitle="Latest first" />
            {outputsQ.isLoading ? (
              <Spinner label="Loading entries..." />
            ) : outputs.length === 0 ? (
              <EmptyState title="No entries yet" sub="Record flour output to see entries here." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {outputs.slice(0, 12).map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{productLabel(o.productType)}</p>
                      <p className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
                        {batchById.get(o.batchId)?.batchNo ?? '—'} · {fmtDateTime(o.loggedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-sm font-bold text-slate-800 dark:text-slate-100">{fmtQ(o.quintals)} q</span>
                      {o.belowYieldFlag ? (
                        <Badge tone="critical">{Number(o.extractionPct ?? 0).toFixed(1)}%</Badge>
                      ) : o.extractionPct != null ? (
                        <Badge tone="pass">{Number(o.extractionPct).toFixed(1)}%</Badge>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
