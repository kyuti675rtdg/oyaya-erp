import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Pencil, Plus, Wrench } from 'lucide-react';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtBirr, fmtDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { FleetMaintenanceRecord, Vehicle } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextArea, TextInput } from '../components/ui';

const cardShell = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-sm p-5';

const serviceTypeLabel: Record<string, string> = {
  PREVENTIVE: 'Preventive',
  CORRECTIVE: 'Corrective',
  INSPECTION: 'Inspection'
};

const serviceTone: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  PREVENTIVE: 'advisory',
  CORRECTIVE: 'critical',
  INSPECTION: 'neutral'
};

export function FleetMaintenance() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('fleet:manage');

  const [vehicleFilter, setVehicleFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FleetMaintenanceRecord | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const recordsQ = useQuery({
    queryKey: ['fleet-maintenance', vehicleFilter],
    queryFn: async () => {
      const q = vehicleFilter ? `?vehicleId=${vehicleFilter}` : '';
      return (await api.get<FleetMaintenanceRecord[]>(`${E.fleetMaintenance}${q}`)).data;
    }
  });
  const dueQ = useQuery({
    queryKey: ['fleet-maintenance-due'],
    queryFn: async () => (await api.get<FleetMaintenanceRecord[]>(E.fleetMaintenanceDue(30))).data
  });
  const vehiclesQ = useQuery({
    queryKey: ['fleet-vehicles'],
    queryFn: async () => (await api.get<Vehicle[]>(E.vehicles)).data
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fleet-maintenance'] });
    qc.invalidateQueries({ queryKey: ['fleet-maintenance-due'] });
  };

  /** Maintenance cost per vehicle for the loaded records. */
  const costByVehicle = useMemo(() => {
    const m = new Map<string, { id: string; plate: string; total: number; count: number }>();
    for (const r of recordsQ.data ?? []) {
      const plate = r.vehicle?.plateNo ?? r.vehicleId;
      if (!m.has(r.vehicleId)) m.set(r.vehicleId, { id: r.vehicleId, plate, total: 0, count: 0 });
      const acc = m.get(r.vehicleId)!;
      acc.total += Number(r.costBirr);
      acc.count += 1;
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [recordsQ.data]);

  const openAdd = () => {
    setEditing(null);
    setFormError(null);
    setModalOpen(true);
  };
  const openEdit = (r: FleetMaintenanceRecord) => {
    setEditing(r);
    setFormError(null);
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const strOrNull = (k: string) => {
        const v = String(fd.get(k) ?? '').trim();
        return v || null;
      };
      const payload = {
        ...(editing ? {} : { vehicleId: String(fd.get('vehicleId') ?? '') }),
        serviceType: String(fd.get('serviceType') ?? 'PREVENTIVE'),
        description: String(fd.get('description') ?? '').trim(),
        serviceDate: String(fd.get('serviceDate') ?? ''),
        costBirr: fd.get('costBirr') !== '' ? Number(fd.get('costBirr')) : 0,
        odometer: fd.get('odometer') !== '' ? Number(fd.get('odometer')) : null,
        nextDueDate: strOrNull('nextDueDate'),
        performedBy: strOrNull('performedBy'),
        status: String(fd.get('status') ?? 'COMPLETED')
      };
      if (editing) {
        await api.put(E.fleetMaintRecord(editing.id), payload);
      } else {
        await api.post(E.fleetMaintenance, payload);
      }
      setModalOpen(false);
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Save failed. Please review the form.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: FleetMaintenanceRecord) => {
    if (!window.confirm('Delete this maintenance record?')) return;
    try {
      await api.delete(E.fleetMaintRecord(r.id));
      invalidate();
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-5">
      {(dueQ.data ?? []).length > 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-bold text-amber-900">
              {(dueQ.data ?? []).length} service{(dueQ.data ?? []).length === 1 ? '' : 's'} due within 30 days or overdue
            </p>
            <p className="mt-1 text-xs text-amber-800">
              {(dueQ.data ?? []).map((r) => `${r.vehicle?.plateNo ?? ''} — ${r.description} (due ${r.nextDueDate ? fmtDate(r.nextDueDate) : '?'})`).join(' · ')}
            </p>
          </div>
        </div>
      ) : null}

      <div className={cardShell}>
        <CardHeader
          icon={<Wrench size={16} />}
          title="Fleet Maintenance Tracking"
          subtitle="Service records, next-service due alerts, and cost per vehicle"
          action={
            canManage ? (
              <Button onClick={openAdd}>
                <Plus size={14} /> New service record
              </Button>
            ) : undefined
          }
        />
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-64">
          <Field label="Filter by vehicle">
            <Select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)}>
              <option value="">All vehicles</option>
              {(vehiclesQ.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNo}
                </option>
              ))}
            </Select>
          </Field>
          </div>
        </div>
        {recordsQ.isLoading ? (
          <Spinner label="Loading maintenance records..." />
        ) : recordsQ.isError ? (
          <ErrorBox message="Could not load maintenance records." onRetry={() => recordsQ.refetch()} />
        ) : (recordsQ.data ?? []).length === 0 ? (
          <EmptyState title="No maintenance records" sub="Record preventive services, repairs and inspections per vehicle." />
        ) : (
          <DataTable<FleetMaintenanceRecord>
            columns={[
              { key: 'vehicle', label: 'Vehicle', render: (r) => <span className="font-bold tabular-nums">{r.vehicle?.plateNo ?? '—'}</span> },
              { key: 'serviceType', label: 'Type', render: (r) => <Badge tone={serviceTone[r.serviceType] ?? 'neutral'}>{serviceTypeLabel[r.serviceType] ?? r.serviceType}</Badge> },
              { key: 'description', label: 'Description', render: (r) => <span className="line-clamp-2 max-w-xs">{r.description}</span> },
              { key: 'serviceDate', label: 'Service date', render: (r) => fmtDate(r.serviceDate) },
              { key: 'cost', label: 'Cost (ETB)', mono: true, render: (r) => fmtBirr(r.costBirr) },
              { key: 'nextDue', label: 'Next due', render: (r) => (r.nextDueDate ? fmtDate(r.nextDueDate) : '—') },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'COMPLETED' ? 'pass' : 'advisory'}>{r.status}</Badge> },
              ...(canManage
                ? [
                    {
                      key: 'actions',
                      label: 'Actions',
                      render: (r: FleetMaintenanceRecord) => (
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" onClick={() => openEdit(r)} title="Edit">
                            <Pencil size={13} />
                          </Button>
                          <Button variant="ghost" onClick={() => remove(r)} title="Delete">
                            ✕
                          </Button>
                        </div>
                      )
                    }
                  ]
                : [])
            ]}
            rows={recordsQ.data ?? []}
            emptyTitle="No maintenance records found."
          />
        )}
      </div>

      <div className={cardShell}>
        <CardHeader icon={<Wrench size={16} />} title="Maintenance cost per vehicle" subtitle="Totals from the loaded records" />
        {costByVehicle.length === 0 ? (
          <EmptyState title="No cost data" sub="No maintenance records in the current filter." />
        ) : (
          <DataTable<{ id: string; plate: string; total: number; count: number }>
            columns={[
              { key: 'plate', label: 'Vehicle', render: (r) => <span className="font-bold tabular-nums">{r.plate}</span> },
              { key: 'count', label: 'Services', mono: true, render: (r) => String(r.count) },
              { key: 'total', label: 'Total cost (ETB)', mono: true, render: (r) => fmtBirr(r.total) }
            ]}
            rows={costByVehicle}
            emptyTitle="No cost data."
          />
        )}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={editing ? 'Edit service record' : 'New service record'}
          >
            <h3 className="mb-4 text-base font-bold text-slate-900 dark:text-slate-100">{editing ? 'Edit service record' : 'New service record'}</h3>
            {formError ? (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            ) : null}
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Vehicle" required>
                  <Select name="vehicleId" defaultValue={editing?.vehicleId ?? ''} required disabled={!!editing}>
                    <option value="">Select…</option>
                    {(vehiclesQ.data ?? []).filter((v) => v.isActive).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plateNo}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Service type" required>
                  <Select name="serviceType" defaultValue={editing?.serviceType ?? 'PREVENTIVE'}>
                    <option value="PREVENTIVE">Preventive</option>
                    <option value="CORRECTIVE">Corrective</option>
                    <option value="INSPECTION">Inspection</option>
                  </Select>
                </Field>
                <Field label="Service date" required>
                  <TextInput name="serviceDate" type="date" defaultValue={editing?.serviceDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)} required />
                </Field>
                <Field label="Cost (ETB)">
                  <TextInput name="costBirr" type="number" step="0.01" min="0" defaultValue={editing?.costBirr ?? ''} className="tabular-nums" />
                </Field>
                <Field label="Odometer">
                  <TextInput name="odometer" type="number" step="0.1" min="0" defaultValue={editing?.odometer ?? ''} className="tabular-nums" />
                </Field>
                <Field label="Next due date">
                  <TextInput name="nextDueDate" type="date" defaultValue={editing?.nextDueDate?.slice(0, 10) ?? ''} />
                </Field>
                <Field label="Performed by">
                  <TextInput name="performedBy" defaultValue={editing?.performedBy ?? ''} />
                </Field>
                <Field label="Status">
                  <Select name="status" defaultValue={editing?.status ?? 'COMPLETED'}>
                    <option value="COMPLETED">Completed</option>
                    <option value="SCHEDULED">Scheduled</option>
                  </Select>
                </Field>
              </div>
              <Field label="Description" required>
                <TextArea name="description" rows={3} defaultValue={editing?.description ?? ''} required />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving}>
                  {editing ? 'Save changes' : 'Save record'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
