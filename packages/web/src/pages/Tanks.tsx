import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Droplets, Droplet, History, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { ConditioningTank, TankBlend } from '../types';
import { TankGauge } from '../components/TankGauge';
import { CardHeader } from '../components/CardHeader';
import { Button, Field, NumberInput, Select, Spinner, TextInput } from '../components/ui';
import { fmtDateTime, fmtQ } from '../lib/format';
import { useNetwork } from '../store/network';

const cardShell = 'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const statusStyles: Record<string, string> = {
  Empty: 'bg-slate-100 text-slate-600',
  Filling: 'bg-blue-100 text-blue-700',
  Conditioning: 'bg-amber-100 text-amber-800',
  Ready: 'bg-emerald-100 text-emerald-700',
  'In Use': 'bg-violet-100 text-violet-700',
  Cleaning: 'bg-slate-200 text-slate-500'
};

function eventBadgeStyle(event: string): string {
  const e = event.toLowerCase();
  if (e.includes('fill')) return 'bg-blue-100 text-blue-700';
  if (e.includes('empty')) return 'bg-slate-200 text-slate-700';
  if (e.includes('ready')) return 'bg-emerald-100 text-emerald-700';
  if (e.includes('clean')) return 'bg-slate-100 text-slate-600';
  if (e.includes('condition') || e.includes('cycle') || e.includes('batch')) return 'bg-amber-100 text-amber-800';
  if (e.includes('release') || e.includes('use') || e.includes('mill')) return 'bg-violet-100 text-violet-700';
  return 'bg-slate-100 text-slate-600';
}

