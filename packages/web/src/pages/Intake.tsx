import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { Supplier, WheatIntake } from '../types';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { NumPad } from '../components/NumPad';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { fmtDateTime, fmtQ } from '../lib/format';

const INTAKE_THRESHOLDS = [
  { key: 'glutenPct', label: 'Gluten (%)', hint: 'Accept: 20% or higher', mode: 'min' as const, threshold: 20 },
  { key: 'moisturePct', label: 'Moisture (%)', hint: 'Accept: 13.5% or lower', mode: 'max' as const, threshold: 13.5 },
  { key: 'impurityPct', label: 'Impurity (%)', hint: 'Accept: 6% or lower', mode: 'max' as const, threshold: 6 },
  { key: 'hectoliterPct', label: 'Hectoliter weight', hint: 'Accept: 74 or higher', mode: 'min' as const, threshold: 74 },
  { key: 'germinationPct', label: 'Germination (%)', hint: 'Accept: 1% or lower', mode: 'max' as const, threshold: 1 }
];

const STATUS_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  ACCEPTED: 'pass',
  FLAGGED: 'critical',
  REJECTED: 'critical',
  PENDING_LAB: 'advisory'
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Intake() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<WheatIntake | null>(null);
  const [decision, setDecision] = useState<'ACCEPT' | 'REJECT'>('ACCEPT');
  const [decisionNote, setDecisionNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Gate form state
  const [supplierId, setSupplierId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(todayISO());
  const [truckPlate, setTruckPlate] = useState('');
  const [wheatCategory, setWheatCategory] = useState('SOFT');
  const [bagCount, setBagCount] = useState('');

  // Lab form state
  const [labIntakeId, setLabIntakeId] = useState('');
  const [labParams, setLabParams] = useState<Record<string, string>>({
    glutenPct: '',
    moisturePct: '',
    impurityPct: '',
    hectoliterPct: '',
    germinationPct: ''
  });

  const suppliersQ = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<Supplier[]>(E.suppliers)).data
  });
  const pendingQ = useQuery({
    queryKey: ['intakes-pending'],
    queryFn: async () => (await api.get<WheatIntake[]>(`${E.intakes}?status=PENDING_LAB`)).data
  });
  const flaggedQ = useQuery({
    queryKey: ['intakes-flagged'],
    queryFn: async () => (await api.get<WheatIntake[]>(E.intakesFlagged)).data,
    refetchInterval: 30000
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['intakes-pending'] });
    qc.invalidateQueries({ queryKey: ['intakes-flagged'] });
  };

  const submitIntake = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      const bags = Number(bagCount);
      if (!supplierId || !truckPlate.trim() || !Number.isFinite(bags) || bags <= 0) {
        setNotice({ ok: false, text: 'Supplier, truck plate and a positive bag count are required.' });
        return;
      }
      const r = await submitOrQueue('wheat-intake', E.intakes, {
        supplierId,
        deliveryDate: new Date(`${deliveryDate}T00:00:00`).toISOString(),
        truckPlate: truckPlate.trim().toUpperCase(),
        wheatCategory,
        bagCount: bags
      });
      setNotice({
        ok: true,
        text: r.queued
          ? 'Saved offline — intake will sync automatically when connectivity returns.'
          : 'Intake recorded. Confirming intake creates the supplier payable.'
      });
      setTruckPlate('');
      setBagCount('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record intake.' });
    } finally {
      setSaving(false);
    }
  };

  const submitLab = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      if (!labIntakeId) {
        setNotice({ ok: false, text: 'Select a delivery to test.' });
        return;
      }
      const params: Record<string, number> = {};
      for (const t of INTAKE_THRESHOLDS) {
        const v = Number(labParams[t.key]);
        if (!Number.isFinite(v)) {
          setNotice({ ok: false, text: `Enter a numeric value for ${t.label}.` });
          return;
        }
        params[t.key] = v;
      }
      const r = await submitOrQueue('intake-lab', `${E.intakes}/${labIntakeId}/lab`, {
        intakeId: labIntakeId,
        ...params
      });
      const breaches = INTAKE_THRESHOLDS.filter((t) =>
        t.mode === 'min' ? params[t.key] < t.threshold : params[t.key] > t.threshold
      );
      setNotice({
        ok: true,
        text: r.queued
          ? 'Lab result saved offline — will sync automatically.'
          : breaches.length > 0
            ? `Lab result recorded. ${breaches.length} parameter(s) breached threshold — delivery flagged for Quality Head review.`
            : 'Lab result recorded within thresholds.'
      });
      setLabParams({ glutenPct: '', moisturePct: '', impurityPct: '', hectoliterPct: '', germinationPct: '' });
      setLabIntakeId('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record lab result.' });
    } finally {
      setSaving(false);
    }
  };

  const submitDecision = async () => {
    if (!decisionTarget) return;
    setSaving(true);
    try {
      await api.post(E.intakeDecision(decisionTarget.id), {
        decision,
        note: decisionNote.trim() || undefined
      });
      setNotice({ ok: true, text: `Delivery ${decision === 'ACCEPT' ? 'accepted' : 'rejected'} by Quality Head.` });
      setDecisionTarget(null);
      setDecisionNote('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record decision.' });
    } finally {
      setSaving(false);
    }
  };

  const labBreaches = (key: string, threshold: number, mode: 'min' | 'max'): boolean => {
    const v = Number(labParams[key]);
    if (!Number.isFinite(v) || labParams[key] === '') return false;
    return mode === 'min' ? v < threshold : v > threshold;
  };

  return (
    <div>
      <SectionTitle
        title="Wheat Intake"
        sub="Gate receiving by bag count (1 bag = 1 quintal) and pre-entry lab quality gate"
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Gate intake */}
        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">Gate receiving</h3>
          <form onSubmit={submitIntake} className="space-y-4">
            <Field label="Supplier" required>
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                <option value="">Select supplier</option>
                {(suppliersQ.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.type})
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Delivery date" required>
                <TextInput type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} required />
              </Field>
              <Field label="Truck plate" required hint="Verified at the gate">
                <TextInput value={truckPlate} onChange={(e) => setTruckPlate(e.target.value)} placeholder="AA-12345" required />
              </Field>
            </div>
            <Field label="Wheat type" required>
              <Select value={wheatCategory} onChange={(e) => setWheatCategory(e.target.value)}>
                <option value="SOFT">Soft wheat</option>
                <option value="HARD">Hard wheat</option>
                <option value="FOREIGN">Foreign (imported)</option>
              </Select>
            </Field>
            <Field label="Bag count" required hint="1 bag = 1 quintal. No weighbridge reading required.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <NumberInput
                  value={bagCount}
                  onChange={(e) => setBagCount(e.target.value)}
                  placeholder="e.g. 320"
                  min={1}
                  step={1}
                  className="text-xl"
                />
                <NumPad value={bagCount} onChange={setBagCount} label="Bag count keypad" />
              </div>
            </Field>
            <Button type="submit" loading={saving} className="w-full">
              Record intake ({bagCount ? `${fmtQ(Number(bagCount))} q` : '0.0 q'})
            </Button>
          </form>
        </Card>

        {/* Lab inspection */}
        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">Pre-entry lab inspection</h3>
          <form onSubmit={submitLab} className="space-y-4">
            <Field label="Delivery under test" required>
              <Select value={labIntakeId} onChange={(e) => setLabIntakeId(e.target.value)} required>
                <option value="">Select delivery</option>
                {(pendingQ.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.truckPlate} — {fmtQ(i.quintals)} q {i.wheatCategory}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {INTAKE_THRESHOLDS.map((t) => {
                const breached = labBreaches(t.key, t.threshold, t.mode);
                return (
                  <div key={t.key} className={`rounded-lg border p-3 ${breached ? 'border-critical-text/50 bg-critical-bg' : 'border-line'}`}>
                    <Field label={t.label} hint={t.hint}>
                      <NumberInput
                        value={labParams[t.key]}
                        onChange={(e) => setLabParams((p) => ({ ...p, [t.key]: e.target.value }))}
                        step="0.01"
                        placeholder="0.00"
                      />
                    </Field>
                    {breached ? <p className="mt-1 text-xs font-bold text-critical-text">OUT OF SPEC</p> : null}
                  </div>
                );
              })}
            </div>
            <Button type="submit" loading={saving} className="w-full" variant="secondary">
              Record lab result
            </Button>
          </form>
        </Card>
      </div>

      {/* Flagged deliveries */}
      <div className="mt-6">
        <SectionTitle title="Flagged deliveries" sub="Require an explicit Quality Head Accept / Reject decision" />
        {flaggedQ.isLoading ? (
          <Spinner label="Loading flagged deliveries..." />
        ) : (
          <DataTable<WheatIntake>
            columns={[
              { key: 'deliveryDate', label: 'Date', render: (r) => fmtDateTime(r.deliveryDate) },
              { key: 'truckPlate', label: 'Truck', render: (r) => <span className="tnum font-semibold">{r.truckPlate}</span> },
              { key: 'supplierName', label: 'Supplier', render: (r) => r.supplier?.name ?? '-' },
              { key: 'wheatCategory', label: 'Type', render: (r) => r.wheatCategory },
              { key: 'quintals', label: 'Qty (q)', mono: true, render: (r) => fmtQ(r.quintals) },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge>
              },
              {
                key: 'actions',
                label: 'Decision',
                render: (r) => (
                  <Button variant="secondary" onClick={() => setDecisionTarget(r)} className="px-4 py-2 text-sm">
                    Review
                  </Button>
                )
              }
            ]}
            rows={flaggedQ.data ?? []}
            emptyTitle="No flagged deliveries"
            emptySub="Deliveries breaching any intake threshold will appear here."
          />
        )}
      </div>

      {/* Decision modal */}
      {decisionTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-ink">Quality Head decision</h3>
            <p className="tnum mt-1 text-sm text-slate-600">
              {decisionTarget.truckPlate} — {fmtQ(decisionTarget.quintals)} q {decisionTarget.wheatCategory}
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {INTAKE_THRESHOLDS.map((t) => {
                const v = Number((decisionTarget as unknown as Record<string, number | null>)[t.key] ?? NaN);
                  const bad = Number.isFinite(v) && (t.mode === 'min' ? v < t.threshold : v > t.threshold);
                  return (
                    <li key={t.key} className="flex justify-between">
                      <span className="text-slate-600">{t.label}</span>
                      <span className={`tnum font-semibold ${bad ? 'text-critical-text' : 'text-pass-text'}`}>
                        {Number.isFinite(v) ? v.toFixed(2) : '—'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDecision('ACCEPT')}
                className={`touch rounded-lg border-2 px-4 font-bold ${decision === 'ACCEPT' ? 'border-pass-text bg-pass-bg text-pass-text' : 'border-line text-slate-500'}`}
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => setDecision('REJECT')}
                className={`touch rounded-lg border-2 px-4 font-bold ${decision === 'REJECT' ? 'border-critical-text bg-critical-bg text-critical-text' : 'border-line text-slate-500'}`}
              >
                Reject
              </button>
            </div>
            <div className="mt-3">
              <Field label="Decision note">
                <TextArea value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} placeholder="Reason for the decision" />
              </Field>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={() => setDecisionTarget(null)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={submitDecision} loading={saving} className="flex-1">
                Confirm {decision === 'ACCEPT' ? 'accept' : 'reject'}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
