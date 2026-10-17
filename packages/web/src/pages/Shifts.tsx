import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { queueMutation, submitOrQueue } from '../lib/sync';
import type { LabCheck, Product, ProductionBatch, ShiftHandover, ShiftOutput, ShiftRun } from '../types';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { NumPad } from '../components/NumPad';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { fmtCountdown, fmtDateTime, fmtQ } from '../lib/format';

const QC_INTERVAL_MS = 2 * 60 * 60 * 1000;
const EXTRACTION_MIN = 78;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Extraction rate = flour-kind output / total output x 100. Flagged when < 78%. */
export function extractionPct(outputs: ShiftOutput[]): number | null {
  const total = outputs.reduce((s, o) => s + Number(o.quintals), 0);
  if (total <= 0) return null;
  const flour = outputs
    .filter((o) => o.product?.kind === 'flour')
    .reduce((s, o) => s + Number(o.quintals), 0);
  return (flour / total) * 100;
}

function QcCountdownBanner() {
  const latestQ = useQuery({
    queryKey: ['lab-check-latest'],
    queryFn: async () => {
      const rows = await (await api.get<LabCheck[]>(E.labChecks)).data;
      return rows[0] ?? null;
    },
    refetchInterval: 60000
  });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const last = latestQ.data?.sampleTime ? new Date(latestQ.data.sampleTime).getTime() : null;
  const dueAt = last !== null ? last + QC_INTERVAL_MS : null;
  const remaining = dueAt !== null ? dueAt - now : null;
  const overdue = remaining !== null && remaining <= 0;

  return (
    <div
      role="status"
      className={`no-print sticky top-0 z-20 mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
        overdue
          ? 'border-critical-text/50 bg-critical-bg text-critical-text badge-critical-pulse'
          : 'border-advisory-text/40 bg-advisory-bg text-advisory-text'
      }`}
    >
      <div>
        <p className="text-sm font-bold uppercase tracking-wide">2-hour lab check</p>
        <p className="text-xs font-medium">
          {latestQ.isLoading
            ? 'Checking schedule...'
            : last === null
              ? 'No lab check recorded yet — take a sample now.'
              : overdue
                ? `Overdue — last sample ${fmtDateTime(last)}. Record a check now.`
                : `Next check due at ${fmtDateTime(dueAt)} (last sample ${fmtDateTime(last)}).`}
        </p>
      </div>
      <span className="tnum text-2xl font-bold">
        {remaining === null ? '--:--:--' : fmtCountdown(remaining)}
      </span>
    </div>
  );
}

