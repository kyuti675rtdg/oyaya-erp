import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown, ArrowUp, Factory, FlaskConical, Package, Users, Wheat
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate, fmtDateTime, fmtQ } from '../lib/format';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { EmptyState, SectionTitle, Select, Spinner } from '../components/ui';
import {
  asNum, cardShell, fmtPct, ChainTimeline, StatusBadge,
  type BatchRec, type ChainStep
} from './TraceShared';

interface ShiftRec {
  id: string;
  shift: string;
  shiftDate: string;
  startedAt: string;
  endedAt?: string | null;
  operators: string[];
  downtimeMin?: number | null;
  outputs: Array<{ id: string; product?: { name: string } | null; quintals: string | number; extractionPct?: string | number | null; belowYieldFlag: boolean }>;
}

interface BatchChain {
  batch: BatchRec & { shifts: ShiftRec[] };
  upstream: {
    sources: Array<{ batchId: string; intakeId: string; quintals: string | number; intake: IntakeLike }>;
    tankFills: Array<{ id: string; tankCode: string; quintals: string | number; filledAt: string }>;
    cycles: Array<{ id: string; tankCode: string; batchNo: string; moistureAfter?: string | number | null }>;
  };
  downstream: {
    packRuns: Array<{ id: string; product?: { name: string } | null; bags: number; quintals: string | number; productionDate: string }>;
    fgLots: Array<{ id: string; batchNo: string; product?: { name: string } | null; bags: number; quintals: string | number; locationCode: string }>;
    customers: Array<{ name: string; quintals: number; bags: number }>;
  };
}

interface IntakeLike {
  id: string;
  intakeNo: string;
  truckPlate: string;
  wheatCategory: string;
  quintals: string | number;
  supplier?: { name: string } | null;
  decision?: string | null;
}

