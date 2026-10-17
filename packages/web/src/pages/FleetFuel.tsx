import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fuel, Pencil, Plus, Receipt } from 'lucide-react';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtBirr, fmtDate, fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { FleetExpense, FuelLog, Vehicle } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextArea, TextInput } from '../components/ui';

const cardShell = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-sm p-5';

const expenseCategoryLabel: Record<string, string> = {
  TOLL: 'Toll',
  REPAIR_PARTS: 'Repair parts',
  INSURANCE: 'Insurance',
  WASHING: 'Washing',
  OTHER: 'Other'
};

const expenseTone: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  TOLL: 'advisory',
  REPAIR_PARTS: 'critical',
  INSURANCE: 'neutral',
  WASHING: 'pass',
  OTHER: 'neutral'
};

export function FleetFuel() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('fleet:manage');

  const [tab, setTab] = useState<'fuel' | 'expenses'>('fuel');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<FleetExpense | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fuelQ = useQuery({
    queryKey: ['fleet-fuel', vehicleFilter],
    queryFn: async () => {
      const q = vehicleFilter ? `?vehicleId=${vehicleFilter}` : '';
      return (await api.get<FuelLog[]>(`${E.fleetFuel}${q}`)).data;
    },
    enabled: tab === 'fuel'
  });
  const expensesQ = useQuery({
    queryKey: ['fleet-expenses', vehicleFilter],
    queryFn: async () => {
      const q = vehicleFilter ? `?vehicleId=${vehicleFilter}` : '';
      return (await api.get<FleetExpense[]>(`${E.fleetExpenses}${q}`)).data;
    },
    enabled: tab === 'expenses'
  });
  const vehiclesQ = useQuery({
    queryKey: ['fleet-vehicles'],
    queryFn: async () => (await api.get<Vehicle[]>(E.vehicles)).data
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fleet-fuel'] });
    qc.invalidateQueries({ queryKey: ['fleet-expenses'] });
  };

  /** km/L per vehicle from consecutive odometer readings (newest → oldest). */
  const efficiency = useMemo(() => {
    const rows = fuelQ.data ?? [];
    const byVehicle = new Map<string, { plate: string; kms: number; liters: number }>();
    const sorted = [...rows].sort(
      (a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime()
    );
    const seen = new Set<string>();
    for (const r of sorted) {
      const plate = r.vehicle?.plateNo ?? r.vehicleId;
      if (!byVehicle.has(r.vehicleId)) byVehicle.set(r.vehicleId, { plate, kms: 0, liters: 0 });
      const acc = byVehicle.get(r.vehicleId)!;
      if (r.odometer != null && !seen.has(r.vehicleId)) {
        seen.add(r.vehicleId);
      }
      if (r.odometer != null && Number(r.liters) > 0) {
        const prev = sorted.find(
          (o) => o.vehicleId === r.vehicleId && o.id !== r.id && o.odometer != null && new Date(o.loggedAt) < new Date(r.loggedAt)
        );
        if (prev?.odometer != null && Number(r.odometer) > Number(prev.odometer)) {
          acc.kms += Number(r.odometer) - Number(prev.odometer);
          acc.liters += Number(r.liters);
        }
      }
    }
    return [...byVehicle.values()].map((a) => ({
      ...a,
      kmPerL: a.liters > 0 && a.kms > 0 ? Math.round((a.kms / a.liters) * 100) / 100 : null
    }));
  }, [fuelQ.data]);

  const saveFuel = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      await api.post(E.fleetFuel, {
        vehicleId: String(fd.get('vehicleId') ?? ''),
        loggedAt: String(fd.get('loggedAt') ?? '') || undefined,
        liters: Number(fd.get('liters') ?? 0),
        costBirr: Number(fd.get('costBirr') ?? 0),
        odometer: fd.get('odometer') !== '' ? Number(fd.get('odometer')) : null,
        station: String(fd.get('station') ?? '').trim() || null
      });
      setModalOpen(false);
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Save failed. Please review the form.');
    } finally {
      setSaving(false);
    }
  };

  const saveExpense = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const payload = {
        ...(editingExpense ? {} : { vehicleId: String(fd.get('vehicleId') ?? '') }),
        expenseDate: String(fd.get('expenseDate') ?? ''),
        category: String(fd.get('category') ?? 'OTHER'),
        amountBirr: Number(fd.get('amountBirr') ?? 0),
        description: String(fd.get('description') ?? '').trim() || null
      };
      if (editingExpense) {
        await api.put(E.fleetExpense(editingExpense.id), payload);
      } else {
        await api.post(E.fleetExpenses, payload);
      }
      setModalOpen(false);
      setEditingExpense(null);
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Save failed. Please review the form.');
    } finally {
      setSaving(false);
    }
  };

  const removeExpense = async (x: FleetExpense) => {
    if (!window.confirm('Delete this expense?')) return;
    try {
      await api.delete(E.fleetExpense(x.id));
      invalidate();
    } catch {
      // ignore
    }
  };

  const openAdd = () => {
    setEditingExpense(null);
    setFormError(null);
    setModalOpen(true);
  };

  const totalFuelCost = (fuelQ.data ?? []).reduce((s, l) => s + Number(l.costBirr), 0);
  const totalLiters = (fuelQ.data ?? []).reduce((s, l) => s + Number(l.liters), 0);
  const totalExpenses = (expensesQ.data ?? []).reduce((s, x) => s + Number(x.amountBirr), 0);

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<Fuel size={16} />}
          title="Fuel & Operating Expenses"
          subtitle="Fuel logs with km/L efficiency, tolls and other operating costs per vehicle"
          action={
            canManage ? (
              <Button onClick={openAdd}>
                <Plus size={14} /> {tab === 'fuel' ? 'Log fuel' : 'Add expense'}
              </Button>
            ) : undefined
          }
        />
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-1">
            {(['fuel', 'expenses'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-md px-4 py-1.5 text-sm font-semibold ${tab === t ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {t === 'fuel' ? 'Fuel logs' : 'Expenses'}
              </button>
            ))}
          </div>
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

        {tab === 'fuel' ? (
          <>
            <div className="mb-4 flex flex-wrap gap-3">
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total liters</p>
                <p className="text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">{totalLiters.toLocaleString('en-US')} L</p>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total fuel cost</p>
                <p className="text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">{fmtBirr(totalFuelCost)}</p>
              </div>
              {efficiency.map((ef) => (
                <div key={ef.plate} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">{ef.plate}</p>
                  <p className="text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                    {ef.kmPerL != null ? `${ef.kmPerL} km/L` : '—'}
                  </p>
                </div>
              ))}
            </div>
            {fuelQ.isLoading ? (
              <Spinner label="Loading fuel logs..." />
            ) : fuelQ.isError ? (
              <ErrorBox message="Could not load fuel logs." onRetry={() => fuelQ.refetch()} />
            ) : (fuelQ.data ?? []).length === 0 ? (
              <EmptyState title="No fuel logs" sub="Record every refuel with the odometer reading to track efficiency." />
            ) : (
              <DataTable<FuelLog>
                columns={[
                  { key: 'vehicle', label: 'Vehicle', render: (l) => <span className="font-bold tabular-nums">{l.vehicle?.plateNo ?? '—'}</span> },
                  { key: 'loggedAt', label: 'Logged', render: (l) => fmtDateTime(l.loggedAt) },
                  { key: 'liters', label: 'Liters', mono: true, render: (l) => Number(l.liters).toLocaleString('en-US') },
                  { key: 'cost', label: 'Cost (ETB)', mono: true, render: (l) => fmtBirr(l.costBirr) },
                  { key: 'etbPerL', label: 'ETB / L', mono: true, render: (l) => (Number(l.liters) > 0 ? fmtBirr(Number(l.costBirr) / Number(l.liters)) : '—') },
                  { key: 'odometer', label: 'Odometer', mono: true, render: (l) => (l.odometer != null ? Number(l.odometer).toLocaleString('en-US') : '—') },
                  { key: 'station', label: 'Station', render: (l) => l.station ?? '—' }
                ]}
                rows={fuelQ.data ?? []}
                emptyTitle="No fuel logs found."
              />
            )}
          </>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <Receipt size={16} className="text-slate-500 dark:text-slate-400" />
                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total operating expenses</p>
                  <p className="text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">{fmtBirr(totalExpenses)}</p>
                </div>
              </div>
            </div>
            {expensesQ.isLoading ? (
              <Spinner label="Loading expenses..." />
            ) : expensesQ.isError ? (
              <ErrorBox message="Could not load expenses." onRetry={() => expensesQ.refetch()} />
            ) : (expensesQ.data ?? []).length === 0 ? (
              <EmptyState title="No expenses" sub="Record tolls, insurance, washing and other operating costs." />
            ) : (
              <DataTable<FleetExpense>
                columns={[
                  { key: 'vehicle', label: 'Vehicle', render: (x) => <span className="font-bold tabular-nums">{x.vehicle?.plateNo ?? '—'}</span> },
                  { key: 'expenseDate', label: 'Date', render: (x) => fmtDate(x.expenseDate) },
                  { key: 'category', label: 'Category', render: (x) => <Badge tone={expenseTone[x.category] ?? 'neutral'}>{expenseCategoryLabel[x.category] ?? x.category}</Badge> },
                  { key: 'amount', label: 'Amount (ETB)', mono: true, render: (x) => fmtBirr(x.amountBirr) },
                  { key: 'description', label: 'Description', render: (x) => x.description ?? '—' },
                  ...(canManage
                    ? [
                        {
                          key: 'actions',
                          label: 'Actions',
                          render: (x: FleetExpense) => (
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                title="Edit"
                                onClick={() => {
                                  setEditingExpense(x);
                                  setFormError(null);
                                  setModalOpen(true);
                                }}
                              >
                                <Pencil size={13} />
                              </Button>
                              <Button variant="ghost" title="Delete" onClick={() => removeExpense(x)}>
                                ✕
                              </Button>
                            </div>
                          )
                        }
                      ]
                    : [])
                ]}
                rows={expensesQ.data ?? []}
                emptyTitle="No expenses found."
              />
            )}
          </>
        )}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={tab === 'fuel' ? 'Log fuel' : editingExpense ? 'Edit expense' : 'Add expense'}
          >
            <h3 className="mb-4 text-base font-bold text-slate-900 dark:text-slate-100">
              {tab === 'fuel' ? 'Log fuel' : editingExpense ? 'Edit expense' : 'Add expense'}
            </h3>
            {formError ? (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            ) : null}
            {tab === 'fuel' ? (
              <form onSubmit={saveFuel} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Vehicle" required>
                    <Select name="vehicleId" defaultValue="" required>
                      <option value="">Select…</option>
                      {(vehiclesQ.data ?? []).filter((v) => v.isActive).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.plateNo}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Date & time">
                    <TextInput name="loggedAt" type="datetime-local" defaultValue={new Date().toISOString().slice(0, 16)} />
                  </Field>
                  <Field label="Liters" required>
                    <TextInput name="liters" type="number" step="0.01" min="0" required className="tabular-nums" />
                  </Field>
                  <Field label="Cost (ETB)" required>
                    <TextInput name="costBirr" type="number" step="0.01" min="0" required className="tabular-nums" />
                  </Field>
                  <Field label="Odometer">
                    <TextInput name="odometer" type="number" step="0.1" min="0" className="tabular-nums" />
                  </Field>
                  <Field label="Station">
                    <TextInput name="station" placeholder="Filling station" />
                  </Field>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" loading={saving}>
                    Log fuel
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={saveExpense} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Vehicle" required>
                    <Select name="vehicleId" defaultValue={editingExpense?.vehicleId ?? ''} required disabled={!!editingExpense}>
                      <option value="">Select…</option>
                      {(vehiclesQ.data ?? []).filter((v) => v.isActive).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.plateNo}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Date" required>
                    <TextInput name="expenseDate" type="date" defaultValue={editingExpense?.expenseDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)} required />
                  </Field>
                  <Field label="Category" required>
                    <Select name="category" defaultValue={editingExpense?.category ?? 'TOLL'}>
                      <option value="TOLL">Toll</option>
                      <option value="REPAIR_PARTS">Repair parts</option>
                      <option value="INSURANCE">Insurance</option>
                      <option value="WASHING">Washing</option>
                      <option value="OTHER">Other</option>
                    </Select>
                  </Field>
                  <Field label="Amount (ETB)" required>
                    <TextInput name="amountBirr" type="number" step="0.01" min="0" defaultValue={editingExpense?.amountBirr ?? ''} required className="tabular-nums" />
                  </Field>
                </div>
                <Field label="Description">
                  <TextArea name="description" rows={2} defaultValue={editingExpense?.description ?? ''} />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" loading={saving}>
                    {editingExpense ? 'Save changes' : 'Add expense'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
