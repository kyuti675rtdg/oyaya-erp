import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Play, Plus, SprayCan, Square, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type {
  AreaCleaningLog,
  AreaCleaningStatus,
  CleaningChecklistTemplate
} from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../store/auth';
import { fmtDate, fmtDateTime } from '../lib/format';
import {
  CLEANING_STATUS_TONE,
  FACTORY_AREAS,
  SHIFTS,
  cardShell,
  isPastDate,
  todayISO
} from './HygieneCommon';
import {
  Button,
  Card,
  EmptyState,
  Field,
  SectionTitle,
  Select,
  Spinner,
  TextArea,
  TextInput
} from '../components/ui';

const NEXT_STATUS: Partial<Record<AreaCleaningStatus, AreaCleaningStatus>> = {
  SCHEDULED: 'IN_PROGRESS',
  IN_PROGRESS: 'DONE'
};

const NEXT_LABEL: Partial<Record<AreaCleaningStatus, string>> = {
  SCHEDULED: 'Start cleaning',
  IN_PROGRESS: 'Mark done'
};

export function AreaCleaning() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('hygiene:manage');

  const [areaFilter, setAreaFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<AreaCleaningLog | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingTask, setTogglingTask] = useState<string | null>(null);

  // Create form state
  const [area, setArea] = useState<string>(FACTORY_AREAS[0]);
  const [logDate, setLogDate] = useState(todayISO());
  const [shift, setShift] = useState<string>(SHIFTS[0]);
  const [cleaner, setCleaner] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [notes, setNotes] = useState('');

  const listQ = useQuery({
    queryKey: ['hygiene', 'area-cleaning', areaFilter, statusFilter, overdueOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (areaFilter) params.set('area', areaFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (overdueOnly) params.set('overdue', 'true');
      return (await api.get<AreaCleaningLog[]>(`${E.hygAreaCleanings}?${params}`)).data;
    }
  });

  const templatesQ = useQuery({
    queryKey: ['hygiene', 'checklists-lite'],
    queryFn: async () => (await api.get<CleaningChecklistTemplate[]>(E.hygChecklists)).data
  });

  const refreshDetail = async (id: string) => {
    const res = await api.get<AreaCleaningLog>(E.hygAreaCleaning(id));
    setDetail(res.data);
  };

  const openDetail = async (row: AreaCleaningLog) => {
    try {
      await refreshDetail(row.id);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to load log.' });
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!area || !logDate || !shift || !cleaner.trim()) {
      setNotice({ ok: false, text: 'Area, date, shift and cleaner are required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.hygAreaCleanings, {
        area,
        logDate,
        shift,
        cleaner: cleaner.trim(),
        templateId: templateId || null,
        notes: notes.trim() || null
      });
      setNotice({ ok: true, text: 'Cleaning scheduled.' });
      setCleaner('');
      setTemplateId('');
      setNotes('');
      setLogDate(todayISO());
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['hygiene', 'area-cleaning'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to schedule cleaning.' });
    } finally {
      setSaving(false);
    }
  };

  const advance = async (log: AreaCleaningLog) => {
    const next = NEXT_STATUS[log.status];
    if (!next) return;
    setSaving(true);
    try {
      const res = await api.post<AreaCleaningLog>(E.hygAreaCleaningStatus(log.id), { status: next });
      setNotice({
        ok: true,
        text: next === 'DONE' ? 'Cleaning marked done — sent to the approval queue.' : 'Cleaning started.'
      });
      qc.invalidateQueries({ queryKey: ['hygiene', 'area-cleaning'] });
      if (detail?.id === log.id) setDetail(res.data);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Status change failed.' });
    } finally {
      setSaving(false);
    }
  };

  const toggleTask = async (logId: string, taskId: string, done: boolean) => {
    setTogglingTask(taskId);
    try {
      await api.put(E.hygAreaCleaningTask(logId, taskId), { done });
      await refreshDetail(logId);
      qc.invalidateQueries({ queryKey: ['hygiene', 'area-cleaning'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to update task.' });
    } finally {
      setTogglingTask(null);
    }
  };

  const isOverdue = (l: AreaCleaningLog) => l.status !== 'DONE' && isPastDate(l.logDate);

  const columns = [
    {
      key: 'logDate',
      label: 'Date',
      render: (r: AreaCleaningLog) => (
        <span className="tabular-nums">
          {fmtDate(r.logDate)}
          {isOverdue(r) ? <Badge tone="critical" className="ml-2">Overdue</Badge> : null}
        </span>
      )
    },
    { key: 'area', label: 'Area', render: (r: AreaCleaningLog) => <span className="font-semibold text-slate-800 dark:text-slate-100">{r.area}</span> },
    { key: 'shift', label: 'Shift' },
    { key: 'cleaner', label: 'Cleaner' },
    {
      key: 'tasks',
      label: 'Tasks',
      mono: true,
      render: (r: AreaCleaningLog) => {
        const tasks = r.tasks ?? [];
        const done = tasks.filter((t) => t.done).length;
        return tasks.length === 0 ? <span className="text-slate-400 dark:text-slate-500">—</span> : <span className="tabular-nums">{done}/{tasks.length}</span>;
      }
    },
    {
      key: 'status',
      label: 'Status',
      render: (r: AreaCleaningLog) => <Badge tone={CLEANING_STATUS_TONE[r.status]}>{r.status.replace('_', ' ')}</Badge>
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r: AreaCleaningLog) => (
        <div className="flex gap-2">
          <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => openDetail(r)}>Open</Button>
          {canManage && NEXT_STATUS[r.status] ? (
            <Button className="px-3 py-1 text-xs" onClick={() => advance(r)}>{NEXT_LABEL[r.status]}</Button>
          ) : null}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Production Area Cleaning"
        sub="Cleaning log per area — schedule, track and complete sanitation work"
        action={
          canManage ? (
            <Button onClick={() => setShowForm((v) => !v)}>
              <Plus size={16} /> Schedule cleaning
            </Button>
          ) : undefined
        }
      />

      {notice ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className={cardShell}>
        <CardHeader
          icon={<SprayCan size={16} />}
          title="Cleaning log"
          subtitle="Scheduled → In Progress → Done"
          action={
            <div className="flex flex-wrap gap-2">
              <Select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="!w-auto !px-3 !py-1.5 !text-sm">
                <option value="">All areas</option>
                {FACTORY_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-auto !px-3 !py-1.5 !text-sm">
                <option value="">All statuses</option>
                {(['SCHEDULED', 'IN_PROGRESS', 'DONE'] as AreaCleaningStatus[]).map((s) => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </Select>
              <Button
                variant={overdueOnly ? 'primary' : 'secondary'}
                className="!px-3 !py-1.5 !text-sm"
                onClick={() => setOverdueOnly((v) => !v)}
              >
                Overdue only
              </Button>
            </div>
          }
        />
        {listQ.isLoading ? (
          <Spinner label="Loading cleaning log..." />
        ) : listQ.isError ? (
          <EmptyState title="Failed to load cleaning log" sub="Check your connection and try again." />
        ) : (listQ.data ?? []).length === 0 ? (
          <EmptyState title="No cleaning records" sub="Schedule the first area cleaning above." />
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable columns={columns} rows={listQ.data ?? []} />
            </div>
            <div className="grid grid-cols-1 gap-3 md:hidden">
              {(listQ.data ?? []).map((r) => (
                <div key={r.id} className={`rounded-xl border bg-white p-4 ${isOverdue(r) ? 'border-rose-300' : 'border-line'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-100">{r.area}</p>
                      <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{fmtDate(r.logDate)} · {r.shift} · {r.cleaner}</p>
                    </div>
                    <Badge tone={CLEANING_STATUS_TONE[r.status]}>{r.status.replace('_', ' ')}</Badge>
                  </div>
                  {isOverdue(r) ? <Badge tone="critical" className="mt-2">Overdue</Badge> : null}
                  <div className="mt-3 flex gap-2">
                    <Button variant="secondary" className="flex-1 py-1.5 text-sm" onClick={() => openDetail(r)}>Open</Button>
                    {canManage && NEXT_STATUS[r.status] ? (
                      <Button className="flex-1 py-1.5 text-sm" onClick={() => advance(r)}>{NEXT_LABEL[r.status]}</Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showForm ? (
        <form onSubmit={create} className={cardShell}>
          <CardHeader icon={<Plus size={16} />} title="Schedule cleaning" subtitle="Creates a Scheduled log entry" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Factory area" required>
              <Select value={area} onChange={(e) => setArea(e.target.value)}>
                {FACTORY_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
            </Field>
            <Field label="Date" required>
              <TextInput type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
            </Field>
            <Field label="Shift" required>
              <Select value={shift} onChange={(e) => setShift(e.target.value)}>
                {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Cleaner" required>
              <TextInput value={cleaner} onChange={(e) => setCleaner(e.target.value)} placeholder="Cleaner name" />
            </Field>
            <Field label="Checklist used" hint="Task items are copied into the log">
              <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">None</option>
                {(templatesQ.data ?? []).filter((t) => t.isActive).map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.equipment})</option>
                ))}
              </Select>
            </Field>
            <Field label="Notes">
              <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} placeholder="Optional notes" />
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" loading={saving}>Schedule</Button>
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <Card className="max-h-[90vh] w-full max-w-xl overflow-y-auto p-6">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink dark:text-white">{detail.area} — {fmtDate(detail.logDate)}</h3>
                <p className="text-sm tabular-nums text-slate-500 dark:text-slate-400">{detail.shift} shift · {detail.cleaner}</p>
              </div>
              <Button variant="ghost" className="px-2 py-1" onClick={() => setDetail(null)} aria-label="Close">
                <X size={18} />
              </Button>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone={CLEANING_STATUS_TONE[detail.status]}>{detail.status.replace('_', ' ')}</Badge>
              {detail.startedAt ? <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">Started {fmtDateTime(detail.startedAt)}</span> : null}
              {detail.endedAt ? <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">Ended {fmtDateTime(detail.endedAt)}</span> : null}
            </div>
            {detail.notes ? <p className="mb-3 text-sm text-slate-700 dark:text-slate-200">{detail.notes}</p> : null}

            <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Checklist</p>
            {(detail.tasks ?? []).length === 0 ? (
              <EmptyState title="No checklist attached" sub="Tasks were not copied from a template." />
            ) : (
              <ul className="space-y-2">
                {(detail.tasks ?? []).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      disabled={!canManage || detail.status === 'SCHEDULED' || togglingTask === t.id}
                      onClick={() => toggleTask(detail.id, t.id, !t.done)}
                      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        t.done ? 'border-emerald-200 bg-emerald-50/60' : 'border-line bg-white hover:bg-alabaster'
                      } ${!canManage || detail.status === 'SCHEDULED' ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${t.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-transparent'}`}>
                        {t.done ? <Check size={14} /> : <Square size={14} />}
                      </span>
                      <span>
                        <span className={`text-sm font-semibold ${t.done ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{t.title}</span>
                        {t.detail ? <span className="block text-xs text-slate-500 dark:text-slate-400">{t.detail}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex gap-2">
              {canManage && NEXT_STATUS[detail.status] ? (
                <Button onClick={() => advance(detail)} loading={saving}>
                  {detail.status === 'SCHEDULED' ? <Play size={14} /> : <Check size={14} />}
                  {NEXT_LABEL[detail.status]}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
