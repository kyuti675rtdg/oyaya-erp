import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Route } from 'lucide-react';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime, fmtQ } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Dispatch, FleetTrip, Vehicle } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextArea, TextInput } from '../components/ui';

const cardShell = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-sm p-5';

const statusTone: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  PLANNED: 'neutral',
  IN_PROGRESS: 'advisory',
  COMPLETED: 'pass',
  CANCELLED: 'critical'
};

const cargoLabel: Record<string, string> = { FLOUR: 'Flour', WHEAT: 'Wheat', BRAN: 'Bran', OTHER: 'Other' };

function tripKm(t: FleetTrip): number | null {
  if (t.odometerStart != null && t.odometerEnd != null && Number(t.odometerEnd) > Number(t.odometerStart)) {
    return Math.round((Number(t.odometerEnd) - Number(t.odometerStart)) * 10) / 10;
  }
  return null;
}

export function FleetTrips() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('fleet:manage');

  const [statusFilter, setStatusFilter] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FleetTrip | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tripsQ = useQuery({
    queryKey: ['fleet-trips', statusFilter, vehicleFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (vehicleFilter) params.set('vehicleId', vehicleFilter);
      const q = params.toString();
      return (await api.get<FleetTrip[]>(`${E.fleetTrips}${q ? `?${q}` : ''}`)).data;
    }
  });
  const vehiclesQ = useQuery({
    queryKey: ['fleet-vehicles'],
    queryFn: async () => (await api.get<Vehicle[]>(E.vehicles)).data
  });
  const dispatchesQ = useQuery({
    queryKey: ['fleet-dispatch-links'],
    queryFn: async () => (await api.get<Dispatch[]>(E.dispatches)).data,
    staleTime: 60_000
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['fleet-trips'] });

  const dispatchById = useMemo(() => {
    const m = new Map<string, Dispatch>();
    (dispatchesQ.data ?? []).forEach((d) => m.set(d.id, d));
    return m;
  }, [dispatchesQ.data]);

  const openAdd = () => {
    setEditing(null);
    setFormError(null);
    setModalOpen(true);
  };
  const openEdit = (t: FleetTrip) => {
    setEditing(t);
    setFormError(null);
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const numOrNull = (k: string) => (fd.get(k) !== '' && fd.get(k) != null ? Number(fd.get(k)) : null);
      const strOrNull = (k: string) => {
        const v = String(fd.get(k) ?? '').trim();
        return v || null;
      };
      const payload = {
        ...(editing ? {} : { vehicleId: String(fd.get('vehicleId') ?? '') }),
        driverName: strOrNull('driverName'),
        routeFrom: strOrNull('routeFrom'),
        routeTo: strOrNull('routeTo'),
        cargoType: strOrNull('cargoType'),
        cargoQt: numOrNull('cargoQt'),
        departureAt: strOrNull('departureAt'),
        arrivalAt: strOrNull('arrivalAt'),
        odometerStart: numOrNull('odometerStart'),
        odometerEnd: numOrNull('odometerEnd'),
        status: String(fd.get('status') ?? 'PLANNED'),
        dispatchId: strOrNull('dispatchId'),
        notes: strOrNull('notes')
      };
      if (editing) {
        await api.put(E.fleetTrip(editing.id), payload);
      } else {
        await api.post(E.fleetTrips, payload);
      }
      setModalOpen(false);
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Save failed. Please review the form.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: FleetTrip) => {
    if (!window.confirm('Delete this trip record?')) return;
    try {
      await api.delete(E.fleetTrip(t.id));
      invalidate();
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<Route size={16} />}
          title="Delivery Trip Records"
          subtitle="Trip log for flour deliveries and wheat procurement runs"
          action={
            canManage ? (
              <Button onClick={openAdd}>
                <Plus size={14} /> Log trip
              </Button>
            ) : undefined
          }
        />
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-48">
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="PLANNED">Planned</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          </Field>
          <div className="w-56">
          <Field label="Vehicle">
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
        </div>
        {tripsQ.isLoading ? (
          <Spinner label="Loading trips..." />
        ) : tripsQ.isError ? (
          <ErrorBox message="Could not load trips." onRetry={() => tripsQ.refetch()} />
        ) : (tripsQ.data ?? []).length === 0 ? (
          <EmptyState title="No trips logged" sub="Record delivery and procurement trips for every vehicle." />
        ) : (
          <DataTable<FleetTrip>
            columns={[
              { key: 'vehicle', label: 'Vehicle', render: (t) => <span className="font-bold tabular-nums">{t.vehicle?.plateNo ?? '—'}</span> },
              { key: 'driverName', label: 'Driver', render: (t) => t.driverName ?? '—' },
              { key: 'route', label: 'Route', render: (t) => (t.routeFrom || t.routeTo ? `${t.routeFrom ?? '?'} → ${t.routeTo ?? '?'}` : '—') },
              { key: 'cargo', label: 'Cargo', render: (t) => `${cargoLabel[t.cargoType ?? ''] ?? t.cargoType ?? '—'}${t.cargoQt != null ? ` · ${fmtQ(t.cargoQt)} Qt` : ''}` },
              { key: 'departure', label: 'Departure', render: (t) => (t.departureAt ? fmtDateTime(t.departureAt) : '—') },
              { key: 'km', label: 'Km', mono: true, render: (t) => { const km = tripKm(t); return km != null ? String(km) : '—'; } },
              { key: 'status', label: 'Status', render: (t) => <Badge tone={statusTone[t.status] ?? 'neutral'}>{t.status.replace('_', ' ')}</Badge> },
              { key: 'dispatch', label: 'Sales dispatch', render: (t) => (t.dispatchId ? dispatchById.get(t.dispatchId)?.exitNoteNo ?? t.dispatchId.slice(-6) : '—') },
              ...(canManage
                ? [
                    {
                      key: 'actions',
                      label: 'Actions',
                      render: (t: FleetTrip) => (
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" onClick={() => openEdit(t)} title="Edit">
                            <Pencil size={13} />
                          </Button>
                          <Button variant="ghost" onClick={() => remove(t)} title="Delete">
                            ✕
                          </Button>
                        </div>
                      )
                    }
                  ]
                : [])
            ]}
            rows={tripsQ.data ?? []}
            emptyTitle="No trips found."
          />
        )}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalOpen(false)}
          role="dialog" aria-modal="true" aria-label="Trip dialog"
          onKeyDown={(e) => { if (e.key === 'Escape') setModalOpen(false); }}>
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={editing ? 'Edit trip' : 'Log trip'}
          >
            <h3 className="mb-4 text-base font-bold text-slate-900 dark:text-slate-100">{editing ? 'Edit trip' : 'Log trip'}</h3>
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
                <Field label="Driver">
                  <TextInput name="driverName" defaultValue={editing?.driverName ?? ''} />
                </Field>
                <Field label="From">
                  <TextInput name="routeFrom" defaultValue={editing?.routeFrom ?? ''} placeholder="Oyaya mill" />
                </Field>
                <Field label="To">
                  <TextInput name="routeTo" defaultValue={editing?.routeTo ?? ''} placeholder="Destination area" />
                </Field>
                <Field label="Cargo type">
                  <Select name="cargoType" defaultValue={editing?.cargoType ?? ''}>
                    <option value="">—</option>
                    <option value="FLOUR">Flour (delivery)</option>
                    <option value="WHEAT">Wheat (procurement)</option>
                    <option value="BRAN">Bran</option>
                    <option value="OTHER">Other</option>
                  </Select>
                </Field>
                <Field label="Cargo (Qt)">
                  <TextInput name="cargoQt" type="number" step="0.01" min="0" defaultValue={editing?.cargoQt ?? ''} className="tabular-nums" />
                </Field>
                <Field label="Departure">
                  <TextInput name="departureAt" type="datetime-local" defaultValue={editing?.departureAt?.slice(0, 16) ?? ''} />
                </Field>
                <Field label="Arrival">
                  <TextInput name="arrivalAt" type="datetime-local" defaultValue={editing?.arrivalAt?.slice(0, 16) ?? ''} />
                </Field>
                <Field label="Odometer start">
                  <TextInput name="odometerStart" type="number" step="0.1" min="0" defaultValue={editing?.odometerStart ?? ''} className="tabular-nums" />
                </Field>
                <Field label="Odometer end">
                  <TextInput name="odometerEnd" type="number" step="0.1" min="0" defaultValue={editing?.odometerEnd ?? ''} className="tabular-nums" />
                </Field>
                <Field label="Status">
                  <Select name="status" defaultValue={editing?.status ?? 'PLANNED'}>
                    <option value="PLANNED">Planned</option>
                    <option value="IN_PROGRESS">In progress</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="CANCELLED">Cancelled</option>
                  </Select>
                </Field>
                <Field label="Sales dispatch (link)">
                  <Select name="dispatchId" defaultValue={editing?.dispatchId ?? ''}>
                    <option value="">— none —</option>
                    {(dispatchesQ.data ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.exitNoteNo} · {d.area}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Notes">
                <TextArea name="notes" rows={2} defaultValue={editing?.notes ?? ''} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving}>
                  {editing ? 'Save changes' : 'Log trip'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
