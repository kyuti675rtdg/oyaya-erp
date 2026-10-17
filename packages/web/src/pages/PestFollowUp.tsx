import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { FollowUpResult, PestEvidenceRecord, PestFollowUp } from '../types';
import { Badge } from '../components/Badge';
import { Button, ErrorBox, Field, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { DataTable } from '../components/DataTable';
import {
  cardShell,
  FollowUpResultBadge,
  PestCardHeader,
  PestKpi,
  pretty
} from './PestCommon';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PestFollowUp() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('pest:manage');
  const canApprove = hasClaim('pest:approve');

  const [statusFilter, setStatusFilter] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [resultFor, setResultFor] = useState<PestFollowUp | null>(null);
  const [result, setResult] = useState<FollowUpResult>('CLEARED');
  const [resultNotes, setResultNotes] = useState('');

  const [evidenceId, setEvidenceId] = useState('');
  const [dueDate, setDueDate] = useState(todayIso());
  const [inspector, setInspector] = useState('');
  const [notes, setNotes] = useState('');

  const followUpsQ = useQuery({
    queryKey: ['pest-follow-ups', statusFilter || undefined],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      return (await api.get<PestFollowUp[]>(E.pestFollowUps, { params })).data;
    }
  });

  const openEvidenceQ = useQuery({
    queryKey: ['pest-evidence-open'],
    queryFn: async () => (await api.get<PestEvidenceRecord[]>(E.pestEvidence, { params: { status: 'OPEN' } })).data,
    enabled: showForm
  });

  const kpis = useMemo(() => {
    const all = followUpsQ.data ?? [];
    const today = todayIso();
    const pending = all.filter((x) => x.status === 'PENDING');
    const overdue = pending.filter((x) => x.dueDate.slice(0, 10) < today);
    const done = all.filter((x) => x.status === 'DONE');
    const persistent = done.filter((x) => x.result === 'PERSISTENT');
    return { pending: pending.length, overdue: overdue.length, persistent: persistent.length, done: done.length };
  }, [followUpsQ.data]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!evidenceId) {
      setNotice({ ok: false, text: 'Select the evidence record this follow-up belongs to.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.pestFollowUps, {
        evidenceId,
        dueDate,
        inspector: inspector.trim() || undefined,
        notes: notes.trim() || undefined
      });
      setNotice({ ok: true, text: `Follow-up scheduled for ${dueDate}.` });
      setEvidenceId('');
      setDueDate(todayIso());
      setInspector('');
      setNotes('');
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['pest-follow-ups'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to schedule follow-up.' });
    } finally {
      setSaving(false);
    }
  };

  const recordResult = async (e: FormEvent) => {
    e.preventDefault();
    if (!resultFor) return;
    setSaving(true);
    try {
      await api.post(E.pestFollowUpResult(resultFor.id), {
        result,
        notes: resultNotes.trim() || undefined
      });
      setNotice({
        ok: true,
        text: result === 'CLEARED' ? 'Evidence cleared and follow-up closed.' : `Follow-up recorded as ${pretty(result)}.`
      });
      setResultFor(null);
      setResult('CLEARED');
      setResultNotes('');
      qc.invalidateQueries({ queryKey: ['pest-follow-ups'] });
      qc.invalidateQueries({ queryKey: ['pest-evidence'] });
      qc.invalidateQueries({ queryKey: ['pest-evidence-open'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record result.' });
    } finally {
      setSaving(false);
    }
  };

  const escalate = async (id: string) => {
    setSaving(true);
    try {
      await api.post(E.pestFollowUpEscalate(id), {});
      setNotice({ ok: true, text: 'Follow-up escalated — senior review alert raised.' });
      qc.invalidateQueries({ queryKey: ['pest-follow-ups'] });
      qc.invalidateQueries({ queryKey: ['pest-alerts'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Escalation failed.' });
    } finally {
      setSaving(false);
    }
  };

  const rowDue = (r: PestFollowUp) => {
    const today = todayIso();
    const d = r.dueDate.slice(0, 10);
    if (r.status === 'DONE') return <Badge tone="neutral">Done</Badge>;
    if (d < today) return <Badge tone="critical">Overdue</Badge>;
    if (d === today) return <Badge tone="advisory">Due today</Badge>;
    return <Badge tone="neutral">Upcoming</Badge>;
  };

  return (
    <div>
      <SectionTitle
        title="Follow-Up Inspection Tracking"
        sub="Verify every treatment worked — follow-ups linked to evidence records"
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
        <PestKpi label="Pending" value={kpis.pending} tone="violet" sub="Awaiting inspection" />
        <PestKpi label="Overdue" value={kpis.overdue} tone="rose" sub="Past due date" />
        <PestKpi label="Persistent" value={kpis.persistent} tone="amber" sub="Infestation not cleared" />
        <PestKpi label="Completed" value={kpis.done} tone="emerald" sub="Result recorded" />
      </div>

      <div className={`${cardShell} mb-4`}>
        <PestCardHeader
          icon={<ClipboardCheck size={16} />}
          title="Follow-ups"
          subtitle="Linked to pest evidence records"
          action={
            canManage ? (
              <Button onClick={() => setShowForm((v) => !v)} className="px-4 py-2 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Plus size={14} /> Schedule follow-up
                </span>
              </Button>
            ) : null
          }
        />
        <Field label="Status">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="DONE">Done</option>
          </Select>
        </Field>

        {showForm && canManage ? (
          <form onSubmit={create} className="mt-4 space-y-4 border-t border-slate-100 dark:border-slate-700 pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Evidence record" required>
                <Select value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)} required>
                  <option value="">Select open evidence</option>
                  {(openEvidenceQ.data ?? []).map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {pretty(ev.pestType)} — {ev.location} ({fmtDate(ev.observedAt)})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Due date" required>
                <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
              </Field>
              <Field label="Inspector">
                <TextInput value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="Inspector name" />
              </Field>
            </div>
            <Field label="Notes">
              <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What to verify on the visit…" />
            </Field>
            <Button type="submit" loading={saving} className="px-6 py-2.5">
              Schedule follow-up
            </Button>
          </form>
        ) : null}
      </div>

      {followUpsQ.isLoading ? (
        <Spinner label="Loading follow-ups..." />
      ) : followUpsQ.isError ? (
        <ErrorBox message="Could not load follow-ups." onRetry={() => followUpsQ.refetch()} />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable<PestFollowUp>
              columns={[
                {
                  key: 'evidence',
                  label: 'Evidence',
                  render: (r) => (
                    <span className="text-sm">
                      <span className="font-semibold">{r.evidence ? pretty(r.evidence.pestType) : '—'}</span>
                      {r.evidence ? <span className="block text-xs text-slate-500 dark:text-slate-400 capitalize">{r.evidence.location}</span> : null}
                    </span>
                  )
                },
                { key: 'dueDate', label: 'Due', render: (r) => <span className="tnum">{fmtDate(r.dueDate)}</span>, mono: true },
                { key: 'inspector', label: 'Inspector', render: (r) => r.inspector ?? '—' },
                { key: 'timing', label: 'Timing', render: rowDue },
                {
                  key: 'result',
                  label: 'Result',
                  render: (r) => (r.result ? <FollowUpResultBadge result={r.result} /> : <span className="text-slate-400 dark:text-slate-500">—</span>)
                },
                {
                  key: 'actions',
                  label: '',
                  render: (r) =>
                    canManage && r.status === 'PENDING' ? (
                      <div className="flex gap-2">
                        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setResultFor(r)}>
                          Record result
                        </Button>
                        {canApprove ? (
                          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => escalate(r.id)} disabled={saving}>
                            Escalate
                          </Button>
                        ) : null}
                      </div>
                    ) : null
                }
              ]}
              rows={followUpsQ.data ?? []}
              emptyTitle="No follow-ups scheduled"
              emptySub="Schedule a follow-up from an open evidence record."
            />
          </div>
          <div className="space-y-3 md:hidden">
            {(followUpsQ.data ?? []).length === 0 ? (
              <div className={`${cardShell} text-center text-sm text-slate-500`}>No follow-ups scheduled.</div>
            ) : (
              (followUpsQ.data ?? []).map((r) => (
                <div key={r.id} className={cardShell}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-100">
                        {r.evidence ? pretty(r.evidence.pestType) : 'Evidence'}{' '}
                        <span className="font-normal text-slate-500 dark:text-slate-400 capitalize">{r.evidence?.location}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">Due {fmtDate(r.dueDate)}{r.inspector ? ` · ${r.inspector}` : ''}</p>
                    </div>
                    {rowDue(r)}
                  </div>
                  {r.result ? (
                    <div className="mt-2">
                      <FollowUpResultBadge result={r.result} />
                    </div>
                  ) : null}
                  {canManage && r.status === 'PENDING' ? (
                    <div className="mt-3 flex gap-2">
                      <Button variant="secondary" className="flex-1 py-2 text-xs" onClick={() => setResultFor(r)}>
                        Record result
                      </Button>
                      {canApprove ? (
                        <Button variant="secondary" className="flex-1 py-2 text-xs" onClick={() => escalate(r.id)} disabled={saving}>
                          Escalate
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {resultFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <form onSubmit={recordResult} className={`${cardShell} w-full max-w-md !p-6`}>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Record follow-up result</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {resultFor.evidence ? `${pretty(resultFor.evidence.pestType)} — ` : ''}
              <span className="capitalize">{resultFor.evidence?.location}</span> · due {fmtDate(resultFor.dueDate)}
            </p>
            <div className="mt-4">
              <Field label="Result" required>
                <Select value={result} onChange={(e) => setResult(e.target.value as FollowUpResult)} required>
                  <option value="CLEARED">Cleared — no signs remain</option>
                  <option value="PERSISTENT">Persistent — infestation remains</option>
                  <option value="ESCALATED">Escalated — needs senior review</option>
                </Select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Notes">
                <TextArea value={resultNotes} onChange={(e) => setResultNotes(e.target.value)} placeholder="Findings on the visit…" />
              </Field>
            </div>
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setResultFor(null)} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" loading={saving} className="flex-1">
                Save result
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
