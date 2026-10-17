import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { ConditioningTank } from '../types';
import { TankGauge } from '../components/TankGauge';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { useNetwork } from '../store/network';

export function Tanks() {
  const qc = useQueryClient();
  const online = useNetwork((s) => s.online);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Fill form
  const [fillTankCode, setFillTankCode] = useState('');
  const [fillQty, setFillQty] = useState('');
  const [fillWheatType, setFillWheatType] = useState('SOFT');

  // Empty form
  const [emptyTankCode, setEmptyTankCode] = useState('');
  const [emptyQty, setEmptyQty] = useState('');

  // Washing log form
  const [washTank, setWashTank] = useState('');
  const [washStart, setWashStart] = useState('');
  const [washEnd, setWashEnd] = useState('');
  const [washDowntime, setWashDowntime] = useState('');
  const [washEquipment, setWashEquipment] = useState('');
  const [washOperators, setWashOperators] = useState('');

  const tanksQ = useQuery({
    queryKey: ['tanks'],
    queryFn: async () => (await api.get<ConditioningTank[]>(E.tanks)).data,
    refetchInterval: 60000
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tanks'] });

  const submitFill = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      const q = Number(fillQty);
      if (!fillTankCode || !Number.isFinite(q) || q <= 0) {
        setNotice({ ok: false, text: 'Select a tank and enter a positive quantity.' });
        return;
      }
      const r = await submitOrQueue('tank-fill', E.tankFills(fillTankCode), {
        tankCode: fillTankCode,
        quintals: q,
        blendRatio: { [fillWheatType.toLowerCase()]: 100 }
      });
      setNotice({
        ok: true,
        text: r.queued ? 'Fill saved offline — will sync automatically.' : 'Tank fill recorded.'
      });
      setFillQty('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record fill.' });
    } finally {
      setSaving(false);
    }
  };

  const submitEmpty = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      const q = Number(emptyQty);
      if (!emptyTankCode || !Number.isFinite(q) || q <= 0) {
        setNotice({ ok: false, text: 'Select a tank and enter a positive quantity.' });
        return;
      }
      const level = tanks.find((t) => t.code === emptyTankCode)?.levelQ ?? 0;
      const r = await submitOrQueue('tank-empty', E.tankEmpty(emptyTankCode), {
        tankCode: emptyTankCode,
        quintals: q,
        partial: q < Number(level) - 0.01
      });
      setNotice({
        ok: true,
        text: r.queued
          ? 'Emptying saved offline — will sync automatically.'
          : 'Tank emptying recorded. A 1–2 quintal residual is tolerated.'
      });
      setEmptyQty('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record emptying.' });
    } finally {
      setSaving(false);
    }
  };

  const markReady = async (tankCode: string) => {
    setNotice(null);
    if (!online) {
      setNotice({
        ok: false,
        text: 'Marking a tank ready requires a live connection — the server must validate current tank state.'
      });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.tankReady(tankCode), {});
      setNotice({ ok: true, text: 'Tank marked ready for milling.' });
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to mark tank ready.' });
    } finally {
      setSaving(false);
    }
  };

  const submitWashing = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      if (!washTank.trim() || !washStart || !washOperators.trim()) {
        setNotice({ ok: false, text: 'Tank/silo, start time and operators are required.' });
        return;
      }
      const operators = washOperators
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
      const r = await submitOrQueue('washing-log', E.washings, {
        tankOrSilo: washTank.trim(),
        startedAt: new Date(washStart).toISOString(),
        endedAt: washEnd ? new Date(washEnd).toISOString() : undefined,
        downtimeMin: washDowntime ? Number(washDowntime) : 0,
        equipmentChange: washEquipment.trim() || undefined,
        operators
      });
      setNotice({
        ok: true,
        text: r.queued ? 'Washing log saved offline — will sync automatically.' : 'Washing sub-process logged.'
      });
      setWashTank('');
      setWashStart('');
      setWashEnd('');
      setWashDowntime('');
      setWashEquipment('');
      setWashOperators('');
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to log washing.' });
    } finally {
      setSaving(false);
    }
  };

  const tanks = tanksQ.data ?? [];

  return (
    <div>
      <SectionTitle
        title="Conditioning Tanks"
        sub="Wet conditioning tanks A, B and C — partial fills supported, advisory rest guidance only"
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

      {tanksQ.isLoading ? (
        <Spinner label="Loading tanks..." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {tanks.map((t) => (
            <div key={t.code}>
              <TankGauge
                code={t.code.replace('TANK_', '')}
                name={t.name}
                capacityQ={t.capacityQ}
                currentQ={t.levelQ}
                fillStartedAt={t.lastFillAt}
                restGuidance={
                  t.elapsedHrs === null ? 'No fill recorded yet' : `Conditioning for ${t.elapsedHrs}h — advisory rest only`
                }
              />
              <Button
                variant="secondary"
                onClick={() => markReady(t.code)}
                loading={saving}
                className="mt-2 w-full"
              >
                Mark ready for milling
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">Tank fill</h3>
          <form onSubmit={submitFill} className="space-y-4">
            <Field label="Tank" required>
              <Select value={fillTankCode} onChange={(e) => setFillTankCode(e.target.value)} required>
                <option value="">Select tank</option>
                {tanks.map((t) => (
                  <option key={t.code} value={t.code}>
                    Tank {t.code.replace('TANK_', '')} ({t.capacityQ} q)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity (quintals)" required>
              <NumberInput value={fillQty} onChange={(e) => setFillQty(e.target.value)} min={0} step="0.1" placeholder="0.0" />
            </Field>
            <Field label="Wheat type">
              <Select value={fillWheatType} onChange={(e) => setFillWheatType(e.target.value)}>
                <option value="SOFT">Soft wheat</option>
                <option value="HARD">Hard wheat</option>
                <option value="FOREIGN">Foreign (imported)</option>
              </Select>
            </Field>
            <Button type="submit" loading={saving} className="w-full">
              Record fill
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">Tank emptying</h3>
          <form onSubmit={submitEmpty} className="space-y-4">
            <Field label="Tank" required>
              <Select value={emptyTankCode} onChange={(e) => setEmptyTankCode(e.target.value)} required>
                <option value="">Select tank</option>
                {tanks.map((t) => (
                  <option key={t.code} value={t.code}>
                    Tank {t.code.replace('TANK_', '')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity (quintals)" required hint="1–2 q residual after emptying is tolerated, not flagged.">
              <NumberInput value={emptyQty} onChange={(e) => setEmptyQty(e.target.value)} min={0} step="0.1" placeholder="0.0" />
            </Field>
            <Button type="submit" loading={saving} variant="secondary" className="w-full">
              Record emptying
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">Washing sub-process</h3>
          <form onSubmit={submitWashing} className="space-y-4">
            <Field label="Tank / silo used" required>
              <TextInput value={washTank} onChange={(e) => setWashTank(e.target.value)} placeholder="Wash tank 1" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start" required>
                <TextInput type="datetime-local" value={washStart} onChange={(e) => setWashStart(e.target.value)} required />
              </Field>
              <Field label="End">
                <TextInput type="datetime-local" value={washEnd} onChange={(e) => setWashEnd(e.target.value)} />
              </Field>
            </div>
            <Field label="Downtime (minutes)">
              <NumberInput value={washDowntime} onChange={(e) => setWashDowntime(e.target.value)} min={0} placeholder="0" />
            </Field>
            <Field label="Equipment changed" hint="Optional">
              <TextInput value={washEquipment} onChange={(e) => setWashEquipment(e.target.value)} placeholder="e.g. replaced sieve" />
            </Field>
            <Field label="Washing operator(s)" required>
              <TextInput value={washOperators} onChange={(e) => setWashOperators(e.target.value)} placeholder="Names, comma separated" required />
            </Field>
            <Button type="submit" loading={saving} variant="secondary" className="w-full">
              Log washing
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
