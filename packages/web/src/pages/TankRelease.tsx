import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CheckCircle2, Clock3, Droplets, FlaskConical, Timer, Wheat } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { ConditioningCycle, ConditioningTank } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, ErrorBox, Spinner, TextArea } from '../components/ui';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const MOIST_MIN = 15.0;
const MOIST_MAX = 16.5;

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function moistureInRange(m: number | null | undefined): boolean {
  return m != null && m >= MOIST_MIN && m <= MOIST_MAX;
}

/** A tank is ready for release when its cycle finished but it has not been released yet. */
function isAwaitingRelease(t: ConditioningTank): boolean {
  const c = t.activeCycle;
  return t.status === 'Ready' || (c != null && c.completedAt != null && c.releasedAt == null);
}

interface ChecklistState {
  moisture: boolean;
  time: boolean;
  lab: boolean;
  note: string;
  released: boolean;
  saving: boolean;
  error: string | null;
}

function freshChecklist(t: ConditioningTank): ChecklistState {
  const c = t.activeCycle;
  return {
    // Pre-tick when the server value is already in range, but the user must still confirm.
    moisture: moistureInRange(c?.moistureAfter),
    time: (c?.elapsedHrs ?? 0) >= (c?.requiredHrs ?? 0),
    lab: false,
    note: '',
    released: false,
    saving: false,
    error: null
  };
}

