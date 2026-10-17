import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, Factory, Package, Truck, Wheat } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate, fmtDateTime, fmtQ } from '../lib/format';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { EmptyState, SectionTitle, Select, Spinner, TextInput } from '../components/ui';
import {
  cardShell, fmtPct, ChainTimeline, StatusBadge,
  type ChainStep, type LotRec
} from './TraceShared';

interface LotChain {
  lot: LotRec;
  packRuns: Array<{
    id: string; bags: number; quintals: string | number; productionDate: string;
    product?: { name: string } | null;
    batch: { id: string; batchNo: string; productType: string; status: string };
  }>;
  ancestry: Array<{
    batch: { id: string; batchNo: string; productType: string; status: string };
    upstream: {
      sources: Array<{ intakeId: string; quintals: string | number; intake: { intakeNo: string; truckPlate: string; wheatCategory: string; quintals: string | number; supplier?: { name: string } | null; decision?: string | null } }>;
      tankFills: Array<{ tankCode: string; quintals: string | number; filledAt: string }>;
      cycles: Array<{ tankCode: string; batchNo: string }>;
    };
    quality: {
      labChecks: Array<{ id: string; sampleTime: string; outOfRange: string[] }>;
      flourTests: Array<{ id: string; productLabel: string; verdict: string }>;
      nonconformities: Array<{ id: string; ncNo: string; severity: string; status: string }>;
    };
  }>;
  dispatchLines: Array<{
    id: string; batchNo?: string | null; bags: number; quintals: string | number;
    product?: { name: string } | null;
    dispatch?: { exitNoteNo: string; area: string; dispatchedAt: string } | null;
    order?: { customer?: { name: string } | null } | null;
  }>;
}