function blendSummary(blend: Record<string, number> | null | undefined): string | null {
  if (!blend) return null;
  const parts = Object.entries(blend)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${Number(v)}% ${k.toLowerCase()}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

interface TankEventRow {
  event: string;
  quintals: number | null;
  note: string | null;
  occurredAt: string;
}

/** Collapsible event timeline per tank; fetches only when expanded. */
function TankTimeline({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const eventsQ = useQuery({
    queryKey: ['tank-events', code],
    queryFn: async () => (await api.get<TankEventRow[]>(E.tankEvents(code))).data,
    enabled: open
  });
  const events = eventsQ.data ?? [];

  return (
    <div className="mt-3 border-t border-slate-100 dark:border-slate-700 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900"
      >
        <span className="inline-flex items-center gap-1.5">
          <History size={15} /> Event timeline
        </span>
        <span className={`transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open ? (
        eventsQ.isLoading ? (
          <Spinner label="Loading events..." />
        ) : events.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No events recorded for this tank yet.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {events.map((ev, i) => (
              <li key={i} className="flex items-start gap-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${eventBadgeStyle(ev.event)}`}
                >
                  {ev.event}
                </span>
                <div className="min-w-0 text-sm">
                  <p className="tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                    {ev.quintals !== null && ev.quintals !== undefined ? `${fmtQ(ev.quintals)} q` : '—'}
                    <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">{fmtDateTime(ev.occurredAt)}</span>
                  </p>
                  {ev.note ? <p className="truncate text-xs text-slate-500 dark:text-slate-400">{ev.note}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}

function TankCard({
  tank,
  blend,
  onFill,
  onEmpty,
  onMarkReady,
  onToggleCleaning,
  busy
}: {
  tank: ConditioningTank;
  blend: Record<string, number> | null;
  onFill: (code: string) => void;
  onEmpty: (tank: ConditioningTank) => void;
  onMarkReady: (code: string) => void;
  onToggleCleaning: (tank: ConditioningTank) => void;
  busy: boolean;
}) {
  const shortCode = tank.code.replace('TANK_', '');
  const isCleaning = tank.status === 'Cleaning';

  return (
    <div className={cardShell}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusStyles[tank.status] ?? 'bg-slate-100 text-slate-600'}`}
        >
          {tank.status}
        </span>
        {tank.activeCycle ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">
            <Sparkles size={12} />
            <span className="tabular-nums">
              {tank.activeCycle.batchNo} · {tank.activeCycle.elapsedHrs}h / {tank.activeCycle.requiredHrs}h
            </span>
          </span>
        ) : null}
      </div>

      <TankGauge
        code={shortCode}
        name={tank.name}
        capacityQ={tank.capacityQ}
        currentQ={tank.levelQ}
        fillStartedAt={tank.lastFillAt}
        restGuidance={
          tank.elapsedHrs === null
            ? 'No fill recorded yet'
            : `Conditioning for ${tank.elapsedHrs}h — advisory rest only`
        }
      />

      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        <span className="font-semibold text-slate-800 dark:text-slate-100">Level:</span>{' '}
        <span className="tabular-nums font-bold text-slate-900 dark:text-slate-100">
          {fmtQ(tank.levelQ)} / {fmtQ(tank.capacityQ)} q
        </span>
        {blend ? (
          <>
            <br />
            <span className="font-semibold text-slate-800 dark:text-slate-100">Blend:</span>{' '}
            <span className="tabular-nums">{blendSummary(blend)}</span>
          </>
        ) : null}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => onFill(tank.code)} disabled={busy} className="!px-3 text-sm">
          <Droplet size={15} /> Fill
        </Button>
        <Button variant="secondary" onClick={() => onEmpty(tank)} disabled={busy} className="!px-3 text-sm">
          Empty
        </Button>
        <Button variant="secondary" onClick={() => onMarkReady(tank.code)} disabled={busy} className="!px-3 text-sm">
          <CheckCircle2 size={15} /> Mark Ready
        </Button>
        <Button variant="secondary" onClick={() => onToggleCleaning(tank)} disabled={busy} className="!px-3 text-sm">
          {isCleaning ? 'End Cleaning' : 'Start Cleaning'}
        </Button>
      </div>

      <TankTimeline code={tank.code} />
    </div>
  );
}

export function Tanks() {
  const qc = useQueryClient();
  const online = useNetwork((s) => s.online);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const fillFormRef = useRef<HTMLDivElement>(null);

  // Fill form
  const [fillTankCode, setFillTankCode] = useState('');
  const [fillQty, setFillQty] = useState('');
  const [fillWheatType, setFillWheatType] = useState('SOFT');
  const [fillIntakeId, setFillIntakeId] = useState('');
  const [blendSoft, setBlendSoft] = useState('100');
  const [blendHard, setBlendHard] = useState('0');
  const [blendForeign, setBlendForeign] = useState('0');

  // Empty modal
  const [emptyTank, setEmptyTank] = useState<ConditioningTank | null>(null);
  const [emptyQty, setEmptyQty] = useState('');
  const [emptyPartial, setEmptyPartial] = useState(false);

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

  const blendsQ = useQuery({
    queryKey: ['blends'],
    queryFn: async () => (await api.get<TankBlend[]>(E.blends)).data
  });

  const tanks = tanksQ.data ?? [];
  const blendByTank = useMemo(() => {
    const m: Record<string, Record<string, number> | null> = {};
    for (const b of blendsQ.data ?? []) m[b.tankCode] = b.blend;
    return m;
  }, [blendsQ.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tanks'] });
    qc.invalidateQueries({ queryKey: ['blends'] });
  };

  const blendSum = (Number(blendSoft) || 0) + (Number(blendHard) || 0) + (Number(blendForeign) || 0);

  const quickFill = (code: string) => {
    setFillTankCode(code);
    setNotice(null);
    fillFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const submitFill = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const q = Number(fillQty);
    if (!fillTankCode || !Number.isFinite(q) || q <= 0) {
      setNotice({ ok: false, text: 'Select a tank and enter a positive quantity.' });
      return;
    }
    if (blendSum !== 100) {
      setNotice({ ok: false, text: `Blend ratio must sum to 100% (currently ${blendSum}%).` });
      return;
    }
    setSaving(true);
    try {
      const r = await submitOrQueue('tank-fill', E.tankFills(fillTankCode), {
        tankCode: fillTankCode,
        quintals: q,
        blendRatio: { soft: Number(blendSoft), hard: Number(blendHard), foreign: Number(blendForeign) },
        wheatType: fillWheatType,
        intakeId: fillIntakeId.trim() || undefined
      });
      setNotice({
        ok: true,
        text: r.queued
          ? 'Fill saved offline — will sync automatically when back online.'
          : 'Tank fill recorded. Batch number is assigned when conditioning starts.'
      });
      setFillQty('');
      setFillIntakeId('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record fill.' });
    } finally {
      setSaving(false);
    }
  };

  const submitEmptyModal = async (e: FormEvent) => {
    e.preventDefault();
    if (!emptyTank) return;
    setNotice(null);
    const q = Number(emptyQty);
    if (!Number.isFinite(q) || q <= 0) {
      setNotice({ ok: false, text: 'Enter a positive quantity to empty.' });
      return;
    }
    setSaving(true);
    try {
      const r = await submitOrQueue('tank-empty', E.tankEmpty(emptyTank.code), {
        tankCode: emptyTank.code,
        quintals: q,
        partial: emptyPartial || q < Number(emptyTank.levelQ) - 0.01
      });
      setNotice({
        ok: true,
        text: r.queued
          ? 'Emptying saved offline — will sync automatically when back online.'
          : 'Tank emptying recorded. A 1–2 quintal residual is tolerated.'
      });
      setEmptyTank(null);
      setEmptyQty('');
      setEmptyPartial(false);
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

  const toggleCleaning = async (tank: ConditioningTank) => {
    setNotice(null);
    const start = tank.status !== 'Cleaning';
    setSaving(true);
    try {
      const r = await submitOrQueue('tank-cleaning', E.tankCleaning(tank.code), { start });
      setNotice({
        ok: true,
        text: r.queued
          ? `Cleaning ${start ? 'start' : 'end'} saved offline — will sync automatically.`
          : start
            ? `Tank ${tank.code.replace('TANK_', '')} cleaning started.`
            : `Tank ${tank.code.replace('TANK_', '')} cleaning ended.`
      });
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to update cleaning state.' });
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink dark:text-white">Conditioning Tanks</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Wet conditioning tanks A, B and C — partial fills supported, advisory rest guidance only
          </p>
        </div>
        <Link
          to="/tank-filling"
          className="inline-flex items-center gap-2 rounded-lg bg-harvest px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700"
        >
          <Droplets size={16} /> Open filling workspace
        </Link>
      </div>

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

      {!online ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          You are offline — tank fills, emptying, cleaning and washing logs will be queued and synced automatically.
        </div>
      ) : null}

      {tanksQ.isLoading ? (
        <Spinner label="Loading tanks..." />
      ) : tanksQ.isError ? (
        <p className="rounded-xl border border-critical-text/30 bg-critical-bg px-4 py-3 text-sm font-medium text-critical-text">
          Failed to load tanks. Please retry.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {tanks.map((t) => (
            <TankCard
              key={t.code}
              tank={t}
              blend={blendByTank[t.code] ?? null}
              onFill={quickFill}
              onEmpty={(tank) => {
                setEmptyTank(tank);
                setEmptyQty('');
                setEmptyPartial(false);
              }}
              onMarkReady={markReady}
              onToggleCleaning={toggleCleaning}
              busy={saving}
            />
          ))}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div ref={fillFormRef} id="tank-fill-form" className={`${cardShell} scroll-mt-4`}>
          <CardHeader
            icon={<Droplet size={16} />}
            title="Tank fill"
            subtitle="Server validates capacity — a fill that would overflow is rejected"
          />
          <form onSubmit={submitFill} className="space-y-4">
            <Field label="Tank" required>
              <Select value={fillTankCode} onChange={(e) => setFillTankCode(e.target.value)} required>
                <option value="">Select tank</option>
                {tanks.map((t) => (
                  <option key={t.code} value={t.code}>
                    Tank {t.code.replace('TANK_', '')} ({fmtQ(t.capacityQ)} q, {fmtQ(t.levelQ)} q filled)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity (quintals)" required>
              <NumberInput value={fillQty} onChange={(e) => setFillQty(e.target.value)} min={0} step="0.1" placeholder="0.0" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Wheat type">
                <Select value={fillWheatType} onChange={(e) => setFillWheatType(e.target.value)}>
                  <option value="SOFT">Soft wheat</option>
                  <option value="HARD">Hard wheat</option>
                  <option value="FOREIGN">Foreign (imported)</option>
                </Select>
              </Field>
              <Field label="Intake reference" hint="Optional link to intake">
                <TextInput value={fillIntakeId} onChange={(e) => setFillIntakeId(e.target.value)} placeholder="e.g. INT-2026-0142" />
              </Field>
            </div>
            <Field
              label="Blend ratio (%)"
              required
              hint={`Soft + hard + foreign must equal 100%. Current sum: ${blendSum}%`}
            >
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Soft</span>
                  <NumberInput value={blendSoft} onChange={(e) => setBlendSoft(e.target.value)} min={0} max={100} placeholder="0" />
                </div>
                <div>
                  <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Hard</span>
                  <NumberInput value={blendHard} onChange={(e) => setBlendHard(e.target.value)} min={0} max={100} placeholder="0" />
                </div>
                <div>
                  <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Foreign</span>
                  <NumberInput value={blendForeign} onChange={(e) => setBlendForeign(e.target.value)} min={0} max={100} placeholder="0" />
                </div>
              </div>
              <span
                className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
                  blendSum === 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                }`}
              >
                Sum: {blendSum}%
              </span>
            </Field>
            <Button type="submit" loading={saving} className="w-full">
              Record fill
            </Button>
          </form>
        </div>

        <div className={cardShell}>
          <CardHeader
            icon={<CalendarClock size={16} />}
            title="Washing sub-process"
            subtitle="Log a washing cycle for a tank or silo"
          />
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
        </div>
      </div>

      {emptyTank ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setEmptyTank(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Empty tank ${emptyTank.code.replace('TANK_', '')}`}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-ink dark:text-white">Empty Tank {emptyTank.code.replace('TANK_', '')}</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Current level: <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{fmtQ(emptyTank.levelQ)} q</span>
            </p>
            <form onSubmit={submitEmptyModal} className="mt-4 space-y-4">
              <Field label="Quantity (quintals)" required hint="1–2 q residual after emptying is tolerated, not flagged.">
                <NumberInput
                  value={emptyQty}
                  onChange={(e) => setEmptyQty(e.target.value)}
                  min={0}
                  step="0.1"
                  placeholder="0.0"
                  autoFocus
                />
              </Field>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={emptyPartial}
                  onChange={(e) => setEmptyPartial(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-harvest"
                />
                Partial emptying (leave remainder in tank)
              </label>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setEmptyTank(null)} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" loading={saving} className="flex-1">
                  Record
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
