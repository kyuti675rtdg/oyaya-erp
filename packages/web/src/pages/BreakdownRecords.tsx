import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Wrench } from 'lucide-react';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { BreakdownRecord, MaintenanceEquipment } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextArea, TextInput } from '../components/ui';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-sm p-5';

const CATEGORIES = ['MECHANICAL', 'ELECTRICAL', 'PNEUMATIC', 'OTHER'];
const STATUSES = ['OPEN', 'IN_REPAIR', 'RESOLVED'];

const CATEGORY_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  MECHANICAL: 'critical',
  ELECTRICAL: 'advisory',
  PNEUMATIC: 'neutral',
  OTHER: 'neutral'
};

const STATUS_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  OPEN: 'critical',
  IN_REPAIR: 'advisory',
  RESOLVED: 'pass'
};

function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function BreakdownRecords() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('maintenance:manage');

  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [reportModal, setReportModal] = useState(false);
  const [resolveFor, setResolveFor] = useState<BreakdownRecord | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const breakdownsQ = useQuery({
    queryKey: ['maint-breakdowns', statusFilter, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      const q = params.toString();
      return (await api.get<BreakdownRecord[]>(`${E.maintBreakdowns}${q ? `?${q}` : ''}`)).data;
    }
  });

  const equipmentQ = useQuery({
    queryKey: ['maint-equipment-all'],
    queryFn: async () => (await api.get<MaintenanceEquipment[]>(E.maintEquipment)).data,
    enabled: reportModal
  });

  const openCount = useMemo(
    () => (breakdownsQ.data ?? []).filter((b) => b.status !== 'RESOLVED').length,
    [breakdownsQ.data]
  );

  const saveReport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const failureTimeRaw = String(fd.get('failureTime') ?? '');
      if (!failureTimeRaw) throw new Error('Failure time is required.');
      await api.post(E.maintBreakdowns, {
        equipmentId: String(fd.get('equipmentId') ?? ''),
        failureTime: new Date(failureTimeRaw).toISOString(),
        symptom: String(fd.get('symptom') ?? '').trim(),
        category: String(fd.get('category') ?? 'MECHANICAL'),
        reportedByName: String(fd.get('reportedByName') ?? '').trim() || null
      });
      setReportModal(false);
      qc.invalidateQueries({ queryKey: ['maint-breakdowns'] });
    } catch (err) {
      setFormError(err instanceof Error && !isNetworkError(err) && err.message === 'Failure time is required.'
        ? err.message
        : isNetworkError(err) ? 'Network error — check your connection.' : 'Could not record breakdown.');
    } finally {
      setSaving(false);
    }
  };

  const saveResolve = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!resolveFor) return;
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const resolvedAtRaw = String(fd.get('resolvedAt') ?? '');
      await api.put(E.maintBreakdown(resolveFor.id), {
        repairNotes: String(fd.get('repairNotes') ?? '').trim() || null,
        resolvedAt: resolvedAtRaw ? new Date(resolvedAtRaw).toISOString() : undefined,
        resolvedByName: String(fd.get('resolvedByName') ?? '').trim() || null
      });
      setResolveFor(null);
      qc.invalidateQueries({ queryKey: ['maint-breakdowns'] });
      qc.invalidateQueries({ queryKey: ['maint-equipment'] });
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Could not resolve breakdown.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Machine Breakdown &amp; Repair Records</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Breakdown log with failure categories, downtime tracking, and repair notes.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => { setReportModal(true); setFormError(null); }}>
            <Plus size={16} /> Report breakdown
          </Button>
        ) : null}
      </div>

      <div className={cardShell}>
        <CardHeader
          icon={<Wrench size={16} />}
          title="Breakdown log"
          subtitle={openCount > 0 ? `${openCount} unresolved` : 'All breakdowns resolved'}
          action={
            <div className="flex flex-wrap gap-2">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-36">
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </Select>
              <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="!w-40">
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>
                ))}
              </Select>
            </div>
          }
        />
        {breakdownsQ.isLoading ? (
          <Spinner />
        ) : breakdownsQ.isError ? (
          <ErrorBox
            message={isNetworkError(breakdownsQ.error) ? 'Network error.' : 'Failed to load breakdown records.'}
            onRetry={() => breakdownsQ.refetch()}
          />
        ) : (
          <DataTable<BreakdownRecord>
            columns={[
              {
                key: 'failureTime',
                label: 'Failure time',
                render: (r) => <span className="tabular-nums text-sm">{fmtDateTime(r.failureTime)}</span>
              },
              { key: 'equipment', label: 'Equipment', render: (r) => <span className="font-medium">{r.equipment?.name ?? '—'}</span> },
              { key: 'category', label: 'Category', render: (r) => <Badge tone={CATEGORY_TONE[r.category] ?? 'neutral'}>{r.category.charAt(0) + r.category.slice(1).toLowerCase()}</Badge> },
              { key: 'symptom', label: 'Symptom', render: (r) => <span className="max-w-xs truncate text-sm text-slate-600 dark:text-slate-300" title={r.symptom}>{r.symptom}</span> },
              { key: 'reportedByName', label: 'Reported by', render: (r) => <span className="text-sm">{r.reportedByName ?? '—'}</span> },
              {
                key: 'downtimeMinutes',
                label: 'Downtime',
                render: (r) => (
                  <span className="tabular-nums text-sm">
                    {r.downtimeMinutes != null ? `${r.downtimeMinutes} min` : r.status === 'RESOLVED' ? '—' : 'ongoing'}
                  </span>
                )
              },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status.replace(/_/g, ' ')}</Badge> },
              ...(canManage
                ? [{
                    key: 'id' as const,
                    label: '',
                    render: (r: BreakdownRecord) => r.status !== 'RESOLVED' ? (
                      <Button variant="secondary" onClick={() => { setResolveFor(r); setFormError(null); }}>
                        Resolve
                      </Button>
                    ) : (
                      <span className="tabular-nums text-xs text-slate-400 dark:text-slate-500">
                        {r.resolvedAt ? fmtDateTime(r.resolvedAt) : ''}
                      </span>
                    )
                  }]
                : [])
            ]}
            rows={breakdownsQ.data ?? []}
            emptyTitle="No breakdown records found."
          />
        )}
      </div>

      {/* Report modal */}
      {reportModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setReportModal(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Report breakdown"
          >
            <h3 className="mb-4 text-base font-bold text-slate-900 dark:text-slate-100">Report breakdown</h3>
            {formError ? (
              <div className="mb-4 rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
            ) : null}
            <form onSubmit={saveReport} className="space-y-4">
              <Field label="Equipment" required>
                {equipmentQ.isLoading ? (
                  <Spinner />
                ) : (
                  <Select name="equipmentId" required>
                    <option value="">Select equipment…</option>
                    {(equipmentQ.data ?? []).map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Failure time" required>
                  <TextInput type="datetime-local" name="failureTime" required />
                </Field>
                <Field label="Category" required>
                  <Select name="category" defaultValue="MECHANICAL">
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Symptom / failure description" required>
                <TextArea name="symptom" rows={3} required maxLength={2000} placeholder="e.g. Roller mill #2 grinding noise, belt slipping" />
              </Field>
              <Field label="Reported by">
                <TextInput name="reportedByName" maxLength={200} placeholder="Operator name" />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setReportModal(false)}>Cancel</Button>
                <Button type="submit" loading={saving}>Report breakdown</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Resolve modal */}
      {resolveFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setResolveFor(null)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Resolve breakdown"
          >
            <h3 className="mb-1 text-base font-bold text-slate-900 dark:text-slate-100">Resolve breakdown</h3>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              {resolveFor.equipment?.name ?? ''} · failed {fmtDateTime(resolveFor.failureTime)}
            </p>
            {formError ? (
              <div className="mb-4 rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
            ) : null}
            <form onSubmit={saveResolve} className="space-y-4">
              <Field label="Resolved at">
                <TextInput type="datetime-local" name="resolvedAt" defaultValue={toDateTimeLocal(new Date().toISOString())} />
              </Field>
              <Field label="Repair notes" required>
                <TextArea name="repairNotes" rows={4} required maxLength={4000} placeholder="What was repaired, parts replaced, root cause…" />
              </Field>
              <Field label="Resolved by">
                <TextInput name="resolvedByName" maxLength={200} placeholder="Technician name" />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setResolveFor(null)}>Cancel</Button>
                <Button type="submit" loading={saving}>Mark resolved</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
