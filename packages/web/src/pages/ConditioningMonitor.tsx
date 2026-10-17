import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Droplets, Play, Timer } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { ConditioningCycle, ConditioningTank } from '../types';
import { CardHeader } from '../components/CardHeader';
import {
  Button,
  EmptyState,
  Field,
  NumberInput,
  SectionTitle,
  Select,
  Spinner,
  TextInput
} from '../components/ui';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

function fmtCountdown(remainingHrs: number): string {
  const totalMin = Math.max(0, Math.round(remainingHrs * 60));
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function cycleStatus(c: ConditioningCycle): 'Active' | 'Completed' | 'Released' {
  if (c.releasedAt) return 'Released';
  if (c.completedAt) return 'Completed';
  return 'Active';
}

const statusPill: Record<string, string> = {
  Active: 'bg-blue-100 text-blue-800',
  Completed: 'bg-emerald-100 text-emerald-800',
  Released: 'bg-slate-100 text-slate-600'
};

function moistureWarning(moistureAfter: string): string | null {
  const m = Number(moistureAfter);
  if (!Number.isFinite(m)) return 'Enter a valid moisture percentage.';
  if (m < 15.0) return `Moisture ${m}% is below the 15.0% target — grain may be under-conditioned.`;
  if (m > 16.5) return `Moisture ${m}% exceeds the 16.5% target — risk of spoilage or over-conditioning.`;
  return null;
}

export function ConditioningMonitor() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Start conditioning form
  const [startTank, setStartTank] = useState('');
  const [startHrs, setStartHrs] = useState('8');
  const [startWater, setStartWater] = useState('');
  const [startMoisture, setStartMoisture] = useState('');
  const [startNotes, setStartNotes] = useState('');

  // Water log form (per tank code)
  const [waterQty, setWaterQty] = useState<Record<string, string>>({});
  const [waterNote, setWaterNote] = useState<Record<string, string>>({});

  // Complete form (per tank code)
  const [completeMoisture, setCompleteMoisture] = useState<Record<string, string>>({});
  const [completeNotes, setCompleteNotes] = useState<Record<string, string>>({});

  const tanksQ = useQuery({
    queryKey: ['tanks'],
    queryFn: async () => (await api.get<ConditioningTank[]>(E.tanks)).data,
    refetchInterval: 30000
  });

  const cyclesQ = useQuery({
    queryKey: ['cycles'],
    queryFn: async () => (await api.get<ConditioningCycle[]>(E.cycles)).data,
    refetchInterval: 30000
  });

  const tanks = tanksQ.data ?? [];
  const cycles = cyclesQ.data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tanks'] });
    qc.invalidateQueries({ queryKey: ['cycles'] });
  };

  const startableTanks = tanks.filter((t) => Number(t.levelQ) > 2 && !t.activeCycle);

  const cycleById = (id: string | undefined) => cycles.find((c) => c.id === id);

  const submitStart = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const hrs = Number(startHrs);
    if (!startTank) {
      setNotice({ ok: false, text: 'Select a tank to start conditioning.' });
      return;
    }
    if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 72) {
      setNotice({ ok: false, text: 'Required hours must be between 1 and 72.' });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { requiredHrs: hrs };
      if (startWater.trim()) body.waterAddedQ = Number(startWater);
      if (startMoisture.trim()) body.moistureBefore = Number(startMoisture);
      if (startNotes.trim()) body.notes = startNotes.trim();
      const r = await api.post<ConditioningCycle>(E.tankCycleStart(startTank), body);
      setNotice({ ok: true, text: `Conditioning started — batch ${r.data.batchNo}.` });
      setStartTank('');
      setStartHrs('8');
      setStartWater('');
      setStartMoisture('');
      setStartNotes('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to start conditioning.' });
    } finally {
      setSaving(false);
    }
  };

  const logWater = async (tankCode: string) => {
    setNotice(null);
    const qty = Number(waterQty[tankCode] ?? '');
    if (!Number.isFinite(qty) || qty <= 0) {
      setNotice({ ok: false, text: 'Enter a positive water quantity in quintals.' });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { waterAddedQ: qty };
      const note = waterNote[tankCode]?.trim();
      if (note) body.note = note;
      await api.post(E.tankCycleWater(tankCode), body);
      setNotice({ ok: true, text: `Water addition logged for Tank ${tankCode.replace('TANK_', '')}.` });
      setWaterQty((s) => ({ ...s, [tankCode]: '' }));
      setWaterNote((s) => ({ ...s, [tankCode]: '' }));
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to log water.' });
    } finally {
      setSaving(false);
    }
  };

  const completeCycle = async (tankCode: string) => {
    setNotice(null);
    const m = Number(completeMoisture[tankCode] ?? '');
    if (!Number.isFinite(m)) {
      setNotice({ ok: false, text: 'Enter the final moisture percentage.' });
      return;
    }
    const warn = moistureWarning(completeMoisture[tankCode] ?? '');
    if (warn && !window.confirm(`${warn}\n\nComplete the cycle anyway?`)) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { moistureAfter: m };
      const notes = completeNotes[tankCode]?.trim();
      if (notes) body.notes = notes;
      await api.post(E.tankCycleComplete(tankCode), body);
      setNotice({ ok: true, text: `Cycle completed for Tank ${tankCode.replace('TANK_', '')}.` });
      setCompleteMoisture((s) => ({ ...s, [tankCode]: '' }));
      setCompleteNotes((s) => ({ ...s, [tankCode]: '' }));
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to complete cycle.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Conditioning Monitor"
        sub="Live wet conditioning timers for tanks A, B and C — refreshes every 30 seconds"
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

      {tanksQ.isLoading ? (
        <Spinner label="Loading tanks..." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {tanks.map((t) => {
            const c = t.activeCycle;
            const detail = cycleById(c?.id);
            const ready = c !== null && c.remainingHrs <= 0;
            const pct =
              c !== null && c.requiredHrs > 0
                ? Math.min(100, Math.max(0, (c.elapsedHrs / c.requiredHrs) * 100))
                : 0;
            return (
              <div key={t.code} className={cardShell}>
                <CardHeader
                  icon={<Timer size={18} />}
                  title={`Tank ${t.code.replace('TANK_', '')}`}
                  subtitle={t.name}
                  action={
                    c ? (
                      ready ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                          Ready to complete
                        </span>
                      ) : (
                        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800">
                          Conditioning
                        </span>
                      )
                    ) : (
                      <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                        No active cycle
                      </span>
                    )
                  }
                />

                {c ? (
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-semibold tabular-nums text-slate-500 dark:text-slate-400">{c.batchNo}</span>
                      <span
                        className={`text-3xl font-bold tabular-nums ${
                          ready ? 'text-emerald-600' : 'text-slate-900'
                        }`}
                      >
                        {fmtCountdown(c.remainingHrs)}
                      </span>
                    </div>
                    <div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                        <div
                          className={`h-full rounded-full transition-all ${ready ? 'bg-emerald-500' : 'bg-blue-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        <span>Elapsed {Number(c.elapsedHrs).toFixed(1)}h</span>
                        <span>Required {Number(c.requiredHrs).toFixed(1)}h</span>
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
                        <dt className="text-xs text-slate-500 dark:text-slate-400">Started at</dt>
                        <dd className="font-semibold text-slate-800 dark:text-slate-100">{fmtDateTime(c.startedAt)}</dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
                        <dt className="text-xs text-slate-500 dark:text-slate-400">Water added (q)</dt>
                        <dd className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                          {detail?.waterAddedQ != null ? Number(detail.waterAddedQ).toFixed(1) : '—'}
                        </dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
                        <dt className="text-xs text-slate-500 dark:text-slate-400">Moisture before</dt>
                        <dd className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                          {detail?.moistureBefore != null ? `${Number(detail.moistureBefore).toFixed(1)}%` : '—'}
                        </dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
                        <dt className="text-xs text-slate-500 dark:text-slate-400">Moisture target</dt>
                        <dd className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">15.0–16.5%</dd>
                      </div>
                    </dl>

                    {/* Log water */}
                    <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 p-3">
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Log water addition
                      </p>
                      <div className="flex gap-2">
                        <NumberInput
                          value={waterQty[t.code] ?? ''}
                          onChange={(e) => setWaterQty((s) => ({ ...s, [t.code]: e.target.value }))}
                          min={0}
                          step="0.1"
                          placeholder="Qt"
                          className="py-2 text-sm"
                        />
                        <TextInput
                          value={waterNote[t.code] ?? ''}
                          onChange={(e) => setWaterNote((s) => ({ ...s, [t.code]: e.target.value }))}
                          placeholder="Note (optional)"
                          className="py-2 text-sm"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => logWater(t.code)}
                          loading={saving}
                          className="shrink-0 px-4 text-sm"
                        >
                          <Droplets size={15} /> Add
                        </Button>
                      </div>
                    </div>

                    {/* Complete cycle */}
                    <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/50 p-3">
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
                        Complete cycle
                      </p>
                      <div className="flex gap-2">
                        <NumberInput
                          value={completeMoisture[t.code] ?? ''}
                          onChange={(e) =>
                            setCompleteMoisture((s) => ({ ...s, [t.code]: e.target.value }))
                          }
                          min={0}
                          max={100}
                          step="0.1"
                          placeholder="Moisture after %"
                          className="py-2 text-sm"
                        />
                        <Button
                          type="button"
                          onClick={() => completeCycle(t.code)}
                          loading={saving}
                          className="shrink-0 px-4 text-sm"
                        >
                          <CheckCircle2 size={15} /> Complete
                        </Button>
                      </div>
                      {moistureWarning(completeMoisture[t.code] ?? '') ? (
                        <p className="mt-1.5 text-xs font-medium text-amber-700">
                          {moistureWarning(completeMoisture[t.code] ?? '')}
                        </p>
                      ) : null}
                      <TextInput
                        value={completeNotes[t.code] ?? ''}
                        onChange={(e) =>
                          setCompleteNotes((s) => ({ ...s, [t.code]: e.target.value }))
                        }
                        placeholder="Completion notes (optional)"
                        className="mt-2 py-2 text-sm"
                      />
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    title="No active cycle"
                    sub="Start conditioning from the form below to begin the timer."
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Start conditioning form */}
      <div className={`${cardShell} mt-4`}>
        <CardHeader
          icon={<Play size={18} />}
          title="Start conditioning"
          subtitle="Only tanks with more than 2 q and no active cycle can be started"
        />
        <form onSubmit={submitStart} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Tank" required>
            <Select value={startTank} onChange={(e) => setStartTank(e.target.value)} required>
              <option value="">Select tank</option>
              {startableTanks.map((t) => (
                <option key={t.code} value={t.code}>
                  Tank {t.code.replace('TANK_', '')} — {Number(t.levelQ).toFixed(1)} q
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Required hours" required hint="Maximum 72 hours">
            <NumberInput
              value={startHrs}
              onChange={(e) => setStartHrs(e.target.value)}
              min={1}
              max={72}
              step="0.5"
              required
            />
          </Field>
          <Field label="Water added (Qt)" hint="Optional">
            <NumberInput
              value={startWater}
              onChange={(e) => setStartWater(e.target.value)}
              min={0}
              step="0.1"
              placeholder="0.0"
            />
          </Field>
          <Field label="Moisture before (%)" hint="Optional">
            <NumberInput
              value={startMoisture}
              onChange={(e) => setStartMoisture(e.target.value)}
              min={0}
              max={100}
              step="0.1"
              placeholder="e.g. 12.5"
            />
          </Field>
          <Field label="Notes" hint="Optional" >
            <TextInput
              value={startNotes}
              onChange={(e) => setStartNotes(e.target.value)}
              placeholder="Notes"
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={saving} className="w-full">
              <Play size={16} /> Start conditioning
            </Button>
          </div>
        </form>
        {startableTanks.length === 0 && !tanksQ.isLoading ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            No tanks are currently eligible — tanks need more than 2 q and no active cycle.
          </p>
        ) : null}
      </div>

      {/* Cycle history */}
      <div className={`${cardShell} mt-4`}>
        <CardHeader
          icon={<Timer size={18} />}
          title="Conditioning history"
          subtitle="All conditioning cycles, newest first"
        />
        {cyclesQ.isLoading ? (
          <Spinner label="Loading cycles..." />
        ) : cycles.length === 0 ? (
          <EmptyState title="No cycles recorded" sub="Conditioning cycles will appear here once started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  <th className="px-2 py-2 font-semibold">Batch</th>
                  <th className="px-2 py-2 font-semibold">Tank</th>
                  <th className="px-2 py-2 font-semibold">Started</th>
                  <th className="px-2 py-2 text-right font-semibold">Duration</th>
                  <th className="px-2 py-2 text-right font-semibold">Water (q)</th>
                  <th className="px-2 py-2 font-semibold">Moisture</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...cycles]
                  .sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt))
                  .map((c) => {
                    const st = cycleStatus(c);
                    return (
                      <tr key={c.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="whitespace-nowrap px-2 py-2 font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                          {c.batchNo}
                        </td>
                        <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{c.tankCode.replace('TANK_', '')}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-600 dark:text-slate-300">
                          {fmtDateTime(c.startedAt)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                          {Number(c.requiredHrs).toFixed(1)}h
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                          {c.waterAddedQ != null ? Number(c.waterAddedQ).toFixed(1) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700 dark:text-slate-200">
                          {c.moistureBefore != null ? `${Number(c.moistureBefore).toFixed(1)}%` : '—'} →{' '}
                          {c.moistureAfter != null ? `${Number(c.moistureAfter).toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-2 py-2">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusPill[st]}`}>
                            {st}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
