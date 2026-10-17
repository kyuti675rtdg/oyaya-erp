import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { Capa, NcAction, NcActionStatus, ProductionBatch } from '../types';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { fmtDate, fmtDateTime } from '../lib/format';
import { useNetwork } from '../store/network';

const CORRECTION_TYPES = [
  'Reset roller gaps',
  'Clean / adjust purifier',
  'Replace rollers',
  'Blend with dried wheat',
  'Other'
];

const STATUS_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  OPEN: 'critical',
  IN_PROGRESS: 'advisory',
  CLOSED: 'pass'
};

const ACTION_STATUS_TONE: Record<NcActionStatus, 'pass' | 'advisory' | 'neutral'> = {
  PLANNED: 'neutral',
  IN_PROGRESS: 'advisory',
  COMPLETED: 'advisory',
  VERIFIED: 'pass'
};

export function Capa() {
  const qc = useQueryClient();
  const online = useNetwork((s) => s.online);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Capa | null>(null);

  const [issue, setIssue] = useState('');
  const [batchId, setBatchId] = useState('');
  const [identifiedBy, setIdentifiedBy] = useState('');
  const [correctionType, setCorrectionType] = useState(CORRECTION_TYPES[0]);
  const [correctionDetail, setCorrectionDetail] = useState('');
  const [disposition, setDisposition] = useState<'BLENDED_ELSEWHERE' | 'FULLY_RECYCLED' | ''>('');

  // Module 6 expansion: corrective / preventive action plan tab in the detail modal.
  const [capaTab, setCapaTab] = useState<'overview' | 'actions'>('overview');
  const [aType, setAType] = useState<'CORRECTIVE' | 'PREVENTIVE'>('CORRECTIVE');
  const [aDesc, setADesc] = useState('');
  const [aOwner, setAOwner] = useState('');
  const [aDue, setADue] = useState('');
  const [verifyFor, setVerifyFor] = useState<NcAction | null>(null);
  const [verifyNote, setVerifyNote] = useState('');

  const capaActionsQ = useQuery({
    queryKey: ['capa-actions', detail?.id],
    enabled: !!detail && capaTab === 'actions',
    queryFn: async () => (await api.get<NcAction[]>(E.capaActions(detail!.id))).data
  });

  const openCapa = (r: Capa) => {
    setDetail(r);
    setCapaTab('overview');
    setVerifyFor(null);
  };

  const reloadActions = () => qc.invalidateQueries({ queryKey: ['capa-actions', detail?.id] });

  const addCapaAction = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    if (!online) {
      setNotice({ ok: false, text: 'Adding an action requires a live connection.' });
      return;
    }
    if (!aDesc.trim() || !aOwner.trim() || !aDue) {
      setNotice({ ok: false, text: 'Action description, owner and due date are required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.capaActions(detail.id), {
        actionType: aType,
        description: aDesc.trim(),
        owner: aOwner.trim(),
        dueDate: aDue
      });
      setADesc('');
      setAOwner('');
      setADue('');
      reloadActions();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to add action.' });
    } finally {
      setSaving(false);
    }
  };

  const setActionStatus = async (a: NcAction, status: NcActionStatus) => {
    if (!online) {
      setNotice({ ok: false, text: 'Updating an action requires a live connection.' });
      return;
    }
    setSaving(true);
    try {
      await api.put(E.ncAction(a.id), { status });
      reloadActions();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to update action.' });
    } finally {
      setSaving(false);
    }
  };

  const verifyCapaAction = async (e: FormEvent) => {
    e.preventDefault();
    if (!verifyFor || !verifyNote.trim()) {
      setNotice({ ok: false, text: 'A verification note is required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.ncActionVerify(verifyFor.id), { verificationResult: verifyNote.trim() });
      setVerifyFor(null);
      setVerifyNote('');
      reloadActions();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Verification failed.' });
    } finally {
      setSaving(false);
    }
  };

  const capasQ = useQuery({
    queryKey: ['capas'],
    queryFn: async () => (await api.get<Capa[]>(E.capas)).data
  });
  const batchesQ = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(E.batches)).data
  });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      if (!batchId || !issue.trim() || !identifiedBy.trim()) {
        setNotice({ ok: false, text: 'Batch, issue description and identifying user are required.' });
        return;
      }
      const r = await submitOrQueue<Capa>('capa', E.capas, {
        batchId,
        issueDescription: issue.trim(),
        correctionType,
        correctionDetail: correctionDetail.trim() || undefined,
        performedBy: identifiedBy.trim(),
        disposition: disposition || undefined
      });
      // The online create route does not accept disposition — apply it via the update route.
      if (disposition && !r.queued && r.data) {
        await api.put(E.capa(r.data.id), { disposition });
      }
      setNotice({
        ok: true,
        text: r.queued ? 'CAPA saved offline — will sync automatically.' : 'Nonconformity logged.'
      });
      setIssue('');
      setBatchId('');
      setIdentifiedBy('');
      setCorrectionDetail('');
      setDisposition('');
      qc.invalidateQueries({ queryKey: ['capas'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to log CAPA.' });
    } finally {
      setSaving(false);
    }
  };

  const signoff = async (role: 'quality' | 'production') => {
    if (!detail) return;
    if (!online) {
      setNotice({ ok: false, text: 'Sign-off requires a live connection.' });
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<Capa>(E.capaSignoff(detail.id), { role });
      setDetail(res.data);
      qc.invalidateQueries({ queryKey: ['capas'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Sign-off failed.' });
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (!detail) return;
    if (!online) {
      setNotice({ ok: false, text: 'Closing a CAPA requires a live connection.' });
      return;
    }
    if (!detail.qualitySignById || !detail.productionSignById) {
      setNotice({ ok: false, text: 'Joint Quality and Production sign-off is required before closing.' });
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<Capa>(E.capaClose(detail.id), {});
      setDetail(res.data);
      setNotice({ ok: true, text: 'CAPA closed and linked to the batch traceability record.' });
      qc.invalidateQueries({ queryKey: ['capas'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to close CAPA.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Nonconformity & Corrective Action"
        sub="CAPA records require joint Quality and Production sign-off before closing"
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">Log nonconformity</h3>
          <form onSubmit={create} className="space-y-4">
            <Field label="Affected batch" required>
              <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} required>
                <option value="">Select batch</option>
                {(batchesQ.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNo} — {b.productType.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Issue description" required hint='e.g. "moisture above given standard"'>
              <TextArea value={issue} onChange={(e) => setIssue(e.target.value)} required />
            </Field>
            <Field label="Identified by" required>
              <TextInput value={identifiedBy} onChange={(e) => setIdentifiedBy(e.target.value)} required />
            </Field>
            <Field label="Correction type" required>
              <Select value={correctionType} onChange={(e) => setCorrectionType(e.target.value)}>
                {CORRECTION_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Correction detail" hint="Free text">
              <TextArea value={correctionDetail} onChange={(e) => setCorrectionDetail(e.target.value)} />
            </Field>
            <Field label="Disposition" hint="Mandatory product disposition">
              <Select value={disposition} onChange={(e) => setDisposition(e.target.value as typeof disposition)}>
                <option value="">Select disposition</option>
                <option value="BLENDED_ELSEWHERE">Blended into a small quantity elsewhere</option>
                <option value="FULLY_RECYCLED">Fully recycled</option>
              </Select>
            </Field>
            <Button type="submit" loading={saving} className="w-full">
              Log CAPA
            </Button>
          </form>
        </Card>

        <div className="lg:col-span-2">
          {capasQ.isLoading ? (
            <Spinner label="Loading CAPA records..." />
          ) : (
            <DataTable<Capa>
              columns={[
                { key: 'capaNo', label: 'CAPA no.', render: (r) => <span className="tnum font-bold">{r.capaNo}</span> },
                { key: 'dateIdentified', label: 'Date', render: (r) => fmtDate(r.dateIdentified) },
                { key: 'issueDescription', label: 'Issue', render: (r) => <span className="block max-w-xs truncate" title={r.issueDescription}>{r.issueDescription}</span> },
                {
                  key: 'status',
                  label: 'Status',
                  render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge>
                },
                {
                  key: 'signoffs',
                  label: 'Sign-offs',
                  render: (r) => (
                    <span className="text-xs">
                      Q:{' '}
                      <Badge tone={r.qualitySignById ? 'pass' : 'neutral'}>
                        {r.qualitySignById ? 'Signed' : 'Pending'}
                      </Badge>{' '}
                      P:{' '}
                      <Badge tone={r.productionSignById ? 'pass' : 'neutral'}>
                        {r.productionSignById ? 'Signed' : 'Pending'}
                      </Badge>
                    </span>
                  )
                },
                {
                  key: 'open',
                  label: '',
                  render: (r) => (
                    <Button variant="secondary" className="px-4 py-2 text-sm" onClick={() => openCapa(r)}>
                      Open
                    </Button>
                  )
                }
              ]}
              rows={capasQ.data ?? []}
              emptyTitle="No CAPA records"
              emptySub="Out-of-range lab results should open a CAPA record."
            />
          )}
        </div>
      </div>

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto p-6">
            <h3 className="text-lg font-bold text-ink">CAPA {detail.capaNo}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Identified {fmtDateTime(detail.dateIdentified)}
            </p>
            <div className="mt-3 flex gap-2 border-b border-line">
              {(
                [
                  ['overview', 'Overview'],
                  ['actions', 'Actions']
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCapaTab(key)}
                  className={`px-3 pb-2 text-sm font-semibold ${
                    capaTab === key
                      ? 'border-b-2 border-violet-600 text-violet-700'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {capaTab === 'overview' ? (
            <>
            <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">{detail.issueDescription}</p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Correction</dt>
                <dd className="font-medium text-ink">{detail.correctionType ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Disposition</dt>
                <dd className="font-medium text-ink">{detail.disposition?.replace('_', ' ') ?? 'Not set'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Quality sign-off</dt>
                <dd className="font-medium">{detail.qualitySignById ? 'Signed' : 'Pending'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Production sign-off</dt>
                <dd className="font-medium">{detail.productionSignById ? 'Signed' : 'Pending'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Status</dt>
                <dd>
                  <Badge tone={STATUS_TONE[detail.status] ?? 'neutral'}>{detail.status.replace('_', ' ')}</Badge>
                </dd>
              </div>
            </dl>
            {detail.status !== 'CLOSED' ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => signoff('quality')} loading={saving}>
                  Quality sign-off
                </Button>
                <Button variant="secondary" onClick={() => signoff('production')} loading={saving}>
                  Production sign-off
                </Button>
              </div>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => setDetail(null)} className="flex-1">
                Close
              </Button>
              {detail.status !== 'CLOSED' ? (
                <Button onClick={close} loading={saving} className="flex-1">
                  Close CAPA
                </Button>
              ) : null}
            </div>
            </>
            ) : (
            <div className="mt-3">
              {capaActionsQ.isLoading ? (
                <Spinner label="Loading actions..." />
              ) : (
                <div className="space-y-3">
                  {(capaActionsQ.data ?? []).map((a) => (
                    <div key={a.id} className="rounded-xl border border-line bg-white dark:bg-slate-800 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge tone={a.actionType === 'CORRECTIVE' ? 'critical' : 'advisory'}>
                            {a.actionType}
                          </Badge>
                          <Badge tone={ACTION_STATUS_TONE[a.status]}>
                            {a.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">Due {fmtDate(a.dueDate)}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{a.description}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Owner: <span className="font-semibold text-slate-700 dark:text-slate-200">{a.owner}</span>
                      </p>
                      {a.verificationResult ? (
                        <p className="mt-2 rounded-lg bg-pass-bg px-3 py-2 text-xs text-pass-text">
                          Verified: {a.verificationResult}
                        </p>
                      ) : null}
                      {a.effectivenessAt ? (
                        <p
                          className={`mt-2 rounded-lg px-3 py-2 text-xs font-medium ${
                            a.effectivenessOk ? 'bg-pass-bg text-pass-text' : 'bg-critical-bg text-critical-text'
                          }`}
                        >
                          Effectiveness: {a.effectivenessOk ? 'Effective' : 'Not effective'}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {a.status === 'PLANNED' ? (
                          <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={saving} onClick={() => setActionStatus(a, 'IN_PROGRESS')}>
                            Start
                          </Button>
                        ) : null}
                        {a.status === 'IN_PROGRESS' ? (
                          <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={saving} onClick={() => setActionStatus(a, 'COMPLETED')}>
                            Mark complete
                          </Button>
                        ) : null}
                        {a.status === 'COMPLETED' ? (
                          <Button
                            variant="secondary"
                            className="px-3 py-1.5 text-xs"
                            disabled={saving}
                            onClick={() => {
                              setVerifyFor(a);
                              setVerifyNote('');
                            }}
                          >
                            Verify
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {(capaActionsQ.data ?? []).length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line bg-alabaster px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                      No actions yet — plan the corrective and preventive steps below.
                    </p>
                  ) : null}
                </div>
              )}

              {verifyFor ? (
                <form onSubmit={verifyCapaAction} className="mt-3 space-y-3 rounded-xl bg-slate-50 dark:bg-slate-800 p-4">
                  <p className="text-sm font-semibold text-ink">Verify: {verifyFor.description}</p>
                  <Field label="Verification result" required>
                    <TextArea value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} required />
                  </Field>
                  <div className="flex gap-2">
                    <Button variant="secondary" type="button" onClick={() => setVerifyFor(null)} className="flex-1">
                      Cancel
                    </Button>
                    <Button type="submit" loading={saving} className="flex-1">
                      Verify
                    </Button>
                  </div>
                </form>
              ) : detail.status !== 'CLOSED' ? (
                <form onSubmit={addCapaAction} className="mt-3 space-y-3 rounded-xl bg-slate-50 dark:bg-slate-800 p-4">
                  <p className="text-sm font-semibold text-ink">Add action</p>
                  <Field label="Type" required>
                    <Select value={aType} onChange={(e) => setAType(e.target.value as 'CORRECTIVE' | 'PREVENTIVE')}>
                      <option value="CORRECTIVE">Corrective</option>
                      <option value="PREVENTIVE">Preventive</option>
                    </Select>
                  </Field>
                  <Field label="Description" required>
                    <TextArea value={aDesc} onChange={(e) => setADesc(e.target.value)} required />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Owner" required>
                      <TextInput value={aOwner} onChange={(e) => setAOwner(e.target.value)} required />
                    </Field>
                    <Field label="Due date" required>
                      <TextInput type="date" value={aDue} onChange={(e) => setADue(e.target.value)} required />
                    </Field>
                  </div>
                  <Button type="submit" loading={saving} className="w-full">
                    Add action
                  </Button>
                </form>
              ) : null}
            </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
