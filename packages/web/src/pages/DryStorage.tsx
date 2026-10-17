import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  History,
  Layers,
  Package,
  SlidersHorizontal,
  Wheat
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { DryPoolDetail, StorageMovementRow } from '../types';
import { CardHeader } from '../components/CardHeader';
import { SkeletonKpiCard } from '../components/Skeleton';
import { Button, ErrorBox, EmptyState, Field, NumberInput, SectionTitle, Select, TextArea } from '../components/ui';

const cardShell = 'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const pct1 = (n: number) => `${n.toFixed(1)}%`;

const WHEAT_TYPES = ['SOFT', 'HARD', 'FOREIGN'] as const;
const TYPE_COLORS: Record<string, { bar: string; text: string; soft: string }> = {
  SOFT: { bar: 'bg-amber-400', text: 'text-amber-700', soft: 'bg-amber-50' },
  HARD: { bar: 'bg-orange-500', text: 'text-orange-700', soft: 'bg-orange-50' },
  FOREIGN: { bar: 'bg-indigo-500', text: 'text-indigo-700', soft: 'bg-indigo-50' }
};

function directionBadge(direction: string) {
  const d = direction.toUpperCase();
  if (d === 'IN' || d === 'ADJUST_IN')
    return <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">IN</span>;
  if (d === 'OUT' || d === 'ADJUST_OUT')
    return <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-700">OUT</span>;
  return <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">ADJUST</span>;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
        ' ' +
        d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function DryStorage() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [adjQty, setAdjQty] = useState('');
  const [adjType, setAdjType] = useState<string>('');
  const [adjReason, setAdjReason] = useState('');

  const detailQ = useQuery({
    queryKey: ['dry-pool-detail'],
    queryFn: async () => (await api.get<DryPoolDetail>(E.dryPoolDetail)).data,
    refetchInterval: 60000
  });

  const movementsQ = useQuery({
    queryKey: ['dry-pool-movements'],
    queryFn: async () =>
      (await api.get<StorageMovementRow[]>(`${E.movementsFiltered}?locationCode=DRY_POOL`)).data,
    refetchInterval: 60000
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['dry-pool-detail'] });
    qc.invalidateQueries({ queryKey: ['dry-pool-movements'] });
  };

  const submitAdjust = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const q = Number(adjQty);
    if (!Number.isFinite(q) || q === 0) {
      setNotice({ ok: false, text: 'Enter a non-zero quantity. Use + to add, − to remove.' });
      return;
    }
    if (!adjReason.trim()) {
      setNotice({ ok: false, text: 'A reason is required for every stock adjustment.' });
      return;
    }
    setSaving(true);
    try {
      const r = await submitOrQueue('dry-pool-adjust', E.dryPoolAdjust, {
        quintals: q,
        wheatType: adjType || null,
        reason: adjReason.trim()
      });
      setNotice({
        ok: true,
        text: r.queued ? 'Adjustment saved offline — will sync automatically.' : 'Stock adjustment posted.'
      });
      setAdjQty('');
      setAdjType('');
      setAdjReason('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to post adjustment.' });
    } finally {
      setSaving(false);
    }
  };

  const detail = detailQ.data;
  const recent = (movementsQ.data ?? []).slice(0, 8);

  const breakdownBars = detail
    ? WHEAT_TYPES.map((t) => ({
        type: t,
        q: detail.breakdown[t.toLowerCase()] ?? detail.breakdown[t] ?? 0,
        share: detail.balanceQ > 0 ? ((detail.breakdown[t.toLowerCase()] ?? detail.breakdown[t] ?? 0) / detail.balanceQ) * 100 : 0
      }))
    : [];

  return (
    <div className="space-y-5">
      <SectionTitle title="Dry Storage" sub="Dry pool stock, capacity, and manual adjustments" />

      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
          role="alert"
        >
          {notice.text}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {detailQ.isPending && [0, 1, 2, 3].map((i) => <SkeletonKpiCard key={i} />)}
        {detail && (
          <>
            <div className={cardShell}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Total Stock</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <Wheat size={18} />
                </span>
              </div>
              <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-800 dark:text-slate-100">
                {fmt(detail.balanceQ)} <span className="text-sm font-semibold text-slate-400 dark:text-slate-500">Qt</span>
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">of {fmt(detail.capacityQ)} Qt capacity</p>
            </div>

            <div className={cardShell}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Capacity Used</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <BarChart3 size={18} />
                </span>
              </div>
              <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-800 dark:text-slate-100">{pct1(detail.pct)}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Low &lt; 15% · High &gt; 95%</p>
            </div>

            <div className={cardShell}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Wheat Mix</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                  <Layers size={18} />
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                {breakdownBars.map((b) => (
                  <div key={b.type} className="flex items-center gap-2">
                    <span className={`w-12 text-[10px] font-bold uppercase ${TYPE_COLORS[b.type].text}`}>{b.type.slice(0, 4)}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                      <div className={`h-full rounded-full ${TYPE_COLORS[b.type].bar}`} style={{ width: `${Math.min(100, b.share)}%` }} />
                    </div>
                    <span className="w-12 text-right text-[11px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">{pct1(b.share)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={cardShell}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Active Alerts</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                  <AlertTriangle size={18} />
                </span>
              </div>
              <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-800 dark:text-slate-100">{detail.alerts.length}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {detail.alerts.length === 0 ? 'All levels normal' : 'Check the alerts list below'}
              </p>
            </div>
          </>
        )}
      </div>

      {detailQ.isError && <ErrorBox message="Could not load dry pool details." onRetry={() => detailQ.refetch()} />}

      {detail && (
        <>
          {/* Capacity gauge */}
          <div className={cardShell}>
            <CardHeader
              icon={<BarChart3 size={16} />}
              title="Dry Pool Capacity"
              subtitle={`Target: keep between 15% and 95% · conditioning moisture 15.0–16.5%`}
            />
            <div className="relative pt-1">
              <div className="h-5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div
                  className={`h-full rounded-full transition-all ${
                    detail.pct >= 95 ? 'bg-rose-500' : detail.pct < 15 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, detail.pct))}%` }}
                />
              </div>
              {/* threshold markers */}
              <div className="absolute top-1 h-5 w-px bg-slate-400" style={{ left: '15%' }} title="15% low threshold" />
              <div className="absolute top-1 h-5 w-px bg-slate-400" style={{ left: '95%' }} title="95% high threshold" />
            </div>
            <div className="mt-2 flex justify-between text-[11px] font-semibold text-slate-400 dark:text-slate-500">
              <span>15% LOW</span>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">
                {fmt(detail.balanceQ)} / {fmt(detail.capacityQ)} Qt
              </span>
              <span>95% HIGH</span>
            </div>
          </div>

          {/* Breakdown + alerts */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className={cardShell}>
              <CardHeader icon={<Wheat size={16} />} title="Wheat Type Breakdown" subtitle="Share of current dry pool stock" />
              <div className="grid grid-cols-3 gap-3">
                {breakdownBars.map((b) => (
                  <div key={b.type} className={`rounded-xl p-4 ${TYPE_COLORS[b.type].soft}`}>
                    <p className={`text-[11px] font-bold uppercase tracking-wide ${TYPE_COLORS[b.type].text}`}>{b.type}</p>
                    <p className="mt-1 text-xl font-extrabold tabular-nums text-slate-800 dark:text-slate-100">{fmt(b.q)}</p>
                    <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{pct1(b.share)} of total</p>
                  </div>
                ))}
              </div>
            </div>

            <div className={cardShell}>
              <CardHeader icon={<AlertTriangle size={16} />} title="Alerts" subtitle="Threshold and stock warnings" />
              {detail.alerts.length === 0 ? (
                <EmptyState title="No active alerts" sub="Dry pool levels are within normal thresholds." />
              ) : (
                <ul className="space-y-2">
                  {detail.alerts.map((a, i) => (
                    <li
                      key={i}
                      className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${
                        a.level === 'high'
                          ? 'border-rose-200 bg-rose-50 text-rose-800'
                          : a.level === 'low'
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                      <span>{a.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {/* Adjustment form + recent movements */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={cardShell}>
          <CardHeader
            icon={<SlidersHorizontal size={16} />}
            title="Stock Adjustment"
            subtitle="Manual correction — positive adds, negative removes"
          />
          <form onSubmit={submitAdjust} className="space-y-4">
            <Field label="Quantity (Qt, signed)">
              <NumberInput
                value={adjQty}
                onChange={(e) => setAdjQty(e.target.value)}
                placeholder="e.g. 120 or -45"
                step="any"
              />
            </Field>
            <Field label="Wheat type (optional)">
              <Select value={adjType} onChange={(e) => setAdjType(e.target.value)}>
                <option value="">Not specified</option>
                {WHEAT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Reason (required)">
              <TextArea
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                rows={3}
                placeholder="e.g. Spillage correction after intake counting…"
              />
            </Field>
            <Button type="submit" loading={saving} className="w-full">
              <Package size={16} /> Post Adjustment
            </Button>
          </form>
        </div>

        <div className={cardShell}>
          <CardHeader
            icon={<History size={16} />}
            title="Recent Movements"
            subtitle="Last 8 dry pool movements"
            action={
              <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                <CalendarClock size={14} className="mr-1 inline" />
                live
              </span>
            }
          />
          {movementsQ.isPending && <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">Loading movements…</p>}
          {movementsQ.isError && <ErrorBox message="Could not load recent movements." onRetry={() => movementsQ.refetch()} />}
          {movementsQ.data && recent.length === 0 && <EmptyState title="No movements yet" sub="Dry pool movements will appear here." />}
          {recent.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Direction</th>
                    <th className="py-2 pr-3 text-right">Qt</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((m) => (
                    <tr key={m.id} className="border-b border-slate-50 last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 text-slate-600 dark:text-slate-300">{fmtDate(m.movedAt)}</td>
                      <td className="py-2 pr-3">{directionBadge(m.direction)}</td>
                      <td className="py-2 pr-3 text-right font-bold tabular-nums text-slate-800 dark:text-slate-100">{fmt(m.quintals)}</td>
                      <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{m.wheatType ?? '—'}</td>
                      <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{m.reference ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
