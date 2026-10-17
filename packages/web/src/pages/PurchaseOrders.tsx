import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarDays, CheckCircle2, Eye, Pencil, Plus, Search, Truck, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtBirr, fmtDate, fmtDateTime, fmtQ } from '../lib/format';
import type { POStatus, PurchaseOrder, Supplier, WheatCategory, WheatIntake } from '../types';
import { useAuth } from '../store/auth';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Field, NumberInput, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';

const cardShell = 'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const WHEAT_TYPES: WheatCategory[] = ['SOFT', 'HARD', 'FOREIGN'];
const WHEAT_LABELS: Record<WheatCategory, string> = {
  SOFT: 'Soft wheat',
  HARD: 'Hard wheat',
  FOREIGN: 'Foreign (imported)'
};

const STATUS_STYLES: Record<POStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border border-slate-200',
  APPROVED: 'bg-blue-50 text-blue-700 border border-blue-200',
  PARTIALLY_RECEIVED: 'bg-amber-50 text-amber-700 border border-amber-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  CANCELLED: 'bg-rose-50 text-rose-700 border border-rose-200'
};

const STATUS_LABELS: Record<POStatus, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  PARTIALLY_RECEIVED: 'Partially received',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
};

function POStatusBadge({ status }: { status: POStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function ReceiveProgress({ po }: { po: PurchaseOrder }) {
  const ordered = Number(po.quantityQ) || 0;
  const received = Number(po.receivedQ) || 0;
  const pct = ordered > 0 ? Math.min(100, (received / ordered) * 100) : 0;
  return (
    <div className="min-w-[140px]">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="tnum font-semibold text-slate-700 dark:text-slate-200">
          {fmtQ(received)} / {fmtQ(ordered)} q
        </span>
        <span className="tnum">{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div
          className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-violet-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface FormState {
  supplierId: string;
  wheatCategory: WheatCategory;
  quantityQ: string;
  pricePerQ: string;
  deliveryDate: string;
  terms: string;
}

const blankForm: FormState = {
  supplierId: '',
  wheatCategory: 'SOFT',
  quantityQ: '',
  pricePerQ: '',
  deliveryDate: todayISO(),
  terms: ''
};

export function PurchaseOrders() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('procurement:manage');
  const canApprove = hasClaim('procurement:approve');

  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [supplierFilter, setSupplierFilter] = useState<string>('');
  const [fromFilter, setFromFilter] = useState<string>('');
  const [toFilter, setToFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<PurchaseOrder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const queryKey = useMemo(
    () => ['purchase-orders', statusFilter, supplierFilter, fromFilter, toFilter],
    [statusFilter, supplierFilter, fromFilter, toFilter]
  );

  const listQ = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (supplierFilter) params.set('supplierId', supplierFilter);
      if (fromFilter) params.set('from', fromFilter);
      if (toFilter) params.set('to', toFilter);
      const qs = params.toString();
      return (await api.get<PurchaseOrder[]>(`${E.purchaseOrders}${qs ? `?${qs}` : ''}`)).data;
    }
  });

  const suppliersQ = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<Supplier[]>(E.suppliers)).data
  });
  const activeSuppliers = useMemo(
    () => (suppliersQ.data ?? []).filter((s) => s.isActive !== false),
    [suppliersQ.data]
  );

  const detailQ = useQuery({
    queryKey: ['purchase-order', detailId],
    queryFn: async () => (await api.get<PurchaseOrder>(E.purchaseOrder(detailId!))).data,
    enabled: detailId !== null
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return listQ.data ?? [];
    return (listQ.data ?? []).filter((po) => po.poNo.toLowerCase().includes(q));
  }, [listQ.data, search]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['purchase-orders'] });

  const setField = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const formTotal = useMemo(() => {
    const qty = Number(form.quantityQ);
    const price = Number(form.pricePerQ);
    return Number.isFinite(qty) && Number.isFinite(price) && qty > 0 && price > 0 ? qty * price : 0;
  }, [form.quantityQ, form.pricePerQ]);

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const qty = Number(form.quantityQ);
    const price = Number(form.pricePerQ);
    if (!form.supplierId || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      setNotice({ ok: false, text: 'Supplier, a positive quantity and a positive price per quintal are required.' });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        supplierId: form.supplierId,
        wheatCategory: form.wheatCategory,
        quantityQ: qty,
        pricePerQBirr: price,
        deliveryDate: form.deliveryDate ? new Date(`${form.deliveryDate}T00:00:00`).toISOString() : undefined,
        terms: form.terms.trim() || undefined
      };
      const created = (await api.post<PurchaseOrder>(E.purchaseOrders, body)).data;
      setNotice({ ok: true, text: `Purchase order ${created.poNo} created as draft.` });
      setCreateOpen(false);
      setForm(blankForm);
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create purchase order.' });
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setNotice(null);
    const qty = Number(form.quantityQ);
    const price = Number(form.pricePerQ);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      setNotice({ ok: false, text: 'A positive quantity and price per quintal are required.' });
      return;
    }
    setSaving(true);
    try {
      await api.put(E.purchaseOrder(editTarget.id), {
        wheatCategory: form.wheatCategory,
        quantityQ: qty,
        pricePerQBirr: price,
        deliveryDate: form.deliveryDate ? new Date(`${form.deliveryDate}T00:00:00`).toISOString() : null,
        terms: form.terms.trim() || null
      });
      setNotice({ ok: true, text: `Purchase order ${editTarget.poNo} updated.` });
      setEditTarget(null);
      setForm(blankForm);
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to update purchase order.' });
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (po: PurchaseOrder) => {
    setForm({
      supplierId: po.supplierId,
      wheatCategory: po.wheatCategory,
      quantityQ: String(Number(po.quantityQ)),
      pricePerQ: String(Number(po.pricePerQBirr)),
      deliveryDate: po.deliveryDate ? po.deliveryDate.slice(0, 10) : todayISO(),
      terms: po.terms ?? ''
    });
    setEditTarget(po);
  };

  const approvePO = async (po: PurchaseOrder) => {
    setNotice(null);
    setSaving(true);
    try {
      await api.post(E.poApprove(po.id), {});
      setNotice({ ok: true, text: `Purchase order ${po.poNo} approved — gate intake can now reference it.` });
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to approve purchase order.' });
    } finally {
      setSaving(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    if (!cancelReason.trim()) {
      setNotice({ ok: false, text: 'A cancellation reason is required.' });
      return;
    }
    setNotice(null);
    setSaving(true);
    try {
      await api.post(E.poCancel(cancelTarget.id), { reason: cancelReason.trim() });
      setNotice({ ok: true, text: `Purchase order ${cancelTarget.poNo} cancelled.` });
      setCancelTarget(null);
      setCancelReason('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to cancel purchase order.' });
    } finally {
      setSaving(false);
    }
  };

  const modalShell = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto';

  const detail: PurchaseOrder | undefined = detailQ.data;
  const detailIntakes: WheatIntake[] = detail?.intakes ?? [];
  const detailOrdered = Number(detail?.quantityQ ?? 0) || 0;
  const detailReceived = Number(detail?.receivedQ ?? 0) || 0;
  const detailOutstanding = Math.max(0, detailOrdered - detailReceived);

  return (
    <div>
      <SectionTitle
        title="Purchase Orders"
        sub="Wheat procurement orders — commit quantities and prices with suppliers, then track deliveries"
      />

      {notice ? (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
            notice.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-800'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      {/* Filters */}
      <div className={`${cardShell} mb-4`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-2 md:col-span-1 lg:col-span-2">
            <Field label="Search PO number">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <TextInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g. PO-000123"
                  className="pl-9"
                />
              </div>
            </Field>
          </div>
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABELS) as POStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Supplier">
            <Select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
              <option value="">All suppliers</option>
              {(suppliersQ.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <TextInput type="date" value={fromFilter} onChange={(e) => setFromFilter(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={toFilter} onChange={(e) => setToFilter(e.target.value)} />
          </Field>
          <div className="col-span-2 flex items-end md:col-span-1">
            {canManage ? (
              <Button onClick={() => { setForm(blankForm); setCreateOpen(true); }} className="w-full">
                <Plus className="h-4 w-4" /> New PO
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* List */}
      {listQ.isLoading ? (
        <div className={cardShell}>
          <Spinner label="Loading purchase orders..." />
        </div>
      ) : listQ.isError ? (
        <ErrorBox message="Failed to load purchase orders." onRetry={() => listQ.refetch()} />
      ) : rows.length === 0 ? (
        <div className={cardShell}>
          <EmptyState
            title="No purchase orders"
            sub={
              search
                ? 'No purchase orders match your search. Try a different PO number or clear the filters.'
                : 'Create the first purchase order to commit wheat quantities with a supplier.'
            }
          />
        </div>
      ) : (
        <div className={cardShell}>
          <DataTable<PurchaseOrder>
            columns={[
              { key: 'poNo', label: 'PO No.', render: (r) => <span className="tnum font-bold text-ink dark:text-white">{r.poNo}</span> },
              { key: 'supplier', label: 'Supplier', render: (r) => r.supplier?.name ?? '-' },
              { key: 'wheatCategory', label: 'Wheat type', render: (r) => WHEAT_LABELS[r.wheatCategory] ?? r.wheatCategory },
              { key: 'quantityQ', label: 'Qty (q)', mono: true, render: (r) => fmtQ(r.quantityQ) },
              { key: 'pricePerQBirr', label: 'Price / q', mono: true, render: (r) => fmtBirr(r.pricePerQBirr) },
              { key: 'totalBirr', label: 'Total', mono: true, render: (r) => <span className="font-semibold">{fmtBirr(r.totalBirr)}</span> },
              { key: 'deliveryDate', label: 'Delivery', render: (r) => fmtDate(r.deliveryDate) },
              { key: 'status', label: 'Status', render: (r) => <POStatusBadge status={r.status} /> },
              { key: 'received', label: 'Received', render: (r) => <ReceiveProgress po={r} /> },
              {
                key: 'actions',
                label: 'Actions',
                render: (r) => (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      title="View detail"
                      onClick={() => setDetailId(r.id)}
                      className="rounded-lg border border-line p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    {r.status === 'DRAFT' ? (
                      <>
                        {canApprove ? (
                          <button
                            type="button"
                            title="Approve"
                            onClick={() => approvePO(r)}
                            className="rounded-lg border border-blue-200 bg-blue-50 p-1.5 text-blue-700 hover:bg-blue-100"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        ) : null}
                        {canManage ? (
                          <>
                            <button
                              type="button"
                              title="Edit draft"
                              onClick={() => openEdit(r)}
                              className="rounded-lg border border-line p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title="Cancel"
                              onClick={() => { setCancelTarget(r); setCancelReason(''); }}
                              className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-700 hover:bg-rose-100"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </>
                        ) : null}
                      </>
                    ) : null}
                    {r.status !== 'DRAFT' && r.status !== 'CANCELLED' ? (
                      <span className="tnum ml-1 hidden text-xs font-semibold text-slate-500 dark:text-slate-400 xl:inline" title="Outstanding quantity">
                        Outstanding: {fmtQ(Math.max(0, (Number(r.quantityQ) || 0) - (Number(r.receivedQ) || 0)))} q
                      </span>
                    ) : null}
                  </div>
                )
              }
            ]}
            rows={rows}
            emptyTitle="No purchase orders"
            emptySub="No purchase orders match the current filters."
          />
        </div>
      )}

      {/* Create modal */}
      {createOpen ? (
        <div className={modalShell} role="dialog" aria-modal="true" aria-label="Create purchase order"
          onKeyDown={(e) => { if (e.key === 'Escape') setCreateOpen(false); }}>
          <div className={`${cardShell} w-full max-w-lg`}>
            <h3 className="text-lg font-bold text-ink dark:text-white">New purchase order</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Draft — the order takes effect once approved.</p>
            <form onSubmit={submitCreate} className="mt-4 space-y-4">
              <Field label="Supplier" required>
                <Select value={form.supplierId} onChange={(e) => setField('supplierId', e.target.value)} required>
                  <option value="">Select supplier</option>
                  {activeSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Wheat type" required>
                  <Select value={form.wheatCategory} onChange={(e) => setField('wheatCategory', e.target.value as WheatCategory)}>
                    {WHEAT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {WHEAT_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Expected delivery date">
                  <TextInput type="date" value={form.deliveryDate} onChange={(e) => setField('deliveryDate', e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity (quintals)" required>
                  <NumberInput value={form.quantityQ} onChange={(e) => setField('quantityQ', e.target.value)} placeholder="e.g. 500" min={0.1} step={0.5} required />
                </Field>
                <Field label="Price per quintal (ETB)" required>
                  <NumberInput value={form.pricePerQ} onChange={(e) => setField('pricePerQ', e.target.value)} placeholder="e.g. 8500" min={1} step={0.01} required />
                </Field>
              </div>
              <div className="rounded-xl bg-violet-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-violet-900">Order total</span>
                  <span className="tnum text-lg font-extrabold text-violet-900">{fmtBirr(formTotal)}</span>
                </div>
              </div>
              <Field label="Terms / notes">
                <TextArea value={form.terms} onChange={(e) => setField('terms', e.target.value)} placeholder="Payment terms, delivery conditions, special notes..." rows={3} />
              </Field>
              <div className="flex gap-2">
                <Button variant="secondary" type="button" onClick={() => setCreateOpen(false)} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" loading={saving} className="flex-1">
                  Create draft
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Edit modal (draft only) */}
      {editTarget ? (
        <div className={modalShell} role="dialog" aria-modal="true" aria-label="Edit purchase order"
          onKeyDown={(e) => { if (e.key === 'Escape') setEditTarget(null); }}>
          <div className={`${cardShell} w-full max-w-lg`}>
            <h3 className="text-lg font-bold text-ink dark:text-white">Edit draft {editTarget.poNo}</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Supplier: {editTarget.supplier?.name ?? '—'}
            </p>
            <form onSubmit={submitEdit} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Wheat type" required>
                  <Select value={form.wheatCategory} onChange={(e) => setField('wheatCategory', e.target.value as WheatCategory)}>
                    {WHEAT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {WHEAT_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Expected delivery date">
                  <TextInput type="date" value={form.deliveryDate} onChange={(e) => setField('deliveryDate', e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity (quintals)" required>
                  <NumberInput value={form.quantityQ} onChange={(e) => setField('quantityQ', e.target.value)} placeholder="e.g. 500" min={0.1} step={0.5} required />
                </Field>
                <Field label="Price per quintal (ETB)" required>
                  <NumberInput value={form.pricePerQ} onChange={(e) => setField('pricePerQ', e.target.value)} placeholder="e.g. 8500" min={1} step={0.01} required />
                </Field>
              </div>
              <div className="rounded-xl bg-violet-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-violet-900">Order total</span>
                  <span className="tnum text-lg font-extrabold text-violet-900">{fmtBirr(formTotal)}</span>
                </div>
              </div>
              <Field label="Terms / notes">
                <TextArea value={form.terms} onChange={(e) => setField('terms', e.target.value)} placeholder="Payment terms, delivery conditions, special notes..." rows={3} />
              </Field>
              <div className="flex gap-2">
                <Button variant="secondary" type="button" onClick={() => setEditTarget(null)} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" loading={saving} className="flex-1">
                  Save changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Cancel modal */}
      {cancelTarget ? (
        <div className={modalShell} role="dialog" aria-modal="true" aria-label="Cancel purchase order"
          onKeyDown={(e) => { if (e.key === 'Escape') setCancelTarget(null); }}>
          <div className={`${cardShell} w-full max-w-md`}>
            <div className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-600" />
              <h3 className="text-lg font-bold text-ink dark:text-white">Cancel {cancelTarget.poNo}?</h3>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              The order will be closed as cancelled. Gate deliveries already received are not affected.
            </p>
            <div className="mt-4">
              <Field label="Cancellation reason" required>
                <TextArea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Why is this order being cancelled?"
                  rows={3}
                />
              </Field>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" type="button" onClick={() => setCancelTarget(null)} className="flex-1">
                Keep order
              </Button>
              <Button variant="danger" onClick={confirmCancel} loading={saving} className="flex-1">
                Confirm cancellation
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Detail modal */}
      {detailId !== null ? (
        <div className={modalShell} role="dialog" aria-modal="true" aria-label="Purchase order details"
          onKeyDown={(e) => { if (e.key === 'Escape') setDetailId(null); }}>
          <div className={`${cardShell} w-full max-w-2xl`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="tnum text-lg font-bold text-ink dark:text-white">{detail?.poNo ?? 'Purchase order'}</h3>
                  {detail ? <POStatusBadge status={detail.status} /> : null}
                </div>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Created {detail ? fmtDateTime(detail.createdAt) : '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailId(null)}
                className="rounded-lg border border-line p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                aria-label="Close"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>

            {detailQ.isLoading ? (
              <div className="py-8"><Spinner label="Loading order detail..." /></div>
            ) : detailQ.isError || !detail ? (
              <div className="py-4"><ErrorBox message="Failed to load order detail." onRetry={() => detailQ.refetch()} /></div>
            ) : (
              <div className="mt-4 space-y-5">
                {/* Header info */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { label: 'Supplier', value: detail.supplier?.name ?? '—' },
                    { label: 'Wheat type', value: WHEAT_LABELS[detail.wheatCategory] ?? detail.wheatCategory },
                    { label: 'Ordered', value: `${fmtQ(detail.quantityQ)} q`, mono: true },
                    { label: 'Price / q', value: fmtBirr(detail.pricePerQBirr), mono: true },
                    { label: 'Total value', value: fmtBirr(detail.totalBirr), mono: true },
                    { label: 'Delivery date', value: fmtDate(detail.deliveryDate) }
                  ].map((kv) => (
                    <div key={kv.label} className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{kv.label}</p>
                      <p className={`mt-1 text-sm font-bold text-ink dark:text-white ${kv.mono ? 'tnum' : ''}`}>{kv.value}</p>
                    </div>
                  ))}
                </div>
                {detail.terms ? (
                  <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Terms / notes</p>
                    <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{detail.terms}</p>
                  </div>
                ) : null}

                {/* Variance */}
                <div>
                  <h4 className="mb-2 text-sm font-bold text-ink dark:text-white">Ordered vs received</h4>
                  <ReceiveProgress po={detail} />
                  <div className="mt-2 flex flex-wrap gap-4 text-sm">
                    <span className="tnum text-slate-600 dark:text-slate-300">Received: <strong className="text-ink dark:text-white">{fmtQ(detailReceived)} q</strong></span>
                    <span className="tnum text-slate-600 dark:text-slate-300">Outstanding: <strong className="text-ink dark:text-white">{fmtQ(detailOutstanding)} q</strong></span>
                  </div>
                </div>

                {/* Linked intakes */}
                <div>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink dark:text-white">
                    <Truck className="h-4 w-4 text-slate-400 dark:text-slate-500" /> Linked deliveries ({detailIntakes.length})
                  </h4>
                  {detailIntakes.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">No gate deliveries have been linked to this order yet.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-700">
                      <table className="w-full min-w-[420px] text-sm">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            <th className="px-3 py-2">Intake No.</th>
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2 text-right">Quintals</th>
                            <th className="px-3 py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailIntakes.map((i) => (
                            <tr key={i.id} className="border-t border-slate-100 dark:border-slate-700">
                              <td className="tnum px-3 py-2 font-semibold text-ink dark:text-white">{i.intakeNo}</td>
                              <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{fmtDate(i.deliveryDate)}</td>
                              <td className="tnum px-3 py-2 text-right">{fmtQ(i.quintals)}</td>
                              <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{i.status.replace('_', ' ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Timeline */}
                <div>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink dark:text-white">
                    <CalendarDays className="h-4 w-4 text-slate-400 dark:text-slate-500" /> Timeline
                  </h4>
                  <ul className="space-y-2 text-sm">
                    <li className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Draft created</span>
                      <span className="tnum font-semibold">{fmtDateTime(detail.createdAt)}</span>
                    </li>
                    {detail.approvedAt ? (
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Approved</span>
                        <span className="tnum font-semibold">{fmtDateTime(detail.approvedAt)}</span>
                      </li>
                    ) : null}
                    {detailIntakes.length > 0 ? (
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">First delivery</span>
                        <span className="tnum font-semibold">{fmtDate(detailIntakes[0].deliveryDate)}</span>
                      </li>
                    ) : null}
                    {detail.cancelledAt ? (
                      <li className="flex justify-between text-rose-700">
                        <span>Cancelled{detail.cancelReason ? ` — ${detail.cancelReason}` : ''}</span>
                        <span className="tnum font-semibold">{fmtDateTime(detail.cancelledAt)}</span>
                      </li>
                    ) : null}
                  </ul>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 border-t border-slate-100 dark:border-slate-700 pt-4">
                  {detail.status === 'DRAFT' ? (
                    <>
                      {canApprove ? (
                        <Button onClick={() => { setDetailId(null); approvePO(detail); }} className="text-sm">
                          <CheckCircle2 className="h-4 w-4" /> Approve
                        </Button>
                      ) : null}
                      {canManage ? (
                        <>
                          <Button variant="secondary" onClick={() => { setDetailId(null); openEdit(detail); }} className="text-sm">
                            <Pencil className="h-4 w-4" /> Edit
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => { setDetailId(null); setCancelTarget(detail); setCancelReason(''); }}
                            className="text-sm"
                          >
                            <Ban className="h-4 w-4" /> Cancel
                          </Button>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
