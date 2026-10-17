import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, PenLine, ShieldCheck } from 'lucide-react';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { RepairApproval } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, Field, Spinner, TextArea } from '../components/ui';

const cardShell =
  'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

function stageOf(a: RepairApproval): 'TECH' | 'SUPERVISOR' | 'BACK_IN_SERVICE' | 'DONE' {
  if (a.backInServiceAt) return 'DONE';
  if (a.decision === 'APPROVED') return 'BACK_IN_SERVICE';
  if (a.decision === 'REJECTED') return 'SUPERVISOR';
  if (a.techSignedAt) return 'SUPERVISOR';
  return 'TECH';
}

const STAGE_LABEL: Record<string, string> = {
  TECH: 'Awaiting technician sign-off',
  SUPERVISOR: 'Awaiting supervisor approval',
  BACK_IN_SERVICE: 'Approved — back in service pending',
  DONE: 'Back in service'
};

const STAGE_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  TECH: 'advisory',
  SUPERVISOR: 'critical',
  BACK_IN_SERVICE: 'pass',
  DONE: 'pass'
};

function Step({ done, current, label, detail }: { done: boolean; current: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          done ? 'bg-emerald-100 text-emerald-700' : current ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400'
        }`}
      >
        {done ? <CheckCircle2 size={14} /> : '•'}
      </span>
      <div>
        <p className={`text-sm font-semibold ${done || current ? 'text-slate-800' : 'text-slate-400'}`}>{label}</p>
        {detail ? <p className="text-xs text-slate-500">{detail}</p> : null}
      </div>
    </div>
  );
}

export function RepairApproval() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('maintenance:manage');
  const canApprove = hasClaim('maintenance:approve');

  const [showAll, setShowAll] = useState(false);
  const [signoffFor, setSignoffFor] = useState<RepairApproval | null>(null);
  const [decideFor, setDecideFor] = useState<RepairApproval | null>(null);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const approvalsQ = useQuery({
    queryKey: ['maint-repair-approvals', showAll],
    queryFn: async () =>
      (await api.get<RepairApproval[]>(`${E.maintRepairApprovals}?pending=${showAll ? 'false' : 'true'}`)).data
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['maint-repair-approvals'] });
    qc.invalidateQueries({ queryKey: ['maint-work-orders'] });
  };

  const submitSignoff = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!signoffFor) return;
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      await api.post(E.maintTechSignoff(signoffFor.workOrderId), {
        technicianNote: String(fd.get('technicianNote') ?? '').trim() || null
      });
      setSignoffFor(null);
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Could not record sign-off.');
    } finally {
      setSaving(false);
    }
  };

  const submitDecision = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!decideFor) return;
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      await api.post(E.maintApprovalDecision(decideFor.id), {
        decision,
        supervisorNote: String(fd.get('supervisorNote') ?? '').trim() || null
      });
      setDecideFor(null);
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Could not record decision.');
    } finally {
      setSaving(false);
    }
  };

  const backInService = async (a: RepairApproval) => {
    setBusyId(a.id);
    setFormError(null);
    try {
      await api.post(E.maintBackInService(a.workOrderId));
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Could not mark back in service.');
    } finally {
      setBusyId(null);
    }
  };

  const rows = approvalsQ.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Repair Approval &amp; Sign-Off</h1>
          <p className="mt-1 text-sm text-slate-500">
            Technician sign-off → supervisor approval → back in service.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="h-4 w-4 accent-violet-600"
          />
          Show completed
        </label>
      </div>

      {formError ? (
        <div className="rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
      ) : null}

      <div className={cardShell}>
        <CardHeader
          icon={<ShieldCheck size={16} />}
          title="Approval queue"
          subtitle={showAll ? 'All repair approvals' : `${rows.length} awaiting action`}
        />
        {approvalsQ.isLoading ? (
          <Spinner />
        ) : approvalsQ.isError ? (
          <ErrorBox
            message={isNetworkError(approvalsQ.error) ? 'Network error.' : 'Failed to load the approval queue.'}
            onRetry={() => approvalsQ.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={showAll ? 'No repair approvals yet' : 'Queue is clear'}
            sub="Completed work orders appear here for technician sign-off."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {rows.map((a) => {
              const stage = stageOf(a);
              const wo = a.workOrder;
              return (
                <div key={a.id} className="rounded-xl border border-slate-200/70 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm font-bold text-slate-900">{wo?.woNumber ?? '—'}</p>
                      <p className="text-xs text-slate-500">
                        {wo?.equipment?.name ?? '—'} · {wo?.kind ? wo.kind.toLowerCase() : ''}
                      </p>
                    </div>
                    <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>
                  </div>

                  <div className="space-y-2.5">
                    <Step
                      done={!!a.techSignedAt}
                      current={stage === 'TECH'}
                      label="Technician sign-off"
                      detail={a.techSignedAt ? `${fmtDateTime(a.techSignedAt)}${a.technicianNote ? ` — ${a.technicianNote}` : ''}` : undefined}
                    />
                    <Step
                      done={!!a.decision}
                      current={stage === 'SUPERVISOR'}
                      label="Supervisor approval"
                      detail={
                        a.approvedAt
                          ? `${a.decision === 'APPROVED' ? 'Approved' : 'Rejected'} · ${fmtDateTime(a.approvedAt)}${a.supervisorNote ? ` — ${a.supervisorNote}` : ''}`
                          : undefined
                      }
                    />
                    <Step
                      done={!!a.backInServiceAt}
                      current={stage === 'BACK_IN_SERVICE'}
                      label="Back in service"
                      detail={a.backInServiceAt ? fmtDateTime(a.backInServiceAt) : undefined}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {stage === 'TECH' && canManage ? (
                      <Button variant="secondary" onClick={() => { setSignoffFor(a); setFormError(null); }}>
                        <PenLine size={14} /> Technician sign-off
                      </Button>
                    ) : null}
                    {stage === 'SUPERVISOR' && canApprove ? (
                      <Button
                        variant="secondary"
                        onClick={() => { setDecideFor(a); setDecision('APPROVED'); setFormError(null); }}
                      >
                        <ShieldCheck size={14} /> Review &amp; decide
                      </Button>
                    ) : null}
                    {stage === 'BACK_IN_SERVICE' && canApprove ? (
                      <Button onClick={() => backInService(a)} loading={busyId === a.id}>
                        <CheckCircle2 size={14} /> Back in service
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sign-off modal */}
      {signoffFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSignoffFor(null)}>
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Technician sign-off"
          >
            <h3 className="mb-1 text-base font-bold text-slate-900">Technician sign-off</h3>
            <p className="mb-4 text-xs text-slate-500">{signoffFor.workOrder?.woNumber} · {signoffFor.workOrder?.equipment?.name}</p>
            {formError ? (
              <div className="mb-4 rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
            ) : null}
            <form onSubmit={submitSignoff} className="space-y-4">
              <Field label="Technician note">
                <TextArea name="technicianNote" rows={3} maxLength={4000} placeholder="Work completed, tests performed…" />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setSignoffFor(null)}>Cancel</Button>
                <Button type="submit" loading={saving}>Sign off</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Decision modal */}
      {decideFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDecideFor(null)}>
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Supervisor decision"
          >
            <h3 className="mb-1 text-base font-bold text-slate-900">Supervisor decision</h3>
            <p className="mb-4 text-xs text-slate-500">{decideFor.workOrder?.woNumber} · {decideFor.workOrder?.equipment?.name}</p>
            {formError ? (
              <div className="mb-4 rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
            ) : null}
            <form onSubmit={submitDecision} className="space-y-4">
              <Field label="Decision">
                <div className="flex gap-2">
                  {(['APPROVED', 'REJECTED'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDecision(d)}
                      className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold ${
                        decision === d
                          ? d === 'APPROVED'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-rose-500 bg-rose-50 text-rose-700'
                          : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {d === 'APPROVED' ? 'Approve' : 'Reject'}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Supervisor note">
                <TextArea name="supervisorNote" rows={3} maxLength={4000} placeholder="Optional note…" />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setDecideFor(null)}>Cancel</Button>
                <Button type="submit" loading={saving}>Record decision</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
