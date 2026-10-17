import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type {
  ChecklistFrequency,
  ChecklistTaskItem,
  CleaningChecklistTemplate
} from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../store/auth';
import {
  EQUIPMENT_OPTIONS,
  FACTORY_AREAS,
  FREQUENCY_LABEL,
  cardShell
} from './HygieneCommon';
import {
  Button,
  Card,
  EmptyState,
  Field,
  SectionTitle,
  Select,
  Spinner,
  TextArea,
  TextInput
} from '../components/ui';

interface ItemDraft {
  title: string;
  detail: string;
}

const emptyItem = (): ItemDraft => ({ title: '', detail: '' });

export function HygieneChecklists() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('hygiene:manage');

  const [equipmentFilter, setEquipmentFilter] = useState('');
  const [frequencyFilter, setFrequencyFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<CleaningChecklistTemplate | null>(null);
  const [editingItems, setEditingItems] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Create form state
  const [name, setName] = useState('');
  const [equipment, setEquipment] = useState<string>(EQUIPMENT_OPTIONS[0]);
  const [customEquipment, setCustomEquipment] = useState('');
  const [area, setArea] = useState('');
  const [frequency, setFrequency] = useState<ChecklistFrequency>('DAILY');
  const [assignedTo, setAssignedTo] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [editItems, setEditItems] = useState<ItemDraft[]>([]);

  const listQ = useQuery({
    queryKey: ['hygiene', 'checklists', equipmentFilter, frequencyFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (equipmentFilter) params.set('equipment', equipmentFilter);
      if (frequencyFilter) params.set('frequency', frequencyFilter);
      return (await api.get<CleaningChecklistTemplate[]>(`${E.hygChecklists}?${params}`)).data;
    }
  });

  const openDetail = async (row: CleaningChecklistTemplate) => {
    try {
      const res = await api.get<CleaningChecklistTemplate>(E.hygChecklist(row.id));
      setDetail(res.data);
      setEditItems(
        (res.data.items ?? []).map((it: ChecklistTaskItem) => ({ title: it.title, detail: it.detail ?? '' }))
      );
      setEditingItems(false);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to load checklist.' });
    }
  };

  const resetForm = () => {
    setName('');
    setEquipment(EQUIPMENT_OPTIONS[0]);
    setCustomEquipment('');
    setArea('');
    setFrequency('DAILY');
    setAssignedTo('');
    setItems([emptyItem()]);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const cleanItems = items.map((i) => ({ title: i.title.trim(), detail: i.detail.trim() || null })).filter((i) => i.title);
    const finalEquipment = equipment === 'Other' ? customEquipment.trim() : equipment;
    if (!name.trim() || !finalEquipment || cleanItems.length === 0) {
      setNotice({ ok: false, text: 'Name, equipment and at least one task item are required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.hygChecklists, {
        name: name.trim(),
        equipment: finalEquipment,
        area: area || null,
        frequency,
        assignedTo: assignedTo.trim() || null,
        items: cleanItems
      });
      setNotice({ ok: true, text: 'Checklist template created.' });
      resetForm();
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['hygiene', 'checklists'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create checklist.' });
    } finally {
      setSaving(false);
    }
  };

  const saveItems = async () => {
    if (!detail) return;
    const cleanItems = editItems
      .map((i) => ({ title: i.title.trim(), detail: i.detail.trim() || null }))
      .filter((i) => i.title);
    if (cleanItems.length === 0) {
      setNotice({ ok: false, text: 'A checklist needs at least one task item.' });
      return;
    }
    setSaving(true);
    try {
      const res = await api.put<CleaningChecklistTemplate>(E.hygChecklistItems(detail.id), {
        items: cleanItems
      });
      setDetail(res.data);
      setEditingItems(false);
      setNotice({ ok: true, text: 'Checklist items updated.' });
      qc.invalidateQueries({ queryKey: ['hygiene', 'checklists'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to update items.' });
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (row: CleaningChecklistTemplate) => {
    if (!window.confirm(`Deactivate checklist "${row.name}"?`)) return;
    try {
      await api.delete(E.hygChecklist(row.id));
      setNotice({ ok: true, text: 'Checklist deactivated.' });
      qc.invalidateQueries({ queryKey: ['hygiene', 'checklists'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to deactivate.' });
    }
  };

  const columns = [
    { key: 'name', label: 'Template', render: (r: CleaningChecklistTemplate) => <span className="font-semibold text-slate-800 dark:text-slate-100">{r.name}</span> },
    { key: 'equipment', label: 'Equipment' },
    { key: 'frequency', label: 'Frequency', render: (r: CleaningChecklistTemplate) => <Badge tone="neutral">{FREQUENCY_LABEL[r.frequency]}</Badge> },
    { key: 'items', label: 'Tasks', mono: true, render: (r: CleaningChecklistTemplate) => <span className="tabular-nums">{r._count?.items ?? r.items?.length ?? 0}</span> },
    { key: 'assignedTo', label: 'Assigned to', render: (r: CleaningChecklistTemplate) => r.assignedTo ?? '—' },
    {
      key: 'actions',
      label: 'Actions',
      render: (r: CleaningChecklistTemplate) => (
        <div className="flex gap-2">
          <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => openDetail(r)}>
            View
          </Button>
          {canManage ? (
            <Button variant="ghost" className="px-3 py-1 text-xs" onClick={() => deactivate(r)}>
              Deactivate
            </Button>
          ) : null}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Equipment Cleaning Checklists"
        sub="Checklist templates per equipment — mill rolls, sifters, conveyors, packing machines"
        action={
          canManage ? (
            <Button onClick={() => setShowForm((v) => !v)}>
              <Plus size={16} /> New template
            </Button>
          ) : undefined
        }
      />

      {notice ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className={cardShell}>
        <CardHeader
          icon={<ClipboardList size={16} />}
          title="Checklist templates"
          subtitle="Task lists assigned to each piece of equipment"
          action={
            <div className="flex gap-2">
              <Select value={equipmentFilter} onChange={(e) => setEquipmentFilter(e.target.value)} className="!w-auto !px-3 !py-1.5 !text-sm">
                <option value="">All equipment</option>
                {EQUIPMENT_OPTIONS.filter((o) => o !== 'Other').map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
              <Select value={frequencyFilter} onChange={(e) => setFrequencyFilter(e.target.value)} className="!w-auto !px-3 !py-1.5 !text-sm">
                <option value="">All frequencies</option>
                {(Object.keys(FREQUENCY_LABEL) as ChecklistFrequency[]).map((f) => (
                  <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>
                ))}
              </Select>
            </div>
          }
        />
        {listQ.isLoading ? (
          <Spinner label="Loading checklists..." />
        ) : listQ.isError ? (
          <EmptyState title="Failed to load checklists" sub="Check your connection and try again." />
        ) : (listQ.data ?? []).length === 0 ? (
          <EmptyState title="No checklist templates" sub="Create one per equipment to standardise cleaning." />
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable columns={columns} rows={listQ.data ?? []} />
            </div>
            <div className="grid grid-cols-1 gap-3 md:hidden">
              {(listQ.data ?? []).map((r) => (
                <div key={r.id} className="rounded-xl border border-line bg-white dark:bg-slate-800 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-100">{r.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{r.equipment}{r.area ? ` · ${r.area}` : ''}</p>
                    </div>
                    <Badge tone="neutral">{FREQUENCY_LABEL[r.frequency]}</Badge>
                  </div>
                  <p className="mt-2 text-sm tabular-nums text-slate-600 dark:text-slate-300">{r._count?.items ?? 0} tasks · {r.assignedTo ?? 'Unassigned'}</p>
                  <div className="mt-3 flex gap-2">
                    <Button variant="secondary" className="flex-1 py-1.5 text-sm" onClick={() => openDetail(r)}>View</Button>
                    {canManage ? (
                      <Button variant="ghost" className="flex-1 py-1.5 text-sm" onClick={() => deactivate(r)}>Deactivate</Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showForm ? (
        <form onSubmit={create} className={cardShell}>
          <CardHeader icon={<Plus size={16} />} title="New checklist template" subtitle="Define the task list for one piece of equipment" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Template name" required>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mill rolls — daily cleaning" />
            </Field>
            <Field label="Equipment" required>
              <Select value={equipment} onChange={(e) => setEquipment(e.target.value)}>
                {EQUIPMENT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            </Field>
            {equipment === 'Other' ? (
              <Field label="Equipment name" required>
                <TextInput value={customEquipment} onChange={(e) => setCustomEquipment(e.target.value)} placeholder="Equipment name" />
              </Field>
            ) : null}
            <Field label="Factory area">
              <Select value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">—</option>
                {FACTORY_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
            </Field>
            <Field label="Frequency" required>
              <Select value={frequency} onChange={(e) => setFrequency(e.target.value as ChecklistFrequency)}>
                {(Object.keys(FREQUENCY_LABEL) as ChecklistFrequency[]).map((f) => (
                  <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Assigned to">
              <TextInput value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Role or person" />
            </Field>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Task items</p>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-300 text-xs font-bold tabular-nums text-slate-500 dark:text-slate-400">{i + 1}</span>
                  <div className="flex-1 space-y-2">
                    <TextInput value={it.title} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Task — e.g. Brush and blow down roller surfaces" />
                    <TextArea value={it.detail} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)))} placeholder="Detail / method (optional)" rows={1} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-2 py-2"
                    onClick={() => setItems((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : [emptyItem()]))}
                    aria-label="Remove task"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="secondary" className="mt-2 text-sm" onClick={() => setItems((p) => [...p, emptyItem()])}>
              <Plus size={14} /> Add task
            </Button>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" loading={saving}>Save template</Button>
            <Button type="button" variant="secondary" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[90vh] w-full max-w-xl overflow-y-auto p-6">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink">{detail.name}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {detail.equipment}{detail.area ? ` · ${detail.area}` : ''} · {FREQUENCY_LABEL[detail.frequency]}
                </p>
              </div>
              <Button variant="ghost" className="px-2 py-1" onClick={() => setDetail(null)} aria-label="Close">
                <X size={18} />
              </Button>
            </div>
            {canManage && !editingItems ? (
              <Button variant="secondary" className="mb-3 text-sm" onClick={() => setEditingItems(true)}>
                <Pencil size={14} /> Edit task items
              </Button>
            ) : null}
            {editingItems ? (
              <div className="space-y-2">
                {editItems.map((it, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <TextInput value={it.title} onChange={(e) => setEditItems((p) => p.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Task" />
                      <TextArea value={it.detail} onChange={(e) => setEditItems((p) => p.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)))} placeholder="Detail (optional)" rows={1} />
                    </div>
                    <Button type="button" variant="ghost" className="px-2 py-2" onClick={() => setEditItems((p) => p.filter((_, j) => j !== i))} aria-label="Remove task">
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <Button type="button" variant="secondary" className="text-sm" onClick={() => setEditItems((p) => [...p, emptyItem()])}>
                    <Plus size={14} /> Add task
                  </Button>
                  <Button type="button" className="text-sm" loading={saving} onClick={saveItems}>Save tasks</Button>
                  <Button type="button" variant="secondary" className="text-sm" onClick={() => setEditingItems(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {(detail.items ?? []).map((it, i) => (
                  <li key={it.id} className="flex items-start gap-3 rounded-lg border border-line bg-alabaster px-3 py-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 bg-white dark:bg-slate-800 text-[11px] font-bold tabular-nums text-slate-500 dark:text-slate-400">{i + 1}</span>
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{it.title}</p>
                      {it.detail ? <p className="text-xs text-slate-500 dark:text-slate-400">{it.detail}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
