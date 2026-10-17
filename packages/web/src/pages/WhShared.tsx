/**
 * Shared helpers for the Warehouse & Inventory module (Wh* pages).
 * Filename starts with "Wh" per module file-ownership rules.
 */
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { useAuth } from '../store/auth';
import type { Product } from '../types';
import { Button, EmptyState, ErrorBox, NumberInput, Select, TextInput } from '../components/ui';

export const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/70 dark:border-slate-700 shadow-sm p-5';

export const fmtQ = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

export const fmtBirr = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' Br';

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

type Tone = 'violet' | 'emerald' | 'amber' | 'rose' | 'sky' | 'slate';

const toneClasses: Record<Tone, string> = {
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300'
};

export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${toneClasses[tone]}`}
    >
      {label}
    </span>
  );
}

export function docStatusTone(status: string): Tone {
  const s = status.toUpperCase();
  if (['COMPLETED', 'POSTED', 'PLACED', 'DISPATCHED', 'APPROVED', 'CONSUMED'].includes(s)) return 'emerald';
  if (['REQUESTED', 'PENDING', 'DRAFT', 'PLANNED', 'IN_PROGRESS', 'RECOUNT', 'ACTIVE', 'PICKED'].includes(s))
    return 'amber';
  if (['REJECTED', 'CANCELLED', 'EXPIRED', 'RELEASED'].includes(s)) return 'rose';
  return 'slate';
}

export function useWhPerms() {
  const { hasClaim } = useAuth();
  return {
    canView: hasClaim('warehouse:view'),
    canManage: hasClaim('warehouse:manage'),
    canApprove: hasClaim('warehouse:approve')
  };
}

/** Active products (flour catalogue) for line editors. */
export function useProducts() {
  return useQuery({
    queryKey: ['wh-products'],
    queryFn: async () => (await api.get<Product[]>(E.products)).data,
    staleTime: 300000
  });
}

/** Active warehouse locations. */
export function useLocations() {
  return useQuery({
    queryKey: ['wh-locations'],
    queryFn: async () => (await api.get<import('../types').WhLocation[]>(E.warehouseLocations)).data,
    staleTime: 60000
  });
}

export function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Dynamic line-item editor ─────────────────────────────────────────────

export interface WhLine {
  key: string;
  productId: string;
  batchNo: string;
  quintals: string;
  bags: string;
  locationId: string;
  unitCostBirr: string;
  packagingKg: string;
  reason: string;
  reservationId: string;
}

export const emptyWhLine = (): WhLine => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  productId: '',
  batchNo: '',
  quintals: '',
  bags: '',
  locationId: '',
  unitCostBirr: '',
  packagingKg: '',
  reason: 'FOUND',
  reservationId: ''
});

export interface LineEditorOpts {
  showLocation?: boolean;
  showCost?: boolean;
  showPackaging?: boolean;
  showReason?: boolean;
  showReservation?: boolean;
  allowNegativeQty?: boolean;
  reasonOptions?: string[];
}

export function WhLineEditor({
  lines,
  setLines,
  products,
  locations,
  opts = {}
}: {
  lines: WhLine[];
  setLines: (l: WhLine[]) => void;
  products: Product[];
  locations: { id: string; code: string; name: string; isActive: boolean }[];
  opts?: LineEditorOpts;
}) {
  const {
    showLocation = false,
    showCost = false,
    showPackaging = false,
    showReason = false,
    showReservation = false,
    allowNegativeQty = false,
    reasonOptions = ['DAMAGE', 'FOUND', 'RECOUNT', 'SPOILAGE', 'OTHER']
  } = opts;

  const patch = (key: string, field: keyof WhLine, value: string) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, [field]: value } : l)));

  return (
    <div className="space-y-3">
      {lines.map((l, idx) => (
        <div key={l.key} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Line {idx + 1}</span>
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700"
              >
                <Trash2 size={13} /> Remove
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <label className="col-span-2 block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Product *</span>
              <Select value={l.productId} onChange={(e) => patch(l.key, 'productId', e.target.value)}>
                <option value="">Select…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Batch no</span>
              <TextInput value={l.batchNo} onChange={(e) => patch(l.key, 'batchNo', e.target.value)} placeholder="Optional" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Quintals {allowNegativeQty ? '(±)' : '*'}
              </span>
              <NumberInput
                value={l.quintals}
                min={allowNegativeQty ? undefined : '0'}
                step="0.01"
                onChange={(e) => patch(l.key, 'quintals', e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Bags</span>
              <NumberInput value={l.bags} min="0" step="1" onChange={(e) => patch(l.key, 'bags', e.target.value)} placeholder="0" />
            </label>
            {showLocation && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Location *</span>
                <Select value={l.locationId} onChange={(e) => patch(l.key, 'locationId', e.target.value)}>
                  <option value="">Select…</option>
                  {locations
                    .filter((x) => x.isActive)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.code} — {x.name}
                      </option>
                    ))}
                </Select>
              </label>
            )}
            {showCost && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Unit cost (Br/Qt)</span>
                <NumberInput
                  value={l.unitCostBirr}
                  min="0"
                  step="0.01"
                  onChange={(e) => patch(l.key, 'unitCostBirr', e.target.value)}
                  placeholder="Avg cost"
                />
              </label>
            )}
            {showPackaging && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Packaging</span>
                <Select value={l.packagingKg} onChange={(e) => patch(l.key, 'packagingKg', e.target.value)}>
                  <option value="">—</option>
                  {[50, 25, 10, 5].map((kg) => (
                    <option key={kg} value={kg}>
                      {kg} kg
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {showReason && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Reason *</span>
                <Select value={l.reason} onChange={(e) => patch(l.key, 'reason', e.target.value)}>
                  {reasonOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {showReservation && (
              <label className="col-span-2 block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Linked reservation (optional)</span>
                <TextInput
                  value={l.reservationId}
                  onChange={(e) => patch(l.key, 'reservationId', e.target.value)}
                  placeholder="WH-RS-0001 ref id…"
                />
              </label>
            )}
          </div>
        </div>
      ))}
      <Button type="button" variant="secondary" className="!px-4 !py-2 !text-sm" onClick={() => setLines([...lines, emptyWhLine()])}>
        <Plus size={15} /> Add line
      </Button>
    </div>
  );
}

/** Generic list-page state block: skeleton / error / empty. */
export function WhListState({
  isLoading,
  isError,
  isEmpty,
  emptyTitle,
  emptySub,
  onRetry
}: {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  emptyTitle: string;
  emptySub?: string;
  onRetry: () => void;
}) {
  if (isLoading)
    return (
      <div className="space-y-3" aria-label="Loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton-shimmer h-16 rounded-xl" aria-hidden="true" />
        ))}
      </div>
    );
  if (isError) return <ErrorBox message="Could not load data." onRetry={onRetry} />;
  if (isEmpty) return <EmptyState title={emptyTitle} sub={emptySub} />;
  return null;
}
