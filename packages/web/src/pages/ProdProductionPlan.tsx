import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, ClipboardList, Play } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import { useAuth } from '../store/auth';
import type { FlourProductType, PlanStatus, ProductionBatch, ProductionPlan } from '../types';
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
import { fmtDate, fmtQ } from '../lib/format';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const PRODUCT_OPTIONS: { value: FlourProductType; label: string }[] = [
  { value: 'DUKET_NORMAL', label: 'Duket — Normal grade' },
  { value: 'DUKET_SPECIAL', label: 'Duket — Special grade' },
  { value: 'FURISHKA', label: 'Furishka' },
  { value: 'FINO', label: 'Fino' },
  { value: 'FERNACHO', label: 'Fernacho' }
];

const TANK_OPTIONS = ['TANK_A', 'TANK_B', 'TANK_C'];

function productLabel(v: string): string {
  return PRODUCT_OPTIONS.find((o) => o.value === v)?.label ?? v.replace('_', ' ');
}

function statusTone(s: PlanStatus): 'neutral' | 'advisory' | 'pass' | 'critical' {
  if (s === 'PLANNED') return 'neutral';
  if (s === 'IN_PROGRESS') return 'advisory';
  if (s === 'COMPLETED') return 'pass';
  return 'critical';
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function planTargetSummary(p: ProductionPlan): string {
  const targets = p.targets ?? [];
  return targets.map((t) => `${productLabel(t.productType)} ${fmtQ(t.plannedQ)} q`).join(', ');
}

function planTotalQ(p: ProductionPlan): number {
  return (p.targets ?? []).reduce((s, t) => s + Number(t.plannedQ ?? 0), 0);
}

export function ProdProductionPlan() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('production:manage');

  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [completingId, setCompletingId] = useState<string | null>(null);

  // Create form
  const [tankCode, setTankCode] = useState('');
  const [batchId, setBatchId] = useState('');
  const [targets, setTargets] = useState<{ productType: FlourProductType; plannedQ: string }[]>([
    { productType: 'DUKET_NORMAL', plannedQ: '' }
  ]);
  const [plannedWheatQ, setPlannedWheatQ] = useState('');
  const [scheduledDate, setScheduledDate] = useState(todayISO());
  const [shift, setShift] = useState<'MORNING' | 'NIGHT'>('MORNING');
  const [notes, setNotes] = useState('');

  // Complete form
  const [actualWheatQ, setActualWheatQ] = useState('');
  const [actualOutputQ, setActualOutputQ] = useState('');

  const plansQ = useQuery({
    queryKey: ['prod-plans', statusFilter],
    queryFn: async () =>
      (
        await api.get<ProductionPlan[]>(
          `${E.prodPlans}${statusFilter ? `?status=${statusFilter}` : ''}`
        )
      ).data
  });
  const batchesQ = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(E.batches)).data
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['prod-plans'] });
    qc.invalidateQueries({ queryKey: ['prod-yield-alerts'] });
  };

  const addTargetRow = () =>
    setTargets((t) => [...t, { productType: 'FURISHKA', plannedQ: '' }]);

  const removeTargetRow = (i: number) =>
    setTargets((t) => (t.length > 1 ? t.filter((_, x) => x !== i) : t));

  const createPlan = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      const wheatQ = Number(plannedWheatQ);
      const clean = targets.map((t) => ({
        productType: t.productType,
        plannedQ: Number(t.plannedQ)
      }));
      if (!Number.isFinite(wheatQ) || wheatQ <= 0 || !scheduledDate) {
        setNotice({ ok: false, text: 'Planned wheat quantity and scheduled date are required.' });
        return;
      }
      if (clean.some((t) => !Number.isFinite(t.plannedQ) || t.plannedQ <= 0)) {
        setNotice({ ok: false, text: 'Every target row needs a positive quantity.' });
        return;
      }
      const r = await submitOrQueue('prod-plan', E.prodPlans, {
        tankCode: tankCode || null,
        batchId: batchId || null,
        targets: clean,
        plannedWheatQ: wheatQ,
        scheduledDate: new Date(`${scheduledDate}T00:00:00`).toISOString(),
        shift,
        notes: notes.trim() || null
      });
      setNotice({
        ok: true,
        text: r.queued
          ? 'Plan saved offline — will sync automatically.'
          : 'Production plan created.'
      });
      setTankCode('');
      setBatchId('');
      setTargets([{ productType: 'DUKET_NORMAL', plannedQ: '' }]);
      setPlannedWheatQ('');
      setNotes('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create plan.' });
    } finally {
      setSaving(false);
    }
  };

  const startPlan = async (id: string) => {
    setNotice(null);
    try {
      await api.post(E.prodPlanStart(id));
      setNotice({ ok: true, text: 'Plan moved to In Progress.' });
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to start plan.' });
    }
  };

  const completePlan = async (e: FormEvent) => {
    e.preventDefault();
    if (!completingId) return;
    setNotice(null);
    setSaving(true);
    try {
      const w = Number(actualWheatQ);
      const o = Number(actualOutputQ);
      if (
        (!Number.isFinite(w) || w < 0) ||
        (!Number.isFinite(o) || o < 0)
      ) {
        setNotice({ ok: false, text: 'Enter non-negative actual quantities (0 allowed).' });
        return;
      }
      const res = await api.post(E.prodPlanComplete(completingId), {
        actualWheatQ: w,
        actualOutputQ: o
      });
      const p = res.data as ProductionPlan;
      const planned = planTotalQ(p);
      const variance = planned > 0 ? ` Output vs plan: ${((o / planned) * 100).toFixed(1)}%.` : '';
      setNotice({ ok: true, text: `Plan ${p.planNo} completed.${variance}` });
      setCompletingId(null);
      setActualWheatQ('');
      setActualOutputQ('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to complete plan.' });
    } finally {
      setSaving(false);
    }
  };

  const plans = plansQ.data ?? [];
  const summary = useMemo(() => {
    const total = plans.length;
    const planned = plans.filter((p) => p.status === 'PLANNED').length;
    const inProgress = plans.filter((p) => p.status === 'IN_PROGRESS').length;
    const completed = plans.filter((p) => p.status === 'COMPLETED').length;
    return { total, planned, inProgress, completed };
  }, [plans]);

  return (
    <div>
      <SectionTitle
        title="Production Planning & Batch Setup"
        sub="Plan milling batches: released conditioning tank, target products, schedule — PB-YYYY-XXXX"
        action={
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="PLANNED">Planned</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
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

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Plans', value: summary.total },
          { label: 'Planned', value: summary.planned },
          { label: 'In progress', value: summary.inProgress },
          { label: 'Completed', value: summary.completed }
        ].map((k) => (
          <div key={k.label} className={`${cardShell} !p-4`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{k.label}</p>
            <p className="tabular-nums mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {canManage ? (
          <div className={cardShell}>
            <CardHeader
              icon={<ClipboardList size={16} />}
              title="New production plan"
              subtitle="Plan numbers are issued automatically"
            />
            <form onSubmit={createPlan} className="space-y-4">
              <Field label="Released conditioning tank">
                <Select value={tankCode} onChange={(e) => setTankCode(e.target.value)}>
                  <option value="">Not yet assigned</option>
                  {TANK_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t.replace('TANK_', 'Tank ')}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Linked production batch">
                <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                  <option value="">No batch linked</option>
                  {(batchesQ.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNo} — {b.productType.replace('_', ' ')}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Target products</p>
                <div className="space-y-2">
                  {targets.map((t, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Select
                        value={t.productType}
                        onChange={(e) =>
                          setTargets((rows) =>
                            rows.map((r, x) =>
                              x === i ? { ...r, productType: e.target.value as FlourProductType } : r
                            )
                          )
                        }
                      >
                        {PRODUCT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                      <NumberInput
                        value={t.plannedQ}
                        onChange={(e) =>
                          setTargets((rows) =>
                            rows.map((r, x) => (x === i ? { ...r, plannedQ: e.target.value } : r))
                          )
                        }
                        min={0}
                        step="0.1"
                        placeholder="q"
                        className="w-24"
                      />
                      {targets.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="!px-2"
                          onClick={() => removeTargetRow(i)}
                        >
                          ✕
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addTargetRow}
                  className="mt-2 text-sm font-semibold text-violet-primary hover:underline"
                >
                  + Add product
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Planned wheat (q)" required>
                  <NumberInput
                    value={plannedWheatQ}
                    onChange={(e) => setPlannedWheatQ(e.target.value)}
                    min={0}
                    step="0.1"
                    placeholder="0.0"
                  />
                </Field>
                <Field label="Scheduled date" required>
                  <TextInput
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    required
                  />
                </Field>
              </div>
              <Field label="Shift">
                <Select value={shift} onChange={(e) => setShift(e.target.value as 'MORNING' | 'NIGHT')}>
                  <option value="MORNING">Morning</option>
                  <option value="NIGHT">Night</option>
                </Select>
              </Field>
              <Field label="Notes">
                <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </Field>
              <Button type="submit" loading={saving} className="w-full">
                Create plan
              </Button>
            </form>
          </div>
        ) : null}

        <div className={canManage ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <div className={cardShell}>
            <CardHeader
              icon={<CalendarClock size={16} />}
              title="Plans"
              subtitle="Planned → In Progress → Completed"
            />
            {plansQ.isLoading ? (
              <Spinner label="Loading plans..." />
            ) : plansQ.isError ? (
              <ErrorBox message="Failed to load plans." onRetry={() => plansQ.refetch()} />
            ) : (
              <>
                <div className="hidden md:block">
                  <DataTable<ProductionPlan>
                    columns={[
                      {
                        key: 'planNo',
                        label: 'Plan',
                        render: (r) => <span className="tabular-nums font-bold text-slate-800 dark:text-slate-100">{r.planNo}</span>
                      },
                      {
                        key: 'targets',
                        label: 'Targets',
                        render: (r) => <span className="text-xs">{planTargetSummary(r)}</span>
                      },
                      {
                        key: 'plannedWheatQ',
                        label: 'Wheat (q)',
                        mono: true,
                        render: (r) => fmtQ(r.plannedWheatQ)
                      },
                      { key: 'shift', label: 'Shift', render: (r) => r.shift === 'MORNING' ? 'Morning' : 'Night' },
                      {
                        key: 'status',
                        label: 'Status',
                        render: (r) => <Badge tone={statusTone(r.status)}>{r.status.replace('_', ' ')}</Badge>
                      },
                      {
                        key: 'variance',
                        label: 'Output vs plan',
                        mono: true,
                        render: (r) => {
                          const planned = planTotalQ(r);
                          const actual = Number(r.actualOutputQ ?? NaN);
                          if (r.status !== 'COMPLETED' || !Number.isFinite(actual) || planned <= 0) return '-';
                          return `${((actual / planned) * 100).toFixed(1)}%`;
                        }
                      },
                      {
                        key: 'actions',
                        label: '',
                        render: (r) =>
                          canManage ? (
                            <div className="flex gap-2">
                              {r.status === 'PLANNED' ? (
                                <button
                                  onClick={() => startPlan(r.id)}
                                  className="inline-flex items-center gap-1 text-sm font-semibold text-violet-primary hover:underline"
                                >
                                  <Play size={13} /> Start
                                </button>
                              ) : null}
                              {r.status === 'IN_PROGRESS' ? (
                                <button
                                  onClick={() => setCompletingId(r.id)}
                                  className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline"
                                >
                                  <CheckCircle2 size={13} /> Complete
                                </button>
                              ) : null}
                            </div>
                          ) : null
                      }
                    ]}
                    rows={plans}
                    emptyTitle="No production plans"
                    emptySub="Create the first plan for a milling batch."
                  />
                </div>
                <div className="space-y-3 md:hidden">
                  {plans.length === 0 ? (
                    <EmptyState title="No production plans" sub="Create the first plan for a milling batch." />
                  ) : (
                    plans.map((r) => (
                      <div key={r.id} className="rounded-xl border border-slate-200/70 p-4">
                        <div className="flex items-center justify-between">
                          <span className="tabular-nums font-bold text-slate-800 dark:text-slate-100">{r.planNo}</span>
                          <Badge tone={statusTone(r.status)}>{r.status.replace('_', ' ')}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{planTargetSummary(r)}</p>
                        <p className="tabular-nums mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Wheat {fmtQ(r.plannedWheatQ)} q · {fmtDate(r.scheduledDate)} ·{' '}
                          {r.shift === 'MORNING' ? 'Morning' : 'Night'} shift
                        </p>
                        {canManage && r.status === 'PLANNED' ? (
                          <Button variant="secondary" className="mt-3 w-full" onClick={() => startPlan(r.id)}>
                            <Play size={14} /> Start plan
                          </Button>
                        ) : null}
                        {canManage && r.status === 'IN_PROGRESS' ? (
                          <Button variant="secondary" className="mt-3 w-full" onClick={() => setCompletingId(r.id)}>
                            <CheckCircle2 size={14} /> Complete
                          </Button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {completingId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Complete plan</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Record actual quantities. A yield alert is raised automatically when output falls below
              90% of the plan.
            </p>
            <form onSubmit={completePlan} className="mt-4 space-y-4">
              <Field label="Actual wheat used (q)" required>
                <NumberInput
                  value={actualWheatQ}
                  onChange={(e) => setActualWheatQ(e.target.value)}
                  min={0}
                  step="0.1"
                  placeholder="0.0"
                />
              </Field>
              <Field label="Actual flour output (q)" required>
                <NumberInput
                  value={actualOutputQ}
                  onChange={(e) => setActualOutputQ(e.target.value)}
                  min={0}
                  step="0.1"
                  placeholder="0.0"
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" loading={saving} className="flex-1">
                  Complete
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCompletingId(null)}
                  className="flex-1"
                >
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