export function TankRelease() {
  const qc = useQueryClient();
  const [checks, setChecks] = useState<Record<string, ChecklistState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const tanksQ = useQuery({
    queryKey: ['tanks'],
    queryFn: async () => (await api.get<ConditioningTank[]>(E.tanks)).data,
    refetchInterval: 30000
  });
  const cyclesQ = useQuery({
    queryKey: ['cycles'],
    queryFn: async () => (await api.get<ConditioningCycle[]>(E.cycles)).data,
    refetchInterval: 60000
  });

  const tanks = useMemo(() => tanksQ.data ?? [], [tanksQ.data]);
  const awaiting = useMemo(() => tanks.filter(isAwaitingRelease), [tanks]);
  const notReady = useMemo(() => tanks.filter((t) => !isAwaitingRelease(t)), [tanks]);

  // Initialise / refresh checklist state for each awaiting tank (preserve user input once created).
  useEffect(() => {
    setChecks((prev) => {
      const next = { ...prev };
      for (const t of awaiting) {
        if (!next[t.code] || next[t.code].released) next[t.code] = freshChecklist(t);
      }
      return next;
    });
  }, [awaiting]);

  const update = (code: string, patch: Partial<ChecklistState>) =>
    setChecks((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));

  const released = useMemo(
    () => (cyclesQ.data ?? []).filter((c) => c.releasedAt != null).sort((a, b) => b.releasedAt!.localeCompare(a.releasedAt!)),
    [cyclesQ.data]
  );

  const doRelease = async (t: ConditioningTank) => {
    const st = checks[t.code] ?? freshChecklist(t);
    if (!st.moisture || !st.time || !st.lab) {
      update(t.code, { error: 'All three checklist items must be confirmed before release.' });
      return;
    }
    if (!t.activeCycle || t.activeCycle.completedAt == null) {
      update(t.code, { error: 'Cycle is not completed yet — release is blocked by the server.' });
      return;
    }
    update(t.code, { saving: true, error: null });
    try {
      await api.post(E.tankRelease(t.code), {
        moistureVerified: true,
        timeMet: true,
        labApproved: true,
        ...(st.note.trim() ? { note: st.note.trim() } : {})
      });
      update(t.code, { saving: false, released: true, error: null });
      qc.invalidateQueries({ queryKey: ['tanks'] });
      qc.invalidateQueries({ queryKey: ['cycles'] });
    } catch (err) {
      update(t.code, { saving: false, error: err instanceof Error ? err.message : 'Release failed.' });
    }
  };

  const tankLevelAt = (c: ConditioningCycle): string => {
    const t = tanks.find((x) => x.code === c.tankCode);
    return t ? `${t.levelQ.toLocaleString()} Qt` : '—';
  };

  return (
    <div className="space-y-6">
      <div className={cardShell}>
        <CardHeader
          icon={<BadgeCheck className="h-4 w-4" />}
          title="Tank Release to Milling"
          subtitle="Verify moisture, conditioning time and lab approval before a conditioned tank is released to the shift mill."
        />
        {tanksQ.isLoading ? (
          <Spinner label="Loading tanks…" />
        ) : tanksQ.isError ? (
          <ErrorBox message="Could not load tanks." onRetry={() => tanksQ.refetch()} />
        ) : awaiting.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No tanks are awaiting release right now. Tanks appear here once conditioning is completed.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {awaiting.map((t) => {
              const c = t.activeCycle;
              const st = checks[t.code] ?? freshChecklist(t);
              const inRange = moistureInRange(c?.moistureAfter);
              const timeMet = (c?.elapsedHrs ?? 0) >= (c?.requiredHrs ?? 0);
              const isOpen = expanded === t.code;
              return (
                <div key={t.code} className="rounded-xl border border-slate-200/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Wheat className="h-4 w-4 text-amber-600" />
                        <span className="font-bold text-slate-800">Tank {t.code}</span>
                        <span className="text-xs text-slate-500">{t.name}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span>
                          Batch <span className="font-semibold tabular-nums">{c?.batchNo ?? '—'}</span>
                        </span>
                        <span>
                          Level <span className="font-semibold tabular-nums">{t.levelQ.toLocaleString()} / {t.capacityQ.toLocaleString()} Qt</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Droplets className="h-3.5 w-3.5 text-sky-600" />
                          <span className={`font-semibold tabular-nums ${inRange ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {c?.moistureAfter != null ? `${c.moistureAfter.toFixed(1)}%` : '—'}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Timer className="h-3.5 w-3.5 text-slate-500" />
                          <span className="font-semibold tabular-nums">
                            {(c?.elapsedHrs ?? 0).toFixed(1)}h / {(c?.requiredHrs ?? 0).toFixed(1)}h
                          </span>
                        </span>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        t.status === 'Ready' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {t.status === 'Ready' ? 'Ready' : 'Cycle complete'}
                    </span>
                  </div>

                  {st.released ? (
                    <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                      <CheckCircle2 className="h-5 w-5" />
                      Released — ready for shift milling
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : t.code)}
                        className="mt-3 text-xs font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900"
                      >
                        {isOpen ? 'Hide release checklist' : 'Open release checklist'}
                      </button>
                      {isOpen && (
                        <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-4">
                          <label className="flex cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 accent-emerald-600"
                              checked={st.moisture}
                              onChange={(e) => update(t.code, { moisture: e.target.checked })}
                            />
                            <span className="text-sm text-slate-700">
                              <span className="font-semibold">Moisture verified {MOIST_MIN.toFixed(1)}–{MOIST_MAX.toFixed(1)}%</span>
                              <span className="block text-xs text-slate-500">
                                Actual: <span className="font-semibold tabular-nums">{c?.moistureAfter != null ? `${c.moistureAfter.toFixed(1)}%` : 'not recorded'}</span>
                                {c?.moistureAfter != null && !inRange ? ' — outside range, re-condition before release' : ''}
                              </span>
                            </span>
                          </label>
                          <label className="flex cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 accent-emerald-600"
                              checked={st.time}
                              onChange={(e) => update(t.code, { time: e.target.checked })}
                            />
                            <span className="text-sm text-slate-700">
                              <span className="font-semibold">Conditioning time met</span>
                              <span className="block text-xs text-slate-500">
                                Elapsed <span className="font-semibold tabular-nums">{(c?.elapsedHrs ?? 0).toFixed(1)}h</span> vs required{' '}
                                <span className="font-semibold tabular-nums">{(c?.requiredHrs ?? 0).toFixed(1)}h</span>
                                {!timeMet ? ' — time not met, wait before release' : ''}
                              </span>
                            </span>
                          </label>
                          <label className="flex cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 accent-emerald-600"
                              checked={st.lab}
                              onChange={(e) => update(t.code, { lab: e.target.checked })}
                            />
                            <span className="text-sm text-slate-700">
                              <span className="font-semibold">Lab approval obtained</span>
                              <span className="block text-xs text-slate-500">Confirmed by the QC lab — manual sign-off</span>
                            </span>
                          </label>
                          <TextArea
                            rows={2}
                            placeholder="Release note (optional)"
                            value={st.note}
                            onChange={(e) => update(t.code, { note: e.target.value })}
                            className="bg-white"
                          />
                          {st.error && (
                            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{st.error}</p>
                          )}
                          <Button
                            loading={st.saving}
                            disabled={st.saving}
                            onClick={() => doRelease(t)}
                            className="w-full"
                          >
                            <FlaskConical className="h-4 w-4" />
                            Release to Milling
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tanks not ready */}
      {notReady.length > 0 && !tanksQ.isLoading && (
        <div className={cardShell}>
          <CardHeader
            icon={<Clock3 className="h-4 w-4" />}
            title="Not ready for release"
            subtitle="These tanks have no completed conditioning cycle yet."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {notReady.map((t) => (
              <div key={t.code} className="rounded-xl border border-slate-200/70 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">Tank {t.code}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{t.status}</span>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  Complete conditioning first —{' '}
                  <Link to="/conditioning-monitor" className="font-semibold text-amber-700 underline underline-offset-2">
                    open the conditioning monitor
                  </Link>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recently released */}
      <div className={cardShell}>
        <CardHeader
          icon={<CheckCircle2 className="h-4 w-4" />}
          title="Recently released"
          subtitle="Cycles released to milling."
        />
        {cyclesQ.isLoading ? (
          <Spinner label="Loading cycles…" />
        ) : cyclesQ.isError ? (
          <ErrorBox message="Could not load cycles." onRetry={() => cyclesQ.refetch()} />
        ) : released.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No releases recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-4 font-semibold">Batch</th>
                  <th className="pb-2 pr-4 font-semibold">Tank</th>
                  <th className="pb-2 pr-4 font-semibold">Released at</th>
                  <th className="pb-2 font-semibold">Level at release</th>
                </tr>
              </thead>
              <tbody>
                {released.slice(0, 20).map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="py-2.5 pr-4 font-semibold tabular-nums text-slate-800">{c.batchNo}</td>
                    <td className="py-2.5 pr-4 text-slate-600">Tank {c.tankCode}</td>
                    <td className="py-2.5 pr-4 text-slate-600">{fmtDate(c.releasedAt)}</td>
                    <td className="py-2.5 font-semibold tabular-nums text-slate-800">{tankLevelAt(c)}</td>
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
