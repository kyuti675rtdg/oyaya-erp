import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { LabCheck, ShiftRun } from '../types';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner } from '../components/ui';
import { fmtDateTime } from '../lib/format';

interface ParamDef {
  key: 'impurityPct' | 'wheatMoistureBefore' | 'wheatMoistureAfter' | 'flourMoisturePct' | 'wetGlutenPct' | 'glutenElasticity' | 'dryGlutenPct' | 'ashPct' | 'colorScore' | 'granulationPct';
  label: string;
  hint: string;
  breach: (v: number | string) => boolean;
}

const PARAMS: ParamDef[] = [
  { key: 'impurityPct', label: 'Impurity (%)', hint: 'Standard: below 3.0', breach: (v) => Number(v) >= 3.0 },
  { key: 'wheatMoistureBefore', label: 'Wheat moisture before conditioning (%)', hint: 'Standard: 10.0 – 13.3', breach: (v) => Number(v) < 10.0 || Number(v) > 13.3 },
  { key: 'wheatMoistureAfter', label: 'Wheat moisture after conditioning (%)', hint: 'Standard: 15.0 – 16.5', breach: (v) => Number(v) < 15.0 || Number(v) > 16.5 },
  { key: 'flourMoisturePct', label: 'Flour moisture (%)', hint: 'Standard: 14.0 or below', breach: (v) => Number(v) > 14.0 },
  { key: 'wetGlutenPct', label: 'Wet gluten (%)', hint: 'Standard: 30 – 33', breach: (v) => Number(v) < 30 || Number(v) > 33 },
  { key: 'glutenElasticity', label: 'Gluten elasticity', hint: 'Standard: strong or medium', breach: (v) => v === 'WEAK' },
  { key: 'dryGlutenPct', label: 'Dry gluten (%)', hint: 'Standard: 0.8 – 1.6', breach: (v) => Number(v) < 0.8 || Number(v) > 1.6 },
  { key: 'ashPct', label: 'Ash content (%)', hint: 'Standard: 0.7 or below', breach: (v) => Number(v) > 0.7 },
  { key: 'colorScore', label: 'Color', hint: 'Standard: 70 or above', breach: (v) => Number(v) < 70 },
  { key: 'granulationPct', label: 'Granulation / particle size (%)', hint: 'Standard: 75 – 80', breach: (v) => Number(v) < 75 || Number(v) > 80 }
];

const NUMERIC_KEYS = PARAMS.map((p) => p.key).filter((k) => k !== 'glutenElasticity');

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtVal(v: number | string | null | undefined, digits = 2): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

