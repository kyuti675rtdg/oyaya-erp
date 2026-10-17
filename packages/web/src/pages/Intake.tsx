import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  ClipboardList,
  FileText,
  FlaskConical,
  Scale,
  Truck,
  XCircle
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { PurchaseOrder, Supplier, WheatIntake } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { LabParamField } from '../components/LabParamField';
import { NumPad } from '../components/NumPad';
import {
  Button,
  Field,
  NumberInput,
  SectionTitle,
  Select,
  Spinner,
  TextArea,
  TextInput
} from '../components/ui';
import {
  INTAKE_THRESHOLDS,
  breachesOf,
  emptyLabParams,
  paramBreached
} from '../lib/intakeThresholds';
import { fmtBirr, fmtDateTime, fmtQ } from '../lib/format';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const STATUS_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  ACCEPTED: 'pass',
  FLAGGED: 'critical',
  REJECTED: 'critical',
  PENDING_LAB: 'advisory'
};

const DECISION_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  ACCEPT: 'pass',
  CONDITIONAL: 'advisory',
  REJECT: 'critical'
};

type Decision = 'ACCEPT' | 'CONDITIONAL' | 'REJECT';

const DECISION_OPTIONS: { value: Decision; label: string; sub: string }[] = [
  { value: 'ACCEPT', label: 'Accept', sub: 'Meets specification' },
  { value: 'CONDITIONAL', label: 'Conditional', sub: 'Accept with conditions' },
  { value: 'REJECT', label: 'Reject', sub: 'Return to supplier' }
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ');
}

function decisionLabel(d: string | null | undefined): string {
  if (d === 'CONDITIONAL') return 'Conditional';
  if (d === 'REJECT') return 'Rejected';
  if (d === 'ACCEPT') return 'Accepted';
  return '—';
}

