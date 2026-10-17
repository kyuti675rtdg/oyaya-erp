import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Printer, Search, Wheat } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate, fmtQ } from '../lib/format';
import { CardHeader } from '../components/CardHeader';
import { EmptyState, SectionTitle, Spinner, TextInput } from '../components/ui';
import { cardShell, downloadCsv, StatusBadge } from './TraceShared';

interface SearchResult {
  q: string;
  batches: Array<{ id: string; batchNo: string; productType: string; status: string; createdAt: string }>;
  intakes: Array<{ id: string; intakeNo: string; truckPlate: string; deliveryDate: string; supplier?: { name: string } | null }>;
  lots: Array<{ id: string; batchNo: string; bags: number; quintals: string | number; receivedAt: string; product?: { name: string } | null }>;
  suppliers: Array<{ id: string; name: string; type: string }>;
}

type ReportKind = 'batch' | 'intake' | 'lot';

export function TraceSearch() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [submitted, setSubmitted] = useState<{ q: string; from: string; to: string } | null>(null);
  const [report, setReport] = useState<{ kind: ReportKind; id: string; label: string } | null>(null);

  const searchQ = useQuery({
    queryKey: ['trace-search', submitted],
    queryFn: async () =>
      (await api.get<SearchResult>(E.traceSearch(submitted!.q, submitted!.from || undefined, submitted!.to || undefined))).data,
    enabled: !!submitted
  });

  const chainQ = useQuery({
    queryKey: ['trace-search-chain', report],
    queryFn: async () => (await api.get<Record<string, unknown>>(E.traceChain(report!.kind === 'lot' ? 'lot' : report!.kind, report!.id))).data,
    enabled: !!report
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setSubmitted({ q: q.trim(), from, to });
    setReport(null);
  };

  const flattenChain = (chain: Record<string, unknown>): Array<Record<string, unknown>> => {
    const rows: Array<Record<string, unknown>> = [];
    const push = (stage: string, obj: Record<string, unknown>) => rows.push({ stage, ...obj });
    const any = chain as {
      intake?: Record<string, unknown>; lot?: Record<string, unknown>;
      batch?: Record<string, unknown>;
      upstream?: { sources?: Array<Record<string, unknown>>; tankFills?: Array<Record<string, unknown>> };
      downstream?: { packRuns?: Array<Record<string, unknown>>; fgLots?: Array<Record<string, unknown>>; customers?: Array<Record<string, unknown>> };
      ancestry?: Array<{ batch?: Record<string, unknown> }>;
      dispatchLines?: Array<Record<string, unknown>>;
      batches?: Array<{ batch?: Record<string, unknown> }>;
    };
    if (any.intake) {
      const i = any.intake as Record<string, unknown>;
      push('Intake', {
        intakeNo: i.intakeNo, supplier: (i.supplier as { name?: string } | undefined)?.name,
        truck: i.truckPlate, quintals: i.quintals, decision: i.decision ?? i.status
      });
    }
    if (any.lot) {
      const l = any.lot as Record<string, unknown>;
      push('Finished lot', {
        batchNo: l.batchNo, product: (l.product as { name?: string } | undefined)?.name,
        bags: l.bags, quintals: l.quintals, location: l.locationCode
      });
    }
    const batches: Array<Record<string, unknown>> = [];
    if (any.batch) batches.push(any.batch);
    (any.ancestry ?? []).forEach((a) => a.batch && batches.push(a.batch));
    (any.batches ?? []).forEach((b) => b.batch && batches.push(b.batch));
    const seen = new Set<string>();
    batches.forEach((b) => {
      const id = String(b.id ?? b.batchNo);
      if (seen.has(id)) return;
      seen.add(id);
      push('Production batch', { batchNo: b.batchNo, productType: b.productType, status: b.status, wheatWeighedQ: b.wheatWeighedQ });
    });
    (any.upstream?.sources ?? []).forEach((s) => {
      const i = (s.intake ?? {}) as Record<string, unknown>;
      push('Source intake', { intakeNo: i.intakeNo, supplier: (i.supplier as { name?: string } | undefined)?.name, quintals: s.quintals });
    });
    (any.upstream?.tankFills ?? []).forEach((f) => {
      push('Tank fill', { tank: f.tankCode, quintals: f.quintals, filledAt: f.filledAt });
    });
    (any.downstream?.packRuns ?? []).forEach((p) => {
      push('Packaging run', { product: (p.product as { name?: string } | undefined)?.name, bags: p.bags, quintals: p.quintals, date: p.productionDate });
    });
    (any.downstream?.fgLots ?? []).forEach((l) => {
      push('Finished lot', { batchNo: l.batchNo, product: (l.product as { name?: string } | undefined)?.name, bags: l.bags, quintals: l.quintals });
    });
    (any.downstream?.customers ?? []).forEach((cu) => {
      push('Customer', { customer: cu.name, quintals: cu.quintals, bags: cu.bags });
    });
    (any.dispatchLines ?? []).forEach((d) => {
      push('Dispatch', {
        batchNo: d.batchNo, product: (d.product as { name?: string } | undefined)?.name,
        quintals: d.quintals, customer: ((d.order ?? {}) as { customer?: { name?: string } }).customer?.name
      });
    });
    return rows;
  };

  const downloadReport = () => {
    if (!chainQ.data || !report) return;
    downloadCsv(`traceability-${report.kind}-${report.label.replace(/[^a-zA-Z0-9-]/g, '_')}.csv`, flattenChain(chainQ.data));
  };

  const r = searchQ.data;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Traceability Search & Reports"
        sub="Universal search by batch, lot, supplier or date — one-click full-chain report"
      />

      <div className={cardShell}>
        <CardHeader
          icon={<Search className="h-4 w-4" />}
          title="Search the full chain"
          subtitle="Matches batch numbers, lot numbers, suppliers and trucks"
        />
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
          <TextInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Batch no, lot no, supplier name, truck plate…"
            className="flex-1"
          />
          <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className="!w-44" />
          <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" className="!w-44" />
          <button
            type="submit"
            className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-700"
          >
            Search
          </button>
        </form>
      </div>

      {searchQ.isLoading ? (
        <Spinner label="Searching…" />
      ) : r ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className={cardShell}>
            <CardHeader icon={<Wheat className="h-4 w-4" />} title="Production batches" subtitle={`${r.batches.length} match(es)`} />
            {r.batches.length === 0 ? <EmptyState title="No batches" /> : (
              <ul className="space-y-2">
                {r.batches.map((b) => (
                  <li key={b.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800 tnum">{b.batchNo}</p>
                      <p className="text-xs text-slate-500">{b.productType.toLowerCase().replace('_', ' ')} · {fmtDate(b.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge value={b.status} />
                      <button
                        onClick={() => setReport({ kind: 'batch', id: b.id, label: b.batchNo })}
                        className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"
                      >
                        Full-chain report
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={cardShell}>
            <CardHeader icon={<FileText className="h-4 w-4" />} title="Intake batches" subtitle={`${r.intakes.length} match(es)`} />
            {r.intakes.length === 0 ? <EmptyState title="No intakes" /> : (
              <ul className="space-y-2">
                {r.intakes.map((i) => (
                  <li key={i.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800 tnum">{i.intakeNo}</p>
                      <p className="text-xs text-slate-500">{i.supplier?.name ?? '—'} · truck <span className="tnum">{i.truckPlate}</span> · {fmtDate(i.deliveryDate)}</p>
                    </div>
                    <button
                      onClick={() => setReport({ kind: 'intake', id: i.id, label: i.intakeNo })}
                      className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"
                    >
                      Full-chain report
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={cardShell}>
            <CardHeader icon={<FileText className="h-4 w-4" />} title="Finished-goods lots" subtitle={`${r.lots.length} match(es)`} />
            {r.lots.length === 0 ? <EmptyState title="No lots" /> : (
              <ul className="space-y-2">
                {r.lots.map((l) => (
                  <li key={l.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800 tnum">{l.batchNo} · {l.product?.name ?? '—'}</p>
                      <p className="text-xs text-slate-500 tnum">{l.bags} bags · {fmtQ(l.quintals)} Q</p>
                    </div>
                    <button
                      onClick={() => setReport({ kind: 'lot', id: l.id, label: `${l.batchNo}` })}
                      className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"
                    >
                      Full-chain report
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={cardShell}>
            <CardHeader icon={<Search className="h-4 w-4" />} title="Suppliers" subtitle={`${r.suppliers.length} match(es)`} />
            {r.suppliers.length === 0 ? <EmptyState title="No suppliers" /> : (
              <ul className="space-y-2">
                {r.suppliers.map((s) => (
                  <li key={s.id} className="rounded-xl border border-slate-100 px-4 py-3">
                    <p className="text-sm font-bold text-slate-800">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.type.toLowerCase()}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {report && (
        <div className={cardShell}>
          <CardHeader
            icon={<FileText className="h-4 w-4" />}
            title={`Full-chain report — ${report.label}`}
            subtitle={chainQ.data ? `${flattenChain(chainQ.data).length} chain stages` : 'Building report…'}
            action={
              <div className="flex gap-2">
                <button
                  onClick={downloadReport}
                  disabled={!chainQ.data}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </button>
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Printer className="h-3.5 w-3.5" /> Print
                </button>
                <button
                  onClick={() => setReport(null)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            }
          />
          {chainQ.isLoading ? (
            <Spinner label="Building full-chain report…" />
          ) : chainQ.data ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Stage</th>
                    <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {flattenChain(chainQ.data).map((row, i) => (
                    <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <StatusBadge value={String(row.stage ?? '')} />
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {Object.entries(row)
                          .filter(([k]) => k !== 'stage')
                          .map(([k, v]) => `${k}: ${v ?? '—'}`)
                          .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Could not build report" />
          )}
        </div>
      )}
    </div>
  );
}
