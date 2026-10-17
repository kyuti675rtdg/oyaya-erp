import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Play, Plus, ShieldCheck, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { CleaningAction, CleaningActionStatus, HygieneInspection } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../store/auth';
import { fmtDate } from '../lib/format';
import { ACTION_STATUS_TONE, cardShell, isPastDate, todayISO } from './HygieneCommon';
import {
  Button,
  Card,
  EmptyState,
  Field,
  SectionTitle,
  Select,
  Spinner,
  TextArea,
  TextInput
} from '../components/ui';

export function CleaningTracking() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('hygiene:manage');
  const canApprove = hasClaim('hygiene:approve');

  const [statusFilter, setStatusFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<CleaningAction | null>(null);
  const [verifyFor, setVerifyFor] = useState<CleaningAction | null>(null);
  const [verificationNotes, setVerificationNotes] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Create form
  const [actionText, setActionText] = useState('');
  const [owner, setOwner] = useState('');
  const [dueDate, setDueDate] = useState(todayISO());
  const [sourceInspectionId, setSourceInspectionId] = useState('');

  const listQ = useQuery({
    queryKey: ['hygiene', 'actions', statusFilter, overdueOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (overdueOnly) params.set('overdue', 'true');
      return (await api.get<CleaningAction[]>(`${E.hygActions}?${params}`)).data;
    }
  });

  const inspectionsQ = useQuery({
    queryKey: ['hygiene', 'inspections-failed-lite'],
    queryFn: async () =>
      (await api.get<HygieneInspection[]>(`${E.hygInspections}?result=FAIL`)).data
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['hygiene', 'actions'] });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!actionText.trim() || !owner.trim()) {
      setNotice({ ok: false, text: 'Action description and owner are required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.hygActions, {
        action: actionText.trim(),
        owner: owner.trim(),
        dueDate: dueDate || null,
        sourceInspectionId: sourceInspectionId || null
      });
      setNotice({ ok: true, text: 'Follow-up action logged.' });
      setActionText('');
      setOwner('');
      setSourceInspectionId('');
      setDueDate(todayISO());
      setShowForm(false);
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to log action.' });
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (a: CleaningAction, status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED') => {
    setSaving(true);
    try {
      await api.put<CleaningAction>(E.hygAction(a.id), { status });
      setNotice({ ok: true, text: `Action moved to ${status.replace('_', ' ')}.` });
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Status change failed.' });
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    if (!verifyFor) return;
    if (!verificationNotes.trim()) {
      setNotice({ ok: false, text: 'Verification notes are required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post<CleaningAction>(E.hygActionVerify(verifyFor.id), {
        verificationNotes: verificationNotes.trim()
      });
      setNotice({ ok: true, text: 'Action verified.' });
      setVerifyFor(null);
      setVerificationNotes('');
      invalidate();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Verification failed.' });
    } finally {
      setSaving(false);
    }
  };

  const isOverdue = (a: CleaningAction) =>
    (a.status === 'OPEN' || a.status === 'IN_PROGRESS') && isPastDate(a.dueDate);

  const columns = [
    {
      key: 'action',
      label: 'Action',
      render: (r: CleaningAction) => (
        <span>
          <span className="font-semibold text-slate-800">{r.action}</span>
          {isOverdue(r) ? <Badge tone="critical" className="ml-2">Overdue</Badge> : null}
        </span>
      )
    },
    { key: 'owner', label: 'Owner' },
    {
      key: 'dueDate',
      label: 'Due date',
      render: (r: CleaningAction) => (
        <span className={`tabular-nums ${isOverdue(r) ? 'font-bold text-rose-700' : ''}`}>{fmtDate(r.dueDate)}</span>
      )
    },
    {
      key: 'status',
      label: 'Status',
      render: (r: CleaningAction) => <Badge tone={ACTION_STATUS_TONE[r.status]}>{r.status.replace('_', ' ')}</Badge>
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r: CleaningAction) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setDetail(r)}>Open</Button>
          {canManage && r.status === 'OPEN' ? (
            <Button className="px-3 py-1 text-xs" onClick={() => setStatus(r, 'IN_PROGRESS')}>Start</Button>
          ) : null}
          {canApprove && (r.status === 'OPEN' || r.status === 'IN_PROGRESS') ? (
            <Button className="px-3 py-1 text-xs" onClick={() => setVerifyFor(r)}>Verify</Button>
          ) : null}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Cleaning Action Tracking"
        sub="Follow-up actions from failed inspections — owner, due date, verification"
        action={
          canManage ? (
            <Button onClick={() => setShowForm((v) => !v)}>
              <Plus size={16} /> New action
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
          icon={<ListChecks size={16} />}
          title="Follow-up actions"
          subtitle="Verification requires hygiene:approve permission"
          action={
            <div className="flex flex-wrap gap-2">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-auto !px-3 !py-1.5 !text-sm">
                <option value="">All statuses</option>
                {(['OPEN', 'IN_PROGRESS', 'VERIFIED', 'CLOSED'] as CleaningActionStatus[]).map((s) => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </Select>
              <Button
                variant={overdueOnly ? 'primary' : 'secondary'}
                className="!px-3 !py-1.5 !text-sm"
                onClick={() => setOverdueOnly((v) => !v)}
              >
                Overdue only
              </Button>
            </div>
          }
        />
        {listQ.isLoading ? (
          <Spinner label="Loading actions..." />
        ) : listQ.isError ? (
          <EmptyState title="Failed to load actions" sub="Check your connection and try again." />
        ) : (listQ.data ?? []).length === 0 ? (
          <EmptyState title="No follow-up actions" sub="Actions raised from failed inspections appear here." />
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable columns={columns} rows={listQ.data ?? []} />
            </div>
            <div className="grid grid-cols-1 gap-3 md:hidden">
              {(listQ.data ?? []).map((r) => (
                <div key={r.id} className={`rounded-xl border bg-white p-4 ${isOverdue(r) ? 'border-rose-300' : 'border-line'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold text-slate-800">{r.action}</p>
                    <Badge tone={ACTION_STATUS_TONE[r.status]}>{r.status.replace('_', ' ')}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {r.owner} · Due <span className={`tabular-nums ${isOverdue(r) ? 'font-bold text-rose-700' : ''}`}>{fmtDate(r.dueDate)}</span>
                    {isOverdue(r) ? ' · OVERDUE' : ''}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button variant="secondary" className="flex-1 py-1.5 text-sm" onClick={() => setDetail(r)}>Open</Button>
                    {canManage && r.status === 'OPEN' ? (
                      <Button className="flex-1 py-1.5 text-sm" onClick={() => setStatus(r, 'IN_PROGRESS')}>Start</Button>
                    ) : null}
                    {canApprove && (r.status === 'OPEN' || r.status === 'IN_PROGRESS') ? (
                      <Button className="flex-1 py-1.5 text-sm" onClick={() => setVerifyFor(r)}>Verify</Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showForm ? (
        <form onSubmit={create} className={cardShell}>
          <CardHeader icon={<Plus size={16} />} title="New follow-up action" subtitle="Linked to a failed inspection where relevant" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Action" required>
              <TextInput value={actionText} onChange={(e) => setActionText(e.target.value)} placeholder="e.g. Re-clean conveyor C2 and re-inspect" />
            </Field>
            <Field label="Owner" required>
              <TextInput value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Responsible person" />
            </Field>
            <Field label="Due date">
              <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Source inspection" hint="Failed inspections">
              <Select value={sourceInspectionId} onChange={(e) => setSourceInspectionId(e.target.value)}>
                <option value="">None</option>
                {(inspectionsQ.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>{i.target} — {fmtDate(i.inspectedAt)}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" loading={saving}>Log action</Button>
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="mb-2 flex items-start justify-between">
              <h3 className="text-lg font-bold text-ink">{detail.action}</h3>
              <Button variant="ghost" className="px-2 py-1" onClick={() => setDetail(null)} aria-label="Close">
                <X size={18} />
              </Button>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Owner</dt><dd className="font-medium">{detail.owner}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Due date</dt><dd className="font-medium tabular-nums">{fmtDate(detail.dueDate)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd><Badge tone={ACTION_STATUS_TONE[detail.status]}>{detail.status.replace('_', ' ')}</Badge></dd></div>
              {detail.verificationNotes ? (
                <div><dt className="text-slate-500">Verification</dt><dd className="font-medium">{detail.verificationNotes}</dd></div>
              ) : null}
              {detail.verifiedAt ? (
                <div className="flex justify-between"><dt className="text-slate-500">Verified at</dt><dd className="font-medium tabular-nums">{fmtDate(detail.verifiedAt)}</dd></div>
              ) : null}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {canManage && detail.status === 'OPEN' ? (
                <Button onClick={() => { setStatus(detail, 'IN_PROGRESS'); setDetail(null); }}><Play size={14} /> Start</Button>
              ) : null}
              {canManage && detail.status === 'IN_PROGRESS' ? (
                <Button onClick={() => { setStatus(detail, 'CLOSED'); setDetail(null); }}>Close without verify</Button>
              ) : null}
              {canApprove && (detail.status === 'OPEN' || detail.status === 'IN_PROGRESS') ? (
                <Button variant="secondary" onClick={() => { setVerifyFor(detail); setDetail(null); }}><ShieldCheck size={14} /> Verify</Button>
              ) : null}
              <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
            </div>
          </Card>
        </div>
      ) : null}

      {verifyFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg p-6">
            <h3 className="text-lg font-bold text-ink">Verify action</h3>
            <p className="mt-1 text-sm text-slate-600">{verifyFor.action}</p>
            <div className="mt-3">
              <Field label="Verification notes" required>
                <TextArea value={verificationNotes} onChange={(e) => setVerificationNotes(e.target.value)} placeholder="How was completion verified?" />
              </Field>
            </div>
            <div className="mt-4 flex gap-2">
              <Button loading={saving} onClick={verify}><ShieldCheck size={14} /> Mark verified</Button>
              <Button variant="secondary" onClick={() => { setVerifyFor(null); setVerificationNotes(''); }}>Cancel</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
