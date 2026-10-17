import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Package, Plus } from 'lucide-react';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { BreakdownRecord, MaintenanceEquipment, SparePart, WorkOrder } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextArea, TextInput } from '../components/ui';

const cardShell =
  'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

const WO_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const KINDS = ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'];

const NEXT_STATUS: Record<string, string[]> = {
  OPEN: ['ASSIGNED'],
  ASSIGNED: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: ['VERIFIED'],
  VERIFIED: []
};

const STATUS_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  OPEN: 'neutral',
  ASSIGNED: 'advisory',
  IN_PROGRESS: 'advisory',
  COMPLETED: 'pass',
  VERIFIED: 'pass'
};

const PRIORITY_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  LOW: 'neutral',
  MEDIUM: 'neutral',
  HIGH: 'advisory',
  CRITICAL: 'critical'
};

export function WorkOrders() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('maintenance:manage');

  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [createModal, setCreateModal] = useState(false);
  const [partsFor, setPartsFor] = useState<WorkOrder | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const workOrdersQ = useQuery({
    queryKey: ['maint-work-orders', statusFilter, priorityFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      const q = params.toString();
      return (await api.get<WorkOrder[]>(`${E.maintWorkOrders}${q ? `?${q}` : ''}`)).data;
    }
  });

  const equipmentQ = useQuery({
    queryKey: ['maint-equipment-all'],
    queryFn: async () => (await api.get<MaintenanceEquipment[]>(E.maintEquipment)).data,
    enabled: createModal
  });

  const openBreakdownsQ = useQuery({
    queryKey: ['maint-breakdowns-open'],
    queryFn: async () => (await api.get<BreakdownRecord[]>(`${E.maintBreakdowns}?status=OPEN`)).data,
    enabled: createModal
  });

  const partsQ = useQuery({
    queryKey: ['maint-parts-all'],
    queryFn: async () => (await api.get<SparePart[]>(E.maintParts)).data,
    enabled: partsFor !== null
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['maint-work-orders'] });
    qc.invalidateQueries({ queryKey: ['maint-repair-approvals'] });
  };

  const createWorkOrder = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      await api.post(E.maintWorkOrders, {
        equipmentId: String(fd.get('equipmentId') ?? ''),
        kind: String(fd.get('kind') ?? 'CORRECTIVE'),
        priority: String(fd.get('priority') ?? 'MEDIUM'),
        assigneeName: String(fd.get('assigneeName') ?? '').trim() || null,
        breakdownId: String(fd.get('breakdownId') ?? '') || null,
        description: String(fd.get('description') ?? '').trim(),
        notes: String(fd.get('notes') ?? '').trim() || null
      });
      setCreateModal(false);
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err) ? 'Network error — check your connection.' : 'Could not create work order.');
    } finally {
      setSaving(false);
    }
  };

  const transition = async (wo: WorkOrder, next: string) => {
    setBusyId(wo.id);
    setFormError(null);
    try {
      await api.put(E.maintWorkOrder(wo.id), { status: next });
      invalidate();
    } catch (err) {
      setFormError(isNetworkError(err)
        ? 'Network error — check your connection.'
        : next === 'VERIFIED'
          ? 'Verification requires supervisor approval first (Repair Approval page).'
          : 'Could not change work order status.');
    } finally {
      setBusyId(null);
    }
  };

  const saveParts = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!partsFor) return;
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const partId = String(fd.get('partId') ?? '');
      const qty = Number(fd.get('qty') ?? 0);
      if (!partId) throw new Error('Select a part.');
      if (!(qty > 0)) throw new Error('Quantity must be positive.');
      await api.post(E.maintWorkOrderParts(partsFor.id), { items: [{ partId, qty }] });
      setPartsFor(null);
      invalidate();
    } catch (err) {
      setFormError(err instanceof Error && (err.message === 'Select a part.' || err.message === 'Quantity must be positive.')
        ? err.message
        : isNetworkError(err) ? 'Network error — check your connection.' : 'Could not record parts (insufficient stock?).');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Maintenance Work Orders</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Open → Assigned → In Progress → Completed → Verified, with parts usage.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => { setCreateModal(true); setFormError(null); }}>
            <Plus size={16} /> New work order
          </Button>
        ) : null}
      </div>

      {formError ? (
        <div className="rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
      ) : null}

      <div className={cardShell}>
        <CardHeader
          icon={<ClipboardList size={16} />}
          title="Work orders"
          subtitle="Lifecycle transitions are enforced in sequence."
          action={
            <div className="flex flex-wrap gap-2">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-40">
                <option value="">All statuses</option>
                {WO_STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </Select>
              <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="!w-36">
                <option value="">All priorities</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
            </div>
          }
        />
        {workOrdersQ.isLoading ? (
          <Spinner />
        ) : workOrdersQ.isError ? (
          <ErrorBox
            message={isNetworkError(workOrdersQ.error) ? 'Network error.' : 'Failed to load work orders.'}
            onRetry={() => workOrdersQ.refetch()}
          />
        ) : (
          <DataTable<WorkOrder>
            columns={[
              { key: 'woNumber', label: 'WO no.', render: (r) => <span className="font-mono text-sm font-semibold">{r.woNumber}</span> },
              { key: 'equipment', label: 'Equipment', render: (r) => <span className="font-medium">{r.equipment?.name ?? '—'}</span> },
              { key: 'kind', label: 'Kind', render: (r) => <span className="text-sm capitalize">{r.kind.toLowerCase()}</span> },
              { key: 'priority', label: 'Priority', render: (r) => <Badge tone={PRIORITY_TONE[r.priority] ?? 'neutral'}>{r.priority}</Badge> },
              { key: 'assigneeName', label: 'Assignee', render: (r) => <span className="text-sm">{r.assigneeName ?? '—'}</span> },
              {
                key: 'partsUsed',
                label: 'Parts',
                render: (r) => (
                  <span className="tabular-nums text-sm">
                    {(r.partsUsed ?? []).length > 0 ? `${(r.partsUsed ?? []).length} line${(r.partsUsed ?? []).length === 1 ? '' : 's'}` : '—'}
                  </span>
                )
              },
              { key: 'openedAt', label: 'Opened', render: (r) => <span className="tabular-nums text-sm">{fmtDateTime(r.openedAt)}</span> },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status.replace(/_/g, ' ')}</Badge> },
              ...(canManage
                ? [{
                    key: 'id' as const,
                    label: '',
                    render: (r: WorkOrder) => (
                      <div className="flex flex-wrap gap-1.5">
                        {(NEXT_STATUS[r.status] ?? []).map((n) => (
                          <Button
                            key={n}
                            variant="secondary"
                            disabled={busyId === r.id}
                            onClick={() => transition(r, n)}
                          >
                            {busyId === r.id ? '…' : `→ ${n.replace(/_/g, ' ')}`}
                          </Button>
                        ))}
                        {r.status === 'IN_PROGRESS' || r.status === 'COMPLETED' ? (
                          <Button variant="secondary" onClick={() => { setPartsFor(r); setFormError(null); }}>
                            <Package size={14} /> Parts
                          </Button>
                        ) : null}
                      </div>
                    )
                  }]
                : [])
            ]}
            rows={workOrdersQ.data ?? []}
            emptyTitle="No work orders found."
          />
        )}
      </div>

      {/* Create modal */}
      {createModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCreateModal(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="New work order"
          >
            <h3 className="mb-4 text-base font-bold text-slate-900 dark:text-slate-100">New work order</h3>
            {formError ? (
              <div className="mb-4 rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
            ) : null}
            <form onSubmit={createWorkOrder} className="space-y-4">
              <Field label="Equipment" required>
                {equipmentQ.isLoading ? (
                  <Spinner />
                ) : (
                  <Select name="equipmentId" required>
                    <option value="">Select equipment…</option>
                    {(equipmentQ.data ?? []).map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Kind">
                  <Select name="kind" defaultValue="CORRECTIVE">
                    {KINDS.map((k) => (
                      <option key={k} value={k}>{k.charAt(0) + k.slice(1).toLowerCase()}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select name="priority" defaultValue="MEDIUM">
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Assignee">
                  <TextInput name="assigneeName" maxLength={200} placeholder="Technician name" />
                </Field>
                <Field label="Linked breakdown">
                  <Select name="breakdownId" defaultValue="">
                    <option value="">None</option>
                    {(openBreakdownsQ.data ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {(b.equipment?.name ?? '—')} · {b.category.toLowerCase()}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Work description" required>
                <TextArea name="description" rows={3} required maxLength={4000} placeholder="Describe the maintenance task…" />
              </Field>
              <Field label="Notes">
                <TextInput name="notes" maxLength={4000} />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setCreateModal(false)}>Cancel</Button>
                <Button type="submit" loading={saving}>Create work order</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Record parts modal */}
      {partsFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPartsFor(null)}>
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`Record parts for ${partsFor.woNumber}`}
          >
            <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
              <Package size={16} /> Record parts used
            </h3>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              {partsFor.woNumber} · {partsFor.equipment?.name} — stock is decremented on save.
            </p>
            {formError ? (
              <div className="mb-4 rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
            ) : null}
            {(partsFor.partsUsed ?? []).length > 0 ? (
              <ul className="mb-4 space-y-1 rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-sm">
                {(partsFor.partsUsed ?? []).map((p, i) => (
                  <li key={i} className="flex justify-between gap-2 text-slate-600 dark:text-slate-300">
                    <span>{p.partNumber} — {p.name}</span>
                    <span className="tabular-nums font-semibold">×{p.qty}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <form onSubmit={saveParts} className="space-y-4">
              <Field label="Part" required>
                {partsQ.isLoading ? (
                  <Spinner />
                ) : (
                  <Select name="partId" required>
                    <option value="">Select part…</option>
                    {(partsQ.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.partNumber} — {p.name} (stock {p.stockQty})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Quantity" required>
                <TextInput type="number" name="qty" min={1} step="any" required className="tabular-nums" />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setPartsFor(null)}>Cancel</Button>
                <Button type="submit" loading={saving}>Record usage</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
