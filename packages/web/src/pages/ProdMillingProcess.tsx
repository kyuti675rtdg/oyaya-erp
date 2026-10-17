import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cog, Play, Square } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import { useAuth } from '../store/auth';
import type { MillingRun, MillingRunStatus, ProductionBatch, ProductionPlan } from '../types';
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
  TextArea,
  TextInput
} from '../components/ui';
import { fmtDateTime, fmtElapsed, fmtQ } from '../lib/format';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

function statusTone(s: MillingRunStatus): 'advisory' | 'pass' | 'critical' | 'neutral' {
  if (s === 'RUNNING') return 'advisory';
  if (s === 'COMPLETED') return 'pass';
  return 'critical';
}

function LiveElapsed({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);
  return <span className="tabular-nums font-bold">{fmtElapsed(Math.max(0, now - new Date(startedAt).getTime()))}</span>;
}

export function ProdMillingProcess() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('production:manage');

  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [endingId, setEndingId] = useState<string | null>(null);

  // Start form
  const [batchId, setBatchId] = useState('');
  const [planId, setPlanId] = useState('');
  const [lineMachine, setLineMachine] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [feedRate, setFeedRate] = useState('');
  const [rollSettings, setRollSettings] = useState('');
  const [operator, setOperator] = useState('');

  // End form
  const [endedAt, setEndedAt] = useState('');
  const [endStatus, setEndStatus] = useState<'COMPLETED' | 'STOPPED'>('COMPLETED');
  const [endFeedRate, setEndFeedRate] = useState('');
  const [endRollSettings, setEndRollSettings] = useState('');

  const runningQ = useQuery({
    queryKey: ['prod-runs-running'],
    queryFn: async () => (await api.get<MillingRun[]>(E.prodMillingRunsRunning)).data,
    refetchInterval: 60000
  });
  const runsQ = useQuery({
    queryKey: ['prod-runs'],
    queryFn: async () => (await api.get<MillingRun[]>(E.prodMillingRuns)).data
  });
  const batchesQ = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(E.batches)).data
  });
  const plansQ = useQuery({
    queryKey: ['prod-plans'],
    queryFn: async () => (await api.get<ProductionPlan[]>(`${E.prodPlans}?status=IN_PROGRESS`)).data
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['prod-runs-running'] });
    qc.invalidateQueries({ queryKey: ['prod-runs'] });
  };

  const batchById = useMemo(() => {
    const m = new Map<string, ProductionBatch>();
    for (const b of batchesQ.data ?? []) m.set(b.id, b);
    return m;
  }, [batchesQ.data]);

  const startRun = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      if (!batchId || !lineMachine.trim() || !operator.trim() || !startedAt) {
        setNotice({ ok: false, text: 'Batch, line/machine, operator and start time are required.' });
        return;
      }
      const fr = feedRate === '' ? null : Number(feedRate);
      if (fr !== null && (!Number.isFinite(fr) || fr <= 0)) {
        setNotice({ ok: false, text: 'Feed rate must be positive.' });
        return;
      }
      const r = await submitOrQueue('prod-milling-run', E.prodMillingRuns, {
        batchId,
        planId: planId || null,
        lineMachine: lineMachine.trim(),
        startedAt: new Date(startedAt).toISOString(),
        feedRateQHr: fr,
        rollSettings: rollSettings.trim() || null,
        operator: operator.trim()
      });
      setNotice({
        ok: true,
        text: r.queued ? 'Run saved offline — will sync automatically.' : 'Milling run started.'
      });
      setBatchId('');
      setPlanId('');
      setLineMachine('');
      setStartedAt('');
      setFeedRate('');
      setRollSettings('');
      setOperator('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to start run.' });
    } finally {
      setSaving(false);
    }
  };

  const endRun = async (e: FormEvent) => {
    e.preventDefault();
    if (!endingId) return;
    setNotice(null);
    setSaving(true);
    try {
      if (!endedAt) {
        setNotice({ ok: false, text: 'End time is required.' });
        return;
      }
      const fr = endFeedRate === '' ? null : Number(endFeedRate);
      if (fr !== null && (!Number.isFinite(fr) || fr <= 0)) {
        setNotice({ ok: false, text: 'Feed rate must be positive.' });
        return;
      }
      await api.post(E.prodMillingRunEnd(endingId), {
        endedAt: new Date(endedAt).toISOString(),
        status: endStatus,
        feedRateQHr: fr,
        rollSettings: endRollSettings.trim() || null
      });
      setNotice({ ok: true, text: `Run ${endStatus === 'COMPLETED' ? 'completed' : 'stopped'}.` });
      setEndingId(null);
      setEndedAt('');
      setEndFeedRate('');
      setEndRollSettings('');
      setEndStatus('COMPLETED');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to end run.' });
    } finally {
      setSaving(false);
    }
  };

  const running = runningQ.data ?? [];
  const history = (runsQ.data ?? []).filter((r) => r.status !== 'RUNNING');

  return (
    <div>
      <SectionTitle
        title="Milling Process Management"
        sub="Milling runs per batch and line — live tracking of in-progress runs"
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

      {/* Live running runs */}
      <div className={`${cardShell} mb-4`}>
        <CardHeader
          icon={<Cog size={16} />}
          title="Live runs"
          subtitle={`${running.length} run${running.length === 1 ? '' : 's'} in progress`}
        />
        {runningQ.isLoading ? (
          <Spinner label="Loading live runs..." />
        ) : runningQ.isError ? (
          <ErrorBox message="Failed to load live runs." onRetry={() => runningQ.refetch()} />
        ) : running.length === 0 ? (
          <EmptyState title="No runs in progress" sub="Start a milling run below." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {running.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-advisory-text/40 bg-advisory-bg p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="tabular-nums font-bold text-slate-800 dark:text-slate-100">{r.runNo}</span>
                  <Badge tone="advisory">Running</Badge>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{r.lineMachine}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Batch {batchById.get(r.batchId)?.batchNo ?? '—'} · {r.operator}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <div className="text-sm text-slate-600 dark:text-slate-300">
                    Elapsed <LiveElapsed startedAt={r.startedAt} />
                    {r.feedRateQHr != null ? (
                      <span className="tabular-nums ml-2 text-xs text-slate-500 dark:text-slate-400">
                        {fmtQ(r.feedRateQHr)} q/h
                      </span>
                    ) : null}
                  </div>
                  {canManage ? (
                    <Button variant="secondary" className="!px-3 !py-1.5 !text-sm" onClick={() => setEndingId(r.id)}>
                      <Square size={13} /> End
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {canManage ? (
          <div className={cardShell}>
            <CardHeader
              icon={<Play size={16} />}
              title="Start milling run"
              subtitle="One run per batch per line/machine"
            />
            <form onSubmit={startRun} className="space-y-4">
              <Field label="Production batch" required>
                <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} required>
                  <option value="">Select batch</option>
                  {(batchesQ.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNo} — {b.productType.replace('_', ' ')}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Production plan">
                <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">No plan</option>
                  {(plansQ.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.planNo}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Line / machine" required>
                <TextInput
                  value={lineMachine}
                  onChange={(e) => setLineMachine(e.target.value)}
                  placeholder="e.g. Mill Line 1"
                  required
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start time" required>
                  <TextInput
                    type="datetime-local"
                    value={startedAt}
                    onChange={(e) => setStartedAt(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Feed rate (q/h)">
                  <NumberInput
                    value={feedRate}
                    onChange={(e) => setFeedRate(e.target.value)}
                    min={0}
                    step="0.1"
                    placeholder="0.0"
                  />
                </Field>
              </div>
              <Field label="Operator" required>
                <TextInput
                  value={operator}
                  onChange={(e) => setOperator(e.target.value)}
                  placeholder="e.g. Abebe T."
                  required
                />
              </Field>
              <Field label="Roll settings / notes">
                <TextArea
                  value={rollSettings}
                  onChange={(e) => setRollSettings(e.target.value)}
                  rows={2}
                  placeholder="Roll gap, sieve settings, adjustments..."
                />
              </Field>
              <Button type="submit" loading={saving} className="w-full">
                Start run
              </Button>
            </form>
          </div>
        ) : null}

        <div className={canManage ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <div className={cardShell}>
            <CardHeader icon={<Cog size={16} />} title="Run history" subtitle="Completed and stopped runs" />
            {runsQ.isLoading ? (
              <Spinner label="Loading runs..." />
            ) : runsQ.isError ? (
              <ErrorBox message="Failed to load runs." onRetry={() => runsQ.refetch()} />
            ) : (
              <>
                <div className="hidden md:block">
                  <DataTable<MillingRun>
                    columns={[
                      {
                        key: 'runNo',
                        label: 'Run',
                        render: (r) => <span className="tabular-nums font-bold text-slate-800 dark:text-slate-100">{r.runNo}</span>
                      },
                      { key: 'lineMachine', label: 'Line / Machine' },
                      {
                        key: 'batch',
                        label: 'Batch',
                        render: (r) => batchById.get(r.batchId)?.batchNo ?? '—'
                      },
                      { key: 'operator', label: 'Operator' },
                      {
                        key: 'feed',
                        label: 'Feed (q/h)',
                        mono: true,
                        render: (r) => (r.feedRateQHr != null ? fmtQ(r.feedRateQHr) : '-')
                      },
                      {
                        key: 'duration',
                        label: 'Duration',
                        mono: true,
                        render: (r) =>
                          r.durationMin != null
                            ? fmtElapsed(r.durationMin * 60000)
                            : r.endedAt
                              ? fmtElapsed(new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime())
                              : '-'
                      },
                      {
                        key: 'status',
                        label: 'Status',
                        render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      },
                      { key: 'startedAt', label: 'Started', render: (r) => fmtDateTime(r.startedAt) }
                    ]}
                    rows={history}
                    emptyTitle="No completed runs"
                    emptySub="Finished milling runs appear here."
                  />
                </div>
                <div className="space-y-3 md:hidden">
                  {history.length === 0 ? (
                    <EmptyState title="No completed runs" sub="Finished milling runs appear here." />
                  ) : (
                    history.map((r) => (
                      <div key={r.id} className="rounded-xl border border-slate-200/70 p-4">
                        <div className="flex items-center justify-between">
                          <span className="tabular-nums font-bold text-slate-800 dark:text-slate-100">{r.runNo}</span>
                          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                        </div>
                        <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{r.lineMachine}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Batch {batchById.get(r.batchId)?.batchNo ?? '—'} · {r.operator}
                        </p>
                        <p className="tabular-nums mt-1 text-xs text-slate-500 dark:text-slate-400">{fmtDateTime(r.startedAt)}</p>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {endingId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">End milling run</h3>
            <form onSubmit={endRun} className="mt-4 space-y-4">
              <Field label="End time" required>
                <TextInput
                  type="datetime-local"
                  value={endedAt}
                  onChange={(e) => setEndedAt(e.target.value)}
                  required
                />
              </Field>
              <Field label="Result">
                <Select value={endStatus} onChange={(e) => setEndStatus(e.target.value as 'COMPLETED' | 'STOPPED')}>
                  <option value="COMPLETED">Completed</option>
                  <option value="STOPPED">Stopped</option>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Final feed rate (q/h)">
                  <NumberInput
                    value={endFeedRate}
                    onChange={(e) => setEndFeedRate(e.target.value)}
                    min={0}
                    step="0.1"
                    placeholder="0.0"
                  />
                </Field>
                <Field label="Final roll settings">
                  <TextInput
                    value={endRollSettings}
                    onChange={(e) => setEndRollSettings(e.target.value)}
                    placeholder="Notes..."
                  />
                </Field>
              </div>
              <div className="flex gap-2">
                <Button type="submit" loading={saving} className="flex-1">
                  End run
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEndingId(null)} className="flex-1">
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
