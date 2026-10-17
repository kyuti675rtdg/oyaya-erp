import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2, Fuel, Gauge } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtPct } from '../lib/format';
import type { FleetUtilization, Vehicle } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, ErrorBox, Field, Spinner, TextInput } from '../components/ui';

const cardShell = 'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

const statusTone: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  AVAILABLE: 'pass',
  ON_TRIP: 'advisory',
  IN_MAINTENANCE: 'critical',
  OFF_DUTY: 'neutral'
};

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function FleetUtilization() {
  const [from, setFrom] = useState(todayMinus(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const utilQ = useQuery({
    queryKey: ['fleet-utilization', from, to],
    queryFn: async () => (await api.get<FleetUtilization[]>(E.fleetUtilization(from, to))).data
  });
  const vehiclesQ = useQuery({
    queryKey: ['fleet-vehicles'],
    queryFn: async () => (await api.get<Vehicle[]>(E.vehicles)).data,
    staleTime: 60_000
  });

  const activeVehicles = (vehiclesQ.data ?? []).filter((v) => v.isActive);
  const statusCounts = activeVehicles.reduce<Record<string, number>>((acc, v) => {
    const s = v.status ?? 'AVAILABLE';
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  const avgUtil =
    utilQ.data && utilQ.data.length > 0
      ? utilQ.data.reduce((s, u) => s + u.utilizationPct, 0) / utilQ.data.length
      : 0;

  return (
    <div className="space-y-5">
      {/* Availability status board */}
      <div className={cardShell}>
        <CardHeader
          icon={<CalendarCheck2 size={16} />}
          title="Vehicle Availability"
          subtitle="Live status board for the whole fleet"
        />
        <div className="flex flex-wrap gap-3">
          {['AVAILABLE', 'ON_TRIP', 'IN_MAINTENANCE', 'OFF_DUTY'].map((s) => (
            <div key={s} className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2">
              <Badge tone={statusTone[s] ?? 'neutral'}>{s.replace('_', ' ')}</Badge>
              <span className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{statusCounts[s] ?? 0}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Fleet total</span>
            <span className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{activeVehicles.length}</span>
          </div>
        </div>
      </div>

      {/* Utilization per vehicle per period */}
      <div className={cardShell}>
        <CardHeader
          icon={<Gauge size={16} />}
          title="Utilization"
          subtitle="Active trip-days per vehicle as a share of the period"
          action={
            <div className="flex items-end gap-2">
              <Field label="From">
                <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Button variant="secondary" onClick={() => utilQ.refetch()}>
                Refresh
              </Button>
            </div>
          }
        />
        {utilQ.isLoading ? (
          <Spinner label="Computing utilization..." />
        ) : utilQ.isError ? (
          <ErrorBox message="Could not compute utilization." onRetry={() => utilQ.refetch()} />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-3">
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Average utilization</p>
                <p className="text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">{fmtPct(avgUtil)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total km (period)</p>
                <p className="text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                  {(utilQ.data ?? []).reduce((s, u) => s + u.totalKm, 0).toLocaleString('en-US')}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Cargo moved (Qt)</p>
                <p className="text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                  {(utilQ.data ?? []).reduce((s, u) => s + u.cargoQt, 0).toLocaleString('en-US')}
                </p>
              </div>
            </div>
            <DataTable<FleetUtilization>
              columns={[
                { key: 'plateNo', label: 'Vehicle', render: (u) => <span className="font-bold tabular-nums">{u.plateNo}</span> },
                { key: 'trips', label: 'Trips', mono: true, render: (u) => `${u.tripCount} (${u.completedTripCount} done)` },
                { key: 'km', label: 'Km', mono: true, render: (u) => u.totalKm.toLocaleString('en-US') },
                { key: 'days', label: 'Active days', mono: true, render: (u) => `${u.activeDays} / ${u.periodDays}` },
                {
                  key: 'util',
                  label: 'Utilization',
                  render: (u) => (
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                        <div
                          className={`h-full rounded-full ${u.utilizationPct >= 60 ? 'bg-emerald-500' : u.utilizationPct >= 30 ? 'bg-amber-500' : 'bg-red-400'}`}
                          style={{ width: `${Math.min(100, u.utilizationPct)}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold tabular-nums">{fmtPct(u.utilizationPct)}</span>
                    </div>
                  )
                },
                { key: 'eff', label: 'Fuel eff. (km/L)', mono: true, render: (u) => (u.kmPerLiter != null ? u.kmPerLiter.toFixed(2) : '—') }
              ]}
              rows={utilQ.data ?? []}
              emptyTitle="No utilization data for this period."
            />
          </>
        )}
        <p className="mt-4 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Fuel size={13} />
          Utilization = active trip-days ÷ days in period. Distances come from trip odometer readings; fuel efficiency from consecutive fuel logs.
        </p>
      </div>
    </div>
  );
}
