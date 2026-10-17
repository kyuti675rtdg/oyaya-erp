import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Droplets, History, Info, Scale, Warehouse } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { ConditioningTank, DryPoolDetail, TankBlend } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, Field, NumberInput, Select, Spinner, TextInput } from '../components/ui';
import { fmtDateTime, fmtPct, fmtQ } from '../lib/format';
import { useNetwork } from '../store/network';

const cardShell = 'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

function blendSummary(blend: Record<string, number> | null | undefined): string {
  if (!blend) return '—';
  const parts = Object.entries(blend)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${Number(v)}% ${k.toLowerCase()}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

interface RecentFill {
  id: string;
  tankCode: string;
  quintals: number;
  blendRatio: Record<string, number> | null;
  filledAt: string;
}

export function TankFilling() {
  const qc = useQueryClient();
  const online = useNetwork((s) => s.online);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [tankCode, setTankCode] = useState('');
  const [qty, setQty] = useState('');
  const [wheatType, setWheatType] = useState('SOFT');
  const [intakeRef, setIntakeRef] = useState('');
  const [soft, setSoft] = useState('100');
  const [hard, setHard] = useState('0');
  const [foreign, setForeign] = useState('0');

  const tanksQ = useQuery({
    queryKey: ['tanks'],
    queryFn: async () => (await api.get<ConditioningTank[]>(E.tanks)).data,
    refetchInterval: 60000
  });

  const dryPoolQ = useQuery({
    queryKey: ['dry-pool-detail'],
    queryFn: async () => (await api.get<DryPoolDetail>(E.dryPoolDetail)).data
  });

  const blendsQ = useQuery({
    queryKey: ['blends'],
    queryFn: async () => (await api.get<TankBlend[]>(E.blends)).data
  });

  const tanks = tanksQ.data ?? [];
  const dryPool = dryPoolQ.data ?? null;

  const selectedTank = tanks.find((t) => t.code === tankCode) ?? null;
  const freeSpace = selectedTank ? Math.max(0, Number(selectedTank.capacityQ) - Number(selectedTank.levelQ)) : 0;
  const blendSum = (Number(soft) || 0) + (Number(hard) || 0) + (Number(foreign) || 0);
  const q = Number(qty);
  const qtyValid = Number.isFinite(q) && q > 0;
  const exceedsFreeSpace = qtyValid && selectedTank !== null && q > freeSpace + 0.0001;
  const exceedsDryPool = qtyValid && dryPool !== null && q > Number(dryPool.balanceQ) + 0.0001;

  const newLevel = selectedTank && qtyValid ? Math.min(Number(selectedTank.capacityQ), Number(selectedTank.levelQ) + q) : 0;
  const newPct = selectedTank && Number(selectedTank.capacityQ) > 0 ? (newLevel / Number(selectedTank.capacityQ)) * 100 : 0;

  const recentFills = useMemo<RecentFill[]>(() => {
    const rows: RecentFill[] = [];
    for (const b of blendsQ.data ?? []) {
      for (const h of b.history ?? []) {
        rows.push({
          id: h.id,
          tankCode: b.tankCode,
          quintals: h.quintals,
          blendRatio: h.blendRatio,
          filledAt: h.filledAt
        });
      }
    }
    return rows.sort((a, b) => +new Date(b.filledAt) - +new Date(a.filledAt)).slice(0, 15);
  }, [blendsQ.data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!tankCode) {
      setNotice({ ok: false, text: 'Select a destination tank.' });
      return;
    }
    if (!qtyValid) {
      setNotice({ ok: false, text: 'Enter a positive quantity in quintals.' });
      return;
    }
    if (exceedsFreeSpace) {
      setNotice({
        ok: false,
        text: `Quantity exceeds free space in Tank ${tankCode.replace('TANK_', '')} (${fmtQ(freeSpace)} q available).`
      });
      return;
    }
    if (exceedsDryPool) {
      setNotice({
        ok: false,
        text: `Quantity exceeds dry pool availability (${fmtQ(dryPool?.balanceQ)} q available).`
      });
      return;
    }
    if (blendSum !== 100) {
      setNotice({ ok: false, text: `Blend ratio must sum to 100% (currently ${blendSum}%).` });
      return;
    }
    setSaving(true);
    try {
      const r = await submitOrQueue('tank-fill', E.tankFills(tankCode), {
        tankCode,
        quintals: q,
        blendRatio: { soft: Number(soft), hard: Number(hard), foreign: Number(foreign) },
        wheatType,
        intakeId: intakeRef.trim() || undefined
      });
      setNotice({
        ok: true,
        text: r.queued
          ? 'Fill saved offline — will sync automatically when back online.'
          : `Fill recorded — Tank ${tankCode.replace('TANK_', '')} is now at ${fmtQ(newLevel)} / ${fmtQ(selectedTank?.capacityQ)} q.`
      });
      setQty('');
      setIntakeRef('');
      qc.invalidateQueries({ queryKey: ['tanks'] });
      qc.invalidateQueries({ queryKey: ['blends'] });
      qc.invalidateQueries({ queryKey: ['dry-pool-detail'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record fill.' });
    } finally {
      setSaving(false);
    }
  };

  const loading = tanksQ.isLoading || dryPoolQ.isLoading;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink dark:text-white">Tank Filling &amp; Batch Allocation</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Allocate wheat from the dry pool into a conditioning tank — batch numbers are assigned when conditioning starts
          </p>
        </div>
        <Link
          to="/tanks"
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-white dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          <ArrowLeft size={16} /> Back to tanks
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
          You are offline — fills will be queued and synced automatically. Free space is checked against the last loaded data.
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading storage data..." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Left: allocation form */}
          <div className={`${cardShell} lg:col-span-2`}>
            <CardHeader
              icon={<Droplets size={16} />}
              title="Fill allocation"
              subtitle="Source is fixed: dry pool wheat"
            />
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Source">
                  <div className="flex h-12 items-center gap-2 rounded-lg border border-line bg-slate-50 dark:bg-slate-800 px-4">
                    <Warehouse size={16} className="text-slate-500 dark:text-slate-400" />
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Dry Pool{' '}
                      <span className="tabular-nums text-slate-500 dark:text-slate-400">
                        ({dryPool ? `${fmtQ(dryPool.balanceQ)} q available` : '—'})
                      </span>
                    </span>
                  </div>
                </Field>
                <Field label="Destination tank" required>
                  <Select value={tankCode} onChange={(e) => setTankCode(e.target.value)} required>
                    <option value="">Select tank</option>
                    {tanks.map((t) => {
                      const free = Number(t.capacityQ) - Number(t.levelQ);
                      const full = free <= 0.0001;
                      return (
                        <option key={t.code} value={t.code} disabled={full}>
                          Tank {t.code.replace('TANK_', '')} — {full ? 'full' : `${fmtQ(free)} q free`}
                        </option>
                      );
                    })}
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field
                  label="Quantity (quintals)"
                  required
                  hint={
                    selectedTank
                      ? `Free space in Tank ${tankCode.replace('TANK_', '')}: ${fmtQ(freeSpace)} q`
                      : 'Select a tank to see free space'
                  }
                >
                  <NumberInput value={qty} onChange={(e) => setQty(e.target.value)} min={0} step="0.1" placeholder="0.0" />
                  {exceedsFreeSpace ? (
                    <span className="mt-1 block text-xs font-semibold text-critical-text">
                      Exceeds free space ({fmtQ(freeSpace)} q).
                    </span>
                  ) : null}
                  {exceedsDryPool ? (
                    <span className="mt-1 block text-xs font-semibold text-critical-text">
                      Exceeds dry pool balance ({fmtQ(dryPool?.balanceQ)} q).
                    </span>
                  ) : null}
                </Field>
                <Field label="Wheat type">
                  <Select value={wheatType} onChange={(e) => setWheatType(e.target.value)}>
                    <option value="SOFT">Soft wheat</option>
                    <option value="HARD">Hard wheat</option>
                    <option value="FOREIGN">Foreign (imported)</option>
                  </Select>
                </Field>
              </div>

              <Field
                label="Blend ratio (%)"
                required
                hint="Soft + hard + foreign must equal 100%"
              >
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Soft</span>
                    <NumberInput value={soft} onChange={(e) => setSoft(e.target.value)} min={0} max={100} placeholder="0" />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Hard</span>
                    <NumberInput value={hard} onChange={(e) => setHard(e.target.value)} min={0} max={100} placeholder="0" />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Foreign</span>
                    <NumberInput value={foreign} onChange={(e) => setForeign(e.target.value)} min={0} max={100} placeholder="0" />
                  </div>
                </div>
                <span
                  className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
                    blendSum === 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  }`}
                >
                  Sum: {blendSum}%{blendSum === 100 ? ' — valid' : ' (must equal 100)'}
                </span>
              </Field>

              <Field label="Intake reference" hint="Optional link to intake">
                <TextInput value={intakeRef} onChange={(e) => setIntakeRef(e.target.value)} placeholder="e.g. INT-2026-0142" />
              </Field>

              {/* Live preview */}
              {selectedTank ? (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
                  <p className="mb-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                    Preview — Tank {tankCode.replace('TANK_', '')}
                  </p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400">
                      Current: <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{fmtQ(selectedTank.levelQ)} q</span>
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      After: <span className="font-bold tabular-nums text-slate-900 dark:text-slate-100">{fmtQ(newLevel)} q</span>
                    </span>
                  </div>
                  <div
                    className="mt-2 h-4 overflow-hidden rounded-full bg-slate-200"
                    role="progressbar"
                    aria-valuenow={Math.round(newPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Tank ${tankCode.replace('TANK_', '')} level after fill`}
                  >
                    <div className="h-full rounded-full bg-harvest transition-all duration-300" style={{ width: `${Math.min(100, newPct)}%` }} />
                  </div>
                  <p className="mt-1 text-right text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">{newPct.toFixed(1)}% full</p>
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <Info size={13} className="mt-0.5 shrink-0" />
                    Batch No. PB-YYYY-XXXX is assigned when conditioning starts — the fill itself does not create a batch.
                  </p>
                </div>
              ) : null}

              <Button type="submit" loading={saving} className="w-full">
                Record fill
              </Button>
            </form>
          </div>

          {/* Right: availability summary */}
          <div className="space-y-4">
            <div className={cardShell}>
              <CardHeader icon={<Warehouse size={16} />} title="Dry pool" subtitle="Source availability" />
              {dryPool ? (
                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-3xl font-bold tabular-nums text-ink dark:text-white">{fmtQ(dryPool.balanceQ)}</span>
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                      of <span className="font-semibold tabular-nums">{fmtQ(dryPool.capacityQ)} q</span>
                    </span>
                  </div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className="h-full rounded-full bg-harvest" style={{ width: `${Math.min(100, Number(dryPool.pct) || 0)}%` }} />
                  </div>
                  <p className="mt-1 text-right text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">{fmtPct(dryPool.pct, 0)} full</p>
                  {dryPool.breakdown && Object.keys(dryPool.breakdown).length > 0 ? (
                    <div className="mt-3 space-y-1.5 border-t border-slate-100 dark:border-slate-700 pt-3">
                      {Object.entries(dryPool.breakdown).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-sm">
                          <span className="font-medium capitalize text-slate-600 dark:text-slate-300">{k}</span>
                          <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{fmtQ(v)} q</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Dry pool data unavailable.</p>
              )}
            </div>

            <div className={cardShell}>
              <CardHeader icon={<Scale size={16} />} title="Tank free space" subtitle="Destination capacity" />
              <div className="space-y-3">
                {tanks.map((t) => {
                  const free = Math.max(0, Number(t.capacityQ) - Number(t.levelQ));
                  const pct = Number(t.capacityQ) > 0 ? (free / Number(t.capacityQ)) * 100 : 0;
                  return (
                    <div key={t.code}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">Tank {t.code.replace('TANK_', '')}</span>
                        <span className="font-bold tabular-nums text-slate-900 dark:text-slate-100">{fmtQ(free)} q</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                        <div
                          className={`h-full rounded-full ${free <= 0.0001 ? 'bg-slate-300' : 'bg-harvest'}`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent fills */}
      <div className={`${cardShell} mt-4`}>
        <CardHeader icon={<History size={16} />} title="Recent fills" subtitle="Latest tank fills with blend ratios" />
        {blendsQ.isLoading ? (
          <Spinner label="Loading fill history..." />
        ) : recentFills.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No fills recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="pb-2 pr-4 font-semibold">Date</th>
                  <th className="pb-2 pr-4 font-semibold">Tank</th>
                  <th className="pb-2 pr-4 text-right font-semibold">Quintals</th>
                  <th className="pb-2 font-semibold">Blend</th>
                </tr>
              </thead>
              <tbody>
                {recentFills.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{fmtDateTime(r.filledAt)}</td>
                    <td className="py-2 pr-4 font-semibold text-slate-800 dark:text-slate-100">Tank {r.tankCode.replace('TANK_', '')}</td>
                    <td className="py-2 pr-4 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">{fmtQ(r.quintals)}</td>
                    <td className="py-2 text-slate-600 dark:text-slate-300 tabular-nums">{blendSummary(r.blendRatio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
