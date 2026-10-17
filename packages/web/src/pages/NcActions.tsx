import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ListTodo, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import { CardHeader } from '../components/CardHeader';
import { Button, Field, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { Badge } from '../components/Badge';
import type { NcAction, NcActionStatus, NcActionType, Nonconformity } from '../types';
import { NC_ACTION_STATUS_LABEL, actionStatusTone, ageDays, cardShell } from './NcShared';

const ACTION_TYPES: NcActionType[] = ['CORRECTIVE', 'PREVENTIVE'];

function isOverdue(a: NcAction): boolean {
  return (
    (a.status === 'PLANNED' || a.status === 'IN_PROGRESS') &&
    new Date(a.dueDate).getTime() < Date.now()
  );
}

function ActionCard({
  action,
  onVerify,
  onEffectiveness,
  onStatus,
  busy
}: {
  action: NcAction;
  onVerify: (a: NcAction) => void;
  onEffectiveness: (a: NcAction) => void;
  onStatus: (a: NcAction, status: NcActionStatus) => void;
  busy: boolean;
}) {
  const overdue = isOverdue(action);
  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        overdue ? 'border-critical-text/50' : 'border-line'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={action.actionType === 'CORRECTIVE' ? 'critical' : 'advisory'}>
            {action.actionType}
          </Badge>
          <Badge tone={actionStatusTone(action.status)}>{NC_ACTION_STATUS_LABEL[action.status]}</Badge>
          {overdue ? (
            <span className="text-xs font-bold text-critical-text tabular-nums">
              {ageDays(action.dueDate)}d overdue
            </span>
          ) : null}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">Due {fmtDate(action.dueDate)}</span>
      </div>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{action.description}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Owner: <span className="font-semibold text-slate-700 dark:text-slate-200">{action.owner}</span>
      </p>
      {action.verificationResult ? (
        <p className="mt-2 rounded-lg bg-pass-bg px-3 py-2 text-xs text-pass-text">
          Verified: {action.verificationResult}
        </p>
      ) : null}
      {action.effectivenessAt ? (
        <p
          className={`mt-2 rounded-lg px-3 py-2 text-xs font-medium ${
            action.effectivenessOk ? 'bg-pass-bg text-pass-text' : 'bg-critical-bg text-critical-text'
          }`}
        >
          Effectiveness: {action.effectivenessOk ? 'Effective' : 'Not effective'}
          {action.effectivenessNote ? ` — ${action.effectivenessNote}` : ''}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {action.status === 'PLANNED' ? (
          <Button variant="secondary" className="px-3 py-2 text-sm" disabled={busy} onClick={() => onStatus(action, 'IN_PROGRESS')}>
            Start
          </Button>
        ) : null}
        {action.status === 'IN_PROGRESS' ? (
          <Button variant="secondary" className="px-3 py-2 text-sm" disabled={busy} onClick={() => onStatus(action, 'COMPLETED')}>
            Mark complete
          </Button>
        ) : null}
        {action.status === 'COMPLETED' ? (
          <Button variant="secondary" className="px-3 py-2 text-sm" disabled={busy} onClick={() => onVerify(action)}>
            Verify
          </Button>
        ) : null}
        {action.status === 'VERIFIED' && !action.effectivenessAt ? (
          <Button variant="secondary" className="px-3 py-2 text-sm" disabled={busy} onClick={() => onEffectiveness(action)}>
            Effectiveness check
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function NcActions() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [ncId, setNcId] = useState('');
  const [verifyTarget, setVerifyTarget] = useState<NcAction | null>(null);
  const [effectTarget, setEffectTarget] = useState<NcAction | null>(null);
  const [verifyNote, setVerifyNote] = useState('');
  const [effectNote, setEffectNote] = useState('');
  const [effectOk, setEffectOk] = useState(true);

  const [actionType, setActionType] = useState<NcActionType>('CORRECTIVE');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState('');
  const [dueDate, setDueDate] = useState('');

  const listQ = useQuery({
    queryKey: ['nonconformities'],
    queryFn: async () => (await api.get<Nonconformity[]>(E.nonconformities)).data
  });
  const actionsQ = useQuery({
    queryKey: ['nc-actions', ncId],
    enabled: !!ncId,
    queryFn: async () => (await api.get<NcAction[]>(E.ncActions(ncId))).data
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['nc-actions', ncId] });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!ncId) {
      setNotice({ ok: false, text: 'Select a nonconformity first.' });
      return;
    }
    if (!description.trim() || !owner.trim() || !dueDate) {
      setNotice({ ok: false, text: 'Description, owner and due date are required.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await api.post(E.ncActions(ncId), {
        actionType,
        description: description.trim(),
        owner: owner.trim(),
        dueDate
      });
      setNotice({ ok: true, text: 'Action added to the plan.' });
      setDescription('');
      setOwner('');
      setDueDate('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to add action.' });
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (a: NcAction, status: NcActionStatus) => {
    setSaving(true);
    setNotice(null);
    try {
      await api.put(E.ncAction(a.id), { status });
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Update failed.' });
    } finally {
      setSaving(false);
    }
  };

  const doVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!verifyTarget || !verifyNote.trim()) {
      setNotice({ ok: false, text: 'A verification note is required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.ncActionVerify(verifyTarget.id), { verificationResult: verifyNote.trim() });
      setVerifyTarget(null);
      setVerifyNote('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Verification failed.' });
    } finally {
      setSaving(false);
    }
  };

  const doEffectiveness = async (e: FormEvent) => {
    e.preventDefault();
    if (!effectTarget) return;
    setSaving(true);
    try {
      await api.post(E.ncActionEffectiveness(effectTarget.id), {
        effectivenessOk: effectOk,
        effectivenessNote: effectNote.trim() || undefined
      });
      setEffectTarget(null);
      setEffectNote('');
      setEffectOk(true);
      setNotice({
        ok: true,
        text: effectOk ? 'Action marked effective.' : 'Action marked ineffective — a new action plan is needed.'
      });
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Effectiveness check failed.' });
    } finally {
      setSaving(false);
    }
  };

  const actions = useMemo(() => actionsQ.data ?? [], [actionsQ.data]);
  const overdueCount = actions.filter(isOverdue).length;

  return (
    <div>
      <SectionTitle
        title="Corrective & Preventive Actions"
        sub="Action plans per nonconformity — owner, due date, verification and effectiveness"
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
          <CardHeader icon={<ListTodo size={16} />} title="Select nonconformity" />
          <div className="flex flex-wrap items-center gap-3">
            <Select value={ncId} onChange={(e) => setNcId(e.target.value)} className="min-w-64">
              <option value="">Select…</option>
              {(listQ.data ?? [])
                .filter((n) => n.status !== 'CLOSED')
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.ncNo} — {n.description.slice(0, 60)}
                  </option>
                ))}
            </Select>
            {overdueCount > 0 ? (
              <Badge tone="critical">{overdueCount} overdue</Badge>
            ) : null}
          </div>
        </div>
      </div>

      {!ncId ? (
        <div className="rounded-xl border border-dashed border-line bg-alabaster px-6 py-10 text-center">
          <p className="font-semibold text-slate-700 dark:text-slate-200">No nonconformity selected</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose a record to manage its action plan.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className={cardShell}>
            <CardHeader icon={<Plus size={16} />} title="Add action" />
            <form onSubmit={create} className="space-y-4">
              <Field label="Type" required>
                <Select value={actionType} onChange={(e) => setActionType(e.target.value as NcActionType)}>
                  {ACTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t === 'CORRECTIVE' ? 'Corrective' : 'Preventive'}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Description" required>
                <TextArea value={description} onChange={(e) => setDescription(e.target.value)} required />
              </Field>
              <Field label="Owner" required>
                <TextInput value={owner} onChange={(e) => setOwner(e.target.value)} required />
              </Field>
              <Field label="Due date" required>
                <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
              </Field>
              <Button type="submit" loading={saving} className="w-full">
                Add action
              </Button>
            </form>
          </div>
          <div className="lg:col-span-2">
            {actionsQ.isLoading ? (
              <Spinner label="Loading actions..." />
            ) : actions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-alabaster px-6 py-10 text-center">
                <p className="font-semibold text-slate-700 dark:text-slate-200">No actions yet</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Add the corrective and preventive steps for this nonconformity.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {actions.map((a) => (
                  <ActionCard
                    key={a.id}
                    action={a}
                    busy={saving}
                    onStatus={setStatus}
                    onVerify={(t) => {
                      setVerifyTarget(t);
                      setVerifyNote('');
                    }}
                    onEffectiveness={(t) => {
                      setEffectTarget(t);
                      setEffectNote('');
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {verifyTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-ink dark:text-white">Verify action</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{verifyTarget.description}</p>
            <form onSubmit={doVerify} className="mt-4 space-y-4">
              <Field label="Verification result" required hint="What was checked and found">
                <TextArea value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} required />
              </Field>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setVerifyTarget(null)} className="flex-1" type="button">
                  Cancel
                </Button>
                <Button type="submit" loading={saving} className="flex-1">
                  <CheckCircle2 size={14} /> Verify
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {effectTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-ink dark:text-white">Effectiveness check</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{effectTarget.description}</p>
            <form onSubmit={doEffectiveness} className="mt-4 space-y-4">
              <Field label="Outcome" required>
                <Select value={effectOk ? 'yes' : 'no'} onChange={(e) => setEffectOk(e.target.value === 'yes')}>
                  <option value="yes">Effective — recurrence prevented</option>
                  <option value="no">Not effective — further action needed</option>
                </Select>
              </Field>
              <Field label="Evidence / note">
                <TextArea value={effectNote} onChange={(e) => setEffectNote(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEffectTarget(null)} className="flex-1" type="button">
                  Cancel
                </Button>
                <Button type="submit" loading={saving} className="flex-1">
                  Record result
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
