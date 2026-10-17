import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit3, MapPin, Plus, Warehouse as WarehouseIcon } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { WhLocation, WhLocationType } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, Field, NumberInput, Select, TextInput } from '../components/ui';
import {
  WhListState,
  cardShell,
  fmtQ,
  useWhPerms
} from './WhShared';

const TYPE_LABEL: Record<WhLocationType, string> = {
  RAW: 'Raw material',
  FG: 'Finished goods',
  SPARE: 'Spare parts',
  GENERAL: 'General'
};

function UtilizationBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-slate-400 dark:text-slate-500">No capacity set</span>;
  const tone = pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="text-xs font-bold tabular-nums text-slate-600 dark:text-slate-300">{pct.toFixed(1)}%</span>
    </div>
  );
}

interface LocForm {
  code: string;
  name: string;
  zone: string;
  type: WhLocationType;
  capacityQ: string;
  isActive: boolean;
}

const emptyForm = (): LocForm => ({ code: '', name: '', zone: '', type: 'GENERAL', capacityQ: '', isActive: true });

export function WarehouseLocations() {
  const { canManage } = useWhPerms();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<WhLocation | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<LocForm>(emptyForm());
  const [typeFilter, setTypeFilter] = useState('');

  const locQ = useQuery({
    queryKey: ['wh-locations'],
    queryFn: async () => (await api.get<WhLocation[]>(E.warehouseLocations)).data
  });

  const locations = useMemo(() => {
    const all = locQ.data ?? [];
    return typeFilter ? all.filter((l) => l.type === typeFilter) : all;
  }, [locQ.data, typeFilter]);

  const kpis = useMemo(() => {
    const all = locQ.data ?? [];
    const cap = all.reduce((s, l) => s + l.capacityQ, 0);
    const on = all.reduce((s, l) => s + l.onHandQ, 0);
    return {
      count: all.length,
      active: all.filter((l) => l.isActive).length,
      capacity: cap,
      onHand: on,
      util: cap > 0 ? (on / cap) * 100 : null
    };
  }, [locQ.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['wh-locations'] });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        zone: form.zone.trim() || null,
        type: form.type,
        capacityQ: form.capacityQ === '' ? 0 : Number(form.capacityQ),
        isActive: form.isActive
      };
      if (editing) return (await api.put(E.warehouseLocation(editing.id), payload)).data;
      return (await api.post(E.warehouseLocations, payload)).data;
    },
    onSuccess: () => {
      invalidate();
      setCreating(false);
      setEditing(null);
      setForm(emptyForm());
    }
  });

  const seedMut = useMutation({
    mutationFn: async () => (await api.post(E.warehouseSeedLocations)).data,
    onSuccess: invalidate
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setCreating(true);
  };
  const openEdit = (l: WhLocation) => {
    setCreating(false);
    setEditing(l);
    setForm({
      code: l.code,
      name: l.name,
      zone: l.zone ?? '',
      type: l.type,
      capacityQ: String(l.capacityQ),
      isActive: l.isActive
    });
  };

  const formValid =
    form.name.trim().length > 0 && (editing ? true : form.code.trim().length > 0);

  return (
    <div className="space-y-5">
      <div className={`${cardShell}`}>
        <CardHeader
          icon={<WarehouseIcon size={16} />}
          title="Warehouse Locations"
          subtitle="Storage locations, zones, capacity and live utilization"
          action={
            <div className="flex items-center gap-2">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="!w-auto !py-2 !text-sm">
                <option value="">All types</option>
                <option value="RAW">Raw material</option>
                <option value="FG">Finished goods</option>
                <option value="SPARE">Spare parts</option>
                <option value="GENERAL">General</option>
              </Select>
              {canManage && (
                <Button className="!px-4 !py-2 !text-sm" onClick={openCreate}>
                  <Plus size={15} /> New location
                </Button>
              )}
            </div>
          }
        />

        {/* KPI strip */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Locations', value: String(kpis.count), sub: `${kpis.active} active` },
            { label: 'Total capacity', value: `${fmtQ(kpis.capacity)} Qt`, sub: 'quintals' },
            { label: 'On hand', value: `${fmtQ(kpis.onHand)} Qt`, sub: 'across locations' },
            {
              label: 'Utilization',
              value: kpis.util == null ? '—' : `${kpis.util.toFixed(1)}%`,
              sub: 'on hand ÷ capacity'
            }
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{k.label}</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">{k.value}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{k.sub}</p>
            </div>
          ))}
        </div>

        <WhListState
          isLoading={locQ.isLoading}
          isError={locQ.isError}
          isEmpty={!locQ.isLoading && !locQ.isError && locations.length === 0}
          emptyTitle="No warehouse locations yet"
          emptySub="Create locations or seed the default Oyaya layout."
          onRetry={() => locQ.refetch()}
        />

        {!locQ.isLoading && !locQ.isError && locations.length === 0 && canManage && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="secondary"
              loading={seedMut.isPending}
              onClick={() => seedMut.mutate()}
              className="!px-4 !py-2 !text-sm"
            >
              Seed default locations
            </Button>
          </div>
        )}

        {/* Desktop table */}
        {locations.length > 0 && (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3">Code</th>
                    <th className="py-2 pr-3">Name / Zone</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3 text-right">Capacity (Qt)</th>
                    <th className="py-2 pr-3 text-right">On hand (Qt)</th>
                    <th className="py-2 pr-3">Utilization</th>
                    <th className="py-2 pr-3">Status</th>
                    {canManage && <th className="py-2 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {locations.map((l) => (
                    <tr key={l.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="py-2.5 pr-3 font-mono text-xs font-bold text-violet-700">{l.code}</td>
                      <td className="py-2.5 pr-3">
                        <p className="font-semibold text-slate-800 dark:text-slate-100">{l.name}</p>
                        {l.zone && (
                          <p className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <MapPin size={11} /> {l.zone}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">{TYPE_LABEL[l.type]}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{fmtQ(l.capacityQ)}</td>
                      <td className="py-2.5 pr-3 text-right font-bold tabular-nums text-slate-800 dark:text-slate-100">
                        {fmtQ(l.onHandQ)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <UtilizationBar pct={l.utilizationPct} />
                      </td>
                      <td className="py-2.5 pr-3">
                        {l.isActive ? (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            Inactive
                          </span>
                        )}
                      </td>
                      {canManage && (
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => openEdit(l)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                          >
                            <Edit3 size={13} /> Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {locations.map((l) => (
                <div key={l.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs font-bold text-violet-700">{l.code}</p>
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{l.name}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {TYPE_LABEL[l.type]}
                        {l.zone ? ` · ${l.zone}` : ''}
                      </p>
                    </div>
                    {canManage && (
                      <button
                        onClick={() => openEdit(l)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-600 dark:text-slate-300"
                        aria-label="Edit location"
                      >
                        <Edit3 size={15} />
                      </button>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400">On hand</span>
                    <span className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{fmtQ(l.onHandQ)} / {fmtQ(l.capacityQ)} Qt</span>
                  </div>
                  <div className="mt-2">
                    <UtilizationBar pct={l.utilizationPct} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Create / edit modal */}
      {(creating || editing) && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className={`${cardShell} w-full max-w-lg !p-6`}>
            <CardHeader
              icon={<WarehouseIcon size={16} />}
              title={editing ? `Edit ${editing.code}` : 'New warehouse location'}
              subtitle={editing ? 'Update capacity, zone or status' : 'Define a storage location with a unique code'}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Code" required hint="Unique, e.g. WH-FG-03">
                <TextInput
                  value={form.code}
                  disabled={!!editing}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="WH-FG-03"
                  className="font-mono uppercase"
                />
              </Field>
              <Field label="Name" required>
                <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Finished Goods Store 3" />
              </Field>
              <Field label="Zone">
                <TextInput value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} placeholder="South Wing" />
              </Field>
              <Field label="Type" required>
                <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as WhLocationType })}>
                  <option value="RAW">Raw material</option>
                  <option value="FG">Finished goods</option>
                  <option value="SPARE">Spare parts</option>
                  <option value="GENERAL">General</option>
                </Select>
              </Field>
              <Field label="Capacity (quintals)" hint="0 = no limit enforced">
                <NumberInput value={form.capacityQ} min="0" step="1" onChange={(e) => setForm({ ...form, capacityQ: e.target.value })} placeholder="3000" />
              </Field>
              <div className="flex items-end pb-1">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="h-4 w-4 rounded accent-violet-600"
                  />
                  Active
                </label>
              </div>
            </div>
            {saveMut.isError && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {(saveMut.error as Error)?.message ?? 'Save failed'}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                  setForm(emptyForm());
                }}
              >
                Cancel
              </Button>
              <Button disabled={!formValid || saveMut.isPending} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
                {editing ? 'Save changes' : 'Create location'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
