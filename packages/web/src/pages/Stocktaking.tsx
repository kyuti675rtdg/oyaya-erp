import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ClipboardList, Plus, RefreshCcw } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { WhCountSessionDetail, WhCountSessionList } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, Field, NumberInput, Select, TextInput } from '../components/ui';
import {
  StatusBadge,
  WhListState,
  cardShell,
  docStatusTone,
  fmtDate,
  fmtDateTime,
  fmtQ,
  useLocations,
  useWhPerms
} from './WhShared';

type ViewMode = 'count' | 'review' | 'recount';

export function Stocktaking() {
  const { canManage, canApprove } = useWhPerms();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [mode, setMode] = useState<ViewMode>('count');
  const [counts, setCounts] = useState<Record<string, { q: string; bags: string }>>({});
  const [recountSelection, setRecountSelection] = useState<Set<string>>(new Set());

  const locationsQ = useLocations();

  const listQ = useQuery({
    queryKey: ['wh-count-sessions', statusFilter],
    queryFn: async () =>
      (await api.get<WhCountSessionList[]>(E.countSessions + (statusFilter ? `?status=${statusFilter}` : ''))).data
  });

  const detailQ = useQuery({
    queryKey: ['wh-count-session', selectedId],
    queryFn: async () => (await api.get<WhCountSessionDetail>(E.countSession(selectedId!))).data,
    enabled: !!selectedId
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['wh-count-sessions'] });
    qc.invalidateQueries({ queryKey: ['wh-count-session'] });
    qc.invalidateQueries({ queryKey: ['wh-locations'] });
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error('Choose a location.');
      return (
        await api.post(E.countSessions, {
          locationId,
          scheduledDate: scheduledDate ? new Date(scheduledDate).toISOString() : new Date().toISOString()
        })
      ).data as WhCountSessionDetail;
    },
    onSuccess: (s) => {
      invalidate();
      setShowCreate(false);
      setLocationId('');
      setScheduledDate('');
      setSelectedId(s.id);
      setMode('count');
      setCounts({});
    }
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      const doc = detailQ.data;
      if (!doc) throw new Error('No session loaded');
      const payload = doc.lines
        .filter((l) => counts[l.id]?.q !== undefined && counts[l.id].q !== '')
        .map((l) => ({
          lineId: l.id,
          countedQ: Number(counts[l.id].q),
          countedBags: counts[l.id].bags === '' ? 0 : Number(counts[l.id].bags)
        }));
      if (!payload.length) throw new Error('Enter at least one counted quantity.');
      return (await api.post(E.countSubmit(doc.id), { lines: payload })).data as WhCountSessionDetail;
    },
    onSuccess: (s) => {
      invalidate();
      setCounts({});
      setMode(s.status === 'POSTED' ? 'review' : 'review');
    }
  });

  const requestRecountMut = useMutation({
    mutationFn: async () => {
      const ids = [...recountSelection];
      if (!ids.length) throw new Error('Select at least one line to recount.');
      return (await api.post(E.countRequestRecount(selectedId!), { lineIds: ids })).data as WhCountSessionDetail;
    },
    onSuccess: () => {
      invalidate();
      setRecountSelection(new Set());
      setMode('recount');
    }
  });

  const submitRecountMut = useMutation({
    mutationFn: async () => {
      const doc = detailQ.data;
      if (!doc) throw new Error('No session loaded');
      const payload = doc.lines
        .filter((l) => counts[l.id]?.q !== undefined && counts[l.id].q !== '')
        .map((l) => ({
          lineId: l.id,
          recountQ: Number(counts[l.id].q),
          recountBags: counts[l.id].bags === '' ? 0 : Number(counts[l.id].bags)
        }));
      if (!payload.length) throw new Error('Enter at least one recount quantity.');
      return (await api.post(E.countSubmitRecount(doc.id), { lines: payload })).data as WhCountSessionDetail;
    },
    onSuccess: () => {
      invalidate();
      setCounts({});
      setMode('review');
    }
  });

  const approveMut = useMutation({
    mutationFn: async () => (await api.post(E.countApprove(selectedId!))).data as WhCountSessionDetail,
    onSuccess: () => {
      invalidate();
      setMode('review');
    }
  });

  const doc = detailQ.data;

  const varianceSummary = useMemo(() => {
    if (!doc) return null;
    let gain = 0;
    let loss = 0;
    let unsettled = 0;
    for (const l of doc.lines) {
      const eff = l.recountQ ?? l.countedQ;
      if (eff == null) {
        unsettled++;
        continue;
      }
      const v = eff - l.systemQ;
      if (v > 0) gain += v;
      else loss -= v;
    }
    return { gain, loss, unsettled };
  }, [doc]);

  const toggleSelect = (lineId: string) => {
    const next = new Set(recountSelection);
    if (next.has(lineId)) next.delete(lineId);
    else next.add(lineId);
    setRecountSelection(next);
  };

  const setCount = (lineId: string, field: 'q' | 'bags', value: string) =>
    setCounts((c) => ({ ...c, [lineId]: { q: c[lineId]?.q ?? '', bags: c[lineId]?.bags ?? '', [field]: value } }));

  const errMsg = (e: unknown) => (e as Error)?.message ?? 'Action failed';

  // ── Detail ───────────────────────────────────────────────────────
  if (selectedId) {
    const editable = doc && ['PLANNED', 'IN_PROGRESS'].includes(doc.status);
    const canRecount = doc && doc.status === 'IN_PROGRESS';
    const canApproveSession = doc && doc.status === 'IN_PROGRESS' && varianceSummary && varianceSummary.unsettled === 0;
    const recounting = doc && doc.status === 'RECOUNT';

    return (
      <div className="space-y-5">
        <button
          onClick={() => {
            setSelectedId(null);
            setCounts({});
            setRecountSelection(new Set());
          }}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft size={15} /> Back to sessions
        </button>
        <div className={cardShell}>
          {detailQ.isLoading && <WhListState isLoading isError={false} isEmpty={false} emptyTitle="" onRetry={() => {}} />}
          {detailQ.isError && <WhListState isLoading={false} isError isEmpty={false} emptyTitle="" onRetry={() => detailQ.refetch()} />}
          {doc && (
            <>
              <CardHeader
                icon={<ClipboardList size={16} />}
                title={`Count session ${doc.sessionNo}`}
                subtitle={`${doc.locationCode} · ${doc.locationName} · scheduled ${fmtDate(doc.scheduledDate)}`}
                action={<StatusBadge tone={docStatusTone(doc.status)} label={doc.status.replace('_', ' ')} />}
              />

              {varianceSummary && (
                <div className="mb-4 grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Gain</p>
                    <p className="text-lg font-bold tabular-nums text-emerald-700">+{fmtQ(varianceSummary.gain)} Qt</p>
                  </div>
                  <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Loss</p>
                    <p className="text-lg font-bold tabular-nums text-rose-700">−{fmtQ(varianceSummary.loss)} Qt</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Not counted</p>
                    <p className="text-lg font-bold tabular-nums text-slate-700">{varianceSummary.unsettled} lines</p>
                  </div>
                </div>
              )}

              {/* Mode tabs */}
              <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm font-semibold">
                {(
                  [
                    { id: 'count', label: 'Blind count', enabled: !!editable },
                    { id: 'review', label: 'Review', enabled: true },
                    { id: 'recount', label: 'Recount', enabled: !!recounting }
                  ] as { id: ViewMode; label: string; enabled: boolean }[]
                ).map((t) => (
                  <button
                    key={t.id}
                    disabled={!t.enabled}
                    onClick={() => setMode(t.id)}
                    className={`rounded-md px-4 py-1.5 ${
                      mode === t.id ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'
                    } ${t.enabled ? '' : 'cursor-not-allowed opacity-40'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Count mode: blind — system quantities hidden */}
              {mode === 'count' && (
                <>
                  <p className="mb-3 text-xs text-slate-500">
                    Blind count: enter what you physically count. System quantities are hidden until you switch to
                    Review.
                  </p>
                  <div className="space-y-3">
                    {doc.lines.map((l) => (
                      <div key={l.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-slate-800">
                            {l.productName}
                            {l.batchNo ? <span className="ml-2 text-xs font-normal text-slate-500">Batch {l.batchNo}</span> : null}
                          </p>
                          {l.countedQ != null && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                              Counted
                            </span>
                          )}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="mb-1 block text-[11px] font-semibold text-slate-500">Counted (Qt)</span>
                            <NumberInput
                              value={counts[l.id]?.q ?? (l.countedQ != null ? String(l.countedQ) : '')}
                              min="0"
                              step="0.01"
                              disabled={!editable || !canManage}
                              onChange={(e) => setCount(l.id, 'q', e.target.value)}
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-[11px] font-semibold text-slate-500">Bags</span>
                            <NumberInput
                              value={counts[l.id]?.bags ?? (l.countedBags != null ? String(l.countedBags) : '')}
                              min="0"
                              step="1"
                              disabled={!editable || !canManage}
                              onChange={(e) => setCount(l.id, 'bags', e.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                  {editable && canManage && (
                    <div className="mt-4 flex justify-end">
                      <Button loading={submitMut.isPending} onClick={() => submitMut.mutate()}>
                        <CheckCircle2 size={15} /> Submit counts
                      </Button>
                    </div>
                  )}
                  {submitMut.isError && (
                    <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{errMsg(submitMut.error)}</p>
                  )}
                </>
              )}

              {/* Review mode: system vs counted */}
              {mode === 'review' && (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          {canRecount && canManage && <th className="w-8 py-2" />}
                          <th className="py-2 pr-3">Product</th>
                          <th className="py-2 pr-3 text-right">System (Qt)</th>
                          <th className="py-2 pr-3 text-right">Counted (Qt)</th>
                          <th className="py-2 pr-3 text-right">Recount (Qt)</th>
                          <th className="py-2 text-right">Variance (Qt)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doc.lines.map((l) => {
                          const eff = l.recountQ ?? l.countedQ;
                          const v = eff == null ? null : Math.round((eff - l.systemQ) * 100) / 100;
                          const big = v != null && Math.abs(v) >= 1;
                          return (
                            <tr key={l.id} className={`border-b border-slate-50 ${big ? 'bg-amber-50/50' : ''}`}>
                              {canRecount && canManage && (
                                <td className="py-2.5">
                                  <input
                                    type="checkbox"
                                    checked={recountSelection.has(l.id)}
                                    onChange={() => toggleSelect(l.id)}
                                    className="h-4 w-4 accent-violet-600"
                                    aria-label={`Select ${l.productName} for recount`}
                                  />
                                </td>
                              )}
                              <td className="py-2.5 pr-3">
                                <span className="font-semibold text-slate-800">{l.productName}</span>
                                {l.batchNo && <span className="block text-[11px] text-slate-500">Batch {l.batchNo}</span>}
                              </td>
                              <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{fmtQ(l.systemQ)}</td>
                              <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">
                                {l.countedQ != null ? fmtQ(l.countedQ) : '—'}
                              </td>
                              <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                                {l.recountQ != null ? fmtQ(l.recountQ) : '—'}
                              </td>
                              <td
                                className={`py-2.5 text-right font-bold tabular-nums ${
                                  v == null ? 'text-slate-400' : v > 0 ? 'text-emerald-700' : v < 0 ? 'text-rose-700' : 'text-slate-500'
                                }`}
                              >
                                {v == null ? '—' : `${v > 0 ? '+' : ''}${fmtQ(v)}`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {canRecount && canManage && (
                      <Button
                        variant="secondary"
                        disabled={recountSelection.size === 0}
                        loading={requestRecountMut.isPending}
                        onClick={() => requestRecountMut.mutate()}
                      >
                        <RefreshCcw size={15} /> Request recount ({recountSelection.size})
                      </Button>
                    )}
                    {canApproveSession && canApprove && (
                      <Button loading={approveMut.isPending} onClick={() => approveMut.mutate()}>
                        <CheckCircle2 size={15} /> Approve & post corrections
                      </Button>
                    )}
                  </div>
                  {(requestRecountMut.isError || approveMut.isError) && (
                    <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {errMsg(requestRecountMut.error ?? approveMut.error)}
                    </p>
                  )}
                </>
              )}

              {/* Recount mode */}
              {mode === 'recount' && (
                <>
                  <p className="mb-3 text-xs text-slate-500">
                    Enter the second (recount) quantities. The recount value wins over the first count when the
                    session is approved.
                  </p>
                  <div className="space-y-3">
                    {doc.lines.map((l) => (
                      <div key={l.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-slate-800">
                            {l.productName}
                            {l.batchNo ? <span className="ml-2 text-xs font-normal text-slate-500">Batch {l.batchNo}</span> : null}
                          </p>
                          <p className="text-xs text-slate-500">
                            1st count: <span className="font-bold tabular-nums">{l.countedQ != null ? fmtQ(l.countedQ) : '—'}</span>
                          </p>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="mb-1 block text-[11px] font-semibold text-slate-500">Recount (Qt)</span>
                            <NumberInput
                              value={counts[l.id]?.q ?? (l.recountQ != null ? String(l.recountQ) : '')}
                              min="0"
                              step="0.01"
                              disabled={!canManage}
                              onChange={(e) => setCount(l.id, 'q', e.target.value)}
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-[11px] font-semibold text-slate-500">Bags</span>
                            <NumberInput
                              value={counts[l.id]?.bags ?? (l.recountBags != null ? String(l.recountBags) : '')}
                              min="0"
                              step="1"
                              disabled={!canManage}
                              onChange={(e) => setCount(l.id, 'bags', e.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                  {canManage && (
                    <div className="mt-4 flex justify-end">
                      <Button loading={submitRecountMut.isPending} onClick={() => submitRecountMut.mutate()}>
                        <CheckCircle2 size={15} /> Submit recount
                      </Button>
                    </div>
                  )}
                  {submitRecountMut.isError && (
                    <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {errMsg(submitRecountMut.error)}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── List + create ────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<ClipboardList size={16} />}
          title="Physical Stocktaking"
          subtitle="Blind count sessions, variance review, recount and approve & post"
          action={
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-auto !py-2 !text-sm">
                <option value="">All statuses</option>
                <option value="PLANNED">Planned</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="RECOUNT">Recount</option>
                <option value="POSTED">Posted</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
              {canManage && (
                <Button className="!px-4 !py-2 !text-sm" onClick={() => setShowCreate((v) => !v)}>
                  <Plus size={15} /> New session
                </Button>
              )}
            </div>
          }
        />

        {showCreate && canManage && (
          <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Location" required>
                <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Select…</option>
                  {(locationsQ.data ?? [])
                    .filter((l) => l.isActive)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} — {l.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Scheduled date">
                <TextInput type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
              </Field>
            </div>
            {createMut.isError && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{errMsg(createMut.error)}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button loading={createMut.isPending} onClick={() => createMut.mutate()}>
                Start session
              </Button>
            </div>
          </div>
        )}

        <WhListState
          isLoading={listQ.isLoading}
          isError={listQ.isError}
          isEmpty={!listQ.isLoading && !listQ.isError && (listQ.data ?? []).length === 0}
          emptyTitle="No count sessions yet"
          emptySub="Start a session to snapshot system stock and count it blind."
          onRetry={() => listQ.refetch()}
        />

        {(listQ.data ?? []).length > 0 && (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Session</th>
                    <th className="py-2 pr-3">Location</th>
                    <th className="py-2 pr-3">Scheduled</th>
                    <th className="py-2 pr-3 text-right">Counted</th>
                    <th className="py-2 pr-3 text-right">|Variance| (Qt)</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQ.data ?? []).map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => {
                        setSelectedId(s.id);
                        setMode('count');
                        setCounts({});
                      }}
                      className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/60"
                    >
                      <td className="py-2.5 pr-3 font-mono text-xs font-bold text-violet-700">{s.sessionNo}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-slate-700">{s.locationCode}</td>
                      <td className="py-2.5 pr-3 text-slate-600">{fmtDate(s.scheduledDate)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {s.countedLines}/{s.lineCount}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-bold tabular-nums">{fmtQ(s.totalAbsVariance)}</td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge tone={docStatusTone(s.status)} label={s.status.replace('_', ' ')} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {(listQ.data ?? []).map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedId(s.id);
                    setMode('count');
                    setCounts({});
                  }}
                  className="w-full rounded-xl border border-slate-200 p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs font-bold text-violet-700">{s.sessionNo}</p>
                      <p className="text-xs text-slate-500">
                        {s.locationCode} · {fmtDate(s.scheduledDate)}
                      </p>
                    </div>
                    <StatusBadge tone={docStatusTone(s.status)} label={s.status.replace('_', ' ')} />
                  </div>
                  <p className="mt-2 text-sm tabular-nums text-slate-600">
                    Counted {s.countedLines}/{s.lineCount} · |var|{' '}
                    <span className="font-bold text-slate-800">{fmtQ(s.totalAbsVariance)} Qt</span>
                  </p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
