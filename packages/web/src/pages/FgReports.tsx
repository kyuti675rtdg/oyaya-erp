import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, FileSpreadsheet } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { ByproductBalanceType, PackingEfficiencyRow, StockPositionProduct } from '../types';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Field, TextInput } from '../components/ui';
import { fmtQ } from '../lib/format';
import {
  FgBadge,
  FgEmpty,
  FgError,
  FgPageHeader,
  FgSkeleton,
  bucketBadge,
  cardShell,
  downloadCsv,
  secondaryBtn
} from './FgShared';

type ReportKind = 'stock-position' | 'packing-efficiency' | 'byproduct-balance' | 'aging-summary';

const REPORTS: { id: ReportKind; label: string }[] = [
  { id: 'stock-position', label: 'Stock position' },
  { id: 'packing-efficiency', label: 'Packing efficiency' },
  { id: 'byproduct-balance', label: 'Byproduct balance' },
  { id: 'aging-summary', label: 'Aging summary' }
];

const VIOLET = '#7c3aed';
const EMERALD = '#10b981';
const AMBER = '#f59e0b';
const ROSE = '#f43f5e';
const SLATE = '#64748b';
const BUCKET_COLORS: Record<string, string> = { '0-30': EMERALD, '31-60': VIOLET, '61-90': AMBER, '90+': ROSE };

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function exportName(kind: ReportKind): string {
  return `fg-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
}

export function FgReports() {
  const hasClaim = useAuth((s) => s.hasClaim);
  const [report, setReport] = useState<ReportKind>('stock-position');
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const rangeQs = from && to ? `?from=${from}&to=${to}` : '';

  const positionQ = useQuery({
    queryKey: ['fg-report-stock-position'],
    queryFn: async () =>
      (await api.get<{ products: StockPositionProduct[]; grandTotalQ: number; lowStockThresholdQ: number }>(E.fgReportStockPosition)).data,
    enabled: hasClaim('fg:view') && report === 'stock-position'
  });
  const efficiencyQ = useQuery({
    queryKey: ['fg-report-efficiency', from, to],
    queryFn: async () => (await api.get<PackingEfficiencyRow[]>(`${E.fgPackingEfficiency}${rangeQs}`)).data,
    enabled: hasClaim('fg:view') && report === 'packing-efficiency'
  });
  const balanceQ = useQuery({
    queryKey: ['fg-report-byproduct-balance', from, to],
    queryFn: async () =>
      (await api.get<{ types: ByproductBalanceType[] }>(`${E.fgReportByproductBalance}${rangeQs}`)).data,
    enabled: hasClaim('fg:view') && report === 'byproduct-balance'
  });
  const agingQ = useQuery({
    queryKey: ['fg-report-aging'],
    queryFn: async () =>
      (await api.get<{ summary: { bucket: string; lots: number; quintals: number }[] }>(E.fgAging)).data,
    enabled: hasClaim('fg:view') && report === 'aging-summary'
  });

  const position = positionQ.data;
  const chartData = useMemo(
    () => (position?.products ?? []).map((p) => ({ name: p.productName, quintals: p.totalQuintals })),
    [position]
  );
  const effTotals = useMemo(() => {
    const rows = efficiencyQ.data ?? [];
    return {
      runs: rows.reduce((s, r) => s + r.runs, 0),
      bags: rows.reduce((s, r) => s + r.bags, 0),
      quintals: rows.reduce((s, r) => s + r.quintals, 0)
    };
  }, [efficiencyQ.data]);

  if (!hasClaim('fg:view')) {
    return (
      <div className="space-y-4">
        <FgPageHeader title="Finished Goods Reports" subtitle="Stock, packing, byproduct and aging analytics" />
        <FgError message="You do not have permission to view FG reports (fg:view)." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FgPageHeader
        title="Finished Goods Reports"
        subtitle="Stock position, packing efficiency, byproduct balance, aging summary — with CSV export"
        actions={
          <div className="flex gap-2">
            {REPORTS.map((r) => (
              <button
                key={r.id}
                onClick={() => setReport(r.id)}
                className={`rounded-lg px-3.5 py-2 text-sm font-bold transition ${
                  report === r.id
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {(report === 'packing-efficiency' || report === 'byproduct-balance') && (
        <div className={`${cardShell} !py-4`}>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="From">
              <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      {/* ── Stock position ── */}
      {report === 'stock-position' && (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className={cardShell}>
              <CardHeader icon={<BarChart3 size={16} />} title="Quintals by product" subtitle="On-hand finished flour" />
              {positionQ.isLoading ? (
                <FgSkeleton rows={4} />
              ) : positionQ.isError ? (
                <FgError message="Failed to load stock position" onRetry={() => positionQ.refetch()} />
              ) : chartData.length === 0 ? (
                <FgEmpty title="No stock" sub="No finished goods on hand." />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} dy={10} height={60} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: unknown) => [`${Number(v).toFixed(1)} q`, 'Quintals']} />
                    <Bar dataKey="quintals" radius={[6, 6, 0, 0]}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={i % 2 === 0 ? VIOLET : SLATE} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className={cardShell}>
              <CardHeader
                icon={<FileSpreadsheet size={16} />}
                title="Position detail"
                subtitle={`Low-stock threshold: ${position?.lowStockThresholdQ ?? 100} q`}
                action={
                  <button
                    className={secondaryBtn + ' !px-3 !py-1.5 !text-xs'}
                    disabled={!position}
                    onClick={() =>
                      downloadCsv(
                        exportName('stock-position'),
                        ['Product', 'Total bags', 'Total quintals', 'Sizes', 'Locations', 'Low stock'],
                        (position?.products ?? []).map((p) => [
                          p.productName,
                          p.totalBags,
                          p.totalQuintals,
                          p.sizes.map((s) => `${s.bagLabel}: ${s.bags} bags / ${s.quintals} q`).join('; '),
                          p.locations.join('; '),
                          p.lowStock ? 'YES' : 'no'
                        ])
                      )
                    }
                  >
                    <Download size={13} /> CSV
                  </button>
                }
              />
              {positionQ.isLoading ? (
                <FgSkeleton rows={4} />
              ) : positionQ.isError ? (
                <FgError message="Failed to load stock position" onRetry={() => positionQ.refetch()} />
              ) : (position?.products ?? []).length === 0 ? (
                <FgEmpty title="No stock" sub="No finished goods on hand." />
              ) : (
                <>
                  <DataTable<StockPositionProduct>
                    keyOf={(r) => r.productId}
                    columns={[
                      { key: 'productName', label: 'Product', render: (r) => <span className="font-semibold">{r.productName}</span> },
                      { key: 'totalBags', label: 'Bags', mono: true, render: (r) => r.totalBags.toLocaleString('en-US') },
                      { key: 'totalQuintals', label: 'Qt', mono: true, render: (r) => <span className="font-bold">{fmtQ(r.totalQuintals)}</span> },
                      {
                        key: 'sizes',
                        label: 'Breakdown',
                        render: (r) => (
                          <span className="tnum text-xs text-slate-600 dark:text-slate-300">
                            {r.sizes.map((s) => `${s.bagLabel}: ${s.bags}`).join(' · ')}
                          </span>
                        )
                      },
                      {
                        key: 'lowStock',
                        label: 'Status',
                        render: (r) => (r.lowStock ? <FgBadge tone="rose">Low</FgBadge> : <FgBadge tone="emerald">OK</FgBadge>)
                      }
                    ]}
                    rows={position?.products ?? []}
                  />
                  <p className="tnum mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">
                    Grand total: {fmtQ(position?.grandTotalQ ?? 0)} q
                  </p>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Packing efficiency ── */}
      {report === 'packing-efficiency' && (
        <div className={cardShell}>
          <CardHeader
            icon={<BarChart3 size={16} />}
            title="Packing efficiency"
            subtitle={`${effTotals.runs} runs · ${effTotals.bags.toLocaleString('en-US')} bags · ${fmtQ(effTotals.quintals)} q in range`}
            action={
              <button
                className={secondaryBtn + ' !px-3 !py-1.5 !text-xs'}
                disabled={(efficiencyQ.data ?? []).length === 0}
                onClick={() =>
                  downloadCsv(
                    exportName('packing-efficiency'),
                    ['Date', 'Line', 'Runs', 'Bags', 'Quintals', 'Hours', 'Bags per hour'],
                    (efficiencyQ.data ?? []).map((r) => [r.date, r.line, r.runs, r.bags, r.quintals, r.hours, r.bagsPerHour ?? ''])
                  )
                }
              >
                <Download size={13} /> CSV
              </button>
            }
          />
          {efficiencyQ.isLoading ? (
            <FgSkeleton rows={5} />
          ) : efficiencyQ.isError ? (
            <FgError message="Failed to load efficiency" onRetry={() => efficiencyQ.refetch()} />
          ) : (efficiencyQ.data ?? []).length === 0 ? (
            <FgEmpty title="No packing activity" sub="No runs in the selected date range." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={efficiencyQ.data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: unknown) => [Number(v).toLocaleString('en-US'), 'Bags']} />
                  <Legend />
                  <Bar dataKey="bags" name="Bags packed" fill={VIOLET} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4">
                <DataTable<PackingEfficiencyRow>
                  keyOf={(r) => `${r.date}-${r.line}`}
                  columns={[
                    { key: 'date', label: 'Date', mono: true },
                    { key: 'line', label: 'Line', render: (r) => <span className="font-semibold">{r.line}</span> },
                    { key: 'runs', label: 'Runs', mono: true },
                    { key: 'bags', label: 'Bags', mono: true, render: (r) => r.bags.toLocaleString('en-US') },
                    { key: 'quintals', label: 'Qt', mono: true, render: (r) => fmtQ(r.quintals) },
                    {
                      key: 'bagsPerHour',
                      label: 'Bags/h',
                      mono: true,
                      render: (r) =>
                        r.bagsPerHour === null ? <span className="text-slate-400 dark:text-slate-500">—</span> : <span className="font-bold">{Math.round(r.bagsPerHour).toLocaleString('en-US')}</span>
                    }
                  ]}
                  rows={efficiencyQ.data ?? []}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Byproduct balance ── */}
      {report === 'byproduct-balance' && (
        <div className={cardShell}>
          <CardHeader
            icon={<BarChart3 size={16} />}
            title="Byproduct balance"
            subtitle="Inflow vs outflow and on-hand stock in range"
            action={
              <button
                className={secondaryBtn + ' !px-3 !py-1.5 !text-xs'}
                disabled={(balanceQ.data?.types ?? []).length === 0}
                onClick={() =>
                  downloadCsv(
                    exportName('byproduct-balance'),
                    ['Type', 'Inflow (q)', 'Outflow (q)', 'Net (q)', 'On hand (q)'],
                    (balanceQ.data?.types ?? []).map((t) => [t.typeLabel, t.inflowQ, t.outflowQ, t.netQ, t.onHandQ])
                  )
                }
              >
                <Download size={13} /> CSV
              </button>
            }
          />
          {balanceQ.isLoading ? (
            <FgSkeleton rows={4} />
          ) : balanceQ.isError ? (
            <FgError message="Failed to load byproduct balance" onRetry={() => balanceQ.refetch()} />
          ) : (balanceQ.data?.types ?? []).length === 0 ? (
            <FgEmpty title="No byproduct movement" sub="No movements in the selected date range." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={balanceQ.data!.types} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="typeLabel" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: unknown) => [`${Number(v).toFixed(1)} q`]} />
                  <Legend />
                  <Bar dataKey="inflowQ" name="Inflow" fill={EMERALD} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="outflowQ" name="Outflow" fill={ROSE} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="onHandQ" name="On hand" fill={VIOLET} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4">
                <DataTable<ByproductBalanceType>
                  keyOf={(r) => r.type}
                  columns={[
                    { key: 'typeLabel', label: 'Type', render: (r) => <span className="font-semibold">{r.typeLabel}</span> },
                    { key: 'inflowQ', label: 'Inflow (q)', mono: true, render: (r) => <span className="text-emerald-700">+{fmtQ(r.inflowQ)}</span> },
                    { key: 'outflowQ', label: 'Outflow (q)', mono: true, render: (r) => <span className="text-rose-700">−{fmtQ(r.outflowQ)}</span> },
                    { key: 'netQ', label: 'Net (q)', mono: true, render: (r) => <span className="font-bold">{fmtQ(r.netQ)}</span> },
                    { key: 'onHandQ', label: 'On hand (q)', mono: true, render: (r) => <span className="font-bold">{fmtQ(r.onHandQ)}</span> }
                  ]}
                  rows={balanceQ.data?.types ?? []}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Aging summary ── */}
      {report === 'aging-summary' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className={cardShell}>
            <CardHeader icon={<BarChart3 size={16} />} title="Stock by age bucket" subtitle="Quintals per aging bucket" />
            {agingQ.isLoading ? (
              <FgSkeleton rows={4} />
            ) : agingQ.isError ? (
              <FgError message="Failed to load aging summary" onRetry={() => agingQ.refetch()} />
            ) : (agingQ.data?.summary ?? []).every((s) => s.quintals === 0) ? (
              <FgEmpty title="No stock" sub="No finished goods lots on hand." />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={agingQ.data!.summary}
                    dataKey="quintals"
                    nameKey="bucket"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                  >
                    {agingQ.data!.summary.map((s) => (
                      <Cell key={s.bucket} fill={BUCKET_COLORS[s.bucket] ?? SLATE} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: unknown) => [`${Number(v).toFixed(1)} q`, 'Quintals']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className={cardShell}>
            <CardHeader
              icon={<FileSpreadsheet size={16} />}
              title="Bucket detail"
              action={
                <button
                  className={secondaryBtn + ' !px-3 !py-1.5 !text-xs'}
                  disabled={(agingQ.data?.summary ?? []).length === 0}
                  onClick={() =>
                    downloadCsv(
                      exportName('aging-summary'),
                      ['Bucket (days)', 'Lots', 'Quintals'],
                      (agingQ.data?.summary ?? []).map((s) => [s.bucket, s.lots, s.quintals])
                    )
                  }
                >
                  <Download size={13} /> CSV
                </button>
              }
            />
            {agingQ.isLoading ? (
              <FgSkeleton rows={4} />
            ) : agingQ.isError ? (
              <FgError message="Failed to load aging summary" onRetry={() => agingQ.refetch()} />
            ) : (
              <DataTable<{ id?: string; bucket: string; lots: number; quintals: number }>
                keyOf={(r) => r.bucket}
                columns={[
                  { key: 'bucket', label: 'Bucket', render: (r) => bucketBadge(r.bucket) },
                  { key: 'lots', label: 'Lots', mono: true },
                  { key: 'quintals', label: 'Quintals', mono: true, render: (r) => <span className="font-bold">{fmtQ(r.quintals)}</span> },
                  {
                    key: 'share',
                    label: 'Share',
                    mono: true,
                    render: (r) => {
                      const total = (agingQ.data?.summary ?? []).reduce((s, x) => s + x.quintals, 0);
                      return total > 0 ? `${((r.quintals / total) * 100).toFixed(1)}%` : '—';
                    }
                  }
                ]}
                rows={agingQ.data?.summary ?? []}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
