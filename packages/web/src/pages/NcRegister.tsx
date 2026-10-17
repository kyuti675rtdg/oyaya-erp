import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, Eye, Link2, Lock, Search, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { CardHeader } from '../components/CardHeader';
import { Button, Field, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import type { Nonconformity, NcSeverity, NcSource, NcStatus, ProductionBatch } from '../types';
import {
  NC_SEVERITY_LABEL,
  NC_SOURCE_LABEL,
  NC_STATUS_LABEL,
  ageDays,
  cardShell,
  ncStatusTone,
  severityTone
} from './NcShared';

const SOURCES: NcSource[] = ['INTAKE', 'IN_PROCESS', 'FLOUR', 'HYGIENE', 'PEST'];
const SEVERITIES: NcSeverity[] = ['CRITICAL', 'MAJOR', 'MINOR'];
const STATUSES: NcStatus[] = ['OPEN', 'UNDER_REVIEW', 'CLOSED'];

export function NcRegister() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Nonconformity | null>(null);
  const [signoffKind, setSignoffKind] = useState<'CLOSURE' | 'DISPOSITION'>('CLOSURE');

  const [fStatus, setFStatus] = useState('');
  const [fSeverity, setFSeverity] = useState('');
  const [fSource, setFSource] = useState('');

  const [source, setSource] = useState<NcSource>('IN_PROCESS');
  const [batchId, setBatchId] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<NcSeverity>('MAJOR');
  const [detectedBy, setDetectedBy] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (fStatus) p.set('status', fStatus);
    if (fSeverity) p.set('severity', fSeverity);
    if (fSource) p.set('source', fSource);
    const qs = p.toString();
    return qs ? `${E.nonconformities}?${qs}` : E.nonconformities;
  }, [fStatus, fSeverity, fSource]);

  const listQ = useQuery({
    queryKey: ['nonconformities', fStatus, fSeverity, fSource],
    queryFn: async () => (await api.get<Nonconformity[]>(params)).data
  });
  const batchesQ = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(E.batches)).data
  });

  const stats = useMemo(() => {
    const rows = listQ.data ?? [];
    const open = rows.filter((r) => r.status === 'OPEN');
    const critical = rows.filter((r) => r.status !== 'CLOSED' && r.severity === 'CRITICAL');
    const avgAge =
      open.length > 0
        ? Math.round(open.reduce((s, r) => s + ageDays(r.dateDetected), 0) / open.length)
        : 0;
    return { open: open.length, critical: critical.length, avgAge, total: rows.length };
  }, [listQ.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['nonconformities'] });
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!description.trim()) {
      setNotice({ ok: false, text: 'A description of the nonconformity is required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.nonconformities, {
        source,
        batchId: batchId || undefined,
        reference: reference.trim() || undefined,
        description: description.trim(),
        severity,
        detectedBy: detectedBy.trim() || undefined
      });
      setNotice({ ok: true, text: 'Nonconformity logged in the register.' });
      setBatchId('');
      setReference('');
      setDescription('');
      setDetectedBy('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to log nonconformity.' });
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (row: Nonconformity) => {
    try {
      const res = await api.get<Nonconformity>(E.nonconformity(row.id));
      setDetail(res.data);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to load details.' });
    }
  };

  const doAction = async (kind: 'review' | 'link' | 'signoff' | 'close') => {
    if (!detail) return;
    setSaving(true);
    setNotice(null);
    try {
      if (kind === 'review') {
        const res = await api.put<Nonconformity>(E.nonconformity(detail.id), { status: 'UNDER_REVIEW' });
        setDetail(res.data as Nonconformity);
        setNotice({ ok: true, text: 'Moved to Under review.' });
      } else if (kind === 'link') {
        await api.post(E.ncLinkCapa(detail.id), {});
        const res = await api.get<Nonconformity>(E.nonconformity(detail.id));
        setDetail(res.data);
        setNotice({ ok: true, text: 'CAPA record created and linked.' });
      } else if (kind === 'signoff') {
        await api.post(E.ncSignoffRequests(detail.id), { kind: signoffKind });
        const res = await api.get<Nonconformity>(E.nonconformity(detail.id));
        setDetail(res.data);
        setNotice({ ok: true, text: `${signoffKind === 'CLOSURE' ? 'Closure' : 'Disposition'} sign-off requested.` });
      } else {
        const res = await api.post<Nonconformity>(E.ncClose(detail.id), {});
        setDetail(res.data);
        setNotice({ ok: true, text: 'Nonconformity closed with dual sign-off.' });
      }
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Action failed.' });
    } finally {
      setSaving(false);
    }
  };

  const rows = listQ.data ?? [];

  return (
    <div>
      <SectionTitle
        title="Nonconformity & Defect Register"
        sub="Every quality deviation — intake, in-process, flour, hygiene or pest — logged, graded and tracked to closure"
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
        {[
          { label: 'Open NCs', value: stats.open, tone: 'text-critical-text' },
          { label: 'Critical open', value: stats.critical, tone: 'text-critical-text' },
          { label: 'Avg open age (days)', value: stats.avgAge, tone: 'text-slate-800' },
          { label: 'In filter', value: stats.total, tone: 'text-slate-800' }
        ].map((s) => (
          <div key={s.label} className={cardShell}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{s.label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${s.tone}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={cardShell}>
          <CardHeader icon={<AlertTriangle size={16} />} title="Log nonconformity" subtitle="Severity drives the review path" />
          <form onSubmit={create} className="space-y-4">
            <Field label="Source" required>
              <Select value={source} onChange={(e) => setSource(e.target.value as NcSource)}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {NC_SOURCE_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Affected batch" hint="Optional — required to link a CAPA">
              <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                <option value="">No batch</option>
                {(batchesQ.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNo} — {b.productType.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference" hint="e.g. intake no., lab-check ref, area">
              <TextInput value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label="Description" required>
              <TextArea value={description} onChange={(e) => setDescription(e.target.value)} required />
            </Field>
            <Field label="Severity" required>
              <Select value={severity} onChange={(e) => setSeverity(e.target.value as NcSeverity)}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {NC_SEVERITY_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Detected by">
              <TextInput value={detectedBy} onChange={(e) => setDetectedBy(e.target.value)} />
            </Field>
            <Button type="submit" loading={saving} className="w-full">
              Log nonconformity
            </Button>
          </form>
        </div>

        <div className="lg:col-span-2">
          <div className={cardShell}>
            <CardHeader
              icon={<ClipboardList size={16} />}
              title="Register"
              subtitle="Open → Under review → Closed"
              action={
                <div className="flex flex-wrap gap-2">
                  <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter by status">
                    <option value="">All statuses</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {NC_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                  <Select value={fSeverity} onChange={(e) => setFSeverity(e.target.value)} aria-label="Filter by severity">
                    <option value="">All severities</option>
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {NC_SEVERITY_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                  <Select value={fSource} onChange={(e) => setFSource(e.target.value)} aria-label="Filter by source">
                    <option value="">All sources</option>
                    {SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {NC_SOURCE_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                </div>
              }
            />
            {listQ.isLoading ? (
              <Spinner label="Loading register..." />
            ) : listQ.isError ? (
              <div className="rounded-xl border border-critical-text/30 bg-critical-bg px-4 py-6 text-center text-sm text-critical-text">
                Failed to load the register. Check your connection and retry.
              </div>
            ) : (
              <>
                <div className="hidden md:block">
                  <DataTable<Nonconformity>
                    columns={[
                      { key: 'ncNo', label: 'NC no.', render: (r) => <span className="font-bold tabular-nums">{r.ncNo}</span> },
                      {
                        key: 'source',
                        label: 'Source',
                        render: (r) => NC_SOURCE_LABEL[r.source]
                      },
                      {
                        key: 'severity',
                        label: 'Severity',
                        render: (r) => <Badge tone={severityTone(r.severity)}>{NC_SEVERITY_LABEL[r.severity]}</Badge>
                      },
                      {
                        key: 'description',
                        label: 'Description',
                        render: (r) => (
                          <span className="block max-w-xs truncate" title={r.description}>
                            {r.description}
                          </span>
                        )
                      },
                      { key: 'dateDetected', label: 'Detected', render: (r) => fmtDate(r.dateDetected) },
                      {
                        key: 'status',
                        label: 'Status',
                        render: (r) => <Badge tone={ncStatusTone(r.status)}>{NC_STATUS_LABEL[r.status]}</Badge>
                      },
                      {
                        key: 'open',
                        label: '',
                        render: (r) => (
                          <Button variant="secondary" className="px-4 py-2 text-sm" onClick={() => openDetail(r)}>
                            <Eye size={14} /> Open
                          </Button>
                        )
                      }
                    ]}
                    rows={rows}
                    emptyTitle="No nonconformities"
                    emptySub="Deviations logged from intake, QC, hygiene or pest checks appear here."
                  />
                </div>
                <div className="space-y-3 md:hidden">
                  {rows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-line bg-alabaster px-6 py-10 text-center">
                      <p className="font-semibold text-slate-700 dark:text-slate-200">No nonconformities</p>
                    </div>
                  ) : (
                    rows.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => openDetail(r)}
                        className="w-full rounded-xl border border-line bg-white dark:bg-slate-800 p-4 text-left shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold tabular-nums text-ink">{r.ncNo}</span>
                          <Badge tone={severityTone(r.severity)}>{NC_SEVERITY_LABEL[r.severity]}</Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{r.description}</p>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                          <span>
                            {NC_SOURCE_LABEL[r.source]} · {fmtDate(r.dateDetected)}
                          </span>
                          <Badge tone={ncStatusTone(r.status)}>{NC_STATUS_LABEL[r.status]}</Badge>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold tabular-nums text-ink">{detail.ncNo}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {NC_SOURCE_LABEL[detail.source]} · detected {fmtDate(detail.dateDetected)}
                  {detail.detectedBy ? ` by ${detail.detectedBy}` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <Badge tone={severityTone(detail.severity)}>{NC_SEVERITY_LABEL[detail.severity]}</Badge>
                <Badge tone={ncStatusTone(detail.status)}>{NC_STATUS_LABEL[detail.status]}</Badge>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">{detail.description}</p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Batch</dt>
                <dd className="font-medium tabular-nums text-ink">{detail.batch?.batchNo ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Reference</dt>
                <dd className="font-medium text-ink">{detail.reference ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Linked CAPA</dt>
                <dd className="font-medium tabular-nums text-ink">{detail.linkedCapa?.capaNo ?? 'None'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Root cause</dt>
                <dd className="font-medium text-ink">{detail.rootCause ? 'Recorded' : 'Not recorded'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Disposition</dt>
                <dd className="font-medium text-ink">{detail.disposition ? 'Decided' : 'Not decided'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Actions</dt>
                <dd className="font-medium tabular-nums text-ink">{detail.actions?.length ?? 0}</dd>
              </div>
            </dl>

            {detail.status !== 'CLOSED' ? (
              <div className="mt-5 space-y-3 rounded-xl bg-slate-50 dark:bg-slate-800 p-4">
                {detail.status === 'OPEN' ? (
                  <Button variant="secondary" onClick={() => doAction('review')} loading={saving} className="w-full">
                    <Search size={14} /> Move to Under review
                  </Button>
                ) : null}
                {!detail.linkedCapaId && detail.batchId ? (
                  <Button variant="secondary" onClick={() => doAction('link')} loading={saving} className="w-full">
                    <Link2 size={14} /> Link to CAPA record
                  </Button>
                ) : null}
                <div className="flex gap-2">
                  <Select
                    value={signoffKind}
                    onChange={(e) => setSignoffKind(e.target.value as 'CLOSURE' | 'DISPOSITION')}
                    className="flex-1"
                  >
                    <option value="CLOSURE">Closure sign-off</option>
                    <option value="DISPOSITION">Disposition sign-off</option>
                  </Select>
                  <Button variant="secondary" onClick={() => doAction('signoff')} loading={saving} className="flex-1">
                    Request sign-off
                  </Button>
                </div>
                <Button onClick={() => doAction('close')} loading={saving} className="w-full">
                  <Lock size={14} /> Close nonconformity
                </Button>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Closure requires: root-cause analysis, product disposition and a completed dual sign-off.
                </p>
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-pass-bg px-4 py-3 text-sm font-medium text-pass-text">
                Closed {detail.closedAt ? fmtDate(detail.closedAt) : ''}
              </p>
            )}

            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={() => setDetail(null)}>
                <X size={14} /> Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
