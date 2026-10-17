import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, ClipboardCheck, UserPlus, X, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Document } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextArea } from '../components/ui';
import { DOC_STATUS_TONE, cardShell } from './DocShared';

interface UserLite {
  id: string;
  name: string | null;
  email: string;
}

export function DocApprovals() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('documents:manage');
  const canApprove = hasClaim('documents:approve');
  const [docId, setDocId] = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const [approverId, setApproverId] = useState('');
  const [decideId, setDecideId] = useState<string | null>(null);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [comment, setComment] = useState('');

  const docsQ = useQuery({
    queryKey: ['documents', 'review'],
    queryFn: async () => (await api.get<Document[]>(E.docLib + '?status=UNDER_REVIEW')).data,
  });

  const allDocsQ = useQuery({
    queryKey: ['documents', 'all2'],
    queryFn: async () => (await api.get<Document[]>(E.docLib + '?archived=false')).data,
  });

  const detailQ = useQuery({
    queryKey: ['document', docId],
    queryFn: async () => (await api.get<Document>(E.docItem(docId))).data,
    enabled: !!docId,
  });

  const usersQ = useQuery({
    queryKey: ['users-lite'],
    queryFn: async () => (await api.get<UserLite[]>('/master/users')).data,
    enabled: showAssign,
  });

  const approvals = useMemo(() => detailQ.data?.approvals ?? [], [detailQ.data]);

  const assignMut = useMutation({
    mutationFn: async () => (await api.post(E.docApprovalReq(docId), { approverId })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', docId] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      setShowAssign(false);
      setApproverId('');
    },
  });

  const decideMut = useMutation({
    mutationFn: async () =>
      (await api.patch(E.docApprovalDecide(decideId!), { status: decision, comment: comment || null })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', docId] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      setDecideId(null);
      setComment('');
    },
  });

  const submitAssign = (e: FormEvent) => {
    e.preventDefault();
    if (!approverId) return;
    assignMut.mutate();
  };

  const submitDecide = (e: FormEvent) => {
    e.preventDefault();
    decideMut.mutate();
  };

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<ClipboardCheck size={16} />}
          title="Approval Workflow"
          subtitle="Draft → Under Review → Approved → Published"
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className={`${cardShell} !border-amber-100 !p-4`}>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
              Pending review ({(docsQ.data ?? []).length})
            </p>
            {docsQ.isLoading ? (
              <Spinner label="Loading…" />
            ) : (docsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">No documents awaiting review.</p>
            ) : (
              <div className="space-y-2">
                {(docsQ.data ?? []).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDocId(d.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      docId === d.id ? 'border-violet-300 bg-violet-50/60' : 'border-slate-100 hover:border-slate-200'
                    }`}
                  >
                    <p className="truncate text-sm font-semibold text-slate-800">{d.title}</p>
                    <p className="text-xs text-slate-500">
                      {d.docNo} · v{d.version}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={`${cardShell} !p-4`}>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Review detail</p>
            {!docId ? (
              <EmptyState title="Select a document" sub="Choose from the pending list to review approvals." />
            ) : detailQ.isLoading ? (
              <Spinner label="Loading…" />
            ) : detailQ.isError ? (
              <ErrorBox message="Failed to load." onRetry={() => detailQ.refetch()} />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">{detailQ.data?.title}</p>
                    <p className="text-xs text-slate-500">{detailQ.data?.docNo}</p>
                  </div>
                  <Badge tone={DOC_STATUS_TONE[detailQ.data?.status ?? ''] ?? 'neutral'}>
                    {(detailQ.data?.status ?? '').replace('_', ' ')}
                  </Badge>
                </div>
                {approvals.length === 0 ? (
                  <p className="text-sm text-slate-500">No approvers assigned yet.</p>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {approvals.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 py-2.5">
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                            a.status === 'APPROVED'
                              ? 'bg-emerald-50 text-emerald-600'
                              : a.status === 'REJECTED'
                                ? 'bg-rose-50 text-rose-600'
                                : 'bg-amber-50 text-amber-600'
                          }`}
                        >
                          {a.status === 'APPROVED' ? <CheckCircle2 size={15} /> : a.status === 'REJECTED' ? <XCircle size={15} /> : <ClipboardCheck size={15} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-700">{a.approverId}</p>
                          <p className="text-xs text-slate-500">
                            {a.status}
                            {a.decidedAt ? ` · ${fmtDateTime(a.decidedAt)}` : ''}
                            {a.comment ? ` · “${a.comment}”` : ''}
                          </p>
                        </div>
                        {a.status === 'PENDING' && canApprove ? (
                          <Button
                            variant="secondary"
                            className="!px-3 !py-1.5 !text-xs"
                            onClick={() => {
                              setDecideId(a.id);
                              setDecision('APPROVED');
                            }}
                          >
                            Decide
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                {canManage ? (
                  <Button variant="secondary" onClick={() => setShowAssign(true)}>
                    <UserPlus size={14} /> Assign Approver
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={cardShell}>
        <CardHeader icon={<CheckCircle2 size={16} />} title="All Documents" subtitle="Submit for review from here" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(allDocsQ.data ?? [])
            .filter((d) => d.status === 'DRAFT')
            .slice(0, 9)
            .map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded-xl border border-slate-100 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{d.title}</p>
                  <p className="text-xs text-slate-500">{d.docNo}</p>
                </div>
                <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => setDocId(d.id)}>
                  Review
                </Button>
              </div>
            ))}
        </div>
        {(allDocsQ.data ?? []).filter((d) => d.status === 'DRAFT').length === 0 ? (
          <p className="text-sm text-slate-500">No draft documents.</p>
        ) : null}
      </div>

      {showAssign ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form onSubmit={submitAssign} className={`${cardShell} w-full max-w-md space-y-4 !p-6`}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">Assign Approver</h3>
              <button type="button" onClick={() => setShowAssign(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <Field label="Approver">
              <Select value={approverId} onChange={(e) => setApproverId(e.target.value)} required>
                <option value="">Select user…</option>
                {(usersQ.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                  </option>
                ))}
              </Select>
            </Field>
            {assignMut.isError ? <ErrorBox message="Assignment failed." onRetry={() => assignMut.reset()} /> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setShowAssign(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={assignMut.isPending} disabled={!approverId}>
                <Check size={14} /> Assign
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {decideId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form onSubmit={submitDecide} className={`${cardShell} w-full max-w-md space-y-4 !p-6`}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">Approval Decision</h3>
              <button type="button" onClick={() => setDecideId(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <Field label="Decision">
              <Select value={decision} onChange={(e) => setDecision(e.target.value as 'APPROVED' | 'REJECTED')}>
                <option value="APPROVED">Approve</option>
                <option value="REJECTED">Reject</option>
              </Select>
            </Field>
            <Field label={decision === 'REJECTED' ? 'Rejection reason (required)' : 'Comment (optional)'}>
              <TextArea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} required={decision === 'REJECTED'} placeholder={decision === 'REJECTED' ? 'Why is this rejected?' : 'Optional comment'} />
            </Field>
            {decideMut.isError ? <ErrorBox message="Decision failed." onRetry={() => decideMut.reset()} /> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setDecideId(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={decideMut.isPending}>
                <Check size={14} /> Submit
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