export function TraceFinished() {
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const lotsQ = useQuery({
    queryKey: ['trace-lots'],
    queryFn: async () => (await api.get<LotRec[]>(E.traceLots)).data
  });

  const chainQ = useQuery({
    queryKey: ['trace-lot-chain', selectedId],
    queryFn: async () => (await api.get<LotChain>(E.traceChain('lot', selectedId))).data,
    enabled: !!selectedId
  });

  const lots = (lotsQ.data ?? []).filter((l) =>
    !filter ||
    l.batchNo.toLowerCase().includes(filter.toLowerCase()) ||
    (l.product?.name ?? '').toLowerCase().includes(filter.toLowerCase()) ||
    l.locationCode.toLowerCase().includes(filter.toLowerCase())
  );

  const ch = chainQ.data;
  const steps: ChainStep[] = [];
  if (ch) {
    const lot = ch.lot;
    steps.push({
      icon: <Package className="h-4 w-4" />,
      title: `Finished lot — ${lot.product?.name ?? '—'} · ${lot.batchNo}`,
      sub: (
        <span className="tnum">
          <strong>{lot.bags} bags</strong> · {fmtQ(lot.quintals)} Q · location {lot.locationCode} · received{' '}
          {fmtDateTime(lot.receivedAt)}
        </span>
      ),
      accent: 'bg-emerald-100 text-emerald-700'
    });
    ch.packRuns.forEach((p) => {
      steps.push({
        icon: <Factory className="h-4 w-4" />,
        title: `Packaging run — ${p.batch.batchNo}`,
        sub: (
          <span className="tnum">
            {p.bags} bags · {fmtQ(p.quintals)} Q of {p.product?.name ?? '—'} · packed {fmtDate(p.productionDate)}
          </span>
        ),
        accent: 'bg-violet-100 text-violet-700'
      });
    });
    ch.ancestry.forEach((a) => {
      const ncOpen = a.quality.nonconformities.filter((n) => n.status !== 'CLOSED');
      steps.push({
        icon: <Wheat className="h-4 w-4" />,
        title: `Wheat ancestry — batch ${a.batch.batchNo}`,
        sub: (
          <span>
            {a.upstream.sources.length === 0 && <span>No intake sources linked. </span>}
            {a.upstream.sources.map((s, i) => (
              <span key={s.intakeId}>
                {i > 0 && ' · '}
                <span className="tnum">
                  {s.intake.intakeNo} ({s.intake.supplier?.name ?? '—'}, {s.intake.wheatCategory.toLowerCase()}, truck{' '}
                  {s.intake.truckPlate}, {fmtQ(s.quintals)} Q)
                </span>
              </span>
            ))}
            {a.upstream.tankFills.length > 0 && (
              <span className="tnum">
                {' '}→ tanks {a.upstream.tankFills.map((f) => f.tankCode.replace('TANK_', '')).join(', ')}
              </span>
            )}
            <br />
            <span className="tnum">
              {a.quality.labChecks.length} lab checks · {a.quality.flourTests.length} flour tests ·{' '}
              {a.quality.nonconformities.length} NCs
            </span>
            {ncOpen.length > 0 && (
              <span className="ml-2 rounded bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">
                {ncOpen.length} open NC
              </span>
            )}
          </span>
        ),
        badge: <StatusBadge value={a.batch.status} />,
        accent: 'bg-amber-100 text-amber-700'
      });
    });
    ch.dispatchLines.forEach((d) => {
      steps.push({
        icon: <Truck className="h-4 w-4" />,
        title: `Dispatched — ${d.dispatch?.exitNoteNo ?? 'exit note pending'}`,
        sub: (
          <span className="tnum">
            {d.bags} bags · {fmtQ(d.quintals)} Q of {d.product?.name ?? '—'} · customer{' '}
            <strong>{d.order?.customer?.name ?? 'walk-in'}</strong>
            {d.dispatch ? ` · ${d.dispatch.area} · ${fmtDateTime(d.dispatch.dispatchedAt)}` : ''}
          </span>
        ),
        accent: 'bg-blue-100 text-blue-700'
      });
    });
    if (ch.dispatchLines.length === 0) {
      steps.push({
        icon: <Truck className="h-4 w-4" />,
        title: 'Not yet dispatched',
        sub: <span>Lot is still in finished-goods stock.</span>,
        accent: 'bg-slate-100 text-slate-500'
      });
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Finished Product Traceability"
        sub="Every finished lot's complete ancestry — packaging run → batch → wheat sources"
      />
      <div className={cardShell}>
        <CardHeader
          icon={<Package className="h-4 w-4" />}
          title="Finished-goods lots"
          subtitle={`${lots.length} lots in stock`}
          action={
            <div className="flex gap-2">
              <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="!w-64 !py-2 !text-sm">
                <option value="">Select a lot…</option>
                {lots.slice(0, 100).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.batchNo} — {l.product?.name ?? '?'} ({l.locationCode})
                  </option>
                ))}
              </Select>
              <TextInput
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="!w-40 !py-2 !text-sm"
              />
            </div>
          }
        />
        {lotsQ.isLoading ? (
          <Spinner label="Loading lots…" />
        ) : (
          <DataTable<LotRec>
            rows={lots}
            columns={[
              { key: 'batchNo', label: 'Batch No', mono: true, render: (r) => <strong>{r.batchNo}</strong> },
              { key: 'product', label: 'Product', render: (r) => r.product?.name ?? '—' },
              { key: 'bags', label: 'Bags', render: (r) => String(r.bags), mono: true },
              { key: 'quintals', label: 'Q', render: (r) => fmtQ(r.quintals), mono: true },
              { key: 'locationCode', label: 'Location', mono: true },
              { key: 'receivedAt', label: 'Received', render: (r) => fmtDate(r.receivedAt), mono: true },
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
            title={`Lot ancestry — ${ch?.lot.batchNo ?? '…'} ${ch?.lot.product?.name ? `· ${ch.lot.product.name}` : ''}`}
            subtitle="Packaging → batch → wheat sources → dispatch"
          />
          {chainQ.isLoading ? (
            <Spinner label="Building lot ancestry…" />
          ) : ch ? (
            <ChainTimeline steps={steps} />
          ) : (
            <EmptyState title="Could not load lot" />
          )}
        </div>
      )}
      <p className="text-xs text-slate-400">Duket below {fmtPct(78)} extraction is auto-flagged on the source batch's yield alerts.</p>
    </div>
  );
}
