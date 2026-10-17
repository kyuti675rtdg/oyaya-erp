import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Navigation, PackageCheck, Plus, Truck } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { DeliveryTrip, Dispatch, Vehicle } from '../types';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, SectionTitle, Select, Spinner, TextInput } from '../components/ui';
import { fmtDateTime } from '../lib/format';

const TRIP_TONE: Record<string, BadgeTone> = {
  PLANNED: 'advisory',
  DEPARTED: 'neutral',
  ARRIVED: 'pass',
  POD_CONFIRMED: 'pass',
  CANCELLED: 'critical'
};

const NEXT: Record<string, Array<{ to: 'DEPARTED' | 'ARRIVED' | 'POD_CONFIRMED' | 'CANCELLED'; label: string }>> = {
  PLANNED: [
    { to: 'DEPARTED', label: 'Depart' },
    { to: 'CANCELLED', label: 'Cancel' }
  ],
  DEPARTED: [
    { to: 'ARRIVED', label: 'Arrive' },
    { to: 'CANCELLED', label: 'Cancel' }
  ],
  ARRIVED: [{ to: 'POD_CONFIRMED', label: 'Confirm POD' }]
};

export function DeliveryTrips() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [podBy, setPodBy] = useState<Record<string, string>>({});

  const [vehicleId, setVehicleId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [area, setArea] = useState('');
  const [dispatchId, setDispatchId] = useState('');
  const [notes, setNotes] = useState('');

  const tripsQ = useQuery({
    queryKey: ['delivery-trips'],
    queryFn: async () => (await api.get<DeliveryTrip[]>(E.deliveryTrips)).data
  });
  const vehiclesQ = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => (await api.get<Vehicle[]>(E.vehicles)).data
  });
  const dispatchesQ = useQuery({
    queryKey: ['sales-dispatches'],
    queryFn: async () => (await api.get<Dispatch[]>(E.dispatches)).data
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['delivery-trips'] });

  const createTrip = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!vehicleId || !area.trim()) {
      setNotice({ ok: false, text: 'Vehicle and route/area are required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.deliveryTrips, {
        vehicleId,
        driverName: driverName.trim() || undefined,
        area: area.trim(),
        dispatchId: dispatchId || undefined,
        notes: notes.trim() || undefined
      });
      setNotice({ ok: true, text: 'Delivery trip planned.' });
      setVehicleId('');
      setDriverName('');
      setArea('');
      setDispatchId('');
      setNotes('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create trip.' });
    } finally {
      setSaving(false);
    }
  };

  const move = async (trip: DeliveryTrip, to: 'DEPARTED' | 'ARRIVED' | 'POD_CONFIRMED' | 'CANCELLED') => {
    setNotice(null);
    try {
      await api.post(E.deliveryTripStatus(trip.id), {
        status: to,
        ...(to === 'POD_CONFIRMED' && podBy[trip.id]?.trim() ? { podSignedBy: podBy[trip.id].trim() } : {})
      });
      setNotice({ ok: true, text: `Trip ${trip.tripNo} → ${to.replace('_', ' ')}.` });
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Status change failed.' });
    }
  };

  return (
    <div>
      <SectionTitle title="Delivery Trip Management" sub="Vehicle, driver, route, departure/arrival and proof of delivery" />

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

      <Card className="p-5">
        <CardHeader icon={<Navigation className="h-4 w-4" />} title="Plan delivery trip" subtitle="A trip carries one truck load to customers on a route" />
        <form onSubmit={createTrip} className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Field label="Vehicle" required>
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
              <option value="">Select</option>
              {(vehiclesQ.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNo}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Driver">
            <TextInput value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Driver name" />
          </Field>
          <Field label="Route / area" required>
            <TextInput value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Addis Ababa — CMC" required />
          </Field>
          <Field label="Dispatch (optional)">
            <Select value={dispatchId} onChange={(e) => setDispatchId(e.target.value)}>
              <option value="">None</option>
              {(dispatchesQ.data ?? []).slice(0, 50).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.exitNoteNo} — {d.area}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes">
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={saving} className="w-full">
              <Plus className="mr-1 h-4 w-4" /> Plan trip
            </Button>
          </div>
        </form>
      </Card>

      <div className="mt-6">
        <SectionTitle title="Trips" />
        {tripsQ.isLoading ? (
          <Spinner label="Loading trips..." />
        ) : (
          <DataTable<DeliveryTrip>
            columns={[
              { key: 'tripNo', label: 'Trip', render: (r) => <span className="tnum font-bold">{r.tripNo}</span> },
              {
                key: 'vehicle',
                label: 'Vehicle',
                render: (r) => (
                  <span className="inline-flex items-center gap-1">
                    <Truck className="h-3.5 w-3.5 text-slate-400" />
                    <span className="tnum font-semibold">{r.vehicle?.plateNo ?? '—'}</span>
                  </span>
                )
              },
              { key: 'driver', label: 'Driver', render: (r) => r.driverName ?? '—' },
              {
                key: 'area',
                label: 'Route',
                render: (r) => (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" /> {r.area}
                  </span>
                )
              },
              {
                key: 'times',
                label: 'Departed / Arrived',
                render: (r) => (
                  <span className="tnum text-xs">
                    {r.departedAt ? fmtDateTime(r.departedAt) : '—'} / {r.arrivedAt ? fmtDateTime(r.arrivedAt) : '—'}
                  </span>
                )
              },
              {
                key: 'pod',
                label: 'POD',
                render: (r) =>
                  r.podReceivedAt ? (
                    <span className="inline-flex items-center gap-1 text-xs text-pass-text">
                      <PackageCheck className="h-3.5 w-3.5" /> {r.podSignedBy ?? 'Signed'}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">Pending</span>
                  )
              },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={TRIP_TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge>
              },
              {
                key: 'actions',
                label: '',
                render: (r) => (
                  <div className="flex flex-wrap justify-end gap-1">
                    {(NEXT[r.status] ?? []).map((n) =>
                      n.to === 'POD_CONFIRMED' ? (
                        <span key={n.to} className="inline-flex items-center gap-1">
                          <TextInput
                            value={podBy[r.id] ?? ''}
                            onChange={(e) => setPodBy((p) => ({ ...p, [r.id]: e.target.value }))}
                            placeholder="Signed by"
                            className="!w-28 !py-1 text-xs"
                          />
                          <Button variant="secondary" onClick={() => move(r, n.to)} className="px-2 py-1 text-xs">
                            {n.label}
                          </Button>
                        </span>
                      ) : (
                        <Button
                          key={n.to}
                          variant={n.to === 'CANCELLED' ? 'ghost' : 'secondary'}
                          onClick={() => move(r, n.to)}
                          className="px-2 py-1 text-xs"
                        >
                          {n.label}
                        </Button>
                      )
                    )}
                  </div>
                )
              }
            ]}
            rows={tripsQ.data ?? []}
            emptyTitle="No delivery trips"
            emptySub="Plan a trip for a truck leaving the mill."
          />
        )}
      </div>
    </div>
  );
}
