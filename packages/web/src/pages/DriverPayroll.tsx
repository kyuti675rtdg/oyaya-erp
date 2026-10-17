import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Settings2, Truck } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { DriverTripPay, HrEmployee } from '../types';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Field, Select, Spinner, TextInput,
  ErrorBox} from '../components/ui';
import { fmtBirr } from '../lib/format';
import {
  HrModal,
  HrNotice,
  hrPrimaryBtn,
  hrSecondaryBtn,
  hrShell,
  runPeriodLabel,
  useHrPerms
} from './HrShared';

interface TripRate {
  rateBirrPerTrip: number | string;
  isActive: boolean;
}

export function DriverPayroll() {
  const { canManage } = useHrPerms();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [showForm, setShowForm] = useState(false);
  const [showRate, setShowRate] = useState(false);
  const [form, setForm] = useState({
    employeeId: '',
    trips: '',
    allowanceBirr: '',
    notes: ''
  });
  const [newRate, setNewRate] = useState('');

  const [y, m] = period.split('-').map(Number);

  const rowsQ = useQuery({
    queryKey: ['hr-driver-trip-pay', period],
    queryFn: async () =>
      (await api.get<DriverTripPay[]>(E.hrDriverTripPay, { params: { year: y, month: m } })).data,
    enabled: Number.isInteger(y) && Number.isInteger(m)
  });
  const driversQ = useQuery({
    queryKey: ['hr-employees-drivers'],
    queryFn: async () =>
      (await api.get<HrEmployee[]>(E.hrEmployees, { params: { payrollMode: 'TRIP_BASED', isActive: 'true' } })).data
  });
  const rateQ = useQuery({
    queryKey: ['driver-trip-rate'],
    queryFn: async () => (await api.get<TripRate>(E.driverTripRate)).data
  });

  const saveM = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await api.post(E.hrDriverTripPay, payload)).data,
    onSuccess: () => {
      setNotice({ ok: true, text: 'Driver trip pay saved.' });
      setShowForm(false);
      setForm({ employeeId: '', trips: '', allowanceBirr: '', notes: '' });
      queryClient.invalidateQueries({ queryKey: ['hr-driver-trip-pay'] });
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' })
  });

  const rateM = useMutation({
    mutationFn: async (rateBirrPerTrip: number) =>
      (await api.post(E.driverTripRate, { rateBirrPerTrip })).data,
    onSuccess: () => {
      setNotice({ ok: true, text: 'Fixed trip rate updated.' });
      setShowRate(false);
      setNewRate('');
      queryClient.invalidateQueries({ queryKey: ['driver-trip-rate'] });
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Rate update failed.' })
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.employeeId || !Number(form.trips) || Number(form.trips) < 0) {
      setNotice({ ok: false, text: 'Select a driver and enter trips.' });
      return;
    }
    saveM.mutate({
      employeeId: form.employeeId,
      year: y,
      month: m,
      trips: Number(form.trips),
      allowanceBirr: form.allowanceBirr ? Number(form.allowanceBirr) : 0,
      notes: form.notes.trim() || null
    });
  };

  const rows = rowsQ.data ?? [];
  const totalTrips = rows.reduce((a, r) => a + r.trips, 0);
  const totalPay = rows.reduce((a, r) => a + Number(r.totalBirr), 0);
  const rate = rateQ.data ? Number(rateQ.data.rateBirrPerTrip) : null;
  const previewTotal =
    rate != null && Number(form.trips) > 0
      ? Number(form.trips) * rate + (Number(form.allowanceBirr) || 0)
      : null;

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Truck className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Driver Trip-Based Payroll</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Trips × fixed trip rate + allowances — the driver fixed trip rule
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <button className={hrSecondaryBtn} onClick={() => setShowRate(true)}>
              <Settings2 className="h-4 w-4" /> Trip rate
            </button>
            <button className={hrPrimaryBtn} onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" /> Record trips
            </button>
          </div>
        ) : null}
      </div>

      {notice ? <HrNotice ok={notice.ok} text={notice.text} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={hrShell}>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Fixed trip rate</p>
          <p className="tnum mt-2 text-xl font-bold text-slate-900 dark:text-slate-100">
            {rate != null ? fmtBirr(rate) + ' /trip' : '—'}
          </p>
        </div>
        <div className={hrShell}>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Trips ({period})</p>
          <p className="tnum mt-2 text-xl font-bold text-slate-900 dark:text-slate-100">{totalTrips}</p>
        </div>
        <div className={hrShell}>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Total driver pay</p>
          <p className="tnum mt-2 text-xl font-bold text-violet-700">{fmtBirr(totalPay)}</p>
        </div>
        <div className={`${hrShell} flex items-end`}>
          <Field label="Month">
            <TextInput type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className={hrShell}>
        <CardHeader
          icon={<Truck className="h-4 w-4" />}
          title={`Driver trip pay — ${runPeriodLabel({ periodYear: y, periodMonth: m })}`}
          subtitle="One record per driver per month"
        />
        {rowsQ.isLoading ? (
          <Spinner label="Loading trip records..." />
        ) : (
          <DataTable<DriverTripPay>
            columns={[
              { key: 'driver', label: 'Driver', render: (r) => `${r.employee?.name ?? '—'} (${r.employee?.employeeNo ?? ''})` },
              { key: 'trips', label: 'Trips', mono: true, render: (r) => r.trips },
              { key: 'rate', label: 'Rate/trip', mono: true, render: (r) => fmtBirr(Number(r.rateBirrPerTrip)) },
              { key: 'allow', label: 'Allowances', mono: true, render: (r) => fmtBirr(Number(r.allowanceBirr)) },
              {
                key: 'total',
                label: 'Total pay',
                mono: true,
                render: (r) => <span className="font-bold text-violet-700">{fmtBirr(Number(r.totalBirr))}</span>
              },
              { key: 'notes', label: 'Notes', render: (r) => r.notes ?? '—' }
            ]}
            rows={rows}
            emptyTitle="No driver trip records this month"
          />
        )}
      </div>

      {showForm ? (
        <HrModal title="Record driver trips" subtitle={`Pay month ${period}`} onClose={() => setShowForm(false)}>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Driver" required>
              <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} required>
                <option value="">—</option>
                {(driversQ.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.employeeNo})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Trips completed" required>
              <TextInput type="number" min="0" value={form.trips} onChange={(e) => setForm({ ...form, trips: e.target.value })} required />
            </Field>
            <Field label="Allowances (ETB)" hint="Trip allowances, per-diem, etc.">
              <TextInput type="number" min="0" step="0.01" value={form.allowanceBirr} onChange={(e) => setForm({ ...form, allowanceBirr: e.target.value })} />
            </Field>
            <Field label="Notes">
              <TextInput value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            {previewTotal != null ? (
              <p className="tnum rounded-xl bg-violet-50 px-4 py-3 text-sm font-bold text-violet-800">
                Pay preview: {form.trips} trips × {fmtBirr(rate!)} + {fmtBirr(Number(form.allowanceBirr) || 0)} = {fmtBirr(previewTotal)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
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

      {showRate ? (
        <HrModal title="Fixed trip rate" subtitle="Applies to all drivers from now on" onClose={() => setShowRate(false)}>
          <Field label="Rate per trip (ETB)" required>
            <TextInput
              type="number"
              min="0"
              step="0.01"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              placeholder={rate != null ? String(rate) : 'e.g. 850'}
            />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <button className={hrSecondaryBtn} onClick={() => setShowRate(false)}>
              Cancel
            </button>
            <button
              className={hrPrimaryBtn}
              disabled={!newRate || Number(newRate) <= 0 || rateM.isPending}
              onClick={() => rateM.mutate(Number(newRate))}
            >
              {rateM.isPending ? 'Saving...' : 'Set rate'}
            </button>
          </div>
        </HrModal>
      ) : null}
    </div>
  );
}
