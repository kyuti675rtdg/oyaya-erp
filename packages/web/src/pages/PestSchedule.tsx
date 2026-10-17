import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { PestScheduleEntry, PestScheduleEffectiveStatus } from '../types';
import { Button, ErrorBox, Field, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { cardShell, FREQUENCIES, PEST_AREAS, PestCardHeader, PestKpi, pretty, ScheduleStatusBadge } from './PestCommon';

const STATUS_FILTERS: Array<'ALL' | PestScheduleEffectiveStatus> = ['ALL', 'SCHEDULED', 'OVERDUE', 'DONE', 'CANCELLED'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PestSchedule() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('pest:manage');

  const [statusFilter, setStatusFilter] = useState<'ALL' | PestScheduleEffectiveStatus>('ALL');
  const [areaFilter, setAreaFilter] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [area, setArea] = useState<string>(PEST_AREAS[1]);
  const [scheduledDate, setScheduledDate] = useState(todayIso());
  const [frequency, setFrequency] = useState<'WEEKLY' | 'MONTHLY'>('WEEKLY');
  const [inspector, setInspector] = useState('');
  const [notes, setNotes] = useState('');

  const schedulesQ = useQuery({
    queryKey: ['pest-schedules', statusFilter === 'OVERDUE' ? undefined : statusFilter === 'ALL' ? undefined : statusFilter, areaFilter || undefined],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter !== 'ALL' && statusFilter !== 'OVERDUE') params.status = statusFilter;
      if (areaFilter) params.area = areaFilter;
      return (await api.get<PestScheduleEntry[]>(E.pestSchedules, { params })).data;
    }
  });

  const rows = useMemo(() => {
    let r = schedulesQ.data ?? [];
    if (statusFilter === 'OVERDUE') r = r.filter((x) => x.effectiveStatus === 'OVERDUE');
    return r;
  }, [schedulesQ.data, statusFilter]);

  const kpis = useMemo(() => {
    const all = schedulesQ.data ?? [];
    const overdue = all.filter((x) => x.effectiveStatus === 'OVERDUE');
    const upcoming = all.filter((x) => x.effectiveStatus === 'SCHEDULED');
    const month = new Date().toISOString().slice(0, 7);
    const doneMonth = all.filter((x) => x.effectiveStatus === 'DONE' && (x.completedAt ?? '').slice(0, 7) === month);
    const rate = all.length > 0 ? Math.round((all.filter((x) => x.effectiveStatus === 'DONE').length / all.length) * 100) : 0;
    return { overdue: overdue.length, upcoming: upcoming.length, doneMonth: doneMonth.length, rate };
  }, [schedulesQ.data]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      await api.post(E.pestSchedules, {
        area,
        scheduledDate,
        frequency,
        inspector: inspector.trim() || undefined,
        notes: notes.trim() || undefined
      });
      setNotice({ ok: true, text: `Inspection scheduled for ${area} on ${scheduledDate}.` });
      setInspector('');
      setNotes('');
      setScheduledDate(todayIso());
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['pest-schedules'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to schedule inspection.' });
    } finally {
      setSaving(false);
    }
  };

  const markDone = async (id: string) => {
    setSaving(true);
    try {
      await api.post(E.pestScheduleDone(id), {});
      qc.invalidateQueries({ queryKey: ['pest-schedules'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to mark done.' });
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id: string) => {
    setSaving(true);
    try {
      await api.put(E.pestSchedule(id), { status: 'CANCELLED' });
      qc.invalidateQueries({ queryKey: ['pest-schedules'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to cancel.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Pest Inspection Scheduling"
        sub="Plan and track routine pest inspections across factory areas"
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

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <PestKpi label="Overdue" value={kpis.overdue} tone="rose" sub="Past scheduled date, not done" />
        <PestKpi label="Upcoming" value={kpis.upcoming} tone="violet" sub="Scheduled, on track" />
        <PestKpi label="Done this month" value={kpis.doneMonth} tone="emerald" sub="Completed inspections" />
        <PestKpi label="Completion rate" value={`${kpis.rate}%`} tone="slate" sub="Of all scheduled" />
      </div>

      <div className={`${cardShell} mb-4`}>
        <PestCardHeader
          icon={<CalendarDays size={16} />}
          title="Inspection calendar"
          subtitle="Filter the inspection schedule"
          action={
            canManage ? (
              <Button onClick={() => setShowForm((v) => !v)} className="px-4 py-2 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Plus size={14} /> Schedule inspection
                </span>
              </Button>
            ) : null
          }
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {s === 'ALL' ? 'All statuses' : s === 'OVERDUE' ? 'Overdue' : pretty(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Area">
            <Select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
              <option value="">All areas</option>
              {PEST_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {showForm && canManage ? (
          <form onSubmit={create} className="mt-4 space-y-4 border-t border-slate-100 pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Area" required>
                <Select value={area} onChange={(e) => setArea(e.target.value)} required>
                  {PEST_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Scheduled date" required>
                <TextInput type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} required />
              </Field>
              <Field label="Frequency" required>
                <Select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {pretty(f)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Assigned inspector">
                <TextInput value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="Inspector name" />
              </Field>
            </div>
            <Field label="Notes">
              <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Scope, stations to cover…" />
            </Field>
            <Button type="submit" loading={saving} className="px-6 py-2.5">
              Schedule
            </Button>
          </form>
        ) : null}
      </div>

      {schedulesQ.isLoading ? (
        <Spinner label="Loading inspection schedule..." />
      ) : schedulesQ.isError ? (
        <ErrorBox message="Could not load the inspection schedule." onRetry={() => schedulesQ.refetch()} />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable<PestScheduleEntry>
              columns={[
                { key: 'area', label: 'Area', render: (r) => <span className="font-semibold capitalize">{r.area}</span> },
                { key: 'scheduledDate', label: 'Scheduled', render: (r) => <span className="tnum">{fmtDate(r.scheduledDate)}</span>, mono: true },
                { key: 'frequency', label: 'Frequency', render: (r) => pretty(r.frequency) },
                { key: 'inspector', label: 'Inspector', render: (r) => r.inspector ?? '—' },
                { key: 'effectiveStatus', label: 'Status', render: (r) => <ScheduleStatusBadge status={r.effectiveStatus ?? r.status} /> },
                {
                  key: 'actions',
                  label: '',
                  render: (r) =>
                    canManage && r.effectiveStatus !== 'DONE' && r.status !== 'CANCELLED' ? (
                      <div className="flex gap-2">
                        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => markDone(r.id)} disabled={saving}>
                          Mark done
                        </Button>
                        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => cancel(r.id)} disabled={saving}>
                          Cancel
                        </Button>
                      </div>
                    ) : null
                }
              ]}
              rows={rows}
              emptyTitle="No inspections found"
              emptySub="Schedule an inspection to start the pest control calendar."
            />
          </div>
          <div className="space-y-3 md:hidden">
            {rows.length === 0 ? (
              <div className={`${cardShell} text-center text-sm text-slate-500`}>No inspections found.</div>
            ) : (
              rows.map((r) => (
                <div key={r.id} className={cardShell}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold capitalize text-slate-800">{r.area}</p>
                      <p className="mt-0.5 text-xs text-slate-500 tabular-nums">{fmtDate(r.scheduledDate)} · {pretty(r.frequency)}</p>
                      {r.inspector ? <p className="mt-0.5 text-xs text-slate-500">{r.inspector}</p> : null}
                    </div>
                    <ScheduleStatusBadge status={r.effectiveStatus ?? r.status} />
                  </div>
                  {canManage && r.effectiveStatus !== 'DONE' && r.status !== 'CANCELLED' ? (
                    <div className="mt-3 flex gap-2">
                      <Button variant="secondary" className="flex-1 py-2 text-xs" onClick={() => markDone(r.id)} disabled={saving}>
                        Mark done
                      </Button>
                      <Button variant="secondary" className="flex-1 py-2 text-xs" onClick={() => cancel(r.id)} disabled={saving}>
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
