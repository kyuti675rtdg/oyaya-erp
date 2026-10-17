import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Truck } from 'lucide-react';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtBirr, fmtQ } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Vehicle } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextArea, TextInput } from '../components/ui';

const cardShell = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-sm p-5';

const statusTone: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  AVAILABLE: 'pass',
  ON_TRIP: 'advisory',
  IN_MAINTENANCE: 'critical',
  OFF_DUTY: 'neutral'
};

export function Vehicles() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('fleet:manage');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const vehiclesQ = useQuery({
    queryKey: ['fleet-vehicles'],
    queryFn: async () => (await api.get<Vehicle[]>(E.vehicles)).data
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['fleet-vehicles'] });

  const openAdd = () => {
    setEditing(null);
    setFormError(null);
    setModalOpen(true);
  };
  const openEdit = (v: Vehicle) => {
    setEditing(v);
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
        plateNo: String(fd.get('plateNo') ?? '').trim(),
        vehicleType: String(fd.get('vehicleType') ?? '') || null,
        capacityQt: fd.get('capacityQt') !== '' ? Number(fd.get('capacityQt')) : null,
        ownership: String(fd.get('ownership') ?? 'OWNED'),
        status: String(fd.get('status') ?? 'AVAILABLE'),
        purchaseDate: String(fd.get('purchaseDate') ?? '') || null,
        purchaseCostBirr: fd.get('purchaseCostBirr') !== '' ? Number(fd.get('purchaseCostBirr')) : null,
        notes: String(fd.get('notes') ?? '').trim() || null,
        ...(editing ? { isActive: fd.get('isActive') === 'on' } : {})
      };
      if (editing) {
        await api.put(E.vehicle(editing.id), payload);
      } else {
        await api.post(E.vehicles, payload);
      }
      setModalOpen(false);
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Save failed. The plate number may already exist.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (v: Vehicle) => {
    if (!window.confirm(`Deactivate vehicle ${v.plateNo}?`)) return;
    try {
      await api.delete(E.vehicle(v.id));
      invalidate();
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<Truck size={16} />}
          title="Vehicle Registry"
          subtitle="Delivery and wheat-procurement trucks — owned and rented"
          action={
            canManage ? (
              <Button onClick={openAdd}>
                <Plus size={14} /> Add vehicle
              </Button>
            ) : undefined
          }
        />
        {vehiclesQ.isLoading ? (
          <Spinner label="Loading vehicles..." />
        ) : vehiclesQ.isError ? (
          <ErrorBox message="Could not load vehicles." onRetry={() => vehiclesQ.refetch()} />
        ) : (vehiclesQ.data ?? []).length === 0 ? (
          <EmptyState title="No vehicles registered" sub="Add the first truck to start tracking the fleet." />
        ) : (
          <DataTable<Vehicle>
            columns={[
              { key: 'plateNo', label: 'Plate', render: (v) => <span className="font-bold tabular-nums">{v.plateNo}</span> },
              { key: 'vehicleType', label: 'Type', render: (v) => v.vehicleType ?? '—' },
              { key: 'capacityQt', label: 'Capacity (Qt)', mono: true, render: (v) => (v.capacityQt != null ? fmtQ(v.capacityQt) : '—') },
              { key: 'ownership', label: 'Ownership', render: (v) => <Badge tone={v.ownership === 'OWNED' ? 'pass' : 'advisory'}>{v.ownership}</Badge> },
              { key: 'status', label: 'Status', render: (v) => <Badge tone={statusTone[v.status ?? 'AVAILABLE'] ?? 'neutral'}>{(v.status ?? 'AVAILABLE').replace('_', ' ')}</Badge> },
              { key: 'trips', label: 'Trips', mono: true, render: (v) => String(v._count?.fleetTrips ?? '—') },
              ...(canManage
                ? [
                    {
                      key: 'actions',
                      label: 'Actions',
                      render: (v: Vehicle) => (
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" onClick={() => openEdit(v)} title="Edit">
                            <Pencil size={13} />
                          </Button>
                          {v.isActive ? (
                            <Button variant="ghost" onClick={() => deactivate(v)} title="Deactivate">
                              ✕
                            </Button>
                          ) : (
                            <Badge tone="neutral">Inactive</Badge>
                          )}
                        </div>
                      )
                    }
                  ]
                : [])
            ]}
            rows={vehiclesQ.data ?? []}
            emptyTitle="No vehicles found."
          />
        )}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalOpen(false)}
          role="dialog" aria-modal="true" aria-label="Vehicle dialog"
          onKeyDown={(e) => { if (e.key === 'Escape') setModalOpen(false); }}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={editing ? 'Edit vehicle' : 'Add vehicle'}
          >
            <h3 className="mb-4 text-base font-bold text-slate-900 dark:text-slate-100">{editing ? 'Edit vehicle' : 'Add vehicle'}</h3>
            {formError ? (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            ) : null}
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Plate number" required>
                  <TextInput name="plateNo" defaultValue={editing?.plateNo ?? ''} required className="tabular-nums" />
                </Field>
                <Field label="Type">
                  <Select name="vehicleType" defaultValue={editing?.vehicleType ?? ''}>
                    <option value="">—</option>
                    <option value="TRUCK">Truck</option>
                    <option value="PICKUP">Pickup</option>
                  </Select>
                </Field>
                <Field label="Capacity (Qt)">
                  <TextInput name="capacityQt" type="number" step="0.1" min="0" defaultValue={editing?.capacityQt ?? ''} className="tabular-nums" />
                </Field>
                <Field label="Ownership" required>
                  <Select name="ownership" defaultValue={editing?.ownership ?? 'OWNED'}>
                    <option value="OWNED">Owned</option>
                    <option value="RENTED">Rented</option>
                  </Select>
                </Field>
                <Field label="Status">
                  <Select name="status" defaultValue={editing?.status ?? 'AVAILABLE'}>
                    <option value="AVAILABLE">Available</option>
                    <option value="ON_TRIP">On trip</option>
                    <option value="IN_MAINTENANCE">In maintenance</option>
                    <option value="OFF_DUTY">Off duty</option>
                  </Select>
                </Field>
                <Field label="Purchase date">
                  <TextInput name="purchaseDate" type="date" defaultValue={editing?.purchaseDate?.slice(0, 10) ?? ''} />
                </Field>
                <Field label="Purchase cost (ETB)">
                  <TextInput name="purchaseCostBirr" type="number" step="0.01" min="0" defaultValue={editing?.purchaseCostBirr ?? ''} className="tabular-nums" />
                </Field>
                {editing ? (
                  <Field label="Active">
                    <Select name="isActive" defaultValue={editing.isActive ? 'on' : 'off'}>
                      <option value="on">Active</option>
                      <option value="off">Inactive</option>
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
                  {editing ? 'Save changes' : 'Add vehicle'}
                </Button>
              </div>
              {editing?.purchaseCostBirr ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  Purchase cost: {fmtBirr(editing.purchaseCostBirr)}
                </p>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
