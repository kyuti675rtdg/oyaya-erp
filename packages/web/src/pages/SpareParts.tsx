import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Boxes, ClipboardCheck, History, Plus } from 'lucide-react';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { SparePart, SparePartVerification } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextInput } from '../components/ui';

const cardShell =
  'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

export function SpareParts() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('maintenance:manage');

  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SparePart | null>(null);
  const [adjustFor, setAdjustFor] = useState<SparePart | null>(null);
  const [verifyFor, setVerifyFor] = useState<SparePart | null>(null);
  const [historyFor, setHistoryFor] = useState<SparePart | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const partsQ = useQuery({
    queryKey: ['maint-parts', lowStockOnly, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (lowStockOnly) params.set('lowStock', 'true');
      if (search.trim()) params.set('search', search.trim());
      const q = params.toString();
      return (await api.get<SparePart[]>(`${E.maintParts}${q ? `?${q}` : ''}`)).data;
    }
  });

  const historyQ = useQuery({
    queryKey: ['maint-verifications', historyFor?.id],
    queryFn: async () =>
      (await api.get<SparePartVerification[]>(`${E.maintVerifications}?partId=${historyFor!.id}&limit=30`)).data,
    enabled: !!historyFor
  });

  const lowStockCount = useMemo(
    () => (partsQ.data ?? []).filter((p) => p.lowStock).length,
    [partsQ.data]
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['maint-parts'] });
    qc.invalidateQueries({ queryKey: ['maint-verifications'] });
  };

  const savePart = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      if (editing) {
        await api.put(E.maintPart(editing.id), {
          name: String(fd.get('name') ?? '').trim(),
          compatibleTypes: String(fd.get('compatibleTypes') ?? '').trim() || null,
          minLevel: Number(fd.get('minLevel') ?? 0),
          locationBin: String(fd.get('locationBin') ?? '').trim() || null,
          unit: String(fd.get('unit') ?? 'pcs').trim() || 'pcs'
        });
      } else {
        await api.post(E.maintParts, {
          partNumber: String(fd.get('partNumber') ?? '').trim(),
          name: String(fd.get('name') ?? '').trim(),
          compatibleTypes: String(fd.get('compatibleTypes') ?? '').trim() || null,
          stockQty: Number(fd.get('stockQty') ?? 0),
          minLevel: Number(fd.get('minLevel') ?? 0),
          locationBin: String(fd.get('locationBin') ?? '').trim() || null,
          unit: String(fd.get('unit') ?? 'pcs').trim() || 'pcs'
        });
      }
      setModalOpen(false);
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Could not save part (part number may already exist).');
    } finally {
      setSaving(false);
    }
  };

  const saveAdjust = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!adjustFor) return;
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const qty = Number(fd.get('qty') ?? 0);
      if (!qty) throw new Error('Enter a non-zero quantity.');
      await api.post(E.maintPartAdjust(adjustFor.id), {
        qty,
        note: String(fd.get('note') ?? '').trim() || null
      });
      setAdjustFor(null);
      invalidate();
    } catch (err) {
      setFormError(err instanceof Error && err.message === 'Enter a non-zero quantity.'
        ? err.message
        : isNetworkError(err) ? 'Network error — check your connection.' : 'Could not adjust stock.');
    } finally {
      setSaving(false);
    }
  };

  const saveVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!verifyFor) return;
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      await api.post(E.maintPartVerify(verifyFor.id), {
        countedQty: Number(fd.get('countedQty') ?? 0),
        notes: String(fd.get('notes') ?? '').trim() || null
      });
      setVerifyFor(null);
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Could not record verification.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Spare Parts Inventory &amp; Verification</h1>
          <p className="mt-1 text-sm text-slate-500">
            Parts catalog by part number, stock levels, and periodic physical verification.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => { setEditing(null); setFormError(null); setModalOpen(true); }}>
            <Plus size={16} /> Add part
          </Button>
        ) : null}
      </div>

      {lowStockCount > 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
          <AlertTriangle size={20} className="shrink-0 text-rose-600" />
          <p className="text-sm font-medium text-rose-800">
            <span className="tabular-nums font-bold">{lowStockCount}</span> part{lowStockCount === 1 ? '' : 's'} at or below
            minimum stock level — review and reorder.
          </p>
        </div>
      ) : null}

      <div className={cardShell}>
        <CardHeader
          icon={<Boxes size={16} />}
          title="Parts catalog"
          subtitle="Tracked by part number, compatible equipment, bin location, and minimum level."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                placeholder="Search part no. / name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="!w-48"
              />
              <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={lowStockOnly}
                  onChange={(e) => setLowStockOnly(e.target.checked)}
                  className="h-4 w-4 accent-rose-600"
                />
                Low stock only
              </label>
            </div>
          }
        />
        {partsQ.isLoading ? (
          <Spinner />
        ) : partsQ.isError ? (
          <ErrorBox
            message={isNetworkError(partsQ.error) ? 'Network error.' : 'Failed to load spare parts.'}
            onRetry={() => partsQ.refetch()}
          />
        ) : (
          <DataTable<SparePart>
            columns={[
              {
                key: 'partNumber',
                label: 'Part no.',
                render: (r) => (
                  <div className="flex items-center gap-2">
                    {r.lowStock ? <AlertTriangle size={15} className="shrink-0 text-rose-500" /> : null}
                    <span className="font-mono text-sm font-semibold">{r.partNumber}</span>
                  </div>
                )
              },
              { key: 'name', label: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'compatibleTypes', label: 'Compatible equipment', render: (r) => <span className="text-sm text-slate-600">{r.compatibleTypes ?? '—'}</span> },
              {
                key: 'stockQty',
                label: 'Stock',
                render: (r) => (
                  <span className={`tabular-nums text-sm font-semibold ${r.lowStock ? 'text-rose-600' : 'text-slate-800'}`}>
                    {r.stockQty.toLocaleString()} {r.unit}
                  </span>
                )
              },
              {
                key: 'minLevel',
                label: 'Min level',
                render: (r) => <span className="tabular-nums text-sm">{r.minLevel.toLocaleString()} {r.unit}</span>
              },
              { key: 'locationBin', label: 'Bin', render: (r) => <span className="text-sm">{r.locationBin ?? '—'}</span> },
              {
                key: 'id',
                label: 'Alert',
                render: (r) => r.lowStock
                  ? <Badge tone="critical">Low stock</Badge>
                  : <Badge tone="pass">OK</Badge>
              },
              ...(canManage
                ? [{
                    key: 'id' as const,
                    label: '',
                    render: (r: SparePart) => (
                      <div className="flex flex-wrap gap-1.5">
                        <Button variant="secondary" onClick={() => { setAdjustFor(r); setFormError(null); }}>Adjust</Button>
                        <Button variant="secondary" onClick={() => { setVerifyFor(r); setFormError(null); }}>Verify</Button>
                        <Button variant="secondary" onClick={() => setHistoryFor(r)}>
                          <History size={14} />
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => { setEditing(r); setFormError(null); setModalOpen(true); }}
                        >
                          Edit
                        </Button>
                      </div>
                    )
                  }]
                : [])
            ]}
            rows={partsQ.data ?? []}
            emptyTitle="No spare parts found."
          />
        )}
      </div>

      {/* Add / edit modal */}
      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={editing ? 'Edit spare part' : 'Add spare part'}
          >
            <h3 className="mb-4 text-base font-bold text-slate-900">{editing ? 'Edit spare part' : 'Add spare part'}</h3>
            {formError ? (
              <div className="mb-4 rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
            ) : null}
            <form onSubmit={savePart} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Part number" required>
                  <TextInput
                    name="partNumber"
                    defaultValue={editing?.partNumber ?? ''}
                    required={!editing}
                    disabled={!!editing}
                    maxLength={100}
                    className="font-mono"
                  />
                </Field>
                <Field label="Unit">
                  <TextInput name="unit" defaultValue={editing?.unit ?? 'pcs'} maxLength={20} />
                </Field>
              </div>
              <Field label="Part name" required>
                <TextInput name="name" defaultValue={editing?.name ?? ''} required maxLength={200} />
              </Field>
              <Field label="Compatible equipment">
                <TextInput
                  name="compatibleTypes"
                  defaultValue={editing?.compatibleTypes ?? ''}
                  maxLength={500}
                  placeholder="e.g. ROLLER_MILL, PLANSIFTER"
                />
              </Field>
              <div className="grid grid-cols-3 gap-4">
                {!editing ? (
                  <Field label="Opening stock" required>
                    <TextInput type="number" name="stockQty" min={0} step="any" defaultValue={0} required className="tabular-nums" />
                  </Field>
                ) : null}
                <Field label="Min stock level" required>
                  <TextInput type="number" name="minLevel" min={0} step="any" defaultValue={editing?.minLevel ?? 0} required className="tabular-nums" />
                </Field>
                <Field label="Bin location">
                  <TextInput name="locationBin" defaultValue={editing?.locationBin ?? ''} maxLength={100} placeholder="e.g. A-12" />
                </Field>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Add part'}</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Adjust stock modal */}
      {adjustFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAdjustFor(null)}>
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`Adjust stock for ${adjustFor.partNumber}`}
          >
            <h3 className="mb-1 text-base font-bold text-slate-900">Adjust stock</h3>
            <p className="mb-4 text-xs text-slate-500">
              {adjustFor.partNumber} · current <span className="tabular-nums font-semibold">{adjustFor.stockQty} {adjustFor.unit}</span>
            </p>
            {formError ? (
              <div className="mb-4 rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
            ) : null}
            <form onSubmit={saveAdjust} className="space-y-4">
              <Field label="Quantity (positive = receipt, negative = issue)" required>
                <TextInput type="number" name="qty" step="any" required className="tabular-nums" placeholder="e.g. 50 or -3" />
              </Field>
              <Field label="Note">
                <TextInput name="note" maxLength={500} placeholder="e.g. Purchase receipt PO-1042" />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setAdjustFor(null)}>Cancel</Button>
                <Button type="submit" loading={saving}>Apply adjustment</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Verify modal */}
      {verifyFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setVerifyFor(null)}>
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`Verify stock for ${verifyFor.partNumber}`}
          >
            <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-slate-900">
              <ClipboardCheck size={16} /> Physical verification
            </h3>
            <p className="mb-4 text-xs text-slate-500">
              {verifyFor.partNumber} · system stock <span className="tabular-nums font-semibold">{verifyFor.stockQty} {verifyFor.unit}</span>
            </p>
            {formError ? (
              <div className="mb-4 rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
            ) : null}
            <form onSubmit={saveVerify} className="space-y-4">
              <Field label="Counted quantity" required>
                <TextInput type="number" name="countedQty" min={0} step="any" required className="tabular-nums" />
              </Field>
              <Field label="Notes">
                <TextInput name="notes" maxLength={1000} />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setVerifyFor(null)}>Cancel</Button>
                <Button type="submit" loading={saving}>Record verification</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Verification history modal */}
      {historyFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setHistoryFor(null)}>
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`Verification history for ${historyFor.partNumber}`}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Verification history — {historyFor.partNumber}</h3>
              <Button variant="secondary" onClick={() => setHistoryFor(null)}>Close</Button>
            </div>
            {historyQ.isLoading ? (
              <Spinner />
            ) : historyQ.isError ? (
              <ErrorBox message="Failed to load verification history." onRetry={() => historyQ.refetch()} />
            ) : (
              <DataTable<SparePartVerification>
                columns={[
                  { key: 'verifiedAt', label: 'Verified', render: (r) => <span className="tabular-nums text-sm">{fmtDateTime(r.verifiedAt)}</span> },
                  { key: 'systemQty', label: 'System', render: (r) => <span className="tabular-nums text-sm">{r.systemQty}</span> },
                  { key: 'countedQty', label: 'Counted', render: (r) => <span className="tabular-nums text-sm">{r.countedQty}</span> },
                  {
                    key: 'variance',
                    label: 'Variance',
                    render: (r) => (
                      <span className={`tabular-nums text-sm font-semibold ${Number(r.variance) === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {Number(r.variance) > 0 ? '+' : ''}{r.variance}
                      </span>
                    )
                  },
                  { key: 'notes', label: 'Notes', render: (r) => <span className="text-sm text-slate-500">{r.notes ?? '—'}</span> }
                ]}
                rows={historyQ.data ?? []}
                emptyTitle="No verifications recorded yet."
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
