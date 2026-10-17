import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TimerOff, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import { useAuth } from '../store/auth';
import type { DowntimeCategory, DowntimeLog, DowntimeSummaryRow, MillingRun } from '../types';
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
import { fmtDate, fmtDateTime, fmtInt } from '../lib/format';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const CATEGORY_OPTIONS: { value: DowntimeCategory; label: string }[] = [
  { value: 'POWER', label: 'Power' },
  { value: 'MECHANICAL', label: 'Mechanical' },
  { value: 'ELECTRICAL', label: 'Electrical' },
  { value: 'PLANNED', label: 'Planned maintenance' },
  { value: 'OTHER', label: 'Other' }
];

const MACHINE_SUGGESTIONS = ['Mill Line 1', 'Mill Line 2', 'Washer Line', 'Packing Line', 'Boiler / Utilities'];

function categoryTone(c: DowntimeCategory): 'critical' | 'advisory' | 'neutral' | 'pass' {
  if (c === 'POWER') return 'critical';
  if (c === 'MECHANICAL' || c === 'ELECTRICAL') return 'advisory';
  if (c === 'PLANNED') return 'neutral';
  return 'neutral';
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function ProdDowntimeLogs() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('production:manage');

  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Summary window
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(todayISO());

  // Log form
  const [machineLine, setMachineLine] = useState('');
  const [runId, setRunId] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [endedAt, setEndedAt] = useState('');
  const [minutesLost, setMinutesLost] = useState('');
  const [reasonCategory, setReasonCategory] = useState<DowntimeCategory>('POWER');
  const [description, setDescription] = useState('');
  const [resolvedBy, setResolvedBy] = useState('');

  const summaryQ = useQuery({
    queryKey: ['prod-downtime-summary', fromDate, toDate],
    queryFn: async () =>
      (await api.get<DowntimeSummaryRow[]>(E.prodDowntimeSummary(fromDate, toDate))).data,
    enabled: !!fromDate && !!toDate && fromDate <= toDate
  });
  const logsQ = useQuery({
    queryKey: ['prod-downtime-logs', fromDate, toDate],
    queryFn: async () =>
      (
        await api.get<DowntimeLog[]>(
          `${E.prodDowntime}?from=${fromDate}&to=${toDate}`
        )
      ).data,
    enabled: !!fromDate && !!toDate && fromDate <= toDate
  });
  const runsQ = useQuery({
    queryKey: ['prod-runs-running'],
    queryFn: async () => (await api.get<MillingRun[]>(E.prodMillingRunsRunning)).data
  });

  const totals = useMemo(() => {
    const rows = summaryQ.data ?? [];
    const minutes = rows.reduce((s, r) => s + r.minutesLost, 0);
    const events = rows.reduce((s, r) => s + r.events, 0);
    const uptime = rows.length > 0 ? rows.reduce((s, r) => s + r.uptimePct, 0) / rows.length : 100;
    return { minutes, events, uptime, machines: rows.length };
  }, [summaryQ.data]);

  const logDowntime = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      const mins = Number(minutesLost);
      if (!machineLine.trim() || !startedAt) {
        setNotice({ ok: false, text: 'Machine/line and start time are required.' });
        return;
      }
      if (!Number.isInteger(mins) || mins <= 0) {
        setNotice({ ok: false, text: 'Minutes lost must be a positive whole number.' });
        return;
      }
      if (endedAt && new Date(endedAt).getTime() < new Date(startedAt).getTime()) {
        setNotice({ ok: false, text: 'End time cannot be before start time.' });
        return;
      }
      const r = await submitOrQueue('prod-downtime', E.prodDowntime, {
        machineLine: machineLine.trim(),
        runId: runId || null,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: endedAt ? new Date(endedAt).toISOString() : null,
        minutesLost: mins,
        reasonCategory,
        description: description.trim() || null,
        resolvedBy: resolvedBy.trim() || null
      });
      let extra = '';
      if (r.queued) extra = ' Saved offline — will sync automatically.';
      setNotice({ ok: true, text: `Downtime logged (${fmtMinutes(mins)}).${extra}` });
      setMachineLine('');
      setRunId('');
      setStartedAt('');
      setEndedAt('');
      setMinutesLost('');
      setDescription('');
      setResolvedBy('');
      qc.invalidateQueries({ queryKey: ['prod-downtime-summary'] });
      qc.invalidateQueries({ queryKey: ['prod-downtime-logs'] });
      qc.invalidateQueries({ queryKey: ['prod-yield-alerts'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to log downtime.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Downtime & Machine Activity Logs"
        sub="Machine/line stoppages with reason categories and uptime calculation"
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

      {/* Summary window + KPIs */}
      <div className={`${cardShell} mb-4`}>
        <CardHeader
          icon={<TimerOff size={16} />}
          title="Uptime summary"
          subtitle="Window-based availability per machine"
          action={
            <div className="flex items-center gap-2">
              <TextInput
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="From date"
              />
              <span className="text-xs text-slate-400">to</span>
              <TextInput
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="To date"
              />
            </div>
          }
        />
        {summaryQ.isLoading ? (
          <Spinner label="Computing uptime..." />
        ) : summaryQ.isError ? (
          <ErrorBox message="Failed to compute uptime." onRetry={() => summaryQ.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Avg uptime</p>
                <p className={`tabular-nums mt-1 text-2xl font-bold ${totals.uptime >= 95 ? 'text-emerald-700' : totals.uptime >= 90 ? 'text-amber-700' : 'text-rose-600'}`}>
                  {totals.uptime.toFixed(1)}%
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Minutes lost</p>
                <p className="tabular-nums mt-1 text-2xl font-bold text-slate-800">{fmtMinutes(totals.minutes)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Events</p>
                <p className="tabular-nums mt-1 text-2xl font-bold text-slate-800">{fmtInt(totals.events)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Machines affected</p>
                <p className="tabular-nums mt-1 text-2xl font-bold text-slate-800">{fmtInt(totals.machines)}</p>
              </div>
            </div>
            {(summaryQ.data ?? []).length > 0 ? (
              <div className="mt-4 hidden md:block">
                <DataTable<DowntimeSummaryRow>
                  keyOf={(r) => r.machineLine}
                  columns={[
                    { key: 'machineLine', label: 'Machine / Line', render: (r) => <span className="font-bold text-slate-800">{r.machineLine}</span> },
                    { key: 'events', label: 'Events', mono: true },
                    { key: 'minutesLost', label: 'Lost', mono: true, render: (r) => fmtMinutes(r.minutesLost) },
                    {
                      key: 'byCategory',
                      label: 'By category',
                      render: (r) => (
                        <span className="tabular-nums text-xs text-slate-600">
                          {Object.entries(r.byCategory)
                            .map(([c, m]) => `${c}: ${m}m`)
                            .join(' · ')}
                        </span>
                      )
                    },
                    {
                      key: 'uptimePct',
                      label: 'Uptime',
                      mono: true,
                      render: (r) => (
                        <Badge tone={r.uptimePct >= 95 ? 'pass' : r.uptimePct >= 90 ? 'advisory' : 'critical'}>
                          {r.uptimePct.toFixed(1)}%
                        </Badge>
                      )
                    }
                  ]}
                  rows={summaryQ.data ?? []}
                  emptyTitle="No downtime in window"
                  emptySub="Machines ran without recorded stoppages."
                />
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState title="No downtime in window" sub="Machines ran without recorded stoppages." />
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {canManage ? (
          <div className={cardShell}>
            <CardHeader
              icon={<Wrench size={16} />}
              title="Log downtime"
              subtitle="Record every stoppage as it happens"
            />
            <form onSubmit={logDowntime} className="space-y-4">
              <Field label="Machine / line" required>
                <TextInput
                  value={machineLine}
                  onChange={(e) => setMachineLine(e.target.value)}
                  placeholder="e.g. Mill Line 1"
                  list="machine-suggestions"
                  required
                />
                <datalist id="machine-suggestions">
                  {MACHINE_SUGGESTIONS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <Field label="Running milling run">
                <Select value={runId} onChange={(e) => setRunId(e.target.value)}>
                  <option value="">Not linked</option>
                  {(runsQ.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.runNo} — {r.lineMachine}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start" required>
                  <TextInput
                    type="datetime-local"
                    value={startedAt}
                    onChange={(e) => setStartedAt(e.target.value)}
                    required
                  />
                </Field>
                <Field label="End">
                  <TextInput type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Minutes lost" required>
                  <NumberInput
                    value={minutesLost}
                    onChange={(e) => setMinutesLost(e.target.value)}
                    min={1}
                    step="1"
                    placeholder="0"
                  />
                </Field>
                <Field label="Reason category" required>
                  <Select
                    value={reasonCategory}
                    onChange={(e) => setReasonCategory(e.target.value as DowntimeCategory)}
                  >
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Description">
                <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </Field>
              <Field label="Resolved by">
                <TextInput
                  value={resolvedBy}
                  onChange={(e) => setResolvedBy(e.target.value)}
                  placeholder="Technician name"
                />
              </Field>
              <Button type="submit" loading={saving} className="w-full">
                Log downtime
              </Button>
            </form>
          </div>
        ) : null}

        <div className={canManage ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <div className={cardShell}>
            <CardHeader icon={<TimerOff size={16} />} title="Downtime events" subtitle={`${fmtDate(fromDate)} — ${fmtDate(toDate)}`} />
            {logsQ.isLoading ? (
              <Spinner label="Loading downtime events..." />
            ) : logsQ.isError ? (
              <ErrorBox message="Failed to load downtime events." onRetry={() => logsQ.refetch()} />
            ) : (
              <>
                <div className="hidden md:block">
                  <DataTable<DowntimeLog>
                    columns={[
                      {
                        key: 'machineLine',
                        label: 'Machine / Line',
                        render: (r) => <span className="font-bold text-slate-800">{r.machineLine}</span>
                      },
                      { key: 'startedAt', label: 'Start', render: (r) => fmtDateTime(r.startedAt) },
                      { key: 'minutesLost', label: 'Lost', mono: true, render: (r) => fmtMinutes(r.minutesLost) },
                      {
                        key: 'reasonCategory',
                        label: 'Reason',
                        render: (r) => <Badge tone={categoryTone(r.reasonCategory)}>{r.reasonCategory}</Badge>
                      },
                      { key: 'description', label: 'Notes', render: (r) => r.description ?? '-' },
                      { key: 'resolvedBy', label: 'Resolved by', render: (r) => r.resolvedBy ?? '-' }
                    ]}
                    rows={logsQ.data ?? []}
                    emptyTitle="No downtime events"
                    emptySub="Log a stoppage to start tracking machine availability."
                  />
                </div>
                <div className="space-y-3 md:hidden">
                  {(logsQ.data ?? []).length === 0 ? (
                    <EmptyState title="No downtime events" sub="Log a stoppage to start tracking machine availability." />
                  ) : (
                    (logsQ.data ?? []).map((r) => (
                      <div key={r.id} className="rounded-xl border border-slate-200/70 p-4">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800">{r.machineLine}</span>
                          <Badge tone={categoryTone(r.reasonCategory)}>{r.reasonCategory}</Badge>
                        </div>
                        <p className="tabular-nums mt-1 text-xs text-slate-500">
                          {fmtDateTime(r.startedAt)} · lost {fmtMinutes(r.minutesLost)}
                        </p>
                        {r.description ? <p className="mt-1 text-sm text-slate-600">{r.description}</p> : null}
                        {r.resolvedBy ? <p className="mt-1 text-xs text-slate-500">Resolved by {r.resolvedBy}</p> : null}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
