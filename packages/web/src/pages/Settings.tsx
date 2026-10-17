import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { DriverTripRate, PieceRateConfig, QcThreshold, StorageLocation } from '../types';
import { Button, Card, Field, NumberInput, SectionTitle, Spinner } from '../components/ui';
import { useNetwork } from '../store/network';

function useNotice() {
  return useState<{ ok: boolean; text: string } | null>(null);
}

function Notice({ notice }: { notice: { ok: boolean; text: string } | null }) {
  if (!notice) return null;
  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
        notice.ok
          ? 'border-pass-text/30 bg-pass-bg text-pass-text'
          : 'border-critical-text/30 bg-critical-bg text-critical-text'
      }`}
    >
      {notice.text}
    </div>
  );
}

function ThresholdsEditor() {
  const qc = useQueryClient();
  const online = useNetwork((s) => s.online);
  const [notice, setNotice] = useNotice();
  const [drafts, setDrafts] = useState<Record<string, { min: string; max: string }>>({});
  const [savingId, setSavingId] = useState('');

  const q = useQuery({
    queryKey: ['qc-thresholds'],
    queryFn: async () => (await api.get<QcThreshold[]>(E.qcThresholds)).data
  });

  const save = async (t: QcThreshold) => {
    const d = drafts[t.id];
    setNotice(null);
    if (!online) {
      setNotice({ ok: false, text: 'Configuration changes require a live connection.' });
      return;
    }
    setSavingId(t.id);
    try {
      const min = d?.min === undefined || d.min === '' ? null : Number(d.min);
      const max = d?.max === undefined || d.max === '' ? null : Number(d.max);
      if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) {
        setNotice({ ok: false, text: `${t.param}: min and max must be numeric or empty.` });
        return;
      }
      await api.put(`${E.qcThresholds}/${t.id}`, { minValue: min, maxValue: max });
      setDrafts((p) => {
        const next = { ...p };
        delete next[t.id];
        return next;
      });
      setNotice({ ok: true, text: `Threshold ${t.param} saved.` });
      qc.invalidateQueries({ queryKey: ['qc-thresholds'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSavingId('');
    }
  };

  return (
    <Card className="p-5">
      <h3 className="text-base font-bold text-ink">Quality thresholds</h3>
      <p className="mb-4 mt-0.5 text-sm text-slate-500">Intake acceptance limits and in-process standard ranges.</p>
      <Notice notice={notice} />
      {q.isLoading ? (
        <Spinner label="Loading thresholds..." />
      ) : (
        <div className="space-y-4">
          {(q.data ?? []).map((t) => {
            const d = drafts[t.id] ?? { min: String(t.minValue ?? ''), max: String(t.maxValue ?? '') };
            return (
              <div key={t.id} className="rounded-lg border border-line p-3">
                <p className="mb-2 text-sm font-semibold text-ink">
                  {t.param} <span className="ml-1 text-xs font-normal text-slate-500">({t.category}{t.unit ? `, ${t.unit}` : ''})</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Min">
                    <NumberInput
                      value={d.min}
                      onChange={(e) => setDrafts((p) => ({ ...p, [t.id]: { ...d, min: e.target.value } }))}
                      step="0.01"
                    />
                  </Field>
                  <Field label="Max">
                    <NumberInput
                      value={d.max}
                      onChange={(e) => setDrafts((p) => ({ ...p, [t.id]: { ...d, max: e.target.value } }))}
                      step="0.01"
                    />
                  </Field>
                </div>
                <Button onClick={() => save(t)} loading={savingId === t.id} variant="secondary" className="mt-2 w-full">
                  Save
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function StorageEditor() {
  const qc = useQueryClient();
  const online = useNetwork((s) => s.online);
  const [notice, setNotice] = useNotice();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState('');

  const q = useQuery({
    queryKey: ['storage-locations'],
    queryFn: async () => (await api.get<StorageLocation[]>(E.storageLocations)).data
  });

  const save = async (loc: StorageLocation) => {
    const raw = drafts[loc.id] ?? String(loc.capacityQ);
    setNotice(null);
    if (!online) {
      setNotice({ ok: false, text: 'Configuration changes require a live connection.' });
      return;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) {
      setNotice({ ok: false, text: `${loc.name}: capacity must be a positive number.` });
      return;
    }
    setSavingId(loc.id);
    try {
      await api.put(`${E.storageLocations}/${loc.id}`, { capacityQ: v });
      setDrafts((p) => {
        const next = { ...p };
        delete next[loc.id];
        return next;
      });
      setNotice({ ok: true, text: `${loc.name} capacity saved.` });
      qc.invalidateQueries({ queryKey: ['storage-locations'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSavingId('');
    }
  };

  return (
    <Card className="p-5">
      <h3 className="text-base font-bold text-ink">Storage capacities</h3>
      <p className="mb-4 mt-0.5 text-sm text-slate-500">Dry-storage pool and conditioning tank capacities (quintals).</p>
      <Notice notice={notice} />
      {q.isLoading ? (
        <Spinner label="Loading storage..." />
      ) : (
        <div className="space-y-4">
          {(q.data ?? []).map((loc) => (
            <div key={loc.id} className="rounded-lg border border-line p-3">
              <Field label={`${loc.name} (${loc.code})`} hint="Quintals">
                <NumberInput
                  value={drafts[loc.id] ?? String(loc.capacityQ)}
                  onChange={(e) => setDrafts((p) => ({ ...p, [loc.id]: e.target.value }))}
                  step="0.1"
                  min={0}
                />
              </Field>
              <Button onClick={() => save(loc)} loading={savingId === loc.id} variant="secondary" className="mt-2 w-full">
                Save
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RatesEditor() {
  const qc = useQueryClient();
  const online = useNetwork((s) => s.online);
  const [notice, setNotice] = useNotice();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState('');

  const ratesQ = useQuery({
    queryKey: ['piece-rates'],
    queryFn: async () => (await api.get<PieceRateConfig[]>(E.pieceRates)).data
  });
  const tripQ = useQuery({
    queryKey: ['driver-trip-rate'],
    queryFn: async () => (await api.get<DriverTripRate | null>(E.driverTripRate)).data
  });

  const rateByStage = new Map((ratesQ.data ?? []).map((r) => [r.stage, r]));

  const saveStage = async (stage: PieceRateConfig['stage']) => {
    const key = `stage:${stage}`;
    const raw = drafts[key] ?? String(rateByStage.get(stage)?.rateBirrPerQ ?? '');
    setNotice(null);
    if (!online) {
      setNotice({ ok: false, text: 'Configuration changes require a live connection.' });
      return;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) {
      setNotice({ ok: false, text: 'Rate must be a positive number.' });
      return;
    }
    setSavingKey(key);
    try {
      await api.post(E.pieceRates, { stage, rateBirrPerQ: v });
      setNotice({ ok: true, text: `Piece rate for ${stage.replace('_', ' ')} saved.` });
      qc.invalidateQueries({ queryKey: ['piece-rates'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSavingKey('');
    }
  };

  const saveTrip = async () => {
    const key = 'trip';
    const raw = drafts[key] ?? String(tripQ.data?.rateBirrPerTrip ?? '');
    setNotice(null);
    if (!online) {
      setNotice({ ok: false, text: 'Configuration changes require a live connection.' });
      return;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) {
      setNotice({ ok: false, text: 'Trip rate must be a positive number.' });
      return;
    }
    setSavingKey(key);
    try {
      await api.post(E.driverTripRate, { rateBirrPerTrip: v });
      setNotice({ ok: true, text: 'Driver trip rate saved.' });
      qc.invalidateQueries({ queryKey: ['driver-trip-rate'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSavingKey('');
    }
  };

  const stages: Array<PieceRateConfig['stage']> = ['UNLOADING', 'GRANARY_DUMPING', 'STORE_MOVEMENT', 'TRUCK_LOADING'];

  return (
    <Card className="p-5">
      <h3 className="text-base font-bold text-ink">Piece & trip rates</h3>
      <p className="mb-4 mt-0.5 text-sm text-slate-500">Birr per quintal for the four labor stages, and the driver trip rate.</p>
      <Notice notice={notice} />
      {ratesQ.isLoading || tripQ.isLoading ? (
        <Spinner label="Loading rates..." />
      ) : (
        <div className="space-y-4">
          {stages.map((stage) => {
            const key = `stage:${stage}`;
            return (
              <div key={stage} className="rounded-lg border border-line p-3">
                <Field label={stage.replace(/_/g, ' ')} hint="ETB per quintal">
                  <NumberInput
                    value={drafts[key] ?? String(rateByStage.get(stage)?.rateBirrPerQ ?? '')}
                    onChange={(e) => setDrafts((p) => ({ ...p, [key]: e.target.value }))}
                    step="0.01"
                    min={0}
                  />
                </Field>
                <Button onClick={() => saveStage(stage)} loading={savingKey === key} variant="secondary" className="mt-2 w-full">
                  Save
                </Button>
              </div>
            );
          })}
          <div className="rounded-lg border border-line p-3">
            <Field label="Driver trip rate" hint="ETB per trip (fixed destination-area rule)">
              <NumberInput
                value={drafts['trip'] ?? String(tripQ.data?.rateBirrPerTrip ?? '')}
                onChange={(e) => setDrafts((p) => ({ ...p, trip: e.target.value }))}
                step="0.01"
                min={0}
              />
            </Field>
            <Button onClick={saveTrip} loading={savingKey === 'trip'} variant="secondary" className="mt-2 w-full">
              Save
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function Settings() {
  return (
    <div>
      <SectionTitle
        title="Settings"
        sub="Quality thresholds, storage capacities and payroll rates — changes apply without code changes"
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ThresholdsEditor />
        <StorageEditor />
        <RatesEditor />
      </div>
    </div>
  );
}