export function TraceBatch() {
  const [selectedId, setSelectedId] = useState('');

  const batchesQ = useQuery({
    queryKey: ['trace-batches'],
    queryFn: async () => (await api.get<BatchRec[]>(E.traceBatches)).data
  });

  const chainQ = useQuery({
    queryKey: ['trace-batch-chain', selectedId],
    queryFn: async () => (await api.get<BatchChain>(E.traceChain('batch', selectedId))).data,
    enabled: !!selectedId
  });

  const batches = batchesQ.data ?? [];
  const ch = chainQ.data;
  const steps: ChainStep[] = [];
  if (ch) {
    const b = ch.batch;
    const sourceQ = ch.upstream.sources.reduce((s, x) => s + asNum(x.quintals), 0);
    steps.push({
      icon: <Wheat className="h-4 w-4" />,
      title: 'Wheat sources',
      sub: (
        <ul className="mt-1 space-y-1">
          {ch.upstream.sources.map((s) => (
            <li key={s.intakeId} className="tnum">
              {s.intake.intakeNo} · {s.intake.supplier?.name ?? '—'} · {s.intake.wheatCategory.toLowerCase()} ·{' '}
              {fmtQ(s.quintals)} Q
            </li>
          ))}
          {ch.upstream.sources.length === 0 && <li>No intake sources linked</li>}
        </ul>
      ),
      badge: <span className="text-xs font-bold text-slate-500 dark:text-slate-400 tnum">{fmtQ(sourceQ)} Q total</span>,
      accent: 'bg-amber-100 text-amber-700'
    });
    if (ch.upstream.tankFills.length > 0 || ch.upstream.cycles.length > 0) {
      steps.push({
        icon: <Factory className="h-4 w-4" />,
        title: 'Conditioning',
        sub: (
          <span className="tnum">
            {ch.upstream.tankFills.map((f) => `${f.tankCode.replace('TANK_', 'Tank ')} (${fmtQ(f.quintals)} Q)`).join(' · ')}
            {ch.upstream.cycles.length > 0 && ` · cycles: ${ch.upstream.cycles.map((cy) => cy.batchNo).join(', ')}`}
          </span>
        ),
        accent: 'bg-cyan-100 text-cyan-700'
      });
    }
    steps.push({
      icon: <FlaskConical className="h-4 w-4" />,
      title: `Blend — ${b.batchNo}`,
      sub: (
        <span className="tnum">
          Soft {fmtPct(b.blendSoftPct)} ({fmtQ(b.blendSoftQ)} Q) · Hard {fmtPct(b.blendHardPct)} ({fmtQ(b.blendHardQ)} Q) ·{' '}
          Foreign {fmtPct(b.blendForeignPct)} ({fmtQ(b.blendForeignQ)} Q) · weighed {fmtQ(b.wheatWeighedQ)} Q
        </span>
      ),
      badge: <StatusBadge value={b.status} />,
      accent: 'bg-violet-100 text-violet-700'
    });
    b.shifts.forEach((sh) => {
      const outQ = sh.outputs.reduce((s, o) => s + asNum(o.quintals), 0);
      steps.push({
        icon: <Users className="h-4 w-4" />,
        title: `${sh.shift.toLowerCase()} shift — ${fmtDate(sh.shiftDate)}`,
        sub: (
          <span>
            <span>Operators: {sh.operators.length > 0 ? sh.operators.join(', ') : '—'}</span>
            <br />
            <span className="tnum">
              Outputs: {sh.outputs.map((o) => `${o.product?.name ?? '?'} ${fmtQ(o.quintals)} Q${o.extractionPct != null ? ` (extr. ${asNum(o.extractionPct).toFixed(1)}%)` : ''}`).join(' · ') || '—'}
            </span>
            {sh.outputs.some((o) => o.belowYieldFlag) && (
              <span className="mt-1 inline-block rounded bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">
                Below-yield flag
              </span>
            )}
          </span>
        ),
        date: `${fmtDateTime(sh.startedAt)}${sh.endedAt ? ` → ${fmtDateTime(sh.endedAt)}` : ''} · ${fmtQ(outQ)} Q total`,
        accent: 'bg-slate-100 text-slate-600'
      });
    });
    if (ch.downstream.packRuns.length > 0) {
      steps.push({
        icon: <Package className="h-4 w-4" />,
        title: 'Packaging lots',
        sub: (
          <ul className="mt-1 space-y-1 tnum">
            {ch.downstream.packRuns.map((p) => (
              <li key={p.id}>
                {p.product?.name ?? '—'} · {p.bags} bags · {fmtQ(p.quintals)} Q · packed {fmtDate(p.productionDate)}
              </li>
            ))}
          </ul>
        ),
        accent: 'bg-emerald-100 text-emerald-700'
      });
    }
    if (ch.downstream.customers.length > 0) {
      steps.push({
        icon: <ArrowUp className="h-4 w-4" />,
        title: 'Sales & dispatch',
        sub: (
          <span>{ch.downstream.customers.map((cu) => `${cu.name} (${fmtQ(cu.quintals)} Q, ${cu.bags} bags)`).join(' · ')}</span>
        ),
        accent: 'bg-blue-100 text-blue-700'
      });
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Wheat Blend & Production Batch History"
        sub="Batch genealogy — sources, blend ratios, shifts, outputs and packaging lots"
      />
      <div className={cardShell}>
        <CardHeader
          icon={<Factory className="h-4 w-4" />}
          title="Production batches"
          subtitle={`${batches.length} batches`}
          action={
            <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="!w-72 !py-2 !text-sm">
              <option value="">Select a batch…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNo} — {b.productType.toLowerCase().replace('_', ' ')}
                </option>
              ))}
            </Select>
          }
        />
        {batchesQ.isLoading ? (
          <Spinner label="Loading batches…" />
        ) : (
          <DataTable<BatchRec>
            rows={batches}
            columns={[
              { key: 'batchNo', label: 'Batch No', mono: true, render: (r) => <strong>{r.batchNo}</strong> },
              { key: 'createdAt', label: 'Created', render: (r) => fmtDate(r.createdAt), mono: true },
              { key: 'productType', label: 'Type', render: (r) => r.productType.toLowerCase().replace('_', ' ') },
              {
                key: 'blend', label: 'Blend S/H/F',
                render: (r) => (
                  <span className="tnum">
                    {asNum(r.blendSoftPct).toFixed(0)}/{asNum(r.blendHardPct).toFixed(0)}/{asNum(r.blendForeignPct).toFixed(0)}
                  </span>
                ),
                mono: true
              },
              { key: 'wheatWeighedQ', label: 'Weighed Q', render: (r) => fmtQ(r.wheatWeighedQ), mono: true },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
              {
                key: 'chain', label: '',
                render: (r) => (
                  <button
                    onClick={() => setSelectedId(r.id)}
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"
                  >
                    Trace
                  </button>
                )
              }
            ]}
          />
        )}
      </div>

      {selectedId && (
        <div className={cardShell}>
          <CardHeader
            icon={<ArrowDown className="h-4 w-4" />}
            title={`Batch genealogy — ${ch?.batch.batchNo ?? '…'}`}
            subtitle="Source tanks · blend · shifts · outputs · packaging lots · sales"
          />
          {chainQ.isLoading ? (
            <Spinner label="Building batch genealogy…" />
          ) : ch ? (
            <>
              <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Sources', String(ch.upstream.sources.length)],
                  ['Shifts', String(ch.batch.shifts.length)],
                  ['Pack runs', String(ch.downstream.packRuns.length)],
                  ['FG lots', String(ch.downstream.fgLots.length)]
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-slate-50 dark:bg-slate-800 px-4 py-3 text-center border border-slate-100 dark:border-slate-700">
                    <p className="text-2xl font-black text-slate-800 dark:text-slate-100 tnum">{v}</p>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{k}</p>
                  </div>
                ))}
              </div>
              <ChainTimeline steps={steps} />
            </>
          ) : (
            <EmptyState title="Could not load batch" />
          )}
        </div>
      )}
    </div>
  );
}
