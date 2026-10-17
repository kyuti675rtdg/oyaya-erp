import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FlaskConical,
  History,
  Microscope,
  Scale,
  Truck,
  XCircle
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { WheatIntake } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { LabParamField } from '../components/LabParamField';
import { Button, EmptyState, ErrorBox, SectionTitle, Spinner } from '../components/ui';
import {
  INTAKE_THRESHOLDS,
  breachesOf,
  emptyLabParams,
  intakeLabVerdict,
  paramBreached
} from '../lib/intakeThresholds';
import { fmtDateTime, fmtElapsed, fmtQ } from '../lib/format';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const VERDICT_TONE: Record<'PASS' | 'FAIL' | 'UNTESTED', 'pass' | 'critical' | 'neutral'> = {
  PASS: 'pass',
  FAIL: 'critical',
  UNTESTED: 'neutral'
};

function waitingMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Date.now() - t : 0;
}

export function IncomingInspection() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>(emptyLabParams());

  const pendingQ = useQuery({
    queryKey: ['inspection-pending'],
    queryFn: async () => (await api.get<WheatIntake[]>(`${E.intakes}?status=PENDING_LAB`)).data,
    refetchInterval: 30000
  });
  const historyQ = useQuery({
    queryKey: ['inspection-history'],
    queryFn: async () => (await api.get<WheatIntake[]>(`${E.intakes}?limit=80`)).data
  });

  const pending = pendingQ.data ?? [];

  // Default / re-target the selection whenever the pending list changes.
  useEffect(() => {
    if (pending.length > 0 && !pending.some((i) => i.id === pickedId)) {
      setPickedId(pending[0].id);
    } else if (pending.length === 0) {
      setPickedId(null);
    }
  }, [pending, pickedId]);

  const selected = useMemo(
    () => pending.find((i) => i.id === pickedId) ?? null,
    [pending, pickedId]
  );

  // Live verdict computation over the entered readings only.
  const numericParams = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of INTAKE_THRESHOLDS) {
      const raw = params[t.key].trim();
      if (raw !== '') {
        const v = Number(raw);
        if (Number.isFinite(v)) out[t.key] = v;
      }
    }
    return out;
  }, [params]);

  const enteredCount = Object.keys(numericParams).length;
  const allEntered = enteredCount === INTAKE_THRESHOLDS.length;
  const breaches = useMemo(() => breachesOf(numericParams), [numericParams]);
  const previewVerdict = !allEntered ? null : breaches.length === 0 ? 'PASS' : 'FLAGGED';

  const tested = useMemo(() => {
    const rows = (historyQ.data ?? []).filter(
      (r) => r.status !== 'PENDING_LAB' && intakeLabVerdict(r) !== 'UNTESTED'
    );
    return rows.slice(0, 12);
  }, [historyQ.data]);

  const submitLab = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setNotice(null);
    const values: Record<string, number> = {};
    for (const t of INTAKE_THRESHOLDS) {
      const v = Number(params[t.key]);
      if (!Number.isFinite(v)) {
        setNotice({ ok: false, text: `Enter a numeric value for ${t.label}.` });
        return;
      }
      values[t.key] = v;
    }
    const next = pending.filter((i) => i.id !== selected.id);
    setSaving(true);
    try {
      const r = await submitOrQueue('intake-lab', `${E.intakes}/${selected.id}/lab`, {
        intakeId: selected.id,
        ...values
      });
      const found = breachesOf(values);
      setNotice({
        ok: true,
        text: r.queued
          ? `Lab result for ${selected.intakeNo} saved offline — will sync automatically.`
          : found.length > 0
            ? `Lab result for ${selected.intakeNo} recorded — ${found.length} parameter(s) breached; delivery flagged for Quality Head review.`
            : `Lab result for ${selected.intakeNo} recorded — all parameters within specification.`
      });
      setParams(emptyLabParams());
      qc.invalidateQueries({ queryKey: ['inspection-pending'] });
      qc.invalidateQueries({ queryKey: ['inspection-history'] });
      // Auto-advance to the next pending delivery.
      setPickedId(next.length > 0 ? next[0].id : null);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record lab result.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Incoming Inspection"
        sub="Dedicated lab workspace — test pending deliveries against the intake thresholds"
        action={
          <Link
            to="/intake"
            className="touch inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-all hover:bg-slate-50 hover:shadow-sm active:scale-[0.98]"
          >
            <ArrowLeft size={15} className="text-slate-400" />
            Gate intake
          </Link>
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* Pending deliveries */}
        <div className={`${cardShell} xl:col-span-2`}>
          <CardHeader
            icon={<Truck size={16} />}
            title="Pending lab"
            subtitle="Deliveries awaiting inspection"
            action={
              pending.length > 0 ? (
                <span className="rounded-full bg-advisory-bg px-3 py-1 text-xs font-bold tabular-nums text-advisory-text">
                  {pending.length}
                </span>
              ) : undefined
            }
          />
          {pendingQ.isLoading ? (
            <Spinner label="Loading pending deliveries..." />
          ) : pendingQ.isError ? (
            <ErrorBox
              message={pendingQ.error instanceof Error ? pendingQ.error.message : 'Request failed.'}
              onRetry={() => pendingQ.refetch()}
            />
          ) : pending.length === 0 ? (
            <EmptyState
              title="No deliveries awaiting lab"
              sub="New gate intakes will appear here automatically."
            />
          ) : (
            <ul className="space-y-2.5">
              {pending.map((i) => {
                const active = i.id === selected?.id;
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPickedId(i.id);
                        setParams(emptyLabParams());
                        setNotice(null);
                      }}
                      aria-pressed={active}
                      className={`touch w-full rounded-xl border p-3.5 text-left transition-all ${
                        active
                          ? 'border-violet-300 bg-violet-50/50 shadow-sm ring-2 ring-violet-100'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="tnum text-sm font-extrabold text-slate-900">{i.intakeNo}</span>
                        <Badge tone="advisory">Pending lab</Badge>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span className="tnum inline-flex items-center gap-1 font-semibold text-slate-700">
                          <Truck size={13} />
                          {i.truckPlate}
                        </span>
                        <span>{i.supplier?.name ?? '—'}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold uppercase tracking-wide text-slate-600">
                          {i.wheatCategory}
                        </span>
                        <span className="tnum font-semibold">{fmtQ(i.quintals)} q</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                        <Clock3 size={12} />
                        Arrived {fmtDateTime(i.deliveryDate)} · waiting {fmtElapsed(waitingMs(i.deliveryDate))}
                      </div>
                      {i.moistureQuick !== null && i.moistureQuick !== undefined ? (
                        <div className="mt-1.5 text-xs text-slate-500">
                          Gate moisture:{' '}
                          <span className="tnum font-bold text-slate-700">
                            {Number(i.moistureQuick).toFixed(1)}%
                          </span>
                        </div>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Lab entry form */}
        <div className={`${cardShell} xl:col-span-3`}>
          <CardHeader
            icon={<Microscope size={16} />}
            title="Lab entry"
            subtitle={selected ? `Testing ${selected.intakeNo} — ${selected.truckPlate}` : 'Select a delivery'}
          />
          {!selected ? (
            <EmptyState
              title="No delivery selected"
              sub="Select a pending delivery from the list to begin the lab inspection."
            />
          ) : (
            <form onSubmit={submitLab} className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5 text-sm">
                <span className="tnum font-bold text-slate-900">{selected.intakeNo}</span>
                <span className="text-slate-500">{selected.supplier?.name ?? '—'}</span>
                <span className="tnum font-semibold text-slate-700">{fmtQ(selected.quintals)} q</span>
                {selected.netKg ? (
                  <span className="tnum inline-flex items-center gap-1 text-slate-500">
                    <Scale size={13} />
                    Net {Number(selected.netKg).toLocaleString('en-US')} kg
                  </span>
                ) : null}
                {selected.purchaseOrder ? (
                  <span className="tnum text-slate-500">PO {selected.purchaseOrder.poNo}</span>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {INTAKE_THRESHOLDS.map((t) => (
                  <LabParamField
                    key={t.key}
                    threshold={t}
                    value={params[t.key]}
                    onChange={(v) => setParams((p) => ({ ...p, [t.key]: v }))}
                    disabled={saving}
                  />
                ))}
              </div>

              {/* Overall verdict preview */}
              <div
                aria-live="polite"
                className={`rounded-xl border px-4 py-3 ${
                  previewVerdict === 'PASS'
                    ? 'border-pass-text/30 bg-pass-bg'
                    : previewVerdict === 'FLAGGED'
                      ? 'border-critical-text/30 bg-critical-bg'
                      : 'border-slate-200 bg-slate-50'
                }`}
              >
                {previewVerdict === 'PASS' ? (
                  <p className="flex items-center gap-2 text-sm font-bold text-pass-text">
                    <CheckCircle2 size={18} />
                    PASS — all 5 parameters within specification
                  </p>
                ) : previewVerdict === 'FLAGGED' ? (
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold text-critical-text">
                      <XCircle size={18} />
                      FLAGGED — {breaches.length} parameter{breaches.length === 1 ? '' : 's'} breached
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {breaches.map((t) => (
                        <li
                          key={t.key}
                          className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-bold text-critical-text"
                        >
                          {t.label}: {numericParams[t.key].toFixed(2)}
                          {t.unit} (limit {t.mode === 'min' ? '≥' : '≤'} {t.threshold}
                          {t.unit})
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm font-medium text-slate-500">
                    Enter all 5 parameters to preview the verdict — {enteredCount}/5 entered.
                  </p>
                )}
              </div>

              <Button type="submit" loading={saving} className="w-full">
                <FlaskConical size={16} />
                Record lab result
                {previewVerdict === 'PASS' ? ' — PASS' : previewVerdict === 'FLAGGED' ? ' — FLAG' : ''}
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* Recently tested */}
      <div className={`mt-4 ${cardShell}`}>
        <CardHeader
          icon={<History size={16} />}
          title="Recently tested"
          subtitle="Latest lab results with per-delivery verdicts"
        />
        {historyQ.isLoading ? (
          <Spinner label="Loading test history..." />
        ) : historyQ.isError ? (
          <ErrorBox
            message={historyQ.error instanceof Error ? historyQ.error.message : 'Request failed.'}
            onRetry={() => historyQ.refetch()}
          />
        ) : (
          <DataTable<WheatIntake>
            columns={[
              { key: 'intakeNo', label: 'Intake', render: (r) => <span className="tnum font-bold">{r.intakeNo}</span> },
              { key: 'deliveryDate', label: 'Delivered', render: (r) => fmtDateTime(r.deliveryDate) },
              { key: 'truckPlate', label: 'Truck', render: (r) => <span className="tnum font-semibold">{r.truckPlate}</span> },
              { key: 'supplierName', label: 'Supplier', render: (r) => r.supplier?.name ?? '-' },
              { key: 'quintals', label: 'Qty (q)', mono: true, render: (r) => fmtQ(r.quintals) },
              {
                key: 'readings',
                label: 'Readings',
                render: (r) => (
                  <span className="tnum text-xs">
                    {INTAKE_THRESHOLDS.map((t) => {
                      const v = Number(r[t.key]);
                      const bad = paramBreached(t, v);
                      return (
                        <span
                          key={t.key}
                          className={`mr-2 font-semibold ${bad ? 'text-critical-text' : 'text-slate-500'}`}
                        >
                          {t.label.slice(0, 3)} {v.toFixed(1)}
                        </span>
                      );
                    })}
                  </span>
                )
              },
              {
                key: 'verdict',
                label: 'Verdict',
                render: (r) => {
                  const verdict = intakeLabVerdict(r);
                  return <Badge tone={VERDICT_TONE[verdict]}>{verdict}</Badge>;
                }
              }
            ]}
            rows={tested}
            emptyTitle="No lab results yet"
            emptySub="Tested deliveries will appear here with their verdicts."
          />
        )}
      </div>
    </div>
  );
}
