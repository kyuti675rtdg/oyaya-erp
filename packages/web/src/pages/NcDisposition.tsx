import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, PackageCheck } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate, fmtQ } from '../lib/format';
import { CardHeader } from '../components/CardHeader';
import { Button, Field, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { Badge } from '../components/Badge';
import type { NcDecision, NcDisposition, Nonconformity } from '../types';
import { NC_DECISION_LABEL, cardShell, ncStatusTone, severityTone, NC_SEVERITY_LABEL } from './NcShared';

const DECISIONS: NcDecision[] = ['RELEASE', 'REWORK', 'DOWNGRADE', 'RECYCLE_FEED', 'REJECT_DISPOSE'];

export function NcDisposition() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [ncId, setNcId] = useState('');
  const [decision, setDecision] = useState<NcDecision>('REWORK');
  const [quantityQ, setQuantityQ] = useState('');
  const [approverName, setApproverName] = useState('');
  const [executedBy, setExecutedBy] = useState('');
  const [executionNote, setExecutionNote] = useState('');

  const listQ = useQuery({
    queryKey: ['nonconformities'],
    queryFn: async () => (await api.get<Nonconformity[]>(E.nonconformities)).data
  });
  const detailQ = useQuery({
    queryKey: ['nonconformity-detail', ncId],
    enabled: !!ncId,
    queryFn: async () => (await api.get<Nonconformity>(E.nonconformity(ncId))).data
  });

  const openNcs = useMemo(
    () => (listQ.data ?? []).filter((n) => n.status !== 'CLOSED'),
    [listQ.data]
  );

  const approve = async (e: FormEvent) => {
    e.preventDefault();
    if (!ncId) {
      setNotice({ ok: false, text: 'Select a nonconformity first.' });
      return;
    }
    const q = Number(quantityQ);
    if (!Number.isFinite(q) || q <= 0) {
      setNotice({ ok: false, text: 'Quantity affected (quintals) must be a positive number.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await api.post(E.ncDisposition(ncId), {
        decision,
        quantityQ: q,
        approverName: approverName.trim() || undefined
      });
      setNotice({ ok: true, text: `Disposition approved: ${NC_DECISION_LABEL[decision]}.` });
      qc.invalidateQueries({ queryKey: ['nonconformity-detail', ncId] });
      qc.invalidateQueries({ queryKey: ['nonconformities'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Approval failed.' });
    } finally {
      setSaving(false);
    }
  };

  const execute = async (e: FormEvent) => {
    e.preventDefault();
    const disp: NcDisposition | null | undefined = detailQ.data?.disposition;
    if (!disp) return;
    setSaving(true);
    setNotice(null);
    try {
      await api.post(E.ncDispositionExecute(disp.id), {
        executedBy: executedBy.trim() || undefined,
        executionNote: executionNote.trim() || undefined
      });
      setNotice({ ok: true, text: 'Disposition execution recorded.' });
      setExecutedBy('');
      setExecutionNote('');
      qc.invalidateQueries({ queryKey: ['nonconformity-detail', ncId] });
      qc.invalidateQueries({ queryKey: ['nonconformities'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Execution failed.' });
    } finally {
      setSaving(false);
    }
  };

  const nc = detailQ.data ?? null;
  const disp = nc?.disposition ?? null;

  return (
    <div>
      <SectionTitle
        title="Product Disposition & Recycling"
        sub="Release, rework, downgrade, recycle to feed, or reject & dispose — with approval and execution tracking"
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

      <div className="mb-4">
        <div className={cardShell}>
          <CardHeader icon={<Gavel size={16} />} title="Select nonconformity" />
          {listQ.isLoading ? (
            <Spinner label="Loading nonconformities..." />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Select value={ncId} onChange={(e) => setNcId(e.target.value)} className="min-w-64">
                <option value="">Select…</option>
                {openNcs.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.ncNo} — {n.description.slice(0, 60)}
                  </option>
                ))}
              </Select>
              {nc ? (
                <div className="flex items-center gap-2 text-sm">
                  <Badge tone={severityTone(nc.severity)}>{NC_SEVERITY_LABEL[nc.severity]}</Badge>
                  <Badge tone={ncStatusTone(nc.status)}>{nc.status.replace('_', ' ')}</Badge>
                </div>
              ) : null}
            </div>
          )}
          {nc ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{nc.description}</p> : null}
        </div>
      </div>

      {!ncId ? (
        <div className="rounded-xl border border-dashed border-line bg-alabaster px-6 py-10 text-center">
          <p className="font-semibold text-slate-700 dark:text-slate-200">No nonconformity selected</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose a record to decide the product disposition.</p>
        </div>
      ) : detailQ.isLoading ? (
        <Spinner label="Loading disposition..." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className={cardShell}>
            <CardHeader icon={<Gavel size={16} />} title="Disposition decision" subtitle="Approver permission required" />
            {disp ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Decision</span>
                  <Badge tone="advisory">{NC_DECISION_LABEL[disp.decision]}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Quantity affected</span>
                  <span className="font-bold tabular-nums text-ink dark:text-white">{fmtQ(disp.quantityQ)} Qt</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Approved</span>
                  <span className="font-medium text-ink dark:text-white">
                    {fmtDate(disp.approvedAt)}
                    {disp.approverName ? ` by ${disp.approverName}` : ''}
                  </span>
                </div>
                {disp.executedAt ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Executed</span>
                      <span className="font-medium text-ink dark:text-white">
                        {fmtDate(disp.executedAt)}
                        {disp.executedBy ? ` by ${disp.executedBy}` : ''}
                      </span>
                    </div>
                    {disp.executionNote ? (
                      <p className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{disp.executionNote}</p>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : (
              <form onSubmit={approve} className="space-y-4">
                <Field label="Decision" required>
                  <Select value={decision} onChange={(e) => setDecision(e.target.value as NcDecision)}>
                    {DECISIONS.map((d) => (
                      <option key={d} value={d}>
                        {NC_DECISION_LABEL[d]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Quantity affected (quintals)" required>
                  <TextInput
                    type="number"
                    min="0"
                    step="0.1"
                    value={quantityQ}
                    onChange={(e) => setQuantityQ(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Approver name">
                  <TextInput value={approverName} onChange={(e) => setApproverName(e.target.value)} />
                </Field>
                <Button type="submit" loading={saving} className="w-full">
                  Approve disposition
                </Button>
              </form>
            )}
          </div>

          <div className={cardShell}>
            <CardHeader icon={<PackageCheck size={16} />} title="Execution tracking" subtitle="Record when the decision is carried out" />
            {!disp ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Approve a disposition decision first.</p>
            ) : disp.executedAt ? (
              <div className="rounded-xl bg-pass-bg px-4 py-3 text-sm font-medium text-pass-text">
                Executed {fmtDate(disp.executedAt)}
              </div>
            ) : (
              <form onSubmit={execute} className="space-y-4">
                <Field label="Executed by">
                  <TextInput value={executedBy} onChange={(e) => setExecutedBy(e.target.value)} />
                </Field>
                <Field label="Execution note" hint="e.g. 40 Qt re-milled as Duket special; 12 Qt sent to feed store">
                  <TextArea value={executionNote} onChange={(e) => setExecutionNote(e.target.value)} />
                </Field>
                <Button type="submit" loading={saving} className="w-full">
                  Record execution
                </Button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
