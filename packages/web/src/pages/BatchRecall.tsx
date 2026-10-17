import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon, ClipboardList, FileSearch, Package, ShieldAlert, Truck
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime, fmtQ } from '../lib/format';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { EmptyState, SectionTitle, Select, Spinner, TextArea } from '../components/ui';
import {
  cardShell, downloadCsv, ChainTimeline, StatusBadge,
  type BatchRec, type ChainStep, type RecallCaseRec
} from './TraceShared';

interface Impact {
  batch: { id: string; batchNo: string; productType: string; status: string; wheatWeighedQ: string | number };
  upstream: {
    sources: Array<{ intake: { intakeNo: string; supplier?: { name: string } | null } }>;
  };
  downstream: {
    packRuns: Array<{ id: string; product?: { name: string } | null; bags: number; quintals: string | number }>;
    fgLots: Array<{ id: string; batchNo: string; product?: { name: string } | null; bags: number; quintals: string | number }>;
    dispatchLines: Array<{ id: string; batchNo?: string | null; bags: number; quintals: string | number; product?: { name: string } | null; dispatch?: { exitNoteNo: string } | null; order?: { customer?: { name: string } | null } | null }>;
    customers: Array<{ name: string; quintals: number; bags: number }>;
  };
  impact: {
    packRunCount: number; lotCount: number; dispatchLineCount: number;
    customerCount: number; dispatchedQuintals: number;
    customers: Array<{ name: string; quintals: number; bags: number }>;
  };
}

