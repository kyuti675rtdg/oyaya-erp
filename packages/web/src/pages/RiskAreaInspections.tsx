import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { PestRiskInspection, RiskCheckpointCategory, RiskCheckpointResult } from '../types';
import { Badge } from '../components/Badge';
import { Button, ErrorBox, Field, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { DataTable } from '../components/DataTable';
import {
  cardShell,
  CHECKPOINT_CATEGORIES,
  CheckpointBadge,
  HIGH_RISK_AREAS,
  PestCardHeader,
  PestKpi,
  pretty
} from './PestCommon';

interface DraftCheckpoint {
  checkpoint: string;
  category: RiskCheckpointCategory;
  result: RiskCheckpointResult;
  notes: string;
}

const emptyCheckpoint = (): DraftCheckpoint => ({ checkpoint: '', category: 'BAIT_STATION', result: 'PASS', notes: '' });

export function RiskAreaInspections() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('pest:manage');

  const [areaFilter, setAreaFilter] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<PestRiskInspection | null>(null);

  const [area, setArea] = useState<string>(HIGH_RISK_AREAS[0]);
  const [inspector, setInspector] = useState('');
  const [notes, setNotes] = useState('');
  const [checkpoints, setCheckpoints] = useState<DraftCheckpoint[]>([emptyCheckpoint()]);

  const inspectionsQ = useQuery({
    queryKey: ['pest-risk-inspections', areaFilter || undefined],
    queryFn: async () =>
      (
        await api.get<PestRiskInspection[]>(E.pestRiskInspections, {
          params: areaFilter ? { area: areaFilter } : {}
        })
      ).data
  });

  const kpis = useMemo(() => {
    const all = inspectionsQ.data ?? [];
    const passed = all.filter((x) => x.overallPass).length;
    const failed = all.length - passed;
    const totalCheckpoints = all.reduce((n, x) => n + x.checkpoints.length, 0);
    const failedCheckpoints = all.reduce((n, x) => n + x.checkpoints.filter((c) => c.result === 'FAIL').length, 0);
    return { inspections: all.length, passed, failed, totalCheckpoints, failedCheckpoints };
  }, [inspectionsQ.data]);

  const setCheckpoint = (i: number, patch: Partial<DraftCheckpoint>) => {
    setCheckpoints((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const cleaned = checkpoints.filter((c) => c.checkpoint.trim());
    if (cleaned.length === 0) {
      setNotice({ ok: false, text: 'Add at least one checkpoint with a name.' });
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<PestRiskInspection>(E.pestRiskInspections, {
        area,
        inspector: inspector.trim() || undefined,
        notes: notes.trim() || undefined,
        checkpoints: cleaned.map((c) => ({
          checkpoint: c.checkpoint.trim(),
          category: c.category,
          result: c.result,
          notes: c.notes.trim() || undefined
        }))
      });
      setNotice({
        ok: true,
        text: `Risk area inspection saved for ${area} — overall ${res.data.overallPass ? 'PASS' : 'FAIL'}.`
      });
      setInspector('');
      setNotes('');
      setCheckpoints([emptyCheckpoint()]);
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['pest-risk-inspections'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save inspection.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="High-Risk Area Inspections"
        sub="Dry storage, finished goods warehouse and packing — bait station and entry point checks"
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

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <PestKpi label="Inspections" value={kpis.inspections} tone="slate" sub="High-risk areas" />
        <PestKpi label="Passed" value={kpis.passed} tone="emerald" sub="All checkpoints passed" />
        <PestKpi label="Failed" value={kpis.failed} tone="rose" sub="≥ 1 checkpoint failed" />
        <PestKpi
          label="Failed checkpoints"
          value={`${kpis.failedCheckpoints}/${kpis.totalCheckpoints}`}
          tone="amber"
          sub="Need corrective action"
        />
      </div>

      <div className={`${cardShell} mb-4`}>
        <PestCardHeader
          icon={<ShieldCheck size={16} />}
          title="Risk area inspections"
          subtitle="PASS / FAIL per checkpoint"
          action={
            canManage ? (
              <Button onClick={() => setShowForm((v) => !v)} className="px-4 py-2 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Plus size={14} /> New inspection
                </span>
              </Button>
            ) : null
          }
        />
        <Field label="Area">
          <Select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
            <option value="">All high-risk areas</option>
            {HIGH_RISK_AREAS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Field>

        {showForm && canManage ? (
          <form onSubmit={create} className="mt-4 space-y-4 border-t border-slate-100 dark:border-slate-700 pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Area" required>
                <Select value={area} onChange={(e) => setArea(e.target.value)} required>
                  {HIGH_RISK_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Inspector">
                <TextInput value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="Inspector name" />
              </Field>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Checkpoints</p>
              <div className="space-y-2">
                {checkpoints.map((c, i) => (
                  <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200/70 bg-slate-50/60 p-3 sm:grid-cols-[1fr_130px_120px_auto]">
                    <TextInput
                      value={c.checkpoint}
                      onChange={(e) => setCheckpoint(i, { checkpoint: e.target.value })}
                      placeholder="e.g. Bait station 4 / Entry — north roller door"
                    />
                    <Select value={c.category} onChange={(e) => setCheckpoint(i, { category: e.target.value as RiskCheckpointCategory })}>
                      {CHECKPOINT_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {pretty(cat)}
                        </option>
                      ))}
                    </Select>
                    <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1">
                      {(['PASS', 'FAIL'] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setCheckpoint(i, { result: r })}
                          className={`rounded-md px-2 py-1.5 text-xs font-bold ${
                            c.result === r
                              ? r === 'PASS'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-rose-600 text-white'
                              : 'text-slate-500 hover:bg-slate-100'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setCheckpoints((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-slate-500 dark:text-slate-400 hover:text-rose-600"
                      aria-label="Remove checkpoint"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="secondary" className="mt-2 px-4 py-2 text-sm" onClick={() => setCheckpoints((p) => [...p, emptyCheckpoint()])}>
                <span className="inline-flex items-center gap-1.5">
                  <Plus size={14} /> Add checkpoint
                </span>
              </Button>
            </div>
            <Field label="Notes">
              <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Findings, corrective actions…" />
            </Field>
            <Button type="submit" loading={saving} className="px-6 py-2.5">
              Save inspection
            </Button>
          </form>
        ) : null}
      </div>

      {inspectionsQ.isLoading ? (
        <Spinner label="Loading risk area inspections..." />
      ) : inspectionsQ.isError ? (
        <ErrorBox message="Could not load inspections." onRetry={() => inspectionsQ.refetch()} />
      ) : (
        <div className="hidden md:block">
          <DataTable<PestRiskInspection>
            columns={[
              { key: 'area', label: 'Area', render: (r) => <span className="font-semibold capitalize">{r.area}</span> },
              { key: 'inspectedAt', label: 'Inspected', render: (r) => <span className="tnum">{fmtDateTime(r.inspectedAt)}</span>, mono: true },
              { key: 'inspector', label: 'Inspector', render: (r) => r.inspector ?? '—' },
              {
                key: 'checkpoints',
                label: 'Checkpoints',
                render: (r) => (
                  <span className="tnum text-sm">
                    {r.checkpoints.length} ({r.checkpoints.filter((c) => c.result === 'FAIL').length} failed)
                  </span>
                )
              },
              {
                key: 'overallPass',
                label: 'Overall',
                render: (r) => <Badge tone={r.overallPass ? 'pass' : 'critical'}>{r.overallPass ? 'PASS' : 'FAIL'}</Badge>
              },
              {
                key: 'open',
                label: '',
                render: (r) => (
                  <Button variant="secondary" className="px-4 py-1.5 text-xs" onClick={() => setDetail(r)}>
                    Details
                  </Button>
                )
              }
            ]}
            rows={inspectionsQ.data ?? []}
            emptyTitle="No risk area inspections"
            emptySub="Run a bait station and entry point check in a high-risk area."
          />
        </div>
      )}

      {!inspectionsQ.isLoading && !inspectionsQ.isError ? (
        <div className="space-y-3 md:hidden">
          {(inspectionsQ.data ?? []).map((r) => (
            <div key={r.id} className={cardShell}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold capitalize text-slate-800 dark:text-slate-100">{r.area}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">{fmtDateTime(r.inspectedAt)}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tnum">
                    {r.checkpoints.length} checkpoints ({r.checkpoints.filter((c) => c.result === 'FAIL').length} failed)
                  </p>
                </div>
                <Badge tone={r.overallPass ? 'pass' : 'critical'}>{r.overallPass ? 'PASS' : 'FAIL'}</Badge>
              </div>
              <Button variant="secondary" className="mt-3 w-full py-2 text-xs" onClick={() => setDetail(r)}>
                Details
              </Button>
            </div>
          ))}
          {(inspectionsQ.data ?? []).length === 0 ? (
            <div className={`${cardShell} text-center text-sm text-slate-500`}>No risk area inspections.</div>
          ) : null}
        </div>
      ) : null}

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className={`${cardShell} max-h-[90vh] w-full max-w-lg overflow-y-auto !p-6`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold capitalize text-slate-800 dark:text-slate-100">{detail.area}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">{fmtDateTime(detail.inspectedAt)}</p>
              </div>
              <Badge tone={detail.overallPass ? 'pass' : 'critical'}>{detail.overallPass ? 'PASS' : 'FAIL'}</Badge>
            </div>
            <div className="mt-4 space-y-2">
              {detail.checkpoints.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/70 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{c.checkpoint}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{pretty(c.category)}</p>
                  </div>
                  <CheckpointBadge result={c.result} />
                </div>
              ))}
            </div>
            {detail.notes ? <p className="mt-4 text-sm text-slate-700 dark:text-slate-200">{detail.notes}</p> : null}
            <Button variant="secondary" className="mt-4 w-full" onClick={() => setDetail(null)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
