import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, CheckCircle2, Package, Plus, Scale, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { FgInventoryRow, FgStockAdjustment, PackagingSize, Product } from '../types';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Field, NumberInput, Select, TextArea, TextInput } from '../components/ui';
import { fmtDate, fmtQ } from '../lib/format';
import {
  FgBadge,
  FgEmpty,
  FgError,
  FgKpi,
  FgKpiSkeleton,
  FgModal,
  FgPageHeader,
  FgSkeleton,
  cardShell,
  secondaryBtn,
  useFgPerms,
  violetBtn
} from './FgShared';

const SIZE_ORDER = ['50kg', '25kg', '10kg', '5kg'];
const LOW_STOCK_Q = 100;

export function FinishedGoods() {
  const { canManage, canApprove } = useFgPerms();
  const hasClaim = useAuth((s) => s.hasClaim);
  const queryClient = useQueryClient();
  const [productFilter, setProductFilter] = useState('');
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const qs = productFilter ? `?productId=${encodeURIComponent(productFilter)}` : '';
  const invQ = useQuery({
    queryKey: ['fg-inventory', productFilter],
    queryFn: async () => (await api.get<FgInventoryRow[]>(`${E.fgInventory}${qs}`)).data,
    enabled: hasClaim('fg:view')
  });
  const productsQ = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get<Product[]>(E.products)).data,
    enabled: hasClaim('fg:view')
  });
  const adjQ = useQuery({
    queryKey: ['fg-adjustments'],
    queryFn: async () => (await api.get<FgStockAdjustment[]>(E.fgAdjustments)).data,
    enabled: hasClaim('fg:view')
  });
  const sizesQ = useQuery({
    queryKey: ['packaging-sizes'],
    queryFn: async () => (await api.get<PackagingSize[]>(E.packagingSizes)).data,
    enabled: hasClaim('fg:view')
  });
  const sizes = useMemo(
    () => (sizesQ.data ?? []).filter((s) => s.isActive).sort((a, b) => Number(a.kg) - Number(b.kg)),
    [sizesQ.data]
  );

  const rows = invQ.data ?? [];
  const products = useMemo(
    () => (productsQ.data ?? []).filter((p) => p.kind === 'flour' || p.name.toLowerCase().includes('duket') || p.name.toLowerCase().includes('furishka') || p.name.toLowerCase().includes('fino') || p.name.toLowerCase().includes('fernacho')),
    [productsQ.data]
  );

  // Product × packaging-size matrix
  const matrix = useMemo(() => {
    const byProduct = new Map<
      string,
      {
        productName: string;
        sizes: Record<string, { bags: number; quintals: number; inflowQ: number; outflowQ: number }>;
        totalBags: number;
        totalQ: number;
      }
    >();
    for (const r of rows) {
      const g =
        byProduct.get(r.productId) ??
        { productName: r.productName, sizes: {}, totalBags: 0, totalQ: 0 };
      const label = r.bagLabel === '-' ? 'Bulk' : r.bagLabel;
      const s = g.sizes[label] ?? { bags: 0, quintals: 0, inflowQ: 0, outflowQ: 0 };
      s.bags += r.bags;
      s.quintals += r.quintals;
      s.inflowQ += r.inflowQ;
      s.outflowQ += r.outflowQ;
      g.sizes[label] = s;
      g.totalBags += r.bags;
      g.totalQ += r.quintals;
      byProduct.set(r.productId, g);
    }
    return [...byProduct.entries()].map(([productId, g]) => ({ productId, ...g }));
  }, [rows]);

  const totals = useMemo(() => {
    let bags = 0;
    let q = 0;
    let inflow = 0;
    let outflow = 0;
    for (const r of rows) {
      bags += r.bags;
      q += r.quintals;
      inflow += r.inflowQ;
      outflow += r.outflowQ;
    }
    return { bags, q, inflow, outflow, products: matrix.length };
  }, [rows, matrix]);

  const lowStock = matrix.filter((m) => m.totalQ < LOW_STOCK_Q);

  const adjustMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await api.post(E.fgAdjustments, payload)).data,
    onSuccess: () => {
      setShowAdjust(false);
      setAdjustError(null);
      queryClient.invalidateQueries({ queryKey: ['fg-adjustments'] });
    },
    onError: (e: unknown) =>
      setAdjustError(e instanceof Error ? e.message : 'Failed to create adjustment')
  });

  const decideMut = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) =>
      (await api.post(E.fgAdjustApprove(id), { decision })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fg-adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['fg-inventory'] });
    }
  });

  if (!hasClaim('fg:view')) {
    return (
      <div className="space-y-4">
        <FgPageHeader title="Finished Flour Inventory" subtitle="Stock by product and packaging size" />
        <FgError message="You do not have permission to view finished goods (fg:view)." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FgPageHeader
        title="Finished Flour Inventory"
        subtitle="Stock by product × packaging size — inflow from released batches, outflow to sales dispatch"
        actions={
          canManage ? (
            <button className={violetBtn} onClick={() => setShowAdjust(true)}>
              <Plus size={15} /> Record adjustment
            </button>
          ) : null
        }
      />

      {invQ.isLoading ? (
        <FgKpiSkeleton />
      ) : invQ.isError ? (
        <FgError message="Failed to load inventory" onRetry={() => invQ.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <FgKpi label="On hand" value={`${fmtQ(totals.q)} q`} sub="finished flour" icon={<Scale size={16} />} tone="violet" />
          <FgKpi label="Bags" value={totals.bags.toLocaleString('en-US')} sub={`${totals.products} products in stock`} icon={<Boxes size={16} />} tone="slate" />
          <FgKpi label="Packed in" value={`${fmtQ(totals.inflow)} q`} sub="from released batches" icon={<Package size={16} />} tone="emerald" />
          <FgKpi
            label="Dispatched"
            value={`${fmtQ(totals.outflow)} q`}
            sub={lowStock.length > 0 ? `${lowStock.length} product(s) below ${LOW_STOCK_Q} q` : 'all products above minimum'}
            icon={<TriangleAlert size={16} />}
            tone={lowStock.length > 0 ? 'rose' : 'slate'}
          />
        </div>
      )}

      {/* Product × size matrix */}
      <div className={cardShell}>
        <CardHeader
          icon={<Package size={16} />}
          title="Stock matrix"
          subtitle="Bags and quintals per product and bag size"
          action={
            <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className="max-w-[200px]">
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          }
        />
        {invQ.isLoading ? (
          <FgSkeleton rows={5} />
        ) : invQ.isError ? (
          <FgError message="Failed to load matrix" onRetry={() => invQ.refetch()} />
        ) : matrix.length === 0 ? (
          <FgEmpty title="No finished goods stock" sub="Packed flour will appear here once packaging runs are recorded." />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">Product</th>
                    {SIZE_ORDER.map((s) => (
                      <th key={s} className="tnum px-3 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                        {s}
                      </th>
                    ))}
                    <th className="tnum px-3 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Total</th>
                    <th className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((m) => (
                    <tr key={m.productId} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-semibold text-slate-800">{m.productName}</td>
                      {SIZE_ORDER.map((s) => {
                        const cell = m.sizes[s];
                        return (
                          <td key={s} className="tnum px-3 py-2.5 text-right text-slate-700">
                            {cell ? (
                              <>
                                <span className="font-semibold">{cell.bags.toLocaleString('en-US')}</span>
                                <span className="text-slate-400"> / </span>
                                <span>{fmtQ(cell.quintals)} q</span>
                              </>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="tnum px-3 py-2.5 text-right font-bold text-slate-900">
                        {m.totalBags.toLocaleString('en-US')} <span className="font-normal text-slate-400">/ {fmtQ(m.totalQ)} q</span>
                      </td>
                      <td className="px-3 py-2.5">
                        {m.totalQ < LOW_STOCK_Q ? <FgBadge tone="rose">Low</FgBadge> : <FgBadge tone="emerald">OK</FgBadge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile stacked cards */}
            <div className="space-y-3 md:hidden">
              {matrix.map((m) => (
                <div key={m.productId} className="rounded-xl border border-slate-200 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-slate-800">{m.productName}</p>
                    {m.totalQ < LOW_STOCK_Q ? <FgBadge tone="rose">Low</FgBadge> : <FgBadge tone="emerald">OK</FgBadge>}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {SIZE_ORDER.map((s) => {
                      const cell = m.sizes[s];
                      return (
                        <div key={s} className="tnum rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                          <span className="font-bold text-slate-500">{s}</span>
                          <div className="text-slate-700">
                            {cell ? (
                              <>
                                <span className="font-semibold">{cell.bags.toLocaleString('en-US')}</span> bags · {fmtQ(cell.quintals)} q
                              </>
                            ) : (
                              '—'
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="tnum mt-2 text-sm font-bold text-slate-900">
                    Total: {m.totalBags.toLocaleString('en-US')} bags · {fmtQ(m.totalQ)} q
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Lot detail */}
      <div className={cardShell}>
        <CardHeader icon={<Boxes size={16} />} title="Lots on hand" subtitle="Batch-level detail with inflow from packing and outflow to dispatch" />
        {invQ.isLoading ? (
          <FgSkeleton rows={6} />
        ) : invQ.isError ? (
          <FgError message="Failed to load lots" onRetry={() => invQ.refetch()} />
        ) : rows.length === 0 ? (
          <FgEmpty title="No lots" sub="No finished goods lots match the current filter." />
        ) : (
          <DataTable<FgInventoryRow>
            columns={[
              { key: 'batchNo', label: 'Batch', mono: true, render: (r) => <span className="font-semibold">{r.batchNo}</span> },
              { key: 'productName', label: 'Product' },
              { key: 'bagLabel', label: 'Bag' },
              { key: 'locationCode', label: 'Location', mono: true },
              { key: 'bags', label: 'Bags', mono: true, render: (r) => r.bags.toLocaleString('en-US') },
              { key: 'quintals', label: 'Qt', mono: true, render: (r) => <span className="font-bold">{fmtQ(r.quintals)}</span> },
              { key: 'inflowQ', label: 'Packed in', mono: true, render: (r) => <span className="text-emerald-700">+{fmtQ(r.inflowQ)}</span> },
              { key: 'outflowQ', label: 'Dispatched', mono: true, render: (r) => <span className="text-rose-700">−{fmtQ(r.outflowQ)}</span> },
              { key: 'receivedAt', label: 'Received', render: (r) => fmtDate(r.receivedAt) }
            ]}
            rows={rows}
          />
        )}
      </div>

      {/* Adjustments */}
      <div className={cardShell}>
        <CardHeader
          icon={<CheckCircle2 size={16} />}
          title="Stock adjustments"
          subtitle="Drafts require fg:approve to post to stock"
        />
        {adjQ.isLoading ? (
          <FgSkeleton rows={3} />
        ) : adjQ.isError ? (
          <FgError message="Failed to load adjustments" onRetry={() => adjQ.refetch()} />
        ) : (adjQ.data ?? []).length === 0 ? (
          <FgEmpty title="No adjustments" sub="Draft an adjustment to correct a lot's bags or quintals." />
        ) : (
          <DataTable<FgStockAdjustment>
            columns={[
              { key: 'batchNo', label: 'Batch', mono: true, render: (r) => <span className="font-semibold">{r.batchNo}</span> },
              { key: 'productName', label: 'Product', render: (r) => r.product?.name ?? r.productId },
              { key: 'bagsDelta', label: 'Bags Δ', mono: true, render: (r) => (r.bagsDelta >= 0 ? '+' : '') + r.bagsDelta.toLocaleString('en-US') },
              { key: 'quintalsDelta', label: 'Qt Δ', mono: true, render: (r) => (Number(r.quintalsDelta) >= 0 ? '+' : '') + fmtQ(r.quintalsDelta) },
              { key: 'reason', label: 'Reason' },
              {
                key: 'status',
                label: 'Status',
                render: (r) =>
                  r.status === 'DRAFT' ? (
                    <FgBadge tone="amber">Draft</FgBadge>
                  ) : r.status === 'APPROVED' ? (
                    <FgBadge tone="emerald">Approved</FgBadge>
                  ) : (
                    <FgBadge tone="rose">Rejected</FgBadge>
                  )
              },
              {
                key: 'actions',
                label: '',
                render: (r) =>
                  canApprove && r.status === 'DRAFT' ? (
                    <div className="flex gap-2">
                      <button
                        className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                        disabled={decideMut.isPending}
                        onClick={() => decideMut.mutate({ id: r.id, decision: 'APPROVE' })}
                      >
                        Approve
                      </button>
                      <button
                        className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                        disabled={decideMut.isPending}
                        onClick={() => decideMut.mutate({ id: r.id, decision: 'REJECT' })}
                      >
                        Reject
                      </button>
                    </div>
                  ) : null
              }
            ]}
            rows={adjQ.data ?? []}
          />
        )}
      </div>

      {/* Adjustment modal */}
      {showAdjust && (
        <FgModal
          title="Record stock adjustment"
          subtitle="Creates a DRAFT — a supervisor with fg:approve posts it to stock."
          onClose={() => {
            setShowAdjust(false);
            setAdjustError(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              adjustMut.mutate({
                productId: String(fd.get('productId')),
                batchNo: String(fd.get('batchNo')).trim(),
                packagingSizeId: String(fd.get('packagingSizeId')) || null,
                locationCode: String(fd.get('locationCode')).trim() || 'FG_WH_1',
                bagsDelta: Number(fd.get('bagsDelta')),
                quintalsDelta: Number(fd.get('quintalsDelta')),
                reason: String(fd.get('reason')).trim()
              });
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Product" required>
                <Select name="productId" required defaultValue="">
                  <option value="" disabled>Select product</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Batch no" required>
                <TextInput name="batchNo" required placeholder="e.g. B-2026-041" />
              </Field>
              <Field label="Bag size">
                <Select name="packagingSizeId" defaultValue="">
                  <option value="">Bulk / unassigned</option>
                  {sizes.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Location">
                <TextInput name="locationCode" defaultValue="FG_WH_1" />
              </Field>
              <Field label="Bags Δ (signed)" required hint="Negative to reduce">
                <NumberInput name="bagsDelta" required step={1} placeholder="0" />
              </Field>
              <Field label="Quintals Δ (signed)" required hint="Negative to reduce">
                <NumberInput name="quintalsDelta" required step={0.1} placeholder="0.0" />
              </Field>
            </div>
            <Field label="Reason" required>
              <TextArea name="reason" required placeholder="Why is this adjustment needed?" />
            </Field>
            {adjustError ? <p className="text-sm font-semibold text-rose-700">{adjustError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryBtn} onClick={() => setShowAdjust(false)}>
                Cancel
              </button>
              <button type="submit" className={violetBtn} disabled={adjustMut.isPending}>
                {adjustMut.isPending ? 'Saving...' : 'Save draft'}
              </button>
            </div>
          </form>
        </FgModal>
      )}
    </div>
  );
}
