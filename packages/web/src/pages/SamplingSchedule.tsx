import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  Truck,
  Wheat
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { SamplingEntry, SamplingKind, SamplingStatus } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, SectionTitle, Select, Spinner } from '../components/ui';
import { fmtDate, fmtDateTime } from '../lib/format';

const cardShell = 'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

const KIND_META: Record<SamplingKind, { label: string; icon: React.ReactNode }> = {
  SHIFT_2H: { label: '2-hour shift check', icon: <Wheat size={14} /> },
  INTAKE_TRUCK: { label: 'Intake · per truck', icon: <Truck size={14} /> },
  FLOUR_BATCH: { label: 'Flour · per batch', icon: <FlaskConical size={14} /> }
};

const STATUS_TONE: Record<SamplingStatus, 'pass' | 'critical' | 'advisory' | 'neutral'> = {
  PENDING: 'advisory',
  OVERDUE: 'critical',
  COLLECTED: 'pass',
  SKIPPED: 'neutral'
};

function dayGroupLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(y.getDate() + 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, y)) return 'Tomorrow';
  return fmtDate(iso);
}

export function SamplingSchedule() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [kindFilter, setKindFilter] = useState<string>('all');

  const scheduleQ = useQuery({
    queryKey: ['sampling-schedule'],
    queryFn: async () => (await api.get<SamplingEntry[]>(E.qcSamplingSchedule)).data,
    refetchInterval: 60000
  });

  const filtered = useMemo(() => {
    const rows = scheduleQ.data ?? [];
    return rows.filter((r) => {
      if (statusFilter === 'open' && !(r.status === 'PENDING' || r.status === 'OVERDUE')) return false;
      if (statusFilter !== 'all' && statusFilter !== 'open' && r.status !== statusFilter) return false;
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
      return true;
    });
  }, [scheduleQ.data, statusFilter, kindFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, SamplingEntry[]>();
    for (const r of filtered) {
      const k = r.dueAt.slice(0, 10);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [filtered]);

  const counts = useMemo(() => {
    const rows = scheduleQ.data ?? [];
    return {
      overdue: rows.filter((r) => r.status === 'OVERDUE').length,
      pending: rows.filter((r) => r.status === 'PENDING').length,
      collected: rows.filter((r) => r.status === 'COLLECTED').length
    };
  }, [scheduleQ.data]);

  const generate = async () => {
    setGenerating(true);
    setNotice(null);
    try {
      const r = await api.post<{ ok: boolean; created: number; markedOverdue: number }>(
        E.qcSamplingGenerate
      );
      setNotice({
        ok: true,
        text: `Schedule refreshed — ${r.data.created} new sample(s) scheduled, ${r.data.markedOverdue} marked overdue.`
      });
      qc.invalidateQueries({ queryKey: ['sampling-schedule'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Generation failed.' });
    } finally {
      setGenerating(false);
    }
  };

  const collect = async (id: string) => {
    setCollectingId(id);
    setNotice(null);
    try {
      await api.post(E.qcSamplingCollect(id), {});
      setNotice({ ok: true, text: 'Sample marked as collected.' });
      qc.invalidateQueries({ queryKey: ['sampling-schedule'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to mark collected.' });
    } finally {
      setCollectingId(null);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Laboratory Sampling Schedule"
        sub="Every 2 hours per active shift · every incoming truck · every production batch"
        action={
          <Button onClick={generate} loading={generating} variant="secondary">
            <CalendarDays size={16} /> Generate due samples
          </Button>
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

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className={cardShell}>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-critical-text">
            <AlarmClock size={13} /> Overdue
          </p>
          <p className="mt-1 tabular-nums text-2xl font-bold text-critical-text">{counts.overdue}</p>
        </div>
        <div className={cardShell}>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700">
            <ClipboardList size={13} /> Pending
          </p>
          <p className="mt-1 tabular-nums text-2xl font-bold text-amber-700">{counts.pending}</p>
        </div>
        <div className={cardShell}>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-pass-text">
            <CheckCircle2 size={13} /> Collected
          </p>
          <p className="mt-1 tabular-nums text-2xl font-bold text-pass-text">{counts.collected}</p>
        </div>
      </div>

      <div className={`mb-4 ${cardShell}`}>
        <div className="flex flex-wrap gap-3">
          <div className="w-44">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="open">Open (pending + overdue)</option>
              <option value="all">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="OVERDUE">Overdue</option>
              <option value="COLLECTED">Collected</option>
            </Select>
          </div>
          <div className="w-44">
            <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
              <option value="all">All sample types</option>
              <option value="SHIFT_2H">2-hour shift check</option>
              <option value="INTAKE_TRUCK">Intake · per truck</option>
              <option value="FLOUR_BATCH">Flour · per batch</option>
            </Select>
          </div>
        </div>
      </div>

      {scheduleQ.isLoading ? (
        <Spinner label="Loading sampling schedule..." />
      ) : scheduleQ.isError ? (
        <ErrorBox message="Could not load the sampling schedule." onRetry={() => scheduleQ.refetch()} />
      ) : grouped.length === 0 ? (
        <div className={cardShell}>
          <EmptyState
            title="No samples scheduled"
            sub="Generate the schedule to create 2-hour shift checks, per-truck intake samples and per-batch flour samples."
          />
          <div className="mt-4 flex justify-center">
            <Button onClick={generate} loading={generating}>
              <CalendarDays size={16} /> Generate due samples
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([day, rows]) => (
            <section key={day} className={cardShell}>
              <CardHeader
                icon={<CalendarDays size={16} />}
                title={dayGroupLabel(rows[0].dueAt)}
                subtitle={fmtDate(rows[0].dueAt)}
                action={<Badge tone="neutral">{rows.length} sample(s)</Badge>}
              />
              <ul className="space-y-2.5">
                {rows.map((r) => {
                  const kind = KIND_META[r.kind];
                  const overdue = r.status === 'OVERDUE';
                  const done = r.status === 'COLLECTED';
                  return (
                    <li
                      key={r.id}
                      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 ${
                        overdue
                          ? 'border-critical-text/40 bg-critical-bg'
                          : done
                            ? 'border-slate-200/70 bg-slate-50/60'
                            : 'border-slate-200/70'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                          <span className="text-violet-600">{kind.icon}</span>
                          <span className="truncate">{r.label}</span>
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span>{kind.label}</span>
                          <span>·</span>
                          <span className={`tabular-nums font-semibold ${overdue ? 'text-critical-text' : ''}`}>
                            Due {fmtDateTime(r.dueAt)}
                          </span>
                          {done && r.collectedAt ? (
                            <>
                              <span>·</span>
                              <span className="tabular-nums">Collected {fmtDateTime(r.collectedAt)}</span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                        {!done ? (
                          <Button
                            variant="secondary"
                            className="px-3 py-1.5 text-sm"
                            loading={collectingId === r.id}
                            onClick={() => collect(r.id)}
                          >
                            <CheckCircle2 size={14} /> Mark collected
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