export function QcChecks() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [sampleTime, setSampleTime] = useState(todayLocal());
  const [shiftRunId, setShiftRunId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({
    impurityPct: '',
    wheatMoistureBefore: '',
    wheatMoistureAfter: '',
    flourMoisturePct: '',
    wetGlutenPct: '',
    glutenElasticity: 'STRONG',
    dryGlutenPct: '',
    ashPct: '',
    colorScore: '',
    granulationPct: ''
  });

  const checksQ = useQuery({
    queryKey: ['lab-checks'],
    queryFn: async () => (await api.get<LabCheck[]>(E.labChecks)).data
  });
  const shiftsQ = useQuery({
    queryKey: ['shifts'],
    queryFn: async () => (await api.get<ShiftRun[]>(E.shifts)).data
  });

  const averages = useMemo(() => {
    const checks = checksQ.data ?? [];
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const groups: Record<string, LabCheck[]> = {
      Today: checks.filter((c) => new Date(c.sampleTime) >= dayStart),
      Recent: checks.slice(0, 10)
    };
    const result: Record<string, Record<string, number>> = {};
    for (const [name, list] of Object.entries(groups)) {
      const avgs: Record<string, number> = {};
      for (const key of NUMERIC_KEYS) {
        const vals = list
          .map((c) => (c[key] === null || c[key] === undefined ? NaN : Number(c[key])))
          .filter((n) => Number.isFinite(n));
        if (vals.length > 0) avgs[key] = vals.reduce((s, n) => s + n, 0) / vals.length;
      }
      result[name] = avgs;
    }
    return result;
  }, [checksQ.data]);

  const set = (key: string, v: string) => setValues((p) => ({ ...p, [key]: v }));

  const breachedKeys = PARAMS.filter((p) => {
    const v = values[p.key];
    return v !== '' && v !== undefined && p.breach(v);
  }).map((p) => p.key);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      if (!shiftRunId) {
        setNotice({ ok: false, text: 'Select the shift under test.' });
        setSaving(false);
        return;
      }
      const payload: Record<string, unknown> = {
        shiftRunId,
        sampleTime: new Date(sampleTime).toISOString()
      };
      for (const p of PARAMS) {
        const raw = values[p.key];
        if (p.key === 'glutenElasticity') {
          payload.glutenElasticity = raw;
          continue;
        }
        const v = Number(raw);
        if (!Number.isFinite(v)) {
          setNotice({ ok: false, text: `Enter a numeric value for ${p.label}.` });
          setSaving(false);
          return;
        }
        payload[p.key] = v;
      }
      const r = await submitOrQueue('lab-check', E.labChecks, payload);
      setNotice({
        ok: true,
        text: r.queued
          ? 'Lab check saved offline — will sync automatically.'
          : breachedKeys.length > 0
            ? `Lab check recorded with ${breachedKeys.length} out-of-range parameter(s) — a CAPA record was opened automatically.`
            : 'Lab check recorded within standard ranges.'
      });
      qc.invalidateQueries({ queryKey: ['lab-checks'] });
      qc.invalidateQueries({ queryKey: ['lab-check-latest'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record lab check.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="In-Process Lab Checks"
        sub="Mandatory flour inspection every 2 hours during active shifts — 10 parameters"
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
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-4 text-base font-bold text-ink">Record 2-hour check</h3>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Sample time" required>
                <input
                  type="datetime-local"
                  value={sampleTime}
                  onChange={(e) => setSampleTime(e.target.value)}
                  className="touch w-full rounded-lg border border-line bg-white px-4 text-base focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/20"
                  required
                />
              </Field>
              <Field label="Shift under test" required>
                <Select value={shiftRunId} onChange={(e) => setShiftRunId(e.target.value)} required>
                  <option value="">Select shift</option>
                  {(shiftsQ.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {fmtDateTime(s.shiftDate)} — {s.shift}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PARAMS.map((p) => {
                const raw = values[p.key];
                const bad = raw !== '' && p.breach(raw);
                return (
                  <div
                    key={p.key}
                    className={`rounded-lg border p-3 ${bad ? 'border-critical-text/50 bg-critical-bg' : 'border-line'}`}
                  >
                    {p.key === 'glutenElasticity' ? (
                      <Field label={p.label} hint={p.hint}>
                        <Select value={raw} onChange={(e) => set(p.key, e.target.value)}>
                          <option value="STRONG">Strong</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="WEAK">Weak</option>
                        </Select>
                      </Field>
                    ) : (
                      <Field label={p.label} hint={p.hint}>
                        <NumberInput value={raw} onChange={(e) => set(p.key, e.target.value)} step="0.01" placeholder="0.00" />
                      </Field>
                    )}
                    {bad ? <p className="mt-1 text-xs font-bold text-critical-text">OUT OF RANGE</p> : null}
                  </div>
                );
              })}
            </div>

            <Button type="submit" loading={saving} className="w-full">
              Record lab check
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">Shift & daily averages</h3>
          {checksQ.isLoading ? (
            <p className="text-sm text-slate-500">Loading averages...</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(averages).map(([title, avgs]) => (
                <div key={title}>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
                  {Object.keys(avgs).length > 0 ? (
                    <ul className="space-y-1 text-sm">
                      {Object.entries(avgs).map(([k, v]) => (
                        <li key={k} className="flex justify-between">
                          <span className="text-slate-600">{k}</span>
                          <span className="tnum font-semibold text-ink">{v.toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-400">No data yet.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <SectionTitle title="Check history" />
        {checksQ.isLoading ? (
          <Spinner label="Loading lab checks..." />
        ) : (
          <DataTable<LabCheck>
            columns={[
              { key: 'sampleTime', label: 'Sample time', render: (r) => fmtDateTime(r.sampleTime) },
              {
                key: 'result',
                label: 'Result',
                render: (r) =>
                  r.outOfRange.length > 0 ? (
                    <Badge tone="critical">{r.outOfRange.length} out of range</Badge>
                  ) : (
                    <Badge tone="pass">In spec</Badge>
                  )
              },
              { key: 'impurityPct', label: 'Impurity', mono: true, render: (r) => `${fmtVal(r.impurityPct)}%` },
              { key: 'flourMoisturePct', label: 'Flour moist.', mono: true, render: (r) => `${fmtVal(r.flourMoisturePct)}%` },
              { key: 'wetGlutenPct', label: 'Wet gluten', mono: true, render: (r) => `${fmtVal(r.wetGlutenPct)}%` },
              { key: 'ashPct', label: 'Ash', mono: true, render: (r) => `${fmtVal(r.ashPct)}%` },
              { key: 'colorScore', label: 'Color', mono: true, render: (r) => fmtVal(r.colorScore, 0) }
            ]}
            rows={checksQ.data ?? []}
            emptyTitle="No lab checks yet"
            emptySub="The first 2-hour check of the shift will appear here."
          />
        )}
      </div>
    </div>
  );
}
