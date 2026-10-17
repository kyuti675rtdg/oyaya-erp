import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Cog, Plus } from 'lucide-react';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { MaintenanceEquipment } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextInput } from '../components/ui';

export const EQUIPMENT_TYPE_LABELS: Record<string, string> = {
  ROLLER_MILL: 'Roller Mill',
  PLANSIFTER: 'Plansifter / Sifter',
  PURIFIER: 'Purifier',
  CONVEYOR: 'Conveyor / Auger',
  BUCKET_ELEVATOR: 'Bucket Elevator',
  PACKING_MACHINE: 'Packing Machine',
  COMPRESSOR: 'Compressor',
  GENERATOR: 'Generator',
  OTHER: 'Other'
};

export const EQUIPMENT_STATUSES = ['OPERATIONAL', 'UNDER_MAINTENANCE', 'BREAKDOWN'];

const cardShell =
  'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

const STATUS_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  OPERATIONAL: 'pass',
  UNDER_MAINTENANCE: 'advisory',
  BREAKDOWN: 'critical'
};

function typeLabel(t: string): string {
  return EQUIPMENT_TYPE_LABELS[t] ?? t;
}

export function MaintPlanning() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('maintenance:manage');

  const [overdueOnly, setOverdueOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceEquipment | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['maint-equipment', overdueOnly, typeFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (overdueOnly) params.set('overdue', 'true');
      if (typeFilter) params.set('type', typeFilter);
      if (search.trim()) params.set('search', search.trim());
      const q = params.toString();
      return (await api.get<MaintenanceEquipment[]>(`${E.maintEquipment}${q ? `?${q}` : ''}`)).data;
    }
  });

  const stats = useMemo(() => {
    const rows = data ?? [];
    return {
      total: rows.length,
      overdue: rows.filter((r) => r.overdue).length,
      dueSoon: rows.filter((r) => !r.overdue && r.dueSoon).length,
      breakdown: rows.filter((r) => r.status === 'BREAKDOWN').length
    };
  }, [data]);

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (eq: MaintenanceEquipment) => {
    setEditing(eq);
    setFormError(null);
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const body: Record<string, unknown> = {
        name: String(fd.get('name') ?? '').trim(),
        type: String(fd.get('type') ?? 'OTHER'),
        location: String(fd.get('location') ?? '').trim() || null,
        installDate: String(fd.get('installDate') ?? '') || null,
        intervalDays: Number(fd.get('intervalDays') ?? 30),
        nextDueDate: String(fd.get('nextDueDate') ?? '') || null,
        status: String(fd.get('status') ?? 'OPERATIONAL')
      };
      if (editing) {
        await api.put(E.maintEquipmentById(editing.id), body);
      } else {
        await api.post(E.maintEquipment, body);
      }
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['maint-equipment'] });
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Could not save equipment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Equipment Maintenance Planning</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Mill equipment registry with preventive-maintenance intervals and due dates.
          </p>
        </div>
        {canManage ? (
          <Button onClick={openCreate}>
            <Plus size={16} /> Register equipment
          </Button>
        ) : null}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Registered equipment', value: stats.total, tone: 'text-slate-900' },
          { label: 'Overdue PM', value: stats.overdue, tone: stats.overdue > 0 ? 'text-rose-600' : 'text-slate-900' },
          { label: 'Due within 7 days', value: stats.dueSoon, tone: 'text-amber-600' },
          { label: 'In breakdown', value: stats.breakdown, tone: stats.breakdown > 0 ? 'text-rose-600' : 'text-slate-900' }
        ].map((k) => (
          <div key={k.label} className={cardShell}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{k.label}</p>
            <p className={`tabular-nums mt-1 text-2xl font-bold ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className={cardShell}>
        <CardHeader
          icon={<Cog size={16} />}
          title="Equipment registry"
          subtitle="Overdue rows are highlighted in red."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                placeholder="Search name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="!w-40"
              />
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="!w-44">
                <option value="">All types</option>
                {Object.entries(EQUIPMENT_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={overdueOnly}
                  onChange={(e) => setOverdueOnly(e.target.checked)}
                  className="h-4 w-4 accent-rose-600"
                />
                Overdue only
              </label>
            </div>
          }
        />

        {isLoading ? (
          <Spinner />
        ) : isError ? (
          <ErrorBox message={isNetworkError(error) ? 'Network error.' : 'Failed to load equipment.'} onRetry={() => refetch()} />
        ) : (data ?? []).length === 0 ? (
          <EmptyState title="No equipment registered" sub="Register mill equipment to start planning preventive maintenance." />
        ) : (
          <DataTable<MaintenanceEquipment>
            columns={[
              {
                key: 'name',
                label: 'Equipment',
                render: (r) => (
                  <div className="flex items-center gap-2">
                    {r.overdue ? <AlertTriangle size={15} className="shrink-0 text-rose-500" /> : null}
                    <span className={`font-medium ${r.overdue ? 'text-rose-700' : ''}`}>{r.name}</span>
                  </div>
                )
              },
              { key: 'type', label: 'Type', render: (r) => <span className="text-sm">{typeLabel(r.type)}</span> },
              { key: 'location', label: 'Location', render: (r) => <span className="text-sm">{r.location ?? '—'}</span> },
              {
                key: 'intervalDays',
                label: 'Interval',
                render: (r) => <span className="tabular-nums text-sm">{r.intervalDays} days</span>
              },
              {
                key: 'nextDueDate',
                label: 'Next due',
                render: (r) => (
                  <span className={`tabular-nums text-sm font-medium ${r.overdue ? 'text-rose-600' : r.dueSoon ? 'text-amber-600' : ''}`}>
                    {r.nextDueDate ? fmtDate(r.nextDueDate) : '—'}
                    {r.overdue ? ' · overdue' : r.dueSoon ? ' · due soon' : ''}
                  </span>
                )
              },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status.replace(/_/g, ' ')}</Badge> },
              ...(canManage
                ? [{
                    key: 'id' as const,
                    label: '',
                    render: (r: MaintenanceEquipment) => (
                      <Button variant="secondary" onClick={() => openEdit(r)}>Edit</Button>
                    )
                  }]
                : [])
            ]}
            rows={data ?? []}
            emptyTitle="No equipment matches the filters."
          />
        )}
      </div>

      {/* Create / edit modal */}
      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={editing ? 'Edit equipment' : 'Register equipment'}
          >
            <h3 className="mb-4 text-base font-bold text-slate-900 dark:text-slate-100">
              {editing ? 'Edit equipment' : 'Register equipment'}
            </h3>
            {formError ? (
              <div className="mb-4 rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
            ) : null}
            <form onSubmit={save} className="space-y-4">
              <Field label="Equipment name" required>
                <TextInput name="name" defaultValue={editing?.name ?? ''} required maxLength={200} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Type" required>
                  <Select name="type" defaultValue={editing?.type ?? 'ROLLER_MILL'}>
                    {Object.entries(EQUIPMENT_TYPE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select name="status" defaultValue={editing?.status ?? 'OPERATIONAL'}>
                    {EQUIPMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Location">
                <TextInput name="location" defaultValue={editing?.location ?? ''} maxLength={200} placeholder="e.g. Milling section" />
              </Field>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Install date">
                  <TextInput
                    type="date"
                    name="installDate"
                    defaultValue={editing?.installDate ? editing.installDate.slice(0, 10) : ''}
                  />
                </Field>
                <Field label="PM interval (days)" required>
                  <TextInput
                    type="number"
                    name="intervalDays"
                    min={1}
                    max={3650}
                    defaultValue={editing?.intervalDays ?? 30}
                    required
                    className="tabular-nums"
                  />
                </Field>
                <Field label="Next due date">
                  <TextInput
                    type="date"
                    name="nextDueDate"
                    defaultValue={editing?.nextDueDate ? editing.nextDueDate.slice(0, 10) : ''}
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Register'}</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
