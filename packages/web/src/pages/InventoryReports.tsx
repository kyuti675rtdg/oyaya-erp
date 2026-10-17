import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Download } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { WhAgingRow, WhLocation, WhMovementSummaryRow, WhStockRow, WhValuationRow } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, Select, TextInput } from '../components/ui';
import {
  WhListState,
  cardShell,
  exportCsv,
  fmtBirr,
  fmtDate,
  fmtQ,
  useWhPerms
} from './WhShared';

type Tab = 'valuation' | 'movements' | 'aging' | 'stock';

const MOVEMENT_COLORS: Record<string, string> = {
  RECEIVE: '#8b5cf6',
  TRANSFER_IN: '#0ea5e9',
  TRANSFER_OUT: '#f59e0b',
  ADJUST_IN: '#10b981',
  ADJUST_OUT: '#f43f5e',
  ISSUE: '#f59e0b',
  DISPATCH: '#f43f5e',
  COUNT_IN: '#10b981',
  COUNT_OUT: '#fb7185'
};

const BUCKET_TONES: Record<WhAgingRow['bucket'], string> = {
  '0-30d': 'bg-emerald-100 text-emerald-700',
  '31-60d': 'bg-sky-100 text-sky-700',
  '61-90d': 'bg-amber-100 text-amber-700',
  '90d+': 'bg-rose-100 text-rose-700'
};

