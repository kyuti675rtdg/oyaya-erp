import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ShieldAlert,
  ShieldCheck,
  XCircle
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { useAuth } from '../store/auth';
import type { ProductionBatch, ReleaseChecklist } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, Field, SectionTitle, Select, Spinner, TextArea } from '../components/ui';

const cardShell = 'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

const BATCH_STATUS_TONE: Record<string, 'pass' | 'critical' | 'advisory' | 'neutral'> = {
  APPROVED: 'pass',
  QC_HOLD: 'critical',
  MILLING: 'advisory',
  OPEN: 'neutral',
  CLOSED: 'neutral'
};

export function QualityApproval() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canApprove = hasClaim('qc:approve');

  const [batchId, setBatchId] = useState('');
  const [notes, setNotes] = useState('');
  const [decision, setDecision] = useState<'RELEASE' | 'HOLD' | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const batchesQ = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(E.batches)).data
  });

  const checklistQ = useQuery({
    queryKey: ['release-checklist', batchId],
    queryFn: async () => (await api.get<ReleaseChecklist>(E.qcReleaseChecklist(batchId))).data,
    enabled: batchId !== ''
  });

  const checklist = checklistQ.data ?? null;

  const submit = async (e: FormEvent, d: 'RELEASE' | 'HOLD') => {
    e.preventDefault();
    if (!canApprove) {
      setNotice({ ok: false, text: 'You do not have the qc:approve permission.' });
      return;
    }
    setDecision(d);
    setSaving(true);
    setNotice(null);
    try {
      const r = await api.post<{ batch: { batchNo: string; status: string } }>(
        E.qcReleaseBatch(batchId),
        { decision: d, notes: notes.trim() === '' ? null : notes.trim() }
      );
      setNotice({
        ok: true,
        text:
          d === 'RELEASE'
            ? `Batch ${r.data.batch.batchNo} RELEASED to finished goods.`
            : `Batch ${r.data.batch.batchNo} placed on QC HOLD.`
      });
      setNotes('');
      qc.invalidateQueries({ queryKey: ['release-checklist', batchId] });
      qc.invalidateQueries({ queryKey: ['batches'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Decision failed.' });
    } finally {
      setSaving(false);
      setDecision(null);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Quality Approval & Product Release"
        sub="Release batches to finished goods only when every quality gate passes"
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

      <div className={`mb-4 ${cardShell}`}>
        <div className="max-w-md">
          <Field label="Production batch" required>
            <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">Select batch</option>
              {(batchesQ.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNo} — {b.status}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {batchId === '' ? (
        <div className={cardShell}>
          <EmptyState
            title="Select a batch"
            sub="Choose a production batch to review its release checklist."
          />
        </div>
      ) : checklistQ.isLoading ? (
        <Spinner label="Loading release checklist..." />
      ) : checklistQ.isError ? (
        <ErrorBox message="Could not load the release checklist." onRetry={() => checklistQ.refetch()} />
      ) : checklist ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className={`lg:col-span-2 ${cardShell}`}>
            <CardHeader
              icon={<ClipboardCheck size={16} />}
              title={`Release checklist — Batch ${checklist.batchNo}`}
              subtitle="All gates must pass before release"
              action={
                <Badge tone={BATCH_STATUS_TONE[checklist.status] ?? 'neutral'}>
                  {checklist.status}
                </Badge>
              }
            />
            <ul className="space-y-3">
              {checklist.items.map((item) => (
                <li
                  key={item.key}
                  className={`flex items-start gap-3 rounded-xl border p-4 ${
                    item.passed ? 'border-pass-text/30 bg-pass-bg/50' : 'border-critical-text/40 bg-critical-bg/60'
                  }`}
                >
                  {item.passed ? (
                    <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-pass-text" />
                  ) : (
                    <XCircle size={20} className="mt-0.5 shrink-0 text-critical-text" />
                  )}
                  <div>
                    <p className="text-sm font-bold text-slate-800">{item.label}</p>
                    <p className="mt-0.5 text-sm text-slate-600">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ul>

            {checklist.openCapas.length > 0 ? (
              <div className="mt-4">
                <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-critical-text">
                  <AlertTriangle size={15} /> Open nonconformities blocking release
                </h4>
                <ul className="space-y-2">
                  {checklist.openCapas.map((c) => (
                    <li key={c.id} className="rounded-lg border border-critical-text/30 bg-critical-bg p-3 text-sm">
                      <p className="font-bold text-slate-800">
                        {c.capaNo} <Badge tone="critical" className="ml-1">{c.status}</Badge>
                      </p>
                      <p className="mt-1 text-slate-600">{c.issueDescription}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div
              className={`mt-4 flex items-center gap-3 rounded-xl border p-4 ${
                checklist.canRelease
                  ? 'border-pass-text/30 bg-pass-bg/60'
                  : 'border-amber-300/60 bg-amber-50'
              }`}
            >
              {checklist.canRelease ? (
                <ShieldCheck size={22} className="shrink-0 text-pass-text" />
              ) : (
                <ShieldAlert size={22} className="shrink-0 text-amber-600" />
              )}
              <p className="text-sm font-semibold text-slate-800">
                {checklist.canRelease
                  ? 'All quality gates pass — this batch may be released to finished goods.'
                  : 'Release is blocked until every checklist item passes.'}
              </p>
            </div>
          </div>

          <div className={cardShell}>
            <CardHeader
              icon={<ShieldCheck size={16} />}
              title="Approver sign-off"
              subtitle="Decision is recorded with your identity"
            />
            {!canApprove ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm font-medium text-amber-800">
                You need the <span className="font-mono">qc:approve</span> permission to release or hold batches.
              </p>
            ) : (
              <form className="space-y-4">
                <Field label="Approver notes">
                  <TextArea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Reason for release or hold, conditions, follow-ups..."
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    onClick={(e) => submit(e, 'RELEASE')}
                    loading={saving && decision === 'RELEASE'}
                    disabled={!checklist.canRelease}
                    className="w-full"
                  >
                    <CheckCircle2 size={16} /> Release
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={(e) => submit(e, 'HOLD')}
                    loading={saving && decision === 'HOLD'}
                    className="w-full"
                  >
                    <XCircle size={16} /> Hold
                  </Button>
                </div>
                {!checklist.canRelease ? (
                  <p className="text-xs text-slate-500">
                    Release is disabled while any checklist item fails. A batch can always be placed
                    on QC hold.
                  </p>
                ) : null}
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
