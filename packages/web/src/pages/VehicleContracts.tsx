import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Pencil, Plus } from 'lucide-react';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtBirr, fmtDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Vehicle, VehicleContract } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextArea, TextInput } from '../components/ui';

const cardShell = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-sm p-5';

const contractTypeLabel: Record<string, string> = {
  RENTAL_DAILY: 'Rental · daily',
  RENTAL_MONTHLY: 'Rental · monthly',
  OWNED: 'Owned (depreciation)'
};

const statusTone: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  ACTIVE: 'pass',
  EXPIRED: 'advisory',
  TERMINATED: 'critical'
};

export function VehicleContracts() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('fleet:manage');

  const [vehicleFilter, setVehicleFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleContract | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const contractsQ = useQuery({
    queryKey: ['fleet-contracts', vehicleFilter],
    queryFn: async () => {
      const q = vehicleFilter ? `?vehicleId=${vehicleFilter}` : '';
      return (await api.get<VehicleContract[]>(`${E.fleetContracts}${q}`)).data;
    }
  });
  const vehiclesQ = useQuery({
    queryKey: ['fleet-vehicles'],
    queryFn: async () => (await api.get<Vehicle[]>(E.vehicles)).data
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['fleet-contracts'] });

  const openAdd = () => {
    setEditing(null);
    setFormError(null);
    setModalOpen(true);
  };
  const openEdit = (c: VehicleContract) => {
    setEditing(c);
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
        vehicleId: String(fd.get('vehicleId') ?? ''),
        vendor: String(fd.get('vendor') ?? '').trim(),
        contractType: String(fd.get('contractType') ?? 'RENTAL_MONTHLY'),
        rateBirr: Number(fd.get('rateBirr') ?? 0),
        startDate: String(fd.get('startDate') ?? ''),
        endDate: String(fd.get('endDate') ?? '') || null,
        terms: String(fd.get('terms') ?? '').trim() || null,
        ...(editing ? { status: String(fd.get('status') ?? 'ACTIVE') } : {})
      };
      if (editing) {
        await api.put(E.fleetContract(editing.id), payload);
      } else {
        await api.post(E.fleetContracts, payload);
      }
      setModalOpen(false);
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Save failed. Please review the form.');
    } finally {
      setSaving(false);
    }
  };

  const terminate = async (c: VehicleContract) => {
    if (!window.confirm(`Terminate contract with ${c.vendor}?`)) return;
    try {
      await api.delete(E.fleetContract(c.id));
      invalidate();
    } catch {
      // ignore
    }
  };

  const vehicleById = (id: string) => (vehiclesQ.data ?? []).find((v) => v.id === id);

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<FileText size={16} />}
          title="Owned & Rented Vehicle Management"
          subtitle="Rental contracts, vendor rates, and owned-vehicle depreciation records"
          action={
            canManage ? (
              <Button onClick={openAdd}>
                <Plus size={14} /> New contract
              </Button>
            ) : undefined
          }
        />
        <div className="mb-4 flex items-center gap-3">
          <div className="w-64">
          <Field label="Filter by vehicle">
            <Select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)}>
              <option value="">All vehicles</option>
              {(vehiclesQ.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNo} ({v.ownership})
                </option>
              ))}
            </Select>
          </Field>
          </div>
        </div>
        {contractsQ.isLoading ? (
          <Spinner label="Loading contracts..." />
        ) : contractsQ.isError ? (
          <ErrorBox message="Could not load contracts." onRetry={() => contractsQ.refetch()} />
        ) : (contractsQ.data ?? []).length === 0 ? (
          <EmptyState title="No contracts found" sub="Record rental agreements or depreciation entries for owned vehicles." />
        ) : (
          <DataTable<VehicleContract>
            columns={[
              { key: 'vehicle', label: 'Vehicle', render: (c) => <span className="font-bold tabular-nums">{c.vehicle?.plateNo ?? vehicleById(c.vehicleId)?.plateNo ?? '—'}</span> },
              { key: 'vendor', label: 'Vendor', render: (c) => c.vendor },
              { key: 'contractType', label: 'Type', render: (c) => contractTypeLabel[c.contractType] ?? c.contractType },
              { key: 'rateBirr', label: 'Rate (ETB)', mono: true, render: (c) => fmtBirr(c.rateBirr) },
              { key: 'period', label: 'Period', render: (c) => `${fmtDate(c.startDate)} → ${c.endDate ? fmtDate(c.endDate) : 'open'}` },
              { key: 'status', label: 'Status', render: (c) => <Badge tone={statusTone[c.status] ?? 'neutral'}>{c.status}</Badge> },
              ...(canManage
                ? [
                    {
                      key: 'actions',
                      label: 'Actions',
                      render: (c: VehicleContract) => (
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" onClick={() => openEdit(c)} title="Edit">
                            <Pencil size={13} />
                          </Button>
                          {c.status === 'ACTIVE' ? (
                            <Button variant="ghost" onClick={() => terminate(c)} title="Terminate">
                              ✕
                            </Button>
                          ) : null}
                        </div>
                      )
                    }
                  ]
                : [])
            ]}
            rows={contractsQ.data ?? []}
            emptyTitle="No contracts found."
          />
        )}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={editing ? 'Edit contract' : 'New contract'}
          >
            <h3 className="mb-4 text-base font-bold text-slate-900 dark:text-slate-100">{editing ? 'Edit contract' : 'New contract'}</h3>
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
                <Field label="Contract type" required>
                  <Select name="contractType" defaultValue={editing?.contractType ?? 'RENTAL_MONTHLY'}>
                    <option value="RENTAL_DAILY">Rental · daily</option>
                    <option value="RENTAL_MONTHLY">Rental · monthly</option>
                    <option value="OWNED">Owned (depreciation)</option>
                  </Select>
                </Field>
                <Field label="Vendor" required>
                  <TextInput name="vendor" defaultValue={editing?.vendor ?? ''} required placeholder="Vendor name / SELF for owned" />
                </Field>
                <Field label="Rate (ETB)" required>
                  <TextInput name="rateBirr" type="number" step="0.01" min="0" defaultValue={editing?.rateBirr ?? ''} required className="tabular-nums" />
                </Field>
                <Field label="Start date" required>
                  <TextInput name="startDate" type="date" defaultValue={editing?.startDate?.slice(0, 10) ?? ''} required />
                </Field>
                <Field label="End date">
                  <TextInput name="endDate" type="date" defaultValue={editing?.endDate?.slice(0, 10) ?? ''} />
                </Field>
                {editing ? (
                  <Field label="Status">
                    <Select name="status" defaultValue={editing.status}>
                      <option value="ACTIVE">Active</option>
                      <option value="EXPIRED">Expired</option>
                      <option value="TERMINATED">Terminated</option>
                    </Select>
                  </Field>
                ) : null}
              </div>
              <Field label="Terms">
                <TextArea name="terms" rows={2} defaultValue={editing?.terms ?? ''} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving}>
                  {editing ? 'Save changes' : 'Create contract'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
