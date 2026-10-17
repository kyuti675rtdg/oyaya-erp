import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Droplets } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import { useAuth } from '../store/auth';
import type { ProductionBatch, WashingLog } from '../types';
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
  Spinner,
  TextInput
} from '../components/ui';
import { fmtDateTime, fmtElapsed, fmtPct } from '../lib/format';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

// In-process impurity after washing must be < 3.0%
const IMPURITY_MAX = 3.0;

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function ProdWheatWashing() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('production:manage');

  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [batchFilter, setBatchFilter] = useState('');
  const [closingId, setClosingId] = useState<string | null>(null);

  // Start form
  const [tankOrSilo, setTankOrSilo] = useState('');
  const [batchId, setBatchId] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [operators, setOperators] = useState('');
  const [impurityBefore, setImpurityBefore] = useState('');

  // Close form
  const [endedAt, setEndedAt] = useState('');
  const [waterUsedL, setWaterUsedL] = useState('');
  const [impurityAfter, setImpurityAfter] = useState('');

  const washingsQ = useQuery({
    queryKey: ['prod-washings', batchFilter],
    queryFn: async () =>
      (
        await api.get<WashingLog[]>(
          `${E.washings}${batchFilter ? `?batchId=${batchFilter}` : ''}`
        )
      ).data
  });
  const batchesQ = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(E.batches)).data
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['prod-washings'] });

  const startWash = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      if (!tankOrSilo.trim() || !startedAt || !operators.trim()) {
        setNotice({ ok: false, text: 'Tank/silo, start time and operator are required.' });
        return;
      }
      const imp = impurityBefore === '' ? null : Number(impurityBefore);
      if (imp !== null && (!Number.isFinite(imp) || imp < 0 || imp > 100)) {
        setNotice({ ok: false, text: 'Pre-wash impurity must be between 0 and 100%.' });
        return;
      }
      const ops = operators.split(',').map((o) => o.trim()).filter(Boolean);
      const r = await submitOrQueue('prod-washing', E.washings, {
        tankOrSilo: tankOrSilo.trim(),
        batchId: batchId || null,
        startedAt: new Date(startedAt).toISOString(),
        operators: ops,
        impurityBeforePct: imp
      });
      setNotice({
        ok: true,
        text: r.queued ? 'Wash saved offline — will sync automatically.' : 'Washing started.'
      });
      setTankOrSilo('');
      setBatchId('');
      setStartedAt('');
      setOperators('');
      setImpurityBefore('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to start wash.' });
    } finally {
      setSaving(false);
    }
  };

  const closeWash = async (e: FormEvent) => {
    e.preventDefault();
    if (!closingId) return;
    setNotice(null);
    setSaving(true);
    try {
      const water = waterUsedL === '' ? null : Number(waterUsedL);
      const impA = impurityAfter === '' ? null : Number(impurityAfter);
      if (water !== null && (!Number.isInteger(water) || water < 0)) {
        setNotice({ ok: false, text: 'Water used must be a non-negative whole number of litres.' });
        return;
      }
      if (impA !== null && (!Number.isFinite(impA) || impA < 0 || impA > 100)) {
        setNotice({ ok: false, text: 'Post-wash impurity must be between 0 and 100%.' });
        return;
      }
      await api.put(E.washing(closingId), {
        endedAt: endedAt ? new Date(endedAt).toISOString() : undefined,
        waterUsedL: water,
        impurityAfterPct: impA
      });
      let warn = '';
      if (impA !== null && impA >= IMPURITY_MAX) {
        warn = ` Warning: post-wash impurity ${impA.toFixed(1)}% is above the ${IMPURITY_MAX}% in-process limit.`;
      }
      setNotice({ ok: true, text: `Washing completed.${warn}` });
      setClosingId(null);
      setEndedAt('');
      setWaterUsedL('');
      setImpurityAfter('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to complete wash.' });
    } finally {
      setSaving(false);
    }
  };

  const logs = washingsQ.data ?? [];

  return (
    <div>
      <SectionTitle
        title="Wheat Washing Operations"
        sub="Washing log per batch: start/end, water used, operator, pre/post impurity (in-process limit < 3.0%)"
        action={
          <Select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} aria-label="Filter by batch">
            <option value="">All batches</option>
            {(batchesQ.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchNo}
              </option>
            ))}
          </Select>
        }
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
              icon={<Droplets size={16} />}
              title="Start washing"
              subtitle="Record the batch going into the washer"
            />
            <form onSubmit={startWash} className="space-y-4">
              <Field label="Tank / silo" required>
                <TextInput
                  value={tankOrSilo}
                  onChange={(e) => setTankOrSilo(e.target.value)}
                  placeholder="e.g. Tank A washer line"
                  required
                />
              </Field>
              <Field label="Production batch">
                <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                  <option value="">No batch linked</option>
                  {(batchesQ.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNo} — {b.productType.replace('_', ' ')}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Start time" required>
                <TextInput
                  type="datetime-local"
                  value={startedAt}
                  onChange={(e) => setStartedAt(e.target.value)}
                  required
                />
              </Field>
              <Field label="Operator(s)" required hint="Comma separated names">
                <TextInput
                  value={operators}
                  onChange={(e) => setOperators(e.target.value)}
                  placeholder="e.g. Abebe T., Kebede M."
                  required
                />
              </Field>
              <Field label="Pre-wash impurity (%)">
                <NumberInput
                  value={impurityBefore}
                  onChange={(e) => setImpurityBefore(e.target.value)}
                  min={0}
                  max={100}
                  step="0.1"
                  placeholder="0.0"
                />
              </Field>
              <Button type="submit" loading={saving} className="w-full">
                Start wash
              </Button>
            </form>
          </div>
        ) : null}

        <div className={canManage ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <div className={cardShell}>
            <CardHeader icon={<Droplets size={16} />} title="Washing log" subtitle="Close each wash with water used and post impurity" />
            {washingsQ.isLoading ? (
              <Spinner label="Loading washing logs..." />
            ) : washingsQ.isError ? (
              <ErrorBox message="Failed to load washing logs." onRetry={() => washingsQ.refetch()} />
            ) : (
              <>
                <div className="hidden md:block">
                  <DataTable<WashingLog>
                    columns={[
                      {
                        key: 'tankOrSilo',
                        label: 'Tank / Silo',
                        render: (r) => <span className="font-semibold text-slate-800 dark:text-slate-100">{r.tankOrSilo}</span>
                      },
                      { key: 'startedAt', label: 'Start', render: (r) => fmtDateTime(r.startedAt) },
                      {
                        key: 'duration',
                        label: 'Duration',
                        mono: true,
                        render: (r) =>
                          r.endedAt
                            ? fmtElapsed(new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime())
                            : 'Running'
                      },
                      {
                        key: 'water',
                        label: 'Water (L)',
                        mono: true,
                        render: (r) => (r.waterUsedL != null ? r.waterUsedL.toLocaleString('en-US') : '-')
                      },
                      {
                        key: 'impurity',
                        label: 'Impurity pre → post',
                        mono: true,
                        render: (r) => {
                          const before = num(r.impurityBeforePct);
                          const after = num(r.impurityAfterPct);
                          return (
                            <span>
                              {before !== null ? fmtPct(before) : '-'} →{' '}
                              {after !== null ? (
                                <span className={after >= IMPURITY_MAX ? 'font-bold text-rose-600' : 'font-semibold text-emerald-700'}>
                                  {fmtPct(after)}
                                </span>
                              ) : (
                                '-'
                              )}
                            </span>
                          );
                        }
                      },
                      { key: 'operators', label: 'Operators', render: (r) => (r.operators ?? []).join(', ') || '-' },
                      {
                        key: 'status',
                        label: 'Status',
                        render: (r) =>
                          r.endedAt ? <Badge tone="pass">Done</Badge> : <Badge tone="advisory">Running</Badge>
                      },
                      {
                        key: 'actions',
                        label: '',
                        render: (r) =>
                          canManage && !r.endedAt ? (
                            <button
                              onClick={() => setClosingId(r.id)}
                              className="text-sm font-semibold text-violet-primary hover:underline"
                            >
                              Close wash
                            </button>
                          ) : null
                      }
                    ]}
                    rows={logs}
                    emptyTitle="No washing logs"
                    emptySub="Start a wash to begin tracking."
                  />
                </div>
                <div className="space-y-3 md:hidden">
                  {logs.length === 0 ? (
                    <EmptyState title="No washing logs" sub="Start a wash to begin tracking." />
                  ) : (
                    logs.map((r) => {
                      const after = num(r.impurityAfterPct);
                      return (
                        <div key={r.id} className="rounded-xl border border-slate-200/70 p-4">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-800 dark:text-slate-100">{r.tankOrSilo}</span>
                            {r.endedAt ? <Badge tone="pass">Done</Badge> : <Badge tone="advisory">Running</Badge>}
                          </div>
                          <p className="tabular-nums mt-1 text-xs text-slate-500 dark:text-slate-400">{fmtDateTime(r.startedAt)}</p>
                          <p className="tabular-nums mt-2 text-sm text-slate-600 dark:text-slate-300">
                            Water: {r.waterUsedL != null ? `${r.waterUsedL.toLocaleString('en-US')} L` : '-'} ·
                            Impurity: {num(r.impurityBeforePct) !== null ? fmtPct(num(r.impurityBeforePct)) : '-'} →{' '}
                            {after !== null ? (
                              <span className={after >= IMPURITY_MAX ? 'font-bold text-rose-600' : 'font-semibold text-emerald-700'}>
                                {fmtPct(after)}
                              </span>
                            ) : (
                              '-'
                            )}
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{(r.operators ?? []).join(', ')}</p>
                          {canManage && !r.endedAt ? (
                            <Button variant="secondary" className="mt-3 w-full" onClick={() => setClosingId(r.id)}>
                              Close wash
                            </Button>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {closingId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Close washing</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Record end time, water used and post-wash impurity.</p>
            <form onSubmit={closeWash} className="mt-4 space-y-4">
              <Field label="End time">
                <TextInput type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
              </Field>
              <Field label="Water used (litres)">
                <NumberInput
                  value={waterUsedL}
                  onChange={(e) => setWaterUsedL(e.target.value)}
                  min={0}
                  step="1"
                  placeholder="0"
                />
              </Field>
              <Field label="Post-wash impurity (%)" hint={`In-process limit ${IMPURITY_MAX}%`}>
                <NumberInput
                  value={impurityAfter}
                  onChange={(e) => setImpurityAfter(e.target.value)}
                  min={0}
                  max={100}
                  step="0.1"
                  placeholder="0.0"
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" loading={saving} className="flex-1">
                  Complete wash
                </Button>
                <Button type="button" variant="secondary" onClick={() => setClosingId(null)} className="flex-1">
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