export function Shifts() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState('');

  // Shift form
  const [batchId, setBatchId] = useState('');
  const [shiftDate, setShiftDate] = useState(todayISO());
  const [shiftType, setShiftType] = useState<'MORNING' | 'NIGHT'>('MORNING');
  const [operators, setOperators] = useState('');
  const [startTime, setStartTime] = useState('');

  // Output form
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');

  // Downtime form
  const [downtimeMin, setDowntimeMin] = useState('');
  const [downtimeReason, setDowntimeReason] = useState('');

  // Module 4: handover notes + operator reassignment for the selected shift
  const [handoverType, setHandoverType] = useState<'HANDOVER' | 'OPERATOR_NOTE'>('HANDOVER');
  const [handoverContent, setHandoverContent] = useState('');
  const [operatorsEdit, setOperatorsEdit] = useState('');

  const shiftsQ = useQuery({
    queryKey: ['shifts'],
    queryFn: async () => (await api.get<ShiftRun[]>(E.shifts)).data
  });
  const batchesQ = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(E.batches)).data
  });
  const productsQ = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get<Product[]>(E.products)).data
  });
  const shiftDetailQ = useQuery({
    queryKey: ['shift', selectedShiftId],
    queryFn: async () => (await api.get<ShiftRun>(E.shift(selectedShiftId))).data,
    enabled: !!selectedShiftId
  });

  const handoversQ = useQuery({
    queryKey: ['shift-handovers', selectedShiftId],
    queryFn: async () => (await api.get<ShiftHandover[]>(E.prodShiftHandovers(selectedShiftId))).data,
    enabled: !!selectedShiftId
  });

  const selectedShift = shiftDetailQ.data ?? null;

  const extraction = useMemo(
    () => (selectedShift?.outputs ? extractionPct(selectedShift.outputs) : null),
    [selectedShift]
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['shifts'] });
    qc.invalidateQueries({ queryKey: ['shift', selectedShiftId] });
  };

  // Module 4: reassign operators on the selected shift
  const saveOperators = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedShift) return;
    setNotice(null);
    setSaving(true);
    try {
      const ops = operatorsEdit.split(',').map((o) => o.trim()).filter(Boolean);
      if (ops.length === 0) {
        setNotice({ ok: false, text: 'Enter at least one operator name.' });
        return;
      }
      const r = await submitOrQueue('shift-operators', E.shift(selectedShift.id), { operators: ops }, 'put');
      setNotice({
        ok: true,
        text: r.queued ? 'Operators saved offline — will sync automatically.' : 'Operators reassigned.'
      });
      setOperatorsEdit('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to reassign operators.' });
    } finally {
      setSaving(false);
    }
  };

  // Module 4: end the selected shift
  const endShift = async () => {
    if (!selectedShift || selectedShift.endedAt) return;
    setNotice(null);
    setSaving(true);
    try {
      await api.put(E.shift(selectedShift.id), { endedAt: new Date().toISOString() });
      setNotice({ ok: true, text: 'Shift ended.' });
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to end shift.' });
    } finally {
      setSaving(false);
    }
  };

  // Module 4: handover / operator note
  const saveHandover = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedShift) return;
    setNotice(null);
    setSaving(true);
    try {
      if (!handoverContent.trim()) {
        setNotice({ ok: false, text: 'Write the handover note first.' });
        return;
      }
      const r = await submitOrQueue('shift-handover', E.prodShiftHandovers(selectedShift.id), {
        noteType: handoverType,
        content: handoverContent.trim()
      });
      setNotice({
        ok: true,
        text: r.queued ? 'Note saved offline — will sync automatically.' : 'Handover note recorded.'
      });
      setHandoverContent('');
      qc.invalidateQueries({ queryKey: ['shift-handovers', selectedShiftId] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save note.' });
    } finally {
      setSaving(false);
    }
  };

  const createShift = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      const ops = operators
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
      if (!batchId || ops.length === 0 || !startTime) {
        setNotice({ ok: false, text: 'Batch, operators and start time are required.' });
        return;
      }
      const r = await submitOrQueue('shift-run', E.shifts, {
        batchId,
        shift: shiftType,
        shiftDate: new Date(`${shiftDate}T00:00:00`).toISOString(),
        startedAt: new Date(startTime).toISOString(),
        operators: ops
      });
      setNotice({
        ok: true,
        text: r.queued ? 'Shift saved offline — will sync automatically.' : 'Shift started.'
      });
      setBatchId('');
      setOperators('');
      setStartTime('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to start shift.' });
    } finally {
      setSaving(false);
    }
  };

  const recordOutput = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedShift) return;
    setNotice(null);
    setSaving(true);
    try {
      const q = Number(qty);
      if (!productId || !Number.isFinite(q) || q <= 0) {
        setNotice({ ok: false, text: 'Select a product and enter a positive quantity.' });
        return;
      }
      let queued = false;
      if (navigator.onLine) {
        try {
          await api.post(E.shiftOutputs(selectedShift.id), {
            outputs: [{ productId, quintals: q }]
          });
        } catch (err) {
          if (!isNetworkError(err)) throw err;
          await queueMutation('shift-output', E.shiftOutputs(selectedShift.id), {
            shiftRunId: selectedShift.id,
            productId,
            quintals: q
          });
          queued = true;
        }
      } else {
        await queueMutation('shift-output', E.shiftOutputs(selectedShift.id), {
          shiftRunId: selectedShift.id,
          productId,
          quintals: q
        });
        queued = true;
      }
      setNotice({
        ok: true,
        text: queued ? 'Output saved offline — will sync automatically.' : 'Output recorded.'
      });
      setQty('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record output.' });
    } finally {
      setSaving(false);
    }
  };

  const recordDowntime = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedShift) return;
    setNotice(null);
    setSaving(true);
    try {
      const m = Number(downtimeMin);
      if (!Number.isFinite(m) || m < 0 || !downtimeReason.trim()) {
        setNotice({ ok: false, text: 'Enter downtime minutes and a reason (e.g. power outage).' });
        return;
      }
      const r = await submitOrQueue(
        'shift-downtime',
        E.shift(selectedShift.id),
        {
          shiftRunId: selectedShift.id,
          downtimeMin: Math.round(m),
          downtimeReason: downtimeReason.trim()
        },
        'put'
      );
      setNotice({
        ok: true,
        text: r.queued ? 'Downtime saved offline — will sync automatically.' : 'Downtime logged.'
      });
      setDowntimeMin('');
      setDowntimeReason('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to log downtime.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle title="Shift Milling" sub="Two shifts per day — morning and night, with downtime logging" />

      <QcCountdownBanner />

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
          <h3 className="mb-4 text-base font-bold text-ink">Start shift</h3>
          <form onSubmit={createShift} className="space-y-4">
            <Field label="Production batch" required>
              <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} required>
                <option value="">Select batch</option>
                {(batchesQ.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNo} — {b.productType.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Shift date" required>
                <TextInput type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} required />
              </Field>
              <Field label="Shift" required>
                <Select value={shiftType} onChange={(e) => setShiftType(e.target.value as 'MORNING' | 'NIGHT')}>
                  <option value="MORNING">Morning</option>
                  <option value="NIGHT">Night</option>
                </Select>
              </Field>
            </div>
            <Field label="Machine operators" required hint="Comma separated names">
              <TextInput value={operators} onChange={(e) => setOperators(e.target.value)} placeholder="e.g. Abebe T., Kebede M." required />
            </Field>
            <Field label="Start time" required>
              <TextInput type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </Field>
            <Button type="submit" loading={saving} className="w-full">
              Start shift
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">Record output</h3>
          <form onSubmit={recordOutput} className="space-y-4">
            <Field label="Shift" required>
              <Select value={selectedShiftId} onChange={(e) => setSelectedShiftId(e.target.value)} required>
                <option value="">Select shift</option>
                {(shiftsQ.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {fmtDateTime(s.shiftDate)} — {s.shift}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Product" required>
              <Select value={productId} onChange={(e) => setProductId(e.target.value)} required>
                <option value="">Select product</option>
                {(productsQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity (quintals)" required>
              <NumPad value={qty} onChange={setQty} label="Output keypad" />
            </Field>
            <Button type="submit" loading={saving} className="w-full" disabled={!selectedShiftId}>
              Record output
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">Log downtime</h3>
          <form onSubmit={recordDowntime} className="space-y-4">
            <Field label="Minutes" required>
              <NumberInput value={downtimeMin} onChange={(e) => setDowntimeMin(e.target.value)} min={0} placeholder="0" />
            </Field>
            <Field label="Reason" required hint="e.g. power outage, roller change">
              <TextInput value={downtimeReason} onChange={(e) => setDowntimeReason(e.target.value)} placeholder="Power outage" required />
            </Field>
            <Button type="submit" loading={saving} variant="secondary" className="w-full" disabled={!selectedShiftId}>
              Log downtime
            </Button>
          </form>

          {selectedShift ? (
            <div className="mt-5 rounded-xl border border-line bg-alabaster p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-ink">Extraction rate</p>
                {extraction === null ? (
                  <Badge tone="neutral">No output yet</Badge>
                ) : (
                  <Badge tone={extraction < EXTRACTION_MIN ? 'critical' : 'pass'}>
                    {extraction.toFixed(1)}%
                  </Badge>
                )}
              </div>
              <p className="tnum mt-1 text-xs text-slate-500">
                Flour output / total output x 100. Flagged below {EXTRACTION_MIN}%.
              </p>
              {(selectedShift.outputs ?? []).length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {(selectedShift.outputs ?? []).map((o) => (
                    <li key={o.id} className="flex justify-between">
                      <span className="text-slate-600">{o.product?.name ?? o.productId}</span>
                      <span className="tnum font-semibold text-ink">{fmtQ(o.quintals)} q</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      {/* Module 4: operator management + handover notes for the selected shift */}
      {selectedShift ? (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h3 className="mb-1 text-base font-bold text-ink">Operator assignment</h3>
            <p className="mb-4 text-sm text-slate-500">
              Current: <span className="font-semibold text-slate-700">{(selectedShift.operators ?? []).join(', ') || '—'}</span>
            </p>
            <form onSubmit={saveOperators} className="space-y-3">
              <Field label="Reassign operators" hint="Comma separated — replaces the current list">
                <TextInput
                  value={operatorsEdit}
                  onChange={(e) => setOperatorsEdit(e.target.value)}
                  placeholder="e.g. Abebe T., Kebede M., Hana S."
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" loading={saving} variant="secondary" className="flex-1">
                  Reassign
                </Button>
                {!selectedShift.endedAt ? (
                  <Button type="button" variant="secondary" onClick={endShift} loading={saving} className="flex-1">
                    End shift now
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>

          <Card className="p-5">
            <h3 className="mb-4 text-base font-bold text-ink">Shift handover & operator notes</h3>
            {handoversQ.isLoading ? (
              <Spinner label="Loading notes..." />
            ) : (handoversQ.data ?? []).length === 0 ? (
              <p className="mb-4 text-sm text-slate-500">
                No notes yet — leave a handover for the next shift's crew.
              </p>
            ) : (
              <ul className="mb-4 max-h-48 space-y-2 overflow-y-auto">
                {(handoversQ.data ?? []).map((n) => (
                  <li key={n.id} className="rounded-lg bg-alabaster p-3">
                    <div className="flex items-center justify-between">
                      <Badge tone={n.noteType === 'HANDOVER' ? 'advisory' : 'neutral'}>
                        {n.noteType === 'HANDOVER' ? 'Handover' : 'Operator note'}
                      </Badge>
                      <span className="tnum text-xs text-slate-500">{fmtDateTime(n.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{n.content}</p>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={saveHandover} className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Field label="Type">
                  <Select
                    value={handoverType}
                    onChange={(e) => setHandoverType(e.target.value as 'HANDOVER' | 'OPERATOR_NOTE')}
                  >
                    <option value="HANDOVER">Handover</option>
                    <option value="OPERATOR_NOTE">Operator note</option>
                  </Select>
                </Field>
                <div className="col-span-2">
                  <Field label="Note">
                    <TextArea
                      value={handoverContent}
                      onChange={(e) => setHandoverContent(e.target.value)}
                      rows={2}
                      placeholder="Running issues, settings for the next crew..."
                    />
                  </Field>
                </div>
              </div>
              <Button type="submit" loading={saving} variant="secondary" className="w-full">
                Save note
              </Button>
            </form>
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        <SectionTitle title="Shift log" />
        {shiftsQ.isLoading ? (
          <Spinner label="Loading shifts..." />
        ) : (
          <DataTable<ShiftRun>
            columns={[
              { key: 'shiftDate', label: 'Date', render: (r) => fmtDateTime(r.shiftDate) },
              { key: 'shift', label: 'Shift' },
              { key: 'operators', label: 'Operators', render: (r) => (r.operators ?? []).join(', ') || '-' },
              { key: 'startedAt', label: 'Start', render: (r) => fmtDateTime(r.startedAt) },
              { key: 'endedAt', label: 'End', render: (r) => (r.endedAt ? fmtDateTime(r.endedAt) : 'Running') },
              {
                key: 'downtime',
                label: 'Downtime',
                render: (r) => (r.downtimeMin ? `${r.downtimeMin} min` : '-')
              }
            ]}
            rows={shiftsQ.data ?? []}
            emptyTitle="No shifts yet"
            emptySub="Start a morning or night shift to begin milling."
          />
        )}
      </div>
    </div>
  );
}
