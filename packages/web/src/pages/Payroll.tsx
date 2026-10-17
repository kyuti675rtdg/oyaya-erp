import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { PayrollLine, PayrollRun } from '../types';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { NumPad } from '../components/NumPad';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner, TextInput } from '../components/ui';
import { fmtBirr, fmtDate, fmtQ } from '../lib/format';

const PIECE_STAGES = [
  { key: 'UNLOADING', label: 'Unloading from truck' },
  { key: 'GRANARY_DUMPING', label: 'Dumping into granary' },
  { key: 'STORE_MOVEMENT', label: 'Moving sorted output to store' },
  { key: 'TRUCK_LOADING', label: 'Loading finished goods onto trucks' }
];

function periodLabel(run: PayrollRun): string {
  return `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}`;
}

export function Payroll() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');

  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));

  // Piece-rate log
  const [prLaborer, setPrLaborer] = useState('');
  const [prStage, setPrStage] = useState(PIECE_STAGES[0].key);
  const [prQty, setPrQty] = useState('');
  const [prRef, setPrRef] = useState('');

  const runsQ = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: async () => (await api.get<PayrollRun[]>(E.payrollRuns)).data
  });
  const runQ = useQuery({
    queryKey: ['payroll-run', selectedRunId],
    queryFn: async () => (await api.get<PayrollRun>(E.payrollRun(selectedRunId))).data,
    enabled: !!selectedRunId
  });

  const createRun = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      const [y, m] = period.split('-').map(Number);
      if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
        setNotice({ ok: false, text: 'Select a valid pay period.' });
        setSaving(false);
        return;
      }
      const res = await api.post<PayrollRun>(E.payrollRuns, { year: y, month: m });
      setNotice({ ok: true, text: `Payroll run computed for ${period}.` });
      setSelectedRunId(res.data.id);
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create payroll run.' });
    } finally {
      setSaving(false);
    }
  };

  const logPieceRate = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      const q = Number(prQty);
      if (!prLaborer.trim() || !Number.isFinite(q) || q <= 0) {
        setNotice({ ok: false, text: 'Laborer name and a positive quintal quantity are required.' });
        return;
      }
      const r = await submitOrQueue('piece-rate-log', E.pieceRateLogs, {
        stage: prStage,
        laborer: prLaborer.trim(),
        quintals: q,
        truckPlate: prRef.trim() || undefined
      });
      setNotice({
        ok: true,
        text: r.queued
          ? 'Piece-rate log saved offline — will sync automatically.'
          : 'Piece-rate quintals logged for day-end pay computation.'
      });
      setPrLaborer('');
      setPrQty('');
      setPrRef('');
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to log piece-rate.' });
    } finally {
      setSaving(false);
    }
  };

  const lines = runQ.data?.lines ?? [];

  return (
    <div>
      <SectionTitle
        title="HR & Payroll"
        sub="Tri-mode payroll: fixed salary + overtime, stage piece-rate, and driver trip-based pay"
      />

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">Run payroll</h3>
          <form onSubmit={createRun} className="space-y-4">
            <Field label="Pay period" required hint="Salaried overtime is computed from ZKTeco punches.">
              <TextInput type="month" value={period} onChange={(e) => setPeriod(e.target.value)} required />
            </Field>
            <Button type="submit" loading={saving} className="w-full">
              Compute payroll run
            </Button>
          </form>

          <h3 className="mb-4 mt-8 text-base font-bold text-ink">Piece-rate log</h3>
          <form onSubmit={logPieceRate} className="space-y-4">
            <Field label="Laborer / crew" required>
              <TextInput value={prLaborer} onChange={(e) => setPrLaborer(e.target.value)} placeholder="Name or crew" required />
            </Field>
            <Field label="Labor stage" required>
              <Select value={prStage} onChange={(e) => setPrStage(e.target.value)}>
                {PIECE_STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quintals handled" required hint="Pay = quintals x stage rate at day-end.">
              <NumPad value={prQty} onChange={setPrQty} label="Quintal keypad" />
            </Field>
            <Field label="Truck plate" hint="For unloading stage">
              <TextInput value={prRef} onChange={(e) => setPrRef(e.target.value)} placeholder="AA-12345" />
            </Field>
            <Button type="submit" loading={saving} variant="secondary" className="w-full">
              Log piece-rate
            </Button>
          </form>
        </Card>

        <div className="lg:col-span-2">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Payroll runs</h3>
          {runsQ.isLoading ? (
            <Spinner label="Loading payroll runs..." />
          ) : (
            <DataTable<PayrollRun>
              columns={[
                { key: 'period', label: 'Period', render: (r) => <span className="tnum font-bold">{periodLabel(r)}</span> },
                {
                  key: 'status',
                  label: 'Status',
                  render: (r) => <Badge tone={r.status === 'POSTED' ? 'pass' : 'advisory'}>{r.status}</Badge>
                },
                { key: 'createdAt', label: 'Computed', render: (r) => fmtDate(r.createdAt) },
                {
                  key: 'open',
                  label: '',
                  render: (r) => (
                    <Button variant="secondary" className="px-4 py-2 text-sm" onClick={() => setSelectedRunId(r.id)}>
                      Lines
                    </Button>
                  )
                }
              ]}
              rows={runsQ.data ?? []}
              emptyTitle="No payroll runs yet"
              emptySub="Create a run for the current pay period."
            />
          )}

          {selectedRunId ? (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Run lines {runQ.data ? `— ${periodLabel(runQ.data)}` : ''}
              </h3>
              {runQ.isLoading ? (
                <Spinner label="Loading lines..." />
              ) : (
                <DataTable<PayrollLine>
                  columns={[
                    { key: 'employee', label: 'Employee', render: (r) => r.employee?.name ?? r.employeeId },
                    { key: 'mode', label: 'Pay mode', render: (r) => r.mode.replace('_', ' ') },
                    { key: 'base', label: 'Base', mono: true, render: (r) => fmtBirr(r.baseBirr) },
                    { key: 'overtime', label: 'Overtime', mono: true, render: (r) => fmtBirr(r.overtimeBirr) },
                    { key: 'piece', label: 'Piece-rate', mono: true, render: (r) => `${fmtQ(r.pieceQuintals)} q / ${fmtBirr(r.pieceBirr)}` },
                    { key: 'trips', label: 'Trips', mono: true, render: (r) => `${r.trips} / ${fmtBirr(r.tripBirr)}` },
                    { key: 'gross', label: 'Gross', mono: true, render: (r) => <span className="font-bold">{fmtBirr(r.grossBirr)}</span> }
                  ]}
                  rows={lines}
                  emptyTitle="No lines in this run"
                />
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
