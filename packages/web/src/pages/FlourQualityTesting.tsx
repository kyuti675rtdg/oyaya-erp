import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, PackageCheck } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { FlourQualityTest, ProductionBatch, QcThresholdRow, QcVerdict } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, Card, EmptyState, ErrorBox, Field, NumberInput, SectionTitle, Select, Spinner, TextArea } from '../components/ui';
import { fmtDateTime } from '../lib/format';

const cardShell = 'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

const PRODUCTS = ['Duket', 'Duket (special grade)', 'Furishka', 'Fino', 'Fernacho'] as const;

interface ParamDef {
  key: 'flourMoisturePct' | 'wetGlutenPct' | 'dryGlutenPct' | 'ashPct' | 'colorScore' | 'granulationPct' | 'impurityPct';
  label: string;
  code: string; // threshold code prefix (category 'flour')
  fallbackHint: string;
  fallbackBreach: (v: number) => boolean;
}

const PARAMS: ParamDef[] = [
  { key: 'flourMoisturePct', label: 'Flour moisture (%)', code: 'flour.moisture', fallbackHint: 'Standard: ≤ 14.0%', fallbackBreach: (v) => v > 14.0 },
  { key: 'wetGlutenPct', label: 'Wet gluten (%)', code: 'flour.wetGluten', fallbackHint: 'Standard: 30 – 33%', fallbackBreach: (v) => v < 30 || v > 33 },
  { key: 'dryGlutenPct', label: 'Dry gluten (%)', code: 'flour.dryGluten', fallbackHint: 'Standard: 0.8 – 1.6%', fallbackBreach: (v) => v < 0.8 || v > 1.6 },
  { key: 'ashPct', label: 'Ash content (%)', code: 'flour.ash', fallbackHint: 'Standard: ≤ 0.7%', fallbackBreach: (v) => v > 0.7 },
  { key: 'colorScore', label: 'Color', code: 'flour.color', fallbackHint: 'Standard: ≥ 70', fallbackBreach: (v) => v < 70 },
  { key: 'granulationPct', label: 'Granulation (%)', code: 'flour.granulation', fallbackHint: 'Standard: 75 – 80%', fallbackBreach: (v) => v < 75 || v > 80 },
  { key: 'impurityPct', label: 'Impurity (%)', code: 'flour.impurity', fallbackHint: 'Standard: < 3.0%', fallbackBreach: (v) => v >= 3.0 }
];

const VERDICT_TONE: Record<QcVerdict, 'pass' | 'critical' | 'neutral'> = {
  PASS: 'pass',
  FAIL: 'critical',
  UNTESTED: 'neutral'
};

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtVal(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}

function thresholdHint(t: QcThresholdRow | undefined, fallback: string): string {
  if (!t) return fallback;
  const min = t.minValue === null || t.minValue === undefined ? null : Number(t.minValue);
  const max = t.maxValue === null || t.maxValue === undefined ? null : Number(t.maxValue);
  const unit = t.unit ? ` ${t.unit}` : '';
  if (min !== null && max !== null) return `Standard: ${min} – ${max}${unit}`;
  if (min !== null) return `Standard: ≥ ${min}${unit}`;
  if (max !== null) return `Standard: ≤ ${max}${unit}`;
  return fallback;
}