export function BatchRecall() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('qc:create');

  const [rootBatchId, setRootBatchId] = useState('');
  const [severity, setSeverity] = useState('CLASS_II');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [stepNote, setStepNote] = useState('');
  const [disposition, setDisposition] = useState('');

  const batchesQ = useQuery({
    queryKey: ['trace-batches'],
    queryFn: async () => (await api.get<BatchRec[]>(E.traceBatches)).data
  });

  const impactQ = useQuery({
    queryKey: ['trace-recall-impact', rootBatchId],
    queryFn: async () => (await api.get<Impact>(E.traceRecallImpact(rootBatchId))).data,
    enabled: !!rootBatchId
  });

  const casesQ = useQuery({
    queryKey: ['trace-recall-cases'],
    queryFn: async () => (await api.get<RecallCaseRec[]>(E.traceRecallCases)).data
  });

  const caseQ = useQuery({
    queryKey: ['trace-recall-case', caseId],
    queryFn: async () => (await api.get<RecallCaseRec>(E.traceRecallCase(caseId!))).data,
    enabled: !!caseId
  });

  const createCase = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!rootBatchId || !reason.trim()) {
      setNotice({ ok: false, text: 'Select the root-cause batch and describe the reason.' });
      return;
    }
    setSaving(true);
    try {
      const impact = impactQ.data;
      const { data } = await api.post<RecallCaseRec>(E.traceRecallCases, {
        rootType: 'BATCH',
        rootBatchId,
        rootBatchNo: impact?.batch.batchNo,
        severity,
        reason: reason.trim()
      });
      setNotice({ ok: true, text: `Recall case ${data.caseNo} created with ${data.items?.length ?? 0} affected items.` });
      setReason('');
      setCaseId(data.id);
      qc.invalidateQueries({ queryKey: ['trace-recall-cases'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create recall case.' });
    } finally {
      setSaving(false);
    }
  };

  const patchCase = async (patch: Record<string, string>) => {
    if (!caseId) return;
    setNotice(null);
    try {
      await api.patch(E.traceRecallCase(caseId), patch);
      setNotice({ ok: true, text: 'Recall case updated.' });
      setStepNote('');
      setDisposition('');
      qc.invalidateQueries({ queryKey: ['trace-recall-case', caseId] });
      qc.invalidateQueries({ queryKey: ['trace-recall-cases'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Update failed.' });
    }
  };

  const exportCaseCsv = (c: RecallCaseRec) => {
    const rows = (c.items ?? []).map((it) => ({
      caseNo: c.caseNo,
      severity: c.severity.replace('_', ' '),
      status: c.status,
      batchNo: it.batchNo ?? '',
      lotId: it.lotNo ?? '',
      product: it.productName ?? '',
      quintals: it.quintals ?? '',
      bags: it.bags ?? '',
      customer: it.customerName ?? '',
      itemStatus: it.status
    }));
    downloadCsv(`recall-${c.caseNo}.csv`, rows.length > 0 ? rows : [{ caseNo: c.caseNo, note: 'no affected items' }]);
  };

  const impact = impactQ.data;
  const impactSteps: ChainStep[] = [];
  if (impact) {
    impactSteps.push({
      icon: <FileSearch className="h-4 w-4" />,
      title: `Root cause — batch ${impact.batch.batchNo}`,
      sub: (
        <span className="tnum">
          {impact.batch.productType.toLowerCase().replace('_', ' ')} · weighed {fmtQ(impact.batch.wheatWeighedQ)} Q · sources:{' '}
          {impact.upstream.sources.map((s) => `${s.intake.intakeNo} (${s.intake.supplier?.name ?? '—'})`).join(', ') || '—'}
        </span>
      ),
      badge: <StatusBadge value={impact.batch.status} />,
      accent: 'bg-red-100 text-red-700'
    });
    impactSteps.push({
      icon: <Package className="h-4 w-4" />,
      title: `Affected packaging & lots (${impact.impact.lotCount} lots)`,
      sub: (
        <ul className="mt-1 space-y-1 tnum">
          {impact.downstream.fgLots.slice(0, 15).map((l) => (
            <li key={l.id}>
              {l.product?.name ?? '—'} · batch {l.batchNo} · {l.bags} bags · {fmtQ(l.quintals)} Q
            </li>
          ))}
          {impact.downstream.fgLots.length > 15 && <li>…and {impact.downstream.fgLots.length - 15} more</li>}
          {impact.downstream.fgLots.length === 0 && <li>No finished lots produced from this batch</li>}
        </ul>
      ),
      accent: 'bg-orange-100 text-orange-700'
    });
    impactSteps.push({
      icon: <Truck className="h-4 w-4" />,
      title: `Affected customers (${impact.impact.customerCount})`,
      sub: (
        <span>
          {impact.impact.customers.length === 0
            ? 'Nothing dispatched — containment is at finished-goods stock.'
            : impact.impact.customers.map((cu) => `${cu.name} (${fmtQ(cu.quintals)} Q)`).join(' · ')}
        </span>
      ),
      badge: <span className="text-xs font-bold text-slate-500 dark:text-slate-400 tnum">{fmtQ(impact.impact.dispatchedQuintals)} Q dispatched</span>,
      accent: 'bg-blue-100 text-blue-700'
    });
  }

  const c = caseQ.data;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Batch Recall & Investigation"
        sub="Pick a root-cause batch → auto-identify everything downstream → investigate → disposition → close"
      />

      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {notice.text}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className={cardShell}>
          <CardHeader
            icon={<AlertOctagon className="h-4 w-4" />}
            title="1 · Root cause & impact"
            subtitle="Select the suspect batch to auto-identify all affected downstream"
          />
          <Select value={rootBatchId} onChange={(e) => setRootBatchId(e.target.value)} className="mb-4">
            <option value="">Select root-cause batch…</option>
            {(batchesQ.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>{b.batchNo} — {b.productType.toLowerCase().replace('_', ' ')}</option>
            ))}
          </Select>
          {impactQ.isLoading ? (
            <Spinner label="Analyzing impact…" />
          ) : impact ? (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Pack runs', impact.impact.packRunCount],
                  ['Lots', impact.impact.lotCount],
                  ['Dispatches', impact.impact.dispatchLineCount],
                  ['Customers', impact.impact.customerCount]
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-slate-50 dark:bg-slate-800 px-3 py-3 text-center border border-slate-100 dark:border-slate-700">
                    <p className="text-2xl font-black text-slate-800 dark:text-slate-100 tnum">{v}</p>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{k}</p>
                  </div>
                ))}
              </div>
              <ChainTimeline steps={impactSteps} />
            </>
          ) : (
            <EmptyState title="No batch selected" sub="Impact analysis appears here." />
          )}
        </div>

        <div className={cardShell}>
          <CardHeader
            icon={<ClipboardList className="h-4 w-4" />}
            title="2 · Create recall case"
            subtitle={canManage ? 'Quality permission confirmed' : 'Requires quality manage permission'}
          />
          {!canManage ? (
            <EmptyState title="Permission required" sub="Recall cases can only be created by quality management (qc:manage)." />
          ) : (
            <form onSubmit={createCase} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Severity</label>
                <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  <option value="CLASS_I">Class I — serious health risk</option>
                  <option value="CLASS_II">Class II — reversible / quality risk</option>
                  <option value="CLASS_III">Class III — unlikely to cause harm</option>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Reason</label>
                <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe the defect, complaint or finding…" />
              </div>
              <button
                type="submit"
                disabled={saving || !rootBatchId}
                className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create recall case with auto-computed impact'}
              </button>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Affected lots, dispatches and customers are snapshotted onto the case at creation.
              </p>
            </form>
          )}
        </div>
      </div>

      <div className={cardShell}>
        <CardHeader
          icon={<ShieldAlert className="h-4 w-4" />}
          title="Recall cases"
          subtitle={`${(casesQ.data ?? []).length} cases`}
        />
        {casesQ.isLoading ? (
          <Spinner label="Loading cases…" />
        ) : (
          <DataTable<RecallCaseRec>
            rows={casesQ.data ?? []}
            columns={[
              { key: 'caseNo', label: 'Case', mono: true, render: (r) => <strong>{r.caseNo}</strong> },
              { key: 'rootBatchNo', label: 'Root batch', mono: true, render: (r) => r.rootBatchNo ?? r.rootLotNo ?? '—' },
              { key: 'severity', label: 'Severity', render: (r) => <StatusBadge value={r.severity} /> },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
              { key: 'items', label: 'Items', render: (r) => String(r._count?.items ?? r.items?.length ?? 0), mono: true },
              { key: 'createdAt', label: 'Opened', render: (r) => fmtDateTime(r.createdAt), mono: true },
              {
                key: 'open', label: '',
                render: (r) => (
                  <button
                    onClick={() => setCaseId(r.id)}
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"
                  >
                    Investigate
                  </button>
                )
              }
            ]}
          />
        )}
      </div>

      {caseId && (
        <div className={cardShell}>
          <CardHeader
            icon={<FileSearch className="h-4 w-4" />}
            title={`Investigation — ${c?.caseNo ?? '…'}`}
            subtitle={c ? `${c.reason}` : ''}
            action={
              <div className="flex gap-2">
                {c && (
                  <button
                    onClick={() => exportCaseCsv(c)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    Export CSV
                  </button>
                )}
                <button
                  onClick={() => setCaseId(null)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Close
                </button>
              </div>
            }
          />
          {caseQ.isLoading ? (
            <Spinner label="Loading case…" />
          ) : c ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value={c.status} />
                <StatusBadge value={c.severity} />
                {c.disposition && <StatusBadge value={c.disposition} />}
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  Opened {fmtDateTime(c.createdAt)}{c.closedAt ? ` · closed ${fmtDateTime(c.closedAt)}` : ''}
                </span>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Affected items ({c.items?.length ?? 0})
                </p>
                <DataTable
                  rows={c.items ?? []}
                  columns={[
                    { key: 'batchNo', label: 'Batch', mono: true, render: (r) => r.batchNo ?? '—' },
                    { key: 'productName', label: 'Product' },
                    { key: 'quintals', label: 'Q', render: (r) => fmtQ(r.quintals), mono: true },
                    { key: 'bags', label: 'Bags', render: (r) => String(r.bags ?? '—'), mono: true },
                    { key: 'customerName', label: 'Customer', render: (r) => r.customerName ?? '—' },
                    { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> }
                  ]}
                />
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Investigation log</p>
                {(c.investigationLog ?? []).length === 0 ? (
                  <EmptyState title="No investigation steps yet" sub="Log each step of the investigation below." />
                ) : (
                  <ol className="space-y-2">
                    {(c.investigationLog ?? []).map((s, i) => (
                      <li key={i} className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 px-4 py-3 text-sm">
                        <p className="text-slate-800 dark:text-slate-100">{s.step}</p>
                        <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500 tnum">{fmtDateTime(s.at)} · {s.by}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {canManage && c.status !== 'CLOSED' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-100 dark:border-slate-700 p-4">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Add investigation step</p>
                    <TextArea value={stepNote} onChange={(e) => setStepNote(e.target.value)} placeholder="Finding, test result, customer call…" />
                    <button
                      onClick={() => stepNote.trim() && patchCase({ investigationNote: stepNote.trim(), status: 'INVESTIGATING' })}
                      className="mt-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700"
                    >
                      Log step
                    </button>
                  </div>
                  <div className="rounded-xl border border-slate-100 dark:border-slate-700 p-4">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Disposition decision</p>
                    <Select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
                      <option value="">Select disposition…</option>
                      <option value="RELEASE">Release — product is safe</option>
                      <option value="REWORK">Rework — reprocess affected lots</option>
                      <option value="REJECT">Reject — quarantine / return</option>
                      <option value="DESTROY">Destroy — dispose of product</option>
                    </Select>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => disposition && patchCase({ disposition, status: 'DISPOSITIONED' })}
                        disabled={!disposition}
                        className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        Record disposition
                      </button>
                      <button
                        onClick={() => patchCase({ status: 'CLOSED' })}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
                      >
                        Close case
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState title="Case not found" />
          )}
        </div>
      )}
    </div>
  );
}