export function Intake() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Decision modal state
  const [decisionTarget, setDecisionTarget] = useState<WheatIntake | null>(null);
  const [decision, setDecision] = useState<Decision>('ACCEPT');
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionPrice, setDecisionPrice] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);

  // Gate form state
  const [supplierId, setSupplierId] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(todayISO());
  const [truckPlate, setTruckPlate] = useState('');
  const [wheatCategory, setWheatCategory] = useState('SOFT');
  const [bagCount, setBagCount] = useState('');
  const [grossKg, setGrossKg] = useState('');
  const [tareKg, setTareKg] = useState('');
  const [moistureQuick, setMoistureQuick] = useState('');

  // Lab form state (compact gate-side check; full lab lives in Incoming Inspection)
  const [labIntakeId, setLabIntakeId] = useState('');
  const [labParams, setLabParams] = useState<Record<string, string>>(emptyLabParams());

  const suppliersQ = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<Supplier[]>(E.suppliers)).data
  });
  const openPosQ = useQuery({
    queryKey: ['purchase-orders-open', supplierId],
    queryFn: async () => {
      const all = (await api.get<PurchaseOrder[]>(E.purchaseOrders)).data;
      return all
        .filter(
          (p) =>
            p.supplierId === supplierId && (p.status === 'APPROVED' || p.status === 'PARTIALLY_RECEIVED')
        )
        .sort((a, b) => a.poNo.localeCompare(b.poNo));
    },
    enabled: supplierId !== ''
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
  const allQ = useQuery({
    queryKey: ['intakes-all'],
    queryFn: async () => (await api.get<WheatIntake[]>(`${E.intakes}?limit=100`)).data
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['intakes-pending'] });
    qc.invalidateQueries({ queryKey: ['intakes-flagged'] });
    qc.invalidateQueries({ queryKey: ['intakes-all'] });
  };

  // ── Weighbridge derived values ──────────────────────────────────────────
  const weighbridge = useMemo(() => {
    const g = grossKg.trim() === '' ? NaN : Number(grossKg);
    const t = tareKg.trim() === '' ? NaN : Number(tareKg);
    const entered = grossKg.trim() !== '' || tareKg.trim() !== '';
    const valid = entered && Number.isFinite(g) && Number.isFinite(t) && g > t && g > 0 && t >= 0;
    return { g, t, entered, valid, net: valid ? g - t : null };
  }, [grossKg, tareKg]);

  const selectedPO = useMemo(
    () => (openPosQ.data ?? []).find((p) => p.id === purchaseOrderId) ?? null,
    [openPosQ.data, purchaseOrderId]
  );

  const bagQuintals = useMemo(() => {
    const b = Number(bagCount);
    return Number.isFinite(b) && b > 0 ? b : 0;
  }, [bagCount]);

  const weightBagMismatch =
    weighbridge.valid &&
    bagQuintals > 0 &&
    Math.abs(weighbridge.net! / 100 - bagQuintals) / bagQuintals > 0.01;

  // ── Gate intake submit ──────────────────────────────────────────────────
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
      if (weighbridge.entered && !weighbridge.valid) {
        setNotice({
          ok: false,
          text: 'Weighbridge readings are inconsistent — gross and tare are both required and gross must exceed tare.'
        });
        return;
      }
      let moisture: number | undefined;
      if (moistureQuick.trim() !== '') {
        moisture = Number(moistureQuick);
        if (!Number.isFinite(moisture) || moisture < 0 || moisture > 100) {
          setNotice({ ok: false, text: 'Quick moisture must be a percentage between 0 and 100.' });
          return;
        }
      }
      const r = await submitOrQueue('wheat-intake', E.intakes, {
        supplierId,
        deliveryDate: new Date(`${deliveryDate}T00:00:00`).toISOString(),
        truckPlate: truckPlate.trim().toUpperCase(),
        wheatCategory,
        bagCount: bags,
        purchaseOrderId: purchaseOrderId || undefined,
        grossKg: weighbridge.valid ? weighbridge.g : undefined,
        tareKg: weighbridge.valid ? weighbridge.t : undefined,
        netKg: weighbridge.valid ? weighbridge.net : undefined,
        moistureQuick: moisture
      });
      setNotice({
        ok: true,
        text: r.queued
          ? 'Saved offline — intake will sync automatically when connectivity returns.'
          : selectedPO
            ? `Intake recorded and linked to PO ${selectedPO.poNo}. Confirming intake creates the supplier payable.`
            : 'Intake recorded. Confirming intake creates the supplier payable.'
      });
      setTruckPlate('');
      setBagCount('');
      setGrossKg('');
      setTareKg('');
      setMoistureQuick('');
      setPurchaseOrderId('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record intake.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Lab submit (compact gate-side check) ────────────────────────────────
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
      const breaches = breachesOf(params);
      setNotice({
        ok: true,
        text: r.queued
          ? 'Lab result saved offline — will sync automatically.'
          : breaches.length > 0
            ? `Lab result recorded. ${breaches.length} parameter(s) breached threshold — delivery flagged for Quality Head review.`
            : 'Lab result recorded within thresholds.'
      });
      setLabParams(emptyLabParams());
      setLabIntakeId('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record lab result.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Quality Head decision ───────────────────────────────────────────────
  const openDecision = (r: WheatIntake) => {
    setDecisionTarget(r);
    setDecision('ACCEPT');
    setDecisionNote('');
    setDecisionPrice('');
    setReturnNote('');
    setModalError(null);
  };

  const submitDecision = async () => {
    if (!decisionTarget) return;
    setModalError(null);
    if (decision === 'REJECT' && returnNote.trim() === '') {
      setModalError('A return note is required when rejecting — include return-to-supplier instructions (who returns the truck, where, and by when).');
      return;
    }
    const price = Number(decisionPrice);
    const pricePerQuintalBirr =
      decisionPrice.trim() !== '' && Number.isFinite(price) && price > 0 ? price : undefined;
    if (decisionPrice.trim() !== '' && pricePerQuintalBirr === undefined) {
      setModalError('Agreed price per quintal must be a positive number.');
      return;
    }
    setSaving(true);
    try {
      await api.post(E.intakeDecision(decisionTarget.id), {
        decision,
        note: decisionNote.trim() || undefined,
        pricePerQuintalBirr,
        returnNote: returnNote.trim() || undefined
      });
      const verb = decision === 'ACCEPT' ? 'accepted' : decision === 'CONDITIONAL' ? 'conditionally accepted' : 'rejected';
      setNotice({ ok: true, text: `Delivery ${verb} by Quality Head.` });
      setDecisionTarget(null);
      setDecisionNote('');
      setDecisionPrice('');
      setReturnNote('');
      refresh();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to record decision.');
    } finally {
      setSaving(false);
    }
  };

  const estimatedInvoice = useMemo(() => {
    const price = Number(decisionPrice);
    const q = decisionTarget ? Number(decisionTarget.quintals) : 0;
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(q) || q <= 0) return null;
    return price * q;
  }, [decisionPrice, decisionTarget]);

  return (
    <div>
      <SectionTitle
        title="Wheat Intake"
        sub="Gate receiving by bag count (1 bag = 1 quintal), weighbridge capture and pre-entry lab quality gate"
        action={
          <Link
            to="/incoming-inspection"
            className="touch inline-flex items-center gap-2 rounded-lg border border-line bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 transition-all hover:bg-slate-50 dark:hover:bg-slate-700 hover:shadow-sm active:scale-[0.98]"
          >
            <FlaskConical size={16} className="text-violet-600" />
            Open lab workspace
            <ArrowRight size={14} className="text-slate-400 dark:text-slate-500" />
          </Link>
        }
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
        {/* Gate receiving */}
        <div className={cardShell}>
          <CardHeader
            icon={<Truck size={16} />}
            title="Gate receiving"
            subtitle="Supplier, purchase order and weighbridge capture"
          />
          <form onSubmit={submitIntake} className="space-y-4">
            <Field label="Supplier" required>
              <Select
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value);
                  setPurchaseOrderId('');
                }}
                required
              >
                <option value="">Select supplier</option>
                {(suppliersQ.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.type})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Purchase order" hint="Optional — only approved / partially received POs for this supplier">
              <Select
                value={purchaseOrderId}
                onChange={(e) => setPurchaseOrderId(e.target.value)}
                disabled={!supplierId}
              >
                <option value="">No purchase order</option>
                {(openPosQ.data ?? []).map((p) => {
                  const remaining = Number(p.quantityQ) - Number(p.receivedQ);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.poNo} — {fmtQ(remaining)} q remaining @ {fmtBirr(p.pricePerQBirr)}/q
                    </option>
                  );
                })}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Delivery date" required>
                <TextInput
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  required
                />
              </Field>
              <Field label="Truck plate" required hint="Verified at the gate">
                <TextInput
                  value={truckPlate}
                  onChange={(e) => setTruckPlate(e.target.value)}
                  placeholder="AA-12345"
                  required
                />
              </Field>
            </div>

            <Field label="Wheat type" required>
              <Select value={wheatCategory} onChange={(e) => setWheatCategory(e.target.value)}>
                <option value="SOFT">Soft wheat</option>
                <option value="HARD">Hard wheat</option>
                <option value="FOREIGN">Foreign (imported)</option>
              </Select>
            </Field>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                <Scale size={15} className="text-violet-600" />
                Weighbridge <span className="text-xs font-medium text-slate-400 dark:text-slate-500">(optional)</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Gross (kg)">
                  <NumberInput
                    value={grossKg}
                    onChange={(e) => setGrossKg(e.target.value)}
                    placeholder="e.g. 32 450"
                    min={0}
                    step={1}
                  />
                </Field>
                <Field label="Tare (kg)">
                  <NumberInput
                    value={tareKg}
                    onChange={(e) => setTareKg(e.target.value)}
                    placeholder="e.g. 12 300"
                    min={0}
                    step={1}
                  />
                </Field>
              </div>
              {weighbridge.valid ? (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-white dark:bg-slate-800 px-3 py-2 text-sm">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Net weight</span>
                  <span className="tnum text-base font-extrabold text-slate-900 dark:text-slate-100">
                    {Number(weighbridge.net).toLocaleString('en-US')} kg
                    <span className="ml-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                      ≈ {fmtQ(weighbridge.net! / 100)} q
                    </span>
                  </span>
                </div>
              ) : null}
              {weightBagMismatch ? (
                <p className="mt-2 text-xs font-semibold text-advisory-text">
                  Net weight ({fmtQ(weighbridge.net! / 100)} q) differs from bag count ({fmtQ(bagQuintals)} q) by
                  more than 1% — verify at the gate.
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Bag count" required hint="1 bag = 1 quintal">
                <NumberInput
                  value={bagCount}
                  onChange={(e) => setBagCount(e.target.value)}
                  placeholder="e.g. 320"
                  min={1}
                  step={1}
                  className="text-xl"
                />
              </Field>
              <Field label="Quick moisture (%)" hint="Gate-side probe reading">
                <NumberInput
                  value={moistureQuick}
                  onChange={(e) => setMoistureQuick(e.target.value)}
                  placeholder="e.g. 12.5"
                  min={0}
                  max={100}
                  step={0.1}
                />
              </Field>
            </div>
            <NumPad value={bagCount} onChange={setBagCount} label="Bag count keypad" />

            <Button type="submit" loading={saving} className="w-full">
              Record intake ({bagCount ? `${fmtQ(Number(bagCount))} q` : '0.0 q'})
            </Button>
          </form>
        </div>

        {/* Lab inspection (compact gate-side check) */}
        <div className={cardShell}>
          <CardHeader
            icon={<FlaskConical size={16} />}
            title="Pre-entry lab inspection"
            subtitle="Quick gate-side check — the full lab workspace is under Incoming Inspection"
          />
          <form onSubmit={submitLab} className="space-y-4">
            <Field label="Delivery under test" required>
              <Select value={labIntakeId} onChange={(e) => setLabIntakeId(e.target.value)} required>
                <option value="">Select delivery</option>
                {(pendingQ.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.intakeNo} — {i.truckPlate} — {fmtQ(i.quintals)} q {i.wheatCategory}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {INTAKE_THRESHOLDS.map((t) => (
                <LabParamField
                  key={t.key}
                  threshold={t}
                  value={labParams[t.key]}
                  onChange={(v) => setLabParams((p) => ({ ...p, [t.key]: v }))}
                />
              ))}
            </div>
            <Button type="submit" loading={saving} className="w-full" variant="secondary">
              Record lab result
            </Button>
          </form>
        </div>
      </div>

      {/* Flagged deliveries */}
      <div className={`mt-4 ${cardShell}`}>
        <CardHeader
          icon={<AlertTriangle size={16} />}
          title="Flagged deliveries"
          subtitle="Require an explicit Quality Head decision — Accept, Conditional accept or Reject"
          action={
            flaggedQ.data && flaggedQ.data.length > 0 ? (
              <span className="rounded-full bg-critical-bg px-3 py-1 text-xs font-bold tabular-nums text-critical-text">
                {flaggedQ.data.length}
              </span>
            ) : undefined
          }
        />
        {flaggedQ.isLoading ? (
          <Spinner label="Loading flagged deliveries..." />
        ) : (
          <DataTable<WheatIntake>
            columns={[
              { key: 'intakeNo', label: 'Intake', render: (r) => <span className="tnum font-bold">{r.intakeNo}</span> },
              { key: 'deliveryDate', label: 'Date', render: (r) => fmtDateTime(r.deliveryDate) },
              { key: 'truckPlate', label: 'Truck', render: (r) => <span className="tnum font-semibold">{r.truckPlate}</span> },
              { key: 'supplierName', label: 'Supplier', render: (r) => r.supplier?.name ?? '-' },
              { key: 'wheatCategory', label: 'Type', render: (r) => r.wheatCategory },
              { key: 'quintals', label: 'Qty (q)', mono: true, render: (r) => fmtQ(r.quintals) },
              { key: 'poNo', label: 'PO', render: (r) => <span className="tnum">{r.purchaseOrder?.poNo ?? '-'}</span> },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{statusLabel(r.status)}</Badge>
              },
              {
                key: 'actions',
                label: 'Decision',
                render: (r) => (
                  <Button variant="secondary" onClick={() => openDecision(r)} className="px-4 py-2 text-sm">
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

      {/* All intakes */}
      <div className={`mt-4 ${cardShell}`}>
        <CardHeader
          icon={<ClipboardList size={16} />}
          title="All intakes"
          subtitle="Most recent deliveries with status, PO link and Quality Head decisions"
        />
        {allQ.isLoading ? (
          <Spinner label="Loading intakes..." />
        ) : (
          <DataTable<WheatIntake>
            columns={[
              { key: 'intakeNo', label: 'Intake', render: (r) => <span className="tnum font-bold">{r.intakeNo}</span> },
              { key: 'deliveryDate', label: 'Date', render: (r) => fmtDateTime(r.deliveryDate) },
              { key: 'truckPlate', label: 'Truck', render: (r) => <span className="tnum font-semibold">{r.truckPlate}</span> },
              { key: 'supplierName', label: 'Supplier', render: (r) => r.supplier?.name ?? '-' },
              { key: 'wheatCategory', label: 'Type', render: (r) => r.wheatCategory },
              { key: 'quintals', label: 'Qty (q)', mono: true, render: (r) => fmtQ(r.quintals) },
              { key: 'poNo', label: 'PO', render: (r) => <span className="tnum">{r.purchaseOrder?.poNo ?? '-'}</span> },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{statusLabel(r.status)}</Badge>
              },
              {
                key: 'decision',
                label: 'Decision',
                render: (r) =>
                  r.decision ? (
                    <Badge tone={DECISION_TONE[r.decision] ?? 'neutral'}>{decisionLabel(r.decision)}</Badge>
                  ) : (
                    <span className="text-slate-400 dark:text-slate-500">—</span>
                  )
              }
            ]}
            rows={allQ.data ?? []}
            emptyTitle="No intakes yet"
            emptySub="Record the first delivery at the gate above."
          />
        )}
      </div>

      {/* Decision modal */}
      {decisionTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className={`w-full max-w-lg rounded-2xl border bg-white p-6 shadow-xl ${
              decision === 'CONDITIONAL' ? 'border-amber-200' : 'border-slate-100'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                    decision === 'REJECT'
                      ? 'bg-critical-bg text-critical-text'
                      : decision === 'CONDITIONAL'
                        ? 'bg-amber-50 text-amber-600'
                        : 'bg-pass-bg text-pass-text'
                  }`}
                >
                  <FileText size={17} />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Quality Head decision</h3>
                  <p className="tnum mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                    {decisionTarget.intakeNo} — {decisionTarget.truckPlate} · {fmtQ(decisionTarget.quintals)} q{' '}
                    {decisionTarget.wheatCategory}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDecisionTarget(null)}
                className="touch rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600"
                aria-label="Close"
              >
                <XCircle size={18} />
              </button>
            </div>

            {decisionTarget.flaggedReasons.length > 0 ? (
              <div className="mt-3 rounded-xl border border-critical-text/30 bg-critical-bg px-3 py-2.5">
                <p className="text-xs font-bold uppercase tracking-wide text-critical-text">Flagged reasons</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-critical-text">
                  {decisionTarget.flaggedReasons.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <ul className="mt-3 space-y-1.5 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 p-3">
              {INTAKE_THRESHOLDS.map((t) => {
                const v = Number((decisionTarget as unknown as Record<string, number | null>)[t.key] ?? NaN);
                const has = Number.isFinite(v);
                const bad = has && paramBreached(t, v);
                return (
                  <li key={t.key} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-300">
                      {t.label} <span className="text-xs text-slate-400 dark:text-slate-500">({t.hint})</span>
                    </span>
                    <span
                      className={`tnum font-bold ${
                        !has ? 'text-slate-400' : bad ? 'text-critical-text' : 'text-pass-text'
                      }`}
                    >
                      {has ? `${v.toFixed(2)}${t.unit}` : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {DECISION_OPTIONS.map((opt) => {
                const active = decision === opt.value;
                const tone =
                  opt.value === 'ACCEPT'
                    ? active
                      ? 'border-pass-text bg-pass-bg text-pass-text'
                      : 'border-line text-slate-500'
                    : opt.value === 'CONDITIONAL'
                      ? active
                        ? 'border-amber-400 bg-amber-50 text-amber-700'
                        : 'border-line text-slate-500'
                      : active
                        ? 'border-critical-text bg-critical-bg text-critical-text'
                        : 'border-line text-slate-500';
                const Icon =
                  opt.value === 'ACCEPT' ? CheckCircle2 : opt.value === 'CONDITIONAL' ? AlertTriangle : XCircle;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setDecision(opt.value);
                      setModalError(null);
                    }}
                    className={`touch rounded-xl border-2 px-3 py-2.5 transition-all ${tone}`}
                    aria-pressed={active}
                  >
                    <span className="flex items-center justify-center gap-1.5 font-bold">
                      <Icon size={16} />
                      {opt.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-medium opacity-80">{opt.sub}</span>
                  </button>
                );
              })}
            </div>

            {decision === 'CONDITIONAL' ? (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                Conditional acceptance — record the conditions in the decision note below. The delivery proceeds
                under supervision.
              </p>
            ) : null}

            <div className="mt-3 space-y-3">
              <Field
                label="Agreed price per quintal (ETB)"
                hint={estimatedInvoice !== null ? `Estimated invoice ≈ ${fmtBirr(estimatedInvoice)}` : 'Used to raise the supplier AP invoice'}
              >
                <div className="relative">
                  <Banknote size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                  <NumberInput
                    value={decisionPrice}
                    onChange={(e) => setDecisionPrice(e.target.value)}
                    placeholder="e.g. 6 500"
                    min={0}
                    step={0.01}
                    className="pl-10"
                  />
                </div>
              </Field>
              <Field label={decision === 'CONDITIONAL' ? 'Decision note (conditions)' : 'Decision note'}>
                <TextArea
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  placeholder={
                    decision === 'CONDITIONAL'
                      ? 'Conditions for acceptance, e.g. re-test after conditioning'
                      : 'Reason for the decision'
                  }
                />
              </Field>
              <Field
                label="Return note — return-to-supplier instructions"
                required={decision === 'REJECT'}
                hint={
                  decision === 'REJECT'
                    ? 'Required: who returns the truck, where, and by when'
                    : 'Optional unless rejecting'
                }
              >
                <TextArea
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                  placeholder="e.g. Truck to return to Bale collection point by 17:00 today; supplier covers transport"
                  className={
                    decision === 'REJECT' && modalError ? 'border-critical-text/60' : undefined
                  }
                />
              </Field>
            </div>

            {modalError ? (
              <p className="mt-2 rounded-lg border border-critical-text/30 bg-critical-bg px-3 py-2 text-sm font-medium text-critical-text">
                {modalError}
              </p>
            ) : null}

            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={() => setDecisionTarget(null)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={submitDecision} loading={saving} className="flex-1">
                Confirm{' '}
                {decision === 'ACCEPT'
                  ? 'accept'
                  : decision === 'CONDITIONAL'
                    ? 'conditional accept'
                    : 'reject'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