export function FlourQualityTesting() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [batchId, setBatchId] = useState('');
  const [productLabel, setProductLabel] = useState<string>(PRODUCTS[0]);
  const [sampleTime, setSampleTime] = useState(todayLocal());
  const [notes, setNotes] = useState('');
  const [values, setValues] = useState<Record<string, string>>({
    flourMoisturePct: '',
    wetGlutenPct: '',
    dryGlutenPct: '',
    ashPct: '',
    colorScore: '',
    granulationPct: '',
    impurityPct: ''
  });

  const batchesQ = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(E.batches)).data
  });
  const thresholdsQ = useQuery({
    queryKey: ['qc-thresholds-flour'],
    queryFn: async () =>
      (await api.get<QcThresholdRow[]>(E.qcThresholds, { params: { category: 'flour' } })).data
  });
  const testsQ = useQuery({
    queryKey: ['flour-tests'],
    queryFn: async () => (await api.get<FlourQualityTest[]>(E.qcFlourTests)).data
  });

  const thresholdByCode = useMemo(() => {
    const m = new Map<string, QcThresholdRow>();
    for (const t of thresholdsQ.data ?? []) m.set(t.code, t);
    return m;
  }, [thresholdsQ.data]);

  const breached = useMemo(() => {
    const out: string[] = [];
    for (const p of PARAMS) {
      const raw = values[p.key];
      if (raw === '' || raw === undefined) continue;
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      const t = thresholdByCode.get(p.code);
      const bad = t
        ? (t.minValue !== null && t.minValue !== undefined && v < Number(t.minValue)) ||
          (t.maxValue !== null && t.maxValue !== undefined && v > Number(t.maxValue))
        : p.fallbackBreach(v);
      if (bad) out.push(p.key);
    }
    return out;
  }, [values, thresholdByCode]);

  const enteredCount = useMemo(
    () => PARAMS.filter((p) => values[p.key] !== '' && Number.isFinite(Number(values[p.key]))).length,
    [values]
  );

  const previewVerdict: QcVerdict =
    enteredCount === 0 ? 'UNTESTED' : breached.length > 0 ? 'FAIL' : 'PASS';

  const latestPerProduct = useMemo(() => {
    const map = new Map<string, FlourQualityTest>();
    for (const t of testsQ.data ?? []) {
      const cur = map.get(t.productLabel);
      if (!cur || new Date(t.sampleTime) > new Date(cur.sampleTime)) map.set(t.productLabel, t);
    }
    return map;
  }, [testsQ.data]);

  const set = (key: string, v: string) => setValues((p) => ({ ...p, [key]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      if (!batchId) {
        setNotice({ ok: false, text: 'Select the production batch under test.' });
        setSaving(false);
        return;
      }
      const payload: Record<string, unknown> = {
        batchId,
        productLabel,
        sampleTime: new Date(sampleTime).toISOString(),
        notes: notes.trim() === '' ? null : notes.trim()
      };
      for (const p of PARAMS) {
        const raw = values[p.key];
        if (raw === '') continue;
        const v = Number(raw);
        if (!Number.isFinite(v)) {
          setNotice({ ok: false, text: `Enter a numeric value for ${p.label}.` });
          setSaving(false);
          return;
        }
        payload[p.key] = v;
      }
      const r = await submitOrQueue<{ test: FlourQualityTest; capa: unknown }>(
        'flour-test',
        E.qcFlourTests,
        payload
      );
      const verdict = previewVerdict;
      setNotice({
        ok: true,
        text: r.queued
          ? 'Flour test saved offline — will sync automatically.'
          : verdict === 'FAIL'
            ? 'Flour test recorded: FAIL — out-of-range parameters opened a CAPA automatically.'
            : verdict === 'PASS'
              ? 'Flour test recorded: PASS — all parameters within standard.'
              : 'Flour test recorded (no parameters entered).'
      });
      qc.invalidateQueries({ queryKey: ['flour-tests'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record flour test.' });
    } finally {
      setSaving(false);
    }
  };

  const tests = testsQ.data ?? [];

  return (
    <div>
      <SectionTitle
        title="Flour Quality Testing"
        sub="Finished-flour acceptance per batch and product — moisture, gluten, ash, color, granulation, impurity"
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

      {/* Latest verdict per product */}
      <div className={`mb-4 ${cardShell}`}>
        <CardHeader
          icon={<PackageCheck size={16} />}
          title="Latest verdict per product"
          subtitle="Most recent flour test result for each product line"
        />
        {testsQ.isLoading ? (
          <Spinner label="Loading verdicts..." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {PRODUCTS.map((p) => {
              const latest = latestPerProduct.get(p);
              return (
                <div key={p} className="rounded-xl border border-slate-200/70 p-3 text-center">
                  <p className="text-xs font-bold text-slate-700">{p}</p>
                  <div className="mt-2">
                    {latest ? (
                      <Badge tone={VERDICT_TONE[latest.verdict]}>{latest.verdict}</Badge>
                    ) : (
                      <Badge tone="neutral">No test</Badge>
                    )}
                  </div>
                  {latest ? (
                    <p className="mt-1.5 tabular-nums text-[11px] text-slate-400">
                      {fmtDateTime(latest.sampleTime)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-ink">
            <FlaskConical size={16} className="text-violet-600" /> Record flour test
          </h3>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Production batch" required>
                <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} required>
                  <option value="">Select batch</option>
                  {(batchesQ.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNo} — {b.status}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Product" required>
                <Select value={productLabel} onChange={(e) => setProductLabel(e.target.value)} required>
                  {PRODUCTS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Sample time" required>
                <input
                  type="datetime-local"
                  value={sampleTime}
                  onChange={(e) => setSampleTime(e.target.value)}
                  className="touch w-full rounded-lg border border-line bg-white px-4 text-base focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/20"
                  required
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PARAMS.map((p) => {
                const raw = values[p.key];
                const bad = breached.includes(p.key);
                const hint = thresholdHint(thresholdByCode.get(p.code), p.fallbackHint);
                return (
                  <div
                    key={p.key}
                    className={`rounded-lg border p-3 ${bad ? 'border-critical-text/50 bg-critical-bg' : 'border-line'}`}
                  >
                    <Field label={p.label} hint={hint}>
                      <NumberInput
                        value={raw}
                        onChange={(e) => set(p.key, e.target.value)}
                        step="0.01"
                        placeholder="0.00"
                      />
                    </Field>
                    {bad ? <p className="mt-1 text-xs font-bold text-critical-text">OUT OF RANGE</p> : null}
                  </div>
                );
              })}
            </div>

            <Field label="Notes (optional)">
              <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations, equipment used, ..." />
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
              <span className="text-sm text-slate-600">
                Auto verdict: {enteredCount} parameter(s) entered
              </span>
              <Badge tone={VERDICT_TONE[previewVerdict]} className="text-sm">{previewVerdict}</Badge>
            </div>

            <Button type="submit" loading={saving} className="w-full">
              Record flour test
            </Button>
          </form>
        </Card>

        <div className={cardShell}>
          <CardHeader
            icon={<FlaskConical size={16} />}
            title="About these standards"
            subtitle="Flour category thresholds — configurable"
          />
          <ul className="space-y-2 text-sm text-slate-600">
            {PARAMS.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-2">
                <span>{p.label}</span>
                <span className="tabular-nums font-semibold text-slate-800">
                  {thresholdHint(thresholdByCode.get(p.code), p.fallbackHint).replace('Standard: ', '')}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-400">
            A FAIL verdict automatically opens a CAPA and alerts the lab and production heads.
            Adjust the numbers in Quality Standards if the mill's specification changes.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <SectionTitle title="Test history" />
        {testsQ.isLoading ? (
          <Spinner label="Loading flour tests..." />
        ) : testsQ.isError ? (
          <ErrorBox message="Could not load flour tests." onRetry={() => testsQ.refetch()} />
        ) : tests.length === 0 ? (
          <EmptyState title="No flour tests yet" sub="Record the first finished-flour test above." />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <DataTable<FlourQualityTest>
                rows={tests}
                columns={[
                  { key: 'sampleTime', label: 'Sampled', render: (r) => <span className="tabular-nums">{fmtDateTime(r.sampleTime)}</span> },
                  { key: 'batch', label: 'Batch', render: (r) => r.batch?.batchNo ?? '—' },
                  { key: 'productLabel', label: 'Product' },
                  { key: 'flourMoisturePct', label: 'Moist %', mono: true, render: (r) => fmtVal(r.flourMoisturePct) },
                  { key: 'wetGlutenPct', label: 'Wet gl %', mono: true, render: (r) => fmtVal(r.wetGlutenPct) },
                  { key: 'dryGlutenPct', label: 'Dry gl %', mono: true, render: (r) => fmtVal(r.dryGlutenPct) },
                  { key: 'ashPct', label: 'Ash %', mono: true, render: (r) => fmtVal(r.ashPct) },
                  { key: 'colorScore', label: 'Color', mono: true, render: (r) => fmtVal(r.colorScore) },
                  { key: 'granulationPct', label: 'Gran %', mono: true, render: (r) => fmtVal(r.granulationPct) },
                  { key: 'impurityPct', label: 'Imp %', mono: true, render: (r) => fmtVal(r.impurityPct) },
                  { key: 'verdict', label: 'Verdict', render: (r) => <Badge tone={VERDICT_TONE[r.verdict]}>{r.verdict}</Badge> }
                ]}
              />
            </div>
            {/* Mobile stacked cards */}
            <div className="space-y-3 md:hidden">
              {tests.map((t) => (
                <div key={t.id} className="rounded-xl border border-slate-200/70 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{t.productLabel}</p>
                      <p className="tabular-nums text-xs text-slate-500">
                        {t.batch?.batchNo ?? '—'} · {fmtDateTime(t.sampleTime)}
                      </p>
                    </div>
                    <Badge tone={VERDICT_TONE[t.verdict]}>{t.verdict}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div className="flex justify-between"><dt className="text-slate-500">Moisture</dt><dd className="tabular-nums font-semibold">{fmtVal(t.flourMoisturePct)}%</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500">Wet gluten</dt><dd className="tabular-nums font-semibold">{fmtVal(t.wetGlutenPct)}%</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500">Dry gluten</dt><dd className="tabular-nums font-semibold">{fmtVal(t.dryGlutenPct)}%</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500">Ash</dt><dd className="tabular-nums font-semibold">{fmtVal(t.ashPct)}%</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500">Color</dt><dd className="tabular-nums font-semibold">{fmtVal(t.colorScore)}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500">Granulation</dt><dd className="tabular-nums font-semibold">{fmtVal(t.granulationPct)}%</dd></div>
                  </dl>
                  {t.outOfRange.length > 0 ? (
                    <p className="mt-2 text-xs font-medium text-critical-text">{t.outOfRange.join('; ')}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