export function InventoryReports() {
  useWhPerms();
  const [tab, setTab] = useState<Tab>('valuation');
  const [locationId, setLocationId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const locationsQ = useQuery({
    queryKey: ['wh-locations'],
    queryFn: async () => (await api.get<WhLocation[]>(E.warehouseLocations)).data,
    staleTime: 60000
  });

  const locParam = locationId ? `?locationId=${locationId}` : '';

  const valuationQ = useQuery({
    queryKey: ['wh-valuation', locationId],
    queryFn: async () => (await api.get<WhValuationRow[]>(E.warehouseValuation + locParam)).data,
    enabled: tab === 'valuation'
  });

  const movementsQ = useQuery({
    queryKey: ['wh-movements', locationId, from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (locationId) params.set('locationId', locationId);
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      const qs = params.toString();
      return (await api.get<WhMovementSummaryRow[]>(E.warehouseMovements + (qs ? `?${qs}` : ''))).data;
    },
    enabled: tab === 'movements'
  });

  const agingQ = useQuery({
    queryKey: ['wh-aging', locationId],
    queryFn: async () => (await api.get<WhAgingRow[]>(E.warehouseAging + locParam)).data,
    enabled: tab === 'aging'
  });

  const stockQ = useQuery({
    queryKey: ['wh-stock', locationId],
    queryFn: async () => (await api.get<WhStockRow[]>(E.warehouseStock + locParam)).data,
    enabled: tab === 'stock'
  });

  const valuationTotals = useMemo(() => {
    const rows = valuationQ.data ?? [];
    return {
      qty: rows.reduce((s, r) => s + r.quintals, 0),
      value: rows.reduce((s, r) => s + r.valueBirr, 0),
      products: new Set(rows.map((r) => r.productId)).size
    };
  }, [valuationQ.data]);

  const agingTotals = useMemo(() => {
    const rows = agingQ.data ?? [];
    const byBucket: Record<string, number> = { '0-30d': 0, '31-60d': 0, '61-90d': 0, '90d+': 0 };
    for (const r of rows) byBucket[r.bucket] += r.quintals;
    return byBucket;
  }, [agingQ.data]);

  const movementChart = useMemo(
    () =>
      (movementsQ.data ?? []).map((m) => ({
        name: m.movementType.replace(/_/g, ' '),
        In: Math.round(m.inQ * 100) / 100,
        Out: Math.round(m.outQ * 100) / 100
      })),
    [movementsQ.data]
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: 'valuation', label: 'Valuation' },
    { id: 'movements', label: 'Movements' },
    { id: 'aging', label: 'Aging' },
    { id: 'stock', label: 'Current stock' }
  ];

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<BarChart3 size={16} />}
          title="Inventory Valuation & Reports"
          subtitle="Weighted-average-cost valuation, movement summary, stock aging, CSV export"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="!w-auto !py-2 !text-sm">
                <option value="">All locations</option>
                {(locationsQ.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </Select>
              {tab === 'movements' && (
                <>
                  <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-auto !py-2 !text-sm" aria-label="From date" />
                  <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-auto !py-2 !text-sm" aria-label="To date" />
                </>
              )}
            </div>
          }
        />

        <div className="mb-5 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm font-semibold">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-4 py-1.5 ${tab === t.id ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Valuation ─────────────────────────────────────────── */}
        {tab === 'valuation' && (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3">
              {[
                { label: 'Total quantity', value: `${fmtQ(valuationTotals.qty)} Qt` },
                { label: 'Total stock value', value: fmtBirr(valuationTotals.value) },
                { label: 'Products in stock', value: String(valuationTotals.products) }
              ].map((k) => (
                <div key={k.label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{k.label}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-slate-800">{k.value}</p>
                </div>
              ))}
            </div>
            <WhListState
              isLoading={valuationQ.isLoading}
              isError={valuationQ.isError}
              isEmpty={!valuationQ.isLoading && !valuationQ.isError && (valuationQ.data ?? []).length === 0}
              emptyTitle="No stock on hand"
              emptySub="Receive goods or place put-aways to build stock."
              onRetry={() => valuationQ.refetch()}
            />
            {(valuationQ.data ?? []).length > 0 && (
              <>
                <div className="mb-3 flex justify-end">
                  <Button
                    variant="secondary"
                    className="!px-3 !py-1.5 !text-xs"
                    onClick={() =>
                      exportCsv(
                        `warehouse-valuation-${fmtDate(new Date().toISOString())}.csv`,
                        ['Location', 'Product', 'Batch', 'Quintals', 'Bags', 'AvgCost_Br', 'Value_Br'],
                        (valuationQ.data ?? []).map((r) => [
                          r.locationCode,
                          r.productName,
                          r.batchNo ?? '',
                          r.quintals,
                          r.bags,
                          r.avgCostBirr,
                          r.valueBirr
                        ])
                      )
                    }
                  >
                    <Download size={13} /> Export CSV
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3">Location</th>
                        <th className="py-2 pr-3">Product</th>
                        <th className="py-2 pr-3">Batch</th>
                        <th className="py-2 pr-3 text-right">Qt</th>
                        <th className="py-2 pr-3 text-right">Avg cost (Br)</th>
                        <th className="py-2 text-right">Value (Br)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(valuationQ.data ?? []).map((r, i) => (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                          <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-violet-700">{r.locationCode}</td>
                          <td className="py-2.5 pr-3 font-semibold text-slate-800">{r.productName}</td>
                          <td className="py-2.5 pr-3 text-slate-500">{r.batchNo ?? '—'}</td>
                          <td className="py-2.5 pr-3 text-right font-bold tabular-nums">{fmtQ(r.quintals)}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{fmtQ(r.avgCostBirr)}</td>
                          <td className="py-2.5 text-right font-bold tabular-nums text-slate-800">{fmtBirr(r.valueBirr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Movements ─────────────────────────────────────────── */}
        {tab === 'movements' && (
          <>
            <WhListState
              isLoading={movementsQ.isLoading}
              isError={movementsQ.isError}
              isEmpty={!movementsQ.isLoading && !movementsQ.isError && (movementsQ.data ?? []).length === 0}
              emptyTitle="No movements in this period"
              emptySub="Adjust the date range or post warehouse activity."
              onRetry={() => movementsQ.refetch()}
            />
            {movementChart.length > 0 && (
              <>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={movementChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} dy={8} height={56} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: any) => [`${Number(v ?? 0).toLocaleString()} Qt`, '']} />
                      <Bar dataKey="In" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Out" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3">Movement</th>
                        <th className="py-2 pr-3 text-right">Lines</th>
                        <th className="py-2 pr-3 text-right">In (Qt)</th>
                        <th className="py-2 text-right">Out (Qt)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(movementsQ.data ?? []).map((m) => (
                        <tr key={m.movementType} className="border-b border-slate-50">
                          <td className="py-2.5 pr-3">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full mr-2"
                              style={{ background: MOVEMENT_COLORS[m.movementType] ?? '#64748b' }}
                            />
                            <span className="font-semibold text-slate-800">{m.movementType.replace(/_/g, ' ')}</span>
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{m.lines}</td>
                          <td className="py-2.5 pr-3 text-right font-bold tabular-nums text-emerald-700">{fmtQ(m.inQ)}</td>
                          <td className="py-2.5 text-right font-bold tabular-nums text-rose-700">{fmtQ(m.outQ)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    variant="secondary"
                    className="!px-3 !py-1.5 !text-xs"
                    onClick={() =>
                      exportCsv(
                        `warehouse-movements-${fmtDate(new Date().toISOString())}.csv`,
                        ['MovementType', 'Lines', 'In_Qt', 'Out_Qt'],
                        (movementsQ.data ?? []).map((m) => [m.movementType, m.lines, m.inQ, m.outQ])
                      )
                    }
                  >
                    <Download size={13} /> Export CSV
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Aging ─────────────────────────────────────────────── */}
        {tab === 'aging' && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(['0-30d', '31-60d', '61-90d', '90d+'] as WhAgingRow['bucket'][]).map((b) => (
                <div key={b} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <p className="mb-1">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${BUCKET_TONES[b]}`}>{b}</span>
                  </p>
                  <p className="text-lg font-bold tabular-nums text-slate-800">{fmtQ(agingTotals[b])} Qt</p>
                </div>
              ))}
            </div>
            <WhListState
              isLoading={agingQ.isLoading}
              isError={agingQ.isError}
              isEmpty={!agingQ.isLoading && !agingQ.isError && (agingQ.data ?? []).length === 0}
              emptyTitle="No stock aging data"
              emptySub="Aging is computed from the first receipt date of each stock line."
              onRetry={() => agingQ.refetch()}
            />
            {(agingQ.data ?? []).length > 0 && (
              <>
                <div className="mb-3 flex justify-end">
                  <Button
                    variant="secondary"
                    className="!px-3 !py-1.5 !text-xs"
                    onClick={() =>
                      exportCsv(
                        `warehouse-aging-${fmtDate(new Date().toISOString())}.csv`,
                        ['Location', 'Product', 'Batch', 'Quintals', 'DaysOld', 'Bucket'],
                        (agingQ.data ?? []).map((r) => [r.locationCode, r.productName, r.batchNo ?? '', r.quintals, r.daysOld, r.bucket])
                      )
                    }
                  >
                    <Download size={13} /> Export CSV
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3">Location</th>
                        <th className="py-2 pr-3">Product</th>
                        <th className="py-2 pr-3 text-right">Qt</th>
                        <th className="py-2 pr-3 text-right">Days old</th>
                        <th className="py-2">Bucket</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(agingQ.data ?? []).map((r, i) => (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                          <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-violet-700">{r.locationCode}</td>
                          <td className="py-2.5 pr-3 font-semibold text-slate-800">
                            {r.productName}
                            {r.batchNo ? <span className="block text-[11px] font-normal text-slate-500">Batch {r.batchNo}</span> : null}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-bold tabular-nums">{fmtQ(r.quintals)}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{r.daysOld}</td>
                          <td className="py-2">
                            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${BUCKET_TONES[r.bucket]}`}>
                              {r.bucket}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Current stock ─────────────────────────────────────── */}
        {tab === 'stock' && (
          <>
            <WhListState
              isLoading={stockQ.isLoading}
              isError={stockQ.isError}
              isEmpty={!stockQ.isLoading && !stockQ.isError && (stockQ.data ?? []).length === 0}
              emptyTitle="No stock on hand"
              emptySub="Receive goods or place put-aways to build stock."
              onRetry={() => stockQ.refetch()}
            />
            {(stockQ.data ?? []).length > 0 && (
              <>
                <div className="mb-3 flex justify-end">
                  <Button
                    variant="secondary"
                    className="!px-3 !py-1.5 !text-xs"
                    onClick={() =>
                      exportCsv(
                        `warehouse-stock-${fmtDate(new Date().toISOString())}.csv`,
                        ['Location', 'Product', 'Batch', 'OnHand_Qt', 'Bags', 'Reserved_Qt', 'Available_Qt'],
                        (stockQ.data ?? []).map((r) => [
                          r.locationCode,
                          r.productName,
                          r.batchNo ?? '',
                          r.quintals,
                          r.bags,
                          r.reservedQ,
                          r.availableQ
                        ])
                      )
                    }
                  >
                    <Download size={13} /> Export CSV
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3">Location</th>
                        <th className="py-2 pr-3">Product</th>
                        <th className="py-2 pr-3 text-right">On hand (Qt)</th>
                        <th className="py-2 pr-3 text-right">Bags</th>
                        <th className="py-2 pr-3 text-right">Reserved (Qt)</th>
                        <th className="py-2 text-right">Available (Qt)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stockQ.data ?? []).map((r, i) => (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                          <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-violet-700">{r.locationCode}</td>
                          <td className="py-2.5 pr-3 font-semibold text-slate-800">
                            {r.productName}
                            {r.batchNo ? <span className="block text-[11px] font-normal text-slate-500">Batch {r.batchNo}</span> : null}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-bold tabular-nums">{fmtQ(r.quintals)}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{r.bags}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-amber-700">{fmtQ(r.reservedQ)}</td>
                          <td className="py-2.5 text-right font-bold tabular-nums text-emerald-700">{fmtQ(r.availableQ)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
