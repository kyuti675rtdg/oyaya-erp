import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Hourglass, ListOrdered } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { AgingBucket, AgingLot, FefoSuggestion } from '../types';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Select } from '../components/ui';
import { fmtDate, fmtQ } from '../lib/format';
import {
  FgBadge,
  FgEmpty,
  FgError,
  FgPageHeader,
  FgSkeleton,
  agingStatusBadge,
  bucketBadge,
  cardShell
} from './FgShared';

const BUCKETS: AgingBucket[] = ['0-30', '31-60', '61-90', '90+'];

interface AgingResponse {
  lots: AgingLot[];
  summary: { bucket: AgingBucket; lots: number; quintals: number }[];
  nearExpiry: AgingLot[];
  fefo: FefoSuggestion[];
}

export function StockAging() {
  const hasClaim = useAuth((s) => s.hasClaim);
  const [bucket, setBucket] = useState('');

  const agingQ = useQuery({
    queryKey: ['fg-aging', bucket],
    queryFn: async () =>
      (await api.get<AgingResponse>(`${E.fgAging}${bucket ? `?bucket=${bucket}` : ''}`)).data,
    enabled: hasClaim('fg:view')
  });

  const data = agingQ.data;
  const lots = data?.lots ?? [];
  const summary = data?.summary ?? [];
  const nearExpiry = data?.nearExpiry ?? [];
  const fefo = data?.fefo ?? [];

  if (!hasClaim('fg:view')) {
    return (
      <div className="space-y-4">
        <FgPageHeader title="Stock Aging & Expiry Monitoring" subtitle="Aging buckets, expiry alerts, FEFO dispatch order" />
        <FgError message="You do not have permission to view stock aging (fg:view)." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FgPageHeader
        title="Stock Aging & Expiry Monitoring"
        subtitle="Lots bucketed 0–30 / 31–60 / 61–90 / 90+ days with expiry alerts and FEFO dispatch suggestions"
        actions={
          <Select value={bucket} onChange={(e) => setBucket(e.target.value)} className="max-w-[200px]">
            <option value="">All buckets</option>
            {BUCKETS.map((b) => (
              <option key={b} value={b}>{b} days</option>
            ))}
          </Select>
        }
      />

      {/* Bucket summary */}
      {agingQ.isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {BUCKETS.map((b) => (
            <div key={b} className={cardShell}>
              <div className="h-4 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
              <div className="mt-3 h-8 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
            </div>
          ))}
        </div>
      ) : agingQ.isError ? (
        <FgError message="Failed to load aging data" onRetry={() => agingQ.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {summary.map((s) => (
            <div key={s.bucket} className={cardShell}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Age {s.bucket} days</p>
                {bucketBadge(s.bucket)}
              </div>
              <p className="tnum mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{fmtQ(s.quintals)} <span className="text-base font-medium text-slate-500 dark:text-slate-400">q</span></p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.lots} lot(s)</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* FEFO */}
        <div className={`${cardShell} xl:col-span-1`}>
          <CardHeader icon={<ListOrdered size={16} />} title="FEFO suggestion" subtitle="Oldest lot per product — dispatch these first" />
          {agingQ.isLoading ? (
            <FgSkeleton rows={3} />
          ) : agingQ.isError ? (
            <FgError message="Failed to load FEFO" onRetry={() => agingQ.refetch()} />
          ) : fefo.length === 0 ? (
            <FgEmpty title="No lots with stock" sub="FEFO suggestions appear once lots carry stock." />
          ) : (
            <div className="space-y-2.5">
              {fefo.map((f) => (
                <div key={f.productId} className="rounded-xl border border-violet-200 bg-violet-50/50 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{f.productName}</p>
                      <p className="tnum mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                        {f.batchNo} · {f.bagLabel} · {f.locationCode}
                      </p>
                    </div>
                    <ArrowRight size={15} className="mt-1 shrink-0 text-violet-600" />
                  </div>
                  <div className="tnum mt-2 flex items-center gap-3 text-xs">
                    <span className="font-bold text-violet-700">{fmtQ(f.quintals)} q available</span>
                    <span className="text-slate-500 dark:text-slate-400">{f.agingDays}d old</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expiry alerts */}
        <div className={`${cardShell} xl:col-span-2`}>
          <CardHeader icon={<Hourglass size={16} />} title="Expiry alerts" subtitle="Lots expiring within 30 days or already expired" />
          {agingQ.isLoading ? (
            <FgSkeleton rows={3} />
          ) : agingQ.isError ? (
            <FgError message="Failed to load alerts" onRetry={() => agingQ.refetch()} />
          ) : nearExpiry.length === 0 ? (
            <FgEmpty title="No expiry alerts" sub="Every lot has more than 30 days of shelf life remaining." />
          ) : (
            <DataTable<AgingLot>
              columns={[
                { key: 'productName', label: 'Product' },
                { key: 'batchNo', label: 'Batch', mono: true, render: (r) => <span className="font-semibold">{r.batchNo}</span> },
                { key: 'bagLabel', label: 'Bag' },
                { key: 'quintals', label: 'Qt', mono: true, render: (r) => <span className="font-bold">{fmtQ(r.quintals)}</span> },
                { key: 'expiryDate', label: 'Expires', render: (r) => fmtDate(r.expiryDate) },
                {
                  key: 'daysToExpiry',
                  label: 'Days left',
                  mono: true,
                  render: (r) => (
                    <span className={`font-bold ${r.daysToExpiry < 0 ? 'text-rose-700' : 'text-amber-700'}`}>
                      {r.daysToExpiry < 0 ? `${Math.abs(r.daysToExpiry)}d overdue` : `${r.daysToExpiry}d`}
                    </span>
                  )
                },
                { key: 'status', label: 'Status', render: (r) => agingStatusBadge(r.status) }
              ]}
              rows={nearExpiry}
            />
          )}
        </div>
      </div>

      {/* All lots */}
      <div className={cardShell}>
        <CardHeader icon={<Hourglass size={16} />} title="Lots by age" subtitle={bucket ? `Showing bucket ${bucket} days` : 'All finished-goods lots, oldest first'} />
        {agingQ.isLoading ? (
          <FgSkeleton rows={6} />
        ) : agingQ.isError ? (
          <FgError message="Failed to load lots" onRetry={() => agingQ.refetch()} />
        ) : lots.length === 0 ? (
          <FgEmpty title="No lots" sub="No lots match the current bucket filter." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr>
                    {['Product', 'Batch', 'Bag', 'Location', 'Qt', 'Age', 'Bucket', 'Expires', 'Status'].map((h) => (
                      <th key={h} className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lots.map((l) => (
                    <tr key={l.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700">
                      <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-slate-100">{l.productName}</td>
                      <td className="tnum px-3 py-2.5 text-slate-700 dark:text-slate-200">{l.batchNo}</td>
                      <td className="px-3 py-2.5 text-slate-700 dark:text-slate-200">{l.bagLabel}</td>
                      <td className="tnum px-3 py-2.5 text-slate-700 dark:text-slate-200">{l.locationCode}</td>
                      <td className="tnum px-3 py-2.5 font-bold text-slate-900 dark:text-slate-100">{fmtQ(l.quintals)}</td>
                      <td className="tnum px-3 py-2.5 text-slate-700 dark:text-slate-200">{l.agingDays}d</td>
                      <td className="px-3 py-2.5">{bucketBadge(l.bucket)}</td>
                      <td className="tnum px-3 py-2.5 text-slate-700 dark:text-slate-200">{fmtDate(l.expiryDate)}</td>
                      <td className="px-3 py-2.5">{agingStatusBadge(l.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {lots.map((l) => (
                <div key={l.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-slate-800 dark:text-slate-100">{l.productName}</p>
                    {agingStatusBadge(l.status)}
                  </div>
                  <p className="tnum mt-1 text-xs text-slate-500 dark:text-slate-400">{l.batchNo} · {l.bagLabel} · {l.locationCode}</p>
                  <div className="tnum mt-2 flex items-center gap-3 text-sm">
                    <span className="font-bold text-slate-900 dark:text-slate-100">{fmtQ(l.quintals)} q</span>
                    {bucketBadge(l.bucket)}
                    <span className="text-xs text-slate-500 dark:text-slate-400">expires {fmtDate(l.expiryDate)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {lots.length > 0 && !agingQ.isLoading && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Expiry = receipt date + product shelf life ({BUCKETS.length} buckets). Near-expiry flags lots with ≤30 days left. <FgBadge tone="slate">FEFO</FgBadge> first-expiry-first-out.
        </p>
      )}
    </div>
  );
}
