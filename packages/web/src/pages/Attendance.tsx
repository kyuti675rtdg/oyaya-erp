import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, FileUp, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { AttendanceRecord, AttendanceSummary, HrEmployee } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Field, Select, Spinner, TextArea, TextInput,
  ErrorBox} from '../components/ui';
import { fmtDate } from '../lib/format';
import {
  HrModal,
  HrNotice,
  hrPrimaryBtn,
  hrSecondaryBtn,
  hrShell,
  useHrPerms
} from './HrShared';

const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HALF_DAY'] as const;

function statusTone(s: string): 'pass' | 'advisory' | 'critical' | 'neutral' {
  if (s === 'PRESENT') return 'pass';
  if (s === 'LATE') return 'advisory';
  if (s === 'ABSENT') return 'critical';
  return 'neutral';
}

export function Attendance() {
  const { canManage } = useHrPerms();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AttendanceRecord | null>(null);
  const [form, setForm] = useState({
    employeeId: '',
    date: new Date().toISOString().slice(0, 10),
    status: 'PRESENT',
    checkIn: '',
    checkOut: '',
    workHours: '',
    overtimeHours: '',
    lateMinutes: '',
    notes: ''
  });
  const [csv, setCsv] = useState('');

  const [y, m] = period.split('-').map(Number);

  const summaryQ = useQuery({
    queryKey: ['hr-attendance-summary', period],
    queryFn: async () =>
      (await api.get<AttendanceSummary[]>(E.hrAttendanceSummary(y, m))).data,
    enabled: Number.isInteger(y) && Number.isInteger(m)
  });

  const listQ = useQuery({
    queryKey: ['hr-attendance', period],
    queryFn: async () =>
      (
        await api.get<AttendanceRecord[]>(E.hrAttendance, {
          params: {
            from: new Date(y, m - 1, 1).toISOString(),
            to: new Date(y, m, 1).toISOString()
          }
        })
      ).data,
    enabled: Number.isInteger(y) && Number.isInteger(m)
  });

  const employeesQ = useQuery({
    queryKey: ['hr-employees-active'],
    queryFn: async () =>
      (await api.get<HrEmployee[]>(E.hrEmployees, { params: { isActive: 'true' } })).data
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['hr-attendance-summary'] });
    queryClient.invalidateQueries({ queryKey: ['hr-attendance'] });
  };

  const saveM = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editing) {
        return (await api.put(`${E.hrAttendance}/${editing.id}`, payload)).data;
      }
      return (await api.post(E.hrAttendance, payload)).data;
    },
    onSuccess: () => {
      setNotice({ ok: true, text: editing ? 'Attendance record updated.' : 'Attendance record saved.' });
      setShowForm(false);
      setEditing(null);
      invalidate();
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' })
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => (await api.delete(`${E.hrAttendance}/${id}`)).data,
    onSuccess: () => {
      setNotice({ ok: true, text: 'Attendance record deleted.' });
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Delete failed.' })
  });

  const openEdit = (r: AttendanceRecord) => {
    setEditing(r);
    setForm({
      employeeId: r.employeeId,
      date: r.date.slice(0, 10),
      status: r.status,
      checkIn: r.checkIn ?? '',
      checkOut: r.checkOut ?? '',
      workHours: String(r.workHours ?? ''),
      overtimeHours: String(r.overtimeHours ?? ''),
      lateMinutes: String(r.lateMinutes ?? ''),
      notes: (r as any).notes ?? '',
    });
    setShowForm(true);
    setNotice(null);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      employeeId: '',
      date: new Date().toISOString().slice(0, 10),
      status: 'PRESENT',
      checkIn: '',
      checkOut: '',
      workHours: '',
      overtimeHours: '',
      lateMinutes: '',
      notes: '',
    });
    setShowForm(true);
    setNotice(null);
  };

  const importM = useMutation({
    mutationFn: async (text: string) =>
      (await api.post<{ imported: number; errors: string[] }>(E.hrAttendanceImport, { csv: text })).data,
    onSuccess: (data) => {
      setNotice({
        ok: data.errors.length === 0,
        text:
          data.errors.length === 0
            ? `${data.imported} attendance records imported.`
            : `${data.imported} imported, ${data.errors.length} rows skipped: ${data.errors.slice(0, 3).join(' · ')}`
      });
      setShowImport(false);
      setCsv('');
      invalidate();
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Import failed.' })
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.employeeId) {
      setNotice({ ok: false, text: 'Select an employee.' });
      return;
    }
    saveM.mutate({
      employeeId: form.employeeId,
      date: new Date(`${form.date}T00:00:00Z`).toISOString(),
      status: form.status,
      checkIn: form.checkIn ? new Date(`${form.date}T${form.checkIn}:00Z`).toISOString() : null,
      checkOut: form.checkOut ? new Date(`${form.date}T${form.checkOut}:00Z`).toISOString() : null,
      workHours: form.workHours ? Number(form.workHours) : undefined,
      overtimeHours: form.overtimeHours ? Number(form.overtimeHours) : undefined,
      lateMinutes: form.lateMinutes ? Number(form.lateMinutes) : 0,
      source: 'MANUAL',
      notes: form.notes.trim() || null
    });
  };

  const totals = (summaryQ.data ?? []).reduce(
    (acc, s) => ({
      present: acc.present + s.present,
      late: acc.late + s.late,
      absent: acc.absent + s.absent,
      overtimeHours: acc.overtimeHours + s.overtimeHours
    }),
    { present: 0, late: 0, absent: 0, overtimeHours: 0 }
  );

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Clock3 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Attendance & Biometric Records</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              ZKTeco punches, manual entries and CSV import — late / absence / overtime tracking
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <button className={hrSecondaryBtn} onClick={() => setShowImport(true)}>
              <FileUp className="h-4 w-4" /> CSV import
            </button>
            <button className={hrPrimaryBtn} onClick={openCreate}>
              <Plus className="h-4 w-4" /> Manual entry
            </button>
          </div>
        ) : null}
      </div>

      {notice ? <HrNotice ok={notice.ok} text={notice.text} /> : null}

      <div className={`${hrShell} mb-4 flex items-center gap-4`}>
        <Field label="Month">
          <TextInput type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <div className="tnum flex gap-6 text-sm text-slate-600 dark:text-slate-300">
          <span>
            <span className="font-bold text-emerald-700">{totals.present}</span> present
          </span>
          <span>
            <span className="font-bold text-amber-700">{totals.late}</span> late
          </span>
          <span>
            <span className="font-bold text-red-700">{totals.absent}</span> absent
          </span>
          <span>
            <span className="font-bold text-violet-700">{totals.overtimeHours.toFixed(1)}h</span> overtime
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={hrShell}>
          <CardHeader
            icon={<Clock3 className="h-4 w-4" />}
            title="Monthly summary per employee"
            subtitle="Aggregated from attendance records"
          />
          {summaryQ.isLoading ? (
            <Spinner label="Loading summary..." />
          ) : (
            <DataTable
              columns={[
                { key: 'emp', label: 'Employee', render: (r) => `${r.employee.name} (${r.employee.employeeNo})` },
                { key: 'present', label: 'Present', mono: true, render: (r) => r.present },
                { key: 'late', label: 'Late', mono: true, render: (r) => <span className="font-bold text-amber-700">{r.late}</span> },
                { key: 'absent', label: 'Absent', mono: true, render: (r) => <span className="font-bold text-red-700">{r.absent}</span> },
                { key: 'ot', label: 'OT hours', mono: true, render: (r) => r.overtimeHours.toFixed(1) },
                { key: 'lateMin', label: 'Late min', mono: true, render: (r) => r.lateMinutes }
              ]}
              rows={(summaryQ.data ?? []).map((s) => ({ ...s, id: s.employee.id }))}
              emptyTitle="No attendance records this month"
            />
          )}
        </div>

        <div className={hrShell}>
          <CardHeader
            icon={<Clock3 className="h-4 w-4" />}
            title="Attendance log"
            subtitle="Daily records (newest first)"
          />
          {listQ.isLoading ? (
            <Spinner label="Loading records..." />
          ) : listQ.isError ? (
          <ErrorBox message="Failed to load attendance records." onRetry={() => listQ.refetch()} />
        ) : (
            <DataTable<AttendanceRecord>
              columns={[
                { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
                { key: 'emp', label: 'Employee', render: (r) => r.employee?.name ?? '—' },
                {
                  key: 'status',
                  label: 'Status',
                  render: (r) => <Badge tone={statusTone(r.status)}>{r.status.replace('_', ' ')}</Badge>
                },
                { key: 'work', label: 'Work h', mono: true, render: (r) => Number(r.workHours).toFixed(1) },
                { key: 'ot', label: 'OT h', mono: true, render: (r) => Number(r.overtimeHours).toFixed(1) },
                { key: 'src', label: 'Source', render: (r) => <span className="text-xs text-slate-500 dark:text-slate-400">{r.source}</span> },
                {
                  key: 'actions', label: 'Actions',
                  render: (r) => (
                    <span className="inline-flex items-center gap-1">
                      <button
                        onClick={() => openEdit(r)}
                        className="touch rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-violet-700"
                        title="Edit record"
                        aria-label={`Edit attendance for ${r.employee?.name}`}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(r)}
                        className="touch rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700"
                        title="Delete record"
                        aria-label={`Delete attendance for ${r.employee?.name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  )
                }
              ]}
              rows={listQ.data ?? []}
              emptyTitle="No records logged"
            />
          )}
        </div>
      </div>

      {showForm ? (
        <HrModal title={editing ? `Edit attendance — ${editing.employee?.name}` : "Manual attendance entry"} onClose={() => { setShowForm(false); setEditing(null); }}>
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Employee" required>
              <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} required>
                <option value="">—</option>
                {(employeesQ.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.employeeNo})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" required>
              <TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Late minutes">
              <TextInput type="number" min="0" value={form.lateMinutes} onChange={(e) => setForm({ ...form, lateMinutes: e.target.value })} />
            </Field>
            <Field label="Check-in">
              <TextInput type="time" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
            </Field>
            <Field label="Check-out">
              <TextInput type="time" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
            </Field>
            <Field label="Work hours">
              <TextInput type="number" min="0" step="0.25" value={form.workHours} onChange={(e) => setForm({ ...form, workHours: e.target.value })} />
            </Field>
            <Field label="Overtime hours">
              <TextInput type="number" min="0" step="0.25" value={form.overtimeHours} onChange={(e) => setForm({ ...form, overtimeHours: e.target.value })} />
            </Field>
            <Field label="Notes" hint="Optional">
              <TextInput value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 md:col-span-2">
              <button type="button" className={hrSecondaryBtn} onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" className={hrPrimaryBtn} disabled={saveM.isPending}>
                {saveM.isPending ? 'Saving...' : 'Save record'}
              </button>
            </div>
          </form>
        </HrModal>
      ) : null}

      {showImport ? (
        <HrModal title="Import attendance CSV" subtitle="ZKTeco export placeholder format" onClose={() => setShowImport(false)} wide>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            One row per record:{' '}
            <code className="rounded bg-slate-100 dark:bg-slate-700 px-1">employeeNo,date(YYYY-MM-DD),checkIn(HH:MM),checkOut(HH:MM),status,notes</code>
            <br />
            Work hours, overtime (&gt;8h) and late minutes (after 08:00) are computed automatically.
          </p>
          <TextArea
            rows={8}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={'EMP-001,2026-10-01,08:05,17:30,PRESENT,\nEMP-002,2026-10-01,08:00,16:00,,'}
            className="font-mono text-xs"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button className={hrSecondaryBtn} onClick={() => setShowImport(false)}>
              Cancel
            </button>
            <button className={hrPrimaryBtn} disabled={importM.isPending || !csv.trim()} onClick={() => importM.mutate(csv)}>
              <Upload className="h-4 w-4" /> {importM.isPending ? 'Importing...' : 'Import'}
            </button>
          </div>
        </HrModal>
      ) : null}
    </div>
  );
}
