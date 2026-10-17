import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins, Plus, Settings2 } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { HrEmployee, PieceRateWork } from '../types';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Field, Select, Spinner, TextInput,
  ErrorBox} from '../components/ui';
import { fmtBirr, fmtQ } from '../lib/format';
import {
  HrModal,
  HrNotice,
  hrPrimaryBtn,
  hrSecondaryBtn,
  hrShell,
  useHrPerms
} from './HrShared';

const STAGES = [
  { key: 'UNLOADING', label: 'Unloading from truck' },
  { key: 'GRANARY_DUMPING', label: 'Dumping into granary' },
  { key: 'STORE_MOVEMENT', label: 'Moving sorted output to store' },
  { key: 'TRUCK_LOADING', label: 'Loading finished goods onto trucks' }
];

interface RateConfig {
  stage: string;
  rateBirrPerQ: number | string;
  isActive: boolean;
}

export function PieceRatePayroll() {
  const { canManage } = useHrPerms();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [showForm, setShowForm] = useState(false);
  const [showRates, setShowRates] = useState(false);
  const [form, setForm] = useState({
    employeeId: '',
    laborer: '',
    stage: STAGES[0].key,
    bags: '',
    quintals: '',
    workDate: new Date().toISOString().slice(0, 10),
    truckPlate: '',
    notes: ''
  });
  const [rateEdits, setRateEdits] = useState<Record<string, string>>({});

  const [y, m] = period.split('-').map(Number);

  const workQ = useQuery({
    queryKey: ['hr-piece-work', period],
    queryFn: async () =>
      (
        await api.get<PieceRateWork[]>(E.hrPieceWork, {
          params: {
            from: new Date(y, m - 1, 1).toISOString(),
            to: new Date(y, m, 1).toISOString()
          }
        })
      ).data,
    enabled: Number.isInteger(y) && Number.isInteger(m)
  });
  const employeesQ = useQuery({
    queryKey: ['hr-employees-piece'],
    queryFn: async () =>
      (await api.get<HrEmployee[]>(E.hrEmployees, { params: { payrollMode: 'PIECE_RATE', isActive: 'true' } })).data
  });
  const ratesQ = useQuery({
    queryKey: ['piece-rates'],
    queryFn: async () => (await api.get<RateConfig[]>(E.pieceRates)).data
  });

  const rateByStage = new Map((ratesQ.data ?? []).map((r) => [r.stage, Number(r.rateBirrPerQ)]));

  const saveM = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await api.post(E.hrPieceWork, payload)).data,
    onSuccess: () => {
      setNotice({ ok: true, text: 'Piece-rate work recorded.' });
      setShowForm(false);
      setForm({ ...form, laborer: '', bags: '', quintals: '', truckPlate: '', notes: '' });
      queryClient.invalidateQueries({ queryKey: ['hr-piece-work'] });
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' })
  });

  const rateM = useMutation({
    mutationFn: async ({ stage, rateBirrPerQ }: { stage: string; rateBirrPerQ: number }) =>
      (await api.post(E.pieceRates, { stage, rateBirrPerQ })).data,
    onSuccess: () => {
      setNotice({ ok: true, text: 'Stage rate updated.' });
      queryClient.invalidateQueries({ queryKey: ['piece-rates'] });
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Rate update failed.' })
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const laborer = form.employeeId
      ? (employeesQ.data ?? []).find((x) => x.id === form.employeeId)?.name ?? ''
      : form.laborer.trim();
    if (!laborer) {
      setNotice({ ok: false, text: 'Select an employee or enter a laborer name.' });
      return;
    }
    if (!Number(form.quintals) || Number(form.quintals) <= 0) {
      setNotice({ ok: false, text: 'Enter a positive quintal quantity.' });
      return;
    }
    saveM.mutate({
      employeeId: form.employeeId || null,
      laborer,
      stage: form.stage,
      bags: form.bags ? Number(form.bags) : 0,
      quintals: Number(form.quintals),
      workDate: new Date(`${form.workDate}T00:00:00Z`).toISOString(),
      truckPlate: form.truckPlate.trim() || null,
      notes: form.notes.trim() || null
    });
  };

  const rows = workQ.data ?? [];
  const totalQ = rows.reduce((a, r) => a + Number(r.quintals), 0);
  const totalPay = rows.reduce((a, r) => a + Number(r.payBirr), 0);
  const currentRate = rateByStage.get(form.stage);
  const previewPay =
    currentRate != null && Number(form.quintals) > 0
      ? Number(form.quintals) * currentRate
      : null;

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white">
            <HandCoins className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Piece-Rate Labor Payroll</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Bags & quintals handled × stage rate — day-end pay computation
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <button className={hrSecondaryBtn} onClick={() => setShowRates(true)}>
              <Settings2 className="h-4 w-4" /> Stage rates
            </button>
            <button className={hrPrimaryBtn} onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" /> Log work
            </button>
          </div>
        ) : null}
      </div>

      {notice ? <HrNotice ok={notice.ok} text={notice.text} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STAGES.map((s) => (
          <div key={s.key} className={hrShell}>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">{s.label}</p>
            <p className="tnum mt-2 text-xl font-bold text-slate-900 dark:text-slate-100">
              {rateByStage.has(s.key) ? fmtBirr(rateByStage.get(s.key)!) + ' /q' : '—'}
            </p>
          </div>
        ))}
      </div>

      <div className={`${hrShell} mb-4 flex items-end gap-4`}>
        <Field label="Month">
          <TextInput type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <div className="tnum pb-2 text-sm text-slate-600 dark:text-slate-300">
          <span className="font-bold text-slate-900 dark:text-slate-100">{fmtQ(totalQ)}</span> q ·{' '}
          <span className="font-bold text-violet-700">{fmtBirr(totalPay)}</span> earned
        </div>
      </div>

      <div className={hrShell}>
        <CardHeader
          icon={<HandCoins className="h-4 w-4" />}
          title={`Work records — ${period}`}
          subtitle="Pay = quintals × active stage rate"
        />
        {workQ.isLoading ? (
          <Spinner label="Loading work records..." />
        ) : (
          <DataTable<PieceRateWork>
            columns={[
              { key: 'date', label: 'Date', render: (r) => r.workDate.slice(0, 10) },
              { key: 'laborer', label: 'Laborer', render: (r) => r.employee?.name ?? r.laborer },
              {
                key: 'stage',
                label: 'Stage',
                render: (r) => STAGES.find((s) => s.key === r.stage)?.label ?? r.stage
              },
              { key: 'bags', label: 'Bags', mono: true, render: (r) => r.bags },
              { key: 'q', label: 'Quintals', mono: true, render: (r) => fmtQ(Number(r.quintals)) },
              { key: 'rate', label: 'Rate/q', mono: true, render: (r) => fmtBirr(Number(r.rateBirrPerQ)) },
              {
                key: 'pay',
                label: 'Pay',
                mono: true,
                render: (r) => <span className="font-bold text-violet-700">{fmtBirr(Number(r.payBirr))}</span>
              }
            ]}
            rows={rows}
            emptyTitle="No piece-rate work logged"
          />
        )}
      </div>

      {showForm ? (
        <HrModal title="Log piece-rate work" onClose={() => setShowForm(false)}>
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Employee (piece-rate staff)">
              <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                <option value="">— casual laborer —</option>
                {(employeesQ.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.employeeNo})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Laborer / crew" hint="Used when not linked to an employee">
              <TextInput value={form.laborer} onChange={(e) => setForm({ ...form, laborer: e.target.value })} placeholder="Name or crew" />
            </Field>
            <Field label="Labor stage" required>
              <Select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Work date" required>
              <TextInput type="date" value={form.workDate} onChange={(e) => setForm({ ...form, workDate: e.target.value })} required />
            </Field>
            <Field label="Bags handled">
              <TextInput type="number" min="0" value={form.bags} onChange={(e) => setForm({ ...form, bags: e.target.value })} />
            </Field>
            <Field label="Quintals handled" required>
              <TextInput type="number" min="0" step="0.01" value={form.quintals} onChange={(e) => setForm({ ...form, quintals: e.target.value })} required />
            </Field>
            <Field label="Truck plate" hint="For unloading stage">
              <TextInput value={form.truckPlate} onChange={(e) => setForm({ ...form, truckPlate: e.target.value })} placeholder="AA-12345" />
            </Field>
            <Field label="Notes">
              <TextInput value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            {previewPay != null ? (
              <p className="tnum rounded-xl bg-violet-50 px-4 py-3 text-sm font-bold text-violet-800 md:col-span-2">
                Pay preview: {fmtQ(Number(form.quintals))} q × {fmtBirr(currentRate!)} = {fmtBirr(previewPay)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 md:col-span-2">
              <button type="button" className={hrSecondaryBtn} onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" className={hrPrimaryBtn} disabled={saveM.isPending}>
                {saveM.isPending ? 'Saving...' : 'Log work'}
              </button>
            </div>
          </form>
        </HrModal>
      ) : null}

      {showRates ? (
        <HrModal title="Stage rates (ETB per quintal)" onClose={() => setShowRates(false)}>
          <div className="space-y-3">
            {STAGES.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-800 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{s.label}</p>
                  <p className="tnum text-xs text-slate-500 dark:text-slate-400">
                    Current: {rateByStage.has(s.key) ? fmtBirr(rateByStage.get(s.key)!) : 'not set'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <TextInput
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-28"
                    value={rateEdits[s.key] ?? ''}
                    onChange={(e) => setRateEdits({ ...rateEdits, [s.key]: e.target.value })}
                    placeholder="New rate"
                  />
                  <button
                    className={hrPrimaryBtn}
                    disabled={!rateEdits[s.key] || Number(rateEdits[s.key]) <= 0 || rateM.isPending}
                    onClick={() => rateM.mutate({ stage: s.key, rateBirrPerQ: Number(rateEdits[s.key]) })}
                  >
                    Set
                  </button>
                </div>
              </div>
            ))}
          </div>
        </HrModal>
      ) : null}
    </div>
  );
}
