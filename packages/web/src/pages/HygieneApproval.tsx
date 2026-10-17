import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ShieldCheck, Stamp, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { AreaCleaningLog, HygieneApproval, HygieneInspection } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { useAuth } from '../store/auth';
import { fmtDateTime } from '../lib/format';
import { APPROVAL_TONE, cardShell } from './HygieneCommon';
import {
  Button,
  Card,
  EmptyState,
  Field,
  SectionTitle,
  Select,
  Spinner,
  TextArea
} from '../components/ui';

type SignoffRole = 'supervisor' | 'quality';

export function HygieneApproval() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canApprove = hasClaim('hygiene:approve');
  const canManage = hasClaim('hygiene:manage');

  const [statusFilter, setStatusFilter] = useState('');
  const [signoffFor, setSignoffFor] = useState<{ item: HygieneApproval; role: SignoffRole } | null>(null);
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Manual request form (cleanings that missed auto-creation, or inspections)
  const [showRequest, setShowRequest] = useState(false);
  const [reqSubjectType, setReqSubjectType] = useState<'CLEANING' | 'INSPECTION'>('INSPECTION');
  const [reqSubjectId, setReqSubjectId] = useState('');

  const listQ = useQuery({
    queryKey: ['hygiene', 'approvals', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      return (await api.get<HygieneApproval[]>(`${E.hygApprovals}?${params}`)).data;
    }
  });

  const doneCleaningsQ = useQuery({
    queryKey: ['hygiene', 'cleanings-done-lite'],
    queryFn: async () =>
      (await api.get<AreaCleaningLog[]>(`${E.hygAreaCleanings}?status=DONE`)).data,
    enabled: showRequest
  });

  const inspectionsQ = useQuery({
    queryKey: ['hygiene', 'inspections-lite'],
    queryFn: async () => (await api.get<HygieneInspection[]>(E.hygInspections)).data,
    enabled: showRequest
  });

  const signoff = async () => {
    if (!signoffFor) return;
    setSaving(true);
    try {
      await api.post<HygieneApproval>(E.hygApprovalSignoff(signoffFor.item.id), {
        role: signoffFor.role,
        decision,
        note: note.trim() || null
      });
      setNotice({
        ok: decision === 'approve',
        text: decision === 'approve'
          ? `${signoffFor.role === 'supervisor' ? 'Supervisor' : 'Quality'} sign-off recorded.`
          : 'Request rejected.'
      });
      setSignoffFor(null);
      setNote('');
      setDecision('approve');
      qc.invalidateQueries({ queryKey: ['hygiene', 'approvals'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Sign-off failed.' });
    } finally {
      setSaving(false);
    }
  };

  const requestApproval = async () => {
    if (!reqSubjectId) {
      setNotice({ ok: false, text: 'Select a completed cleaning or an inspection.' });
      return;
    }
    setSaving(true);
    try {
      const label =
        reqSubjectType === 'CLEANING'
          ? (doneCleaningsQ.data ?? []).find((l) => l.id === reqSubjectId)
          : (inspectionsQ.data ?? []).find((i) => i.id === reqSubjectId);
      const subjectLabel =
        reqSubjectType === 'CLEANING' && label
          ? `${(label as AreaCleaningLog).area} — ${(label as AreaCleaningLog).logDate.slice(0, 10)} (${(label as AreaCleaningLog).shift})`
          : reqSubjectType === 'INSPECTION' && label
            ? `${(label as HygieneInspection).target} — inspection`
            : null;
      await api.post(E.hygApprovals, {
        subjectType: reqSubjectType,
        subjectId: reqSubjectId,
        subjectLabel
      });
      setNotice({ ok: true, text: 'Approval requested.' });
      setShowRequest(false);
      setReqSubjectId('');
      qc.invalidateQueries({ queryKey: ['hygiene', 'approvals'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Request failed.' });
    } finally {
      setSaving(false);
    }
  };

  const subjectBadgeTone = (t: 'CLEANING' | 'INSPECTION'): 'neutral' | 'advisory' =>
    t === 'CLEANING' ? 'neutral' : 'advisory';

  const signoffState = (a: HygieneApproval, role: SignoffRole) =>
    role === 'supervisor'
      ? { by: a.supervisorBy, at: a.supervisorAt, note: a.supervisorNote, done: !!a.supervisorBy }
      : { by: a.qualityBy, at: a.qualityAt, note: a.qualityNote, done: !!a.qualityBy };

  const canSign = (a: HygieneApproval, role: SignoffRole) => {
    if (!canApprove) return false;
    if (a.status === 'APPROVED' || a.status === 'REJECTED') return false;
    if (role === 'supervisor') return a.status === 'PENDING';
    return a.status === 'SUPERVISOR_SIGNED';
  };

  const pendingCount = (listQ.data ?? []).filter((a) => a.status === 'PENDING' || a.status === 'SUPERVISOR_SIGNED').length;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Supervisor & Quality Approval"
        sub="Approval queue for completed cleanings and inspections — supervisor first, then quality"
        action={
          canManage ? (
            <Button variant="secondary" onClick={() => setShowRequest((v) => !v)}>
              <Stamp size={16} /> Request approval
            </Button>
          ) : undefined
        }
      />

      {notice ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className={cardShell}>
        <CardHeader
          icon={<ShieldCheck size={16} />}
          title="Approval queue"
          subtitle={pendingCount > 0 ? `${pendingCount} awaiting sign-off` : 'Nothing awaiting sign-off'}
          action={
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-auto !px-3 !py-1.5 !text-sm">
              <option value="">All</option>
              <option value="PENDING">Pending</option>
              <option value="SUPERVISOR_SIGNED">Supervisor signed</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </Select>
          }
        />
        {listQ.isLoading ? (
          <Spinner label="Loading approval queue..." />
        ) : listQ.isError ? (
          <EmptyState title="Failed to load approvals" sub="Check your connection and try again." />
        ) : (listQ.data ?? []).length === 0 ? (
          <EmptyState title="Approval queue is empty" sub="Completed cleanings are added automatically." />
        ) : (
          <div className="space-y-3">
            {(listQ.data ?? []).map((a) => (
              <div key={a.id} className="rounded-xl border border-line bg-white dark:bg-slate-800 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={subjectBadgeTone(a.subjectType)}>{a.subjectType}</Badge>
                      <Badge tone={APPROVAL_TONE[a.status]}>{a.status.replace('_', ' ')}</Badge>
                    </div>
                    <p className="mt-1.5 font-bold text-slate-800 dark:text-slate-100">{a.subjectLabel ?? a.subjectId}</p>
                    <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">Requested {fmtDateTime(a.createdAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    {canSign(a, 'supervisor') ? (
                      <Button className="px-3 py-1.5 text-sm" onClick={() => setSignoffFor({ item: a, role: 'supervisor' })}>
                        <Check size={14} /> Supervisor sign-off
                      </Button>
                    ) : null}
                    {canSign(a, 'quality') ? (
                      <Button className="px-3 py-1.5 text-sm" onClick={() => setSignoffFor({ item: a, role: 'quality' })}>
                        <Check size={14} /> Quality sign-off
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {(['supervisor', 'quality'] as SignoffRole[]).map((role) => {
                    const s = signoffState(a, role);
                    return (
                      <div key={role} className={`rounded-lg border px-3 py-2 ${s.done ? 'border-emerald-200 bg-emerald-50/50' : 'border-line bg-alabaster'}`}>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{role}</p>
                        {s.done ? (
                          <>
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{s.by}</p>
                            <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{s.at ? fmtDateTime(s.at) : ''}</p>
                            {s.note ? <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{s.note}</p> : null}
                          </>
                        ) : (
                          <p className="text-sm text-slate-400 dark:text-slate-500">Awaiting sign-off</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showRequest ? (
        <div className={cardShell}>
          <CardHeader icon={<Stamp size={16} />} title="Request approval" subtitle="Send a completed item into the queue" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Subject type">
              <Select value={reqSubjectType} onChange={(e) => { setReqSubjectType(e.target.value as 'CLEANING' | 'INSPECTION'); setReqSubjectId(''); }}>
                <option value="INSPECTION">Inspection</option>
                <option value="CLEANING">Completed cleaning</option>
              </Select>
            </Field>
            <Field label="Item">
              <Select value={reqSubjectId} onChange={(e) => setReqSubjectId(e.target.value)}>
                <option value="">Select…</option>
                {reqSubjectType === 'CLEANING'
                  ? (doneCleaningsQ.data ?? []).map((l) => (
                      <option key={l.id} value={l.id}>{l.area} — {l.logDate.slice(0, 10)} ({l.shift})</option>
                    ))
                  : (inspectionsQ.data ?? []).map((i) => (
                      <option key={i.id} value={i.id}>{i.target} — {i.inspectedAt.slice(0, 10)}</option>
                    ))}
              </Select>
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button loading={saving} onClick={requestApproval}>Send to queue</Button>
            <Button variant="secondary" onClick={() => setShowRequest(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {signoffFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <Card className="w-full max-w-lg p-6">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink">
                  {signoffFor.role === 'supervisor' ? 'Supervisor' : 'Quality'} sign-off
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">{signoffFor.item.subjectLabel ?? signoffFor.item.subjectId}</p>
              </div>
              <Button variant="ghost" className="px-2 py-1" onClick={() => setSignoffFor(null)} aria-label="Close">
                <X size={18} />
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Decision">
                <Select value={decision} onChange={(e) => setDecision(e.target.value as 'approve' | 'reject')}>
                  <option value="approve">Approve</option>
                  <option value="reject">Reject</option>
                </Select>
              </Field>
              <Field label="Note (optional)">
                <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={1} placeholder="Sign-off note" />
              </Field>
            </div>
            <div className="mt-4 flex gap-2">
              <Button loading={saving} onClick={signoff}>
                <Check size={14} /> {decision === 'approve' ? 'Sign off' : 'Reject'}
              </Button>
              <Button variant="secondary" onClick={() => setSignoffFor(null)}>Cancel</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
