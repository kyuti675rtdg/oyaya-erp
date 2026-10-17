import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, IdCard, Pencil, Plus } from 'lucide-react';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { DriverAssignment, Vehicle } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextArea, TextInput } from '../components/ui';

const cardShell = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-sm p-5';

function licenseState(expiry: string | null | undefined, status: string): 'pass' | 'advisory' | 'critical' | null {
  if (!expiry || status !== 'ACTIVE') return null;
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400_000);
  if (days < 0) return 'critical';
  if (days <= 30) return 'advisory';
  return 'pass';
}

export function DriverAssignment() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('fleet:manage');

  const [showHistory, setShowHistory] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DriverAssignment | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const assignmentsQ = useQuery({
    queryKey: ['fleet-assignments', showHistory],
    queryFn: async () => {
      const q = showHistory ? '' : '?status=ACTIVE';
      return (await api.get<DriverAssignment[]>(`${E.fleetAssignments}${q}`)).data;
    }
  });
  const alertsQ = useQuery({
    queryKey: ['fleet-license-alerts'],
    queryFn: async () => (await api.get<DriverAssignment[]>(E.fleetLicenseAlerts(30))).data
  });
  const vehiclesQ = useQuery({
    queryKey: ['fleet-vehicles'],
    queryFn: async () => (await api.get<Vehicle[]>(E.vehicles)).data
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fleet-assignments'] });
    qc.invalidateQueries({ queryKey: ['fleet-license-alerts'] });
  };

  const openAdd = () => {
    setEditing(null);
    setFormError(null);
    setModalOpen(true);
  };
  const openEdit = (a: DriverAssignment) => {
    setEditing(a);
    setFormError(null);
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const payload = {
        ...(editing ? {} : { vehicleId: String(fd.get('vehicleId') ?? '') }),
        driverName: String(fd.get('driverName') ?? '').trim(),
        licenseNo: String(fd.get('licenseNo') ?? '').trim() || null,
        licenseExpiry: String(fd.get('licenseExpiry') ?? '') || null,
        assignedFrom: String(fd.get('assignedFrom') ?? ''),
        assignedTo: String(fd.get('assignedTo') ?? '') || null,
        notes: String(fd.get('notes') ?? '').trim() || null,
        ...(editing ? { status: String(fd.get('status') ?? 'ACTIVE') } : {})
      };
      if (editing) {
        await api.put(E.fleetAssignment(editing.id), payload);
      } else {
        await api.post(E.fleetAssignments, payload);
      }
      setModalOpen(false);
      invalidate();
    } catch (err) {
      setFormError(
        isNetworkError(err)
          ? 'Network error — check your connection.'
          : 'Save failed. A vehicle can only have one active driver at a time.'
      );
    } finally {
      setSaving(false);
    }
  };

  const endAssignment = async (a: DriverAssignment) => {
    if (!window.confirm(`End ${a.driverName}'s assignment?`)) return;
    try {
      await api.put(E.fleetAssignment(a.id), {
        status: 'ENDED',
        assignedTo: new Date().toISOString().slice(0, 10)
      });
      invalidate();
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-5">
      {(alertsQ.data ?? []).length > 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-bold text-amber-900">
              {(alertsQ.data ?? []).length} driver license{(alertsQ.data ?? []).length === 1 ? '' : 's'} expiring soon or expired
            </p>
            <p className="mt-1 text-xs text-amber-800">
              {(alertsQ.data ?? []).map((a) => `${a.driverName} (${a.vehicle?.plateNo ?? ''}, ${a.licenseExpiry ? fmtDate(a.licenseExpiry) : 'no date'})`).join(' · ')}
            </p>
          </div>
        </div>
      ) : null}

      <div className={cardShell}>
        <CardHeader
          icon={<IdCard size={16} />}
          title="Driver Assignment"
          subtitle="Assign drivers to vehicles and track license validity"
          action={
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? 'Active only' : 'Show history'}
              </Button>
              {canManage ? (
                <Button onClick={openAdd}>
                  <Plus size={14} /> Assign driver
                </Button>
              ) : undefined}
            </div>
          }
        />
        {assignmentsQ.isLoading ? (
          <Spinner label="Loading assignments..." />
        ) : assignmentsQ.isError ? (
          <ErrorBox message="Could not load assignments." onRetry={() => assignmentsQ.refetch()} />
        ) : (assignmentsQ.data ?? []).length === 0 ? (
          <EmptyState title="No assignments" sub={showHistory ? 'No assignment history yet.' : 'No active driver assignments.'} />
        ) : (
          <DataTable<DriverAssignment>
            columns={[
              { key: 'vehicle', label: 'Vehicle', render: (a) => <span className="font-bold tabular-nums">{a.vehicle?.plateNo ?? '—'}</span> },
              { key: 'driverName', label: 'Driver', render: (a) => a.driverName },
              { key: 'licenseNo', label: 'License', mono: true, render: (a) => a.licenseNo ?? '—' },
              {
                key: 'licenseExpiry',
                label: 'License expiry',
                render: (a) => {
                  const st = licenseState(a.licenseExpiry, a.status);
                  if (st === null) return <span className="text-slate-400 dark:text-slate-500">—</span>;
                  return (
                    <Badge tone={st}>
                      {a.licenseExpiry ? fmtDate(a.licenseExpiry) : '—'}
                    </Badge>
                  );
                }
              },
              { key: 'period', label: 'Period', render: (a) => `${fmtDate(a.assignedFrom)} → ${a.assignedTo ? fmtDate(a.assignedTo) : 'present'}` },
              { key: 'status', label: 'Status', render: (a) => <Badge tone={a.status === 'ACTIVE' ? 'pass' : 'neutral'}>{a.status}</Badge> },
              ...(canManage
                ? [
                    {
                      key: 'actions',
                      label: 'Actions',
                      render: (a: DriverAssignment) => (
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" onClick={() => openEdit(a)} title="Edit">
                            <Pencil size={13} />
                          </Button>
                          {a.status === 'ACTIVE' ? (
                            <Button variant="ghost" onClick={() => endAssignment(a)} title="End assignment">
                              ✕
                            </Button>
                          ) : null}
                        </div>
                      )
                    }
                  ]
                : [])
            ]}
            rows={assignmentsQ.data ?? []}
            emptyTitle="No assignments found."
          />
        )}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={editing ? 'Edit assignment' : 'Assign driver'}
          >
            <h3 className="mb-4 text-base font-bold text-slate-900 dark:text-slate-100">{editing ? 'Edit assignment' : 'Assign driver'}</h3>
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
                        {v.plateNo} ({v.ownership})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Driver name" required>
                  <TextInput name="driverName" defaultValue={editing?.driverName ?? ''} required />
                </Field>
                <Field label="License number">
                  <TextInput name="licenseNo" defaultValue={editing?.licenseNo ?? ''} className="tabular-nums" />
                </Field>
                <Field label="License expiry">
                  <TextInput name="licenseExpiry" type="date" defaultValue={editing?.licenseExpiry?.slice(0, 10) ?? ''} />
                </Field>
                <Field label="Assigned from" required>
                  <TextInput name="assignedFrom" type="date" defaultValue={editing?.assignedFrom?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)} required />
                </Field>
                <Field label="Assigned to">
                  <TextInput name="assignedTo" type="date" defaultValue={editing?.assignedTo?.slice(0, 10) ?? ''} />
                </Field>
                {editing ? (
                  <Field label="Status">
                    <Select name="status" defaultValue={editing.status}>
                      <option value="ACTIVE">Active</option>
                      <option value="ENDED">Ended</option>
                    </Select>
                  </Field>
                ) : null}
              </div>
              <Field label="Notes">
                <TextArea name="notes" rows={2} defaultValue={editing?.notes ?? ''} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving}>
                  {editing ? 'Save changes' : 'Assign driver'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
