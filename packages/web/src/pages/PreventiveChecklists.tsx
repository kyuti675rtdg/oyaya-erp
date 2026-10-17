import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, ChevronDown, Play, Plus } from 'lucide-react';
import { api, isNetworkError } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { MaintenanceEquipment, PmExecution, PmTemplate } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { EQUIPMENT_TYPE_LABELS } from './MaintPlanning';

const cardShell =
  'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

export function PreventiveChecklists() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('maintenance:manage');

  const [typeFilter, setTypeFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [templateModal, setTemplateModal] = useState(false);
  const [editing, setEditing] = useState<PmTemplate | null>(null);
  const [itemsText, setItemsText] = useState('');
  const [executeFor, setExecuteFor] = useState<PmTemplate | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Execute-PM form state
  const [execEquipmentId, setExecEquipmentId] = useState('');
  const [execChecks, setExecChecks] = useState<boolean[]>([]);
  const [execDuration, setExecDuration] = useState('');
  const [execNotes, setExecNotes] = useState('');

  const templatesQ = useQuery({
    queryKey: ['maint-pm-templates', typeFilter],
    queryFn: async () => {
      const q = typeFilter ? `?type=${encodeURIComponent(typeFilter)}` : '';
      return (await api.get<PmTemplate[]>(`${E.maintPmTemplates}${q}`)).data;
    }
  });

  const equipmentQ = useQuery({
    queryKey: ['maint-equipment-all'],
    queryFn: async () => (await api.get<MaintenanceEquipment[]>(E.maintEquipment)).data,
    enabled: executeFor !== null
  });

  const historyQ = useQuery({
    queryKey: ['maint-pm-executions'],
    queryFn: async () => (await api.get<PmExecution[]>(`${E.maintPmExecutions}?limit=50`)).data
  });

  const templates = templatesQ.data ?? [];

  const openExecute = (t: PmTemplate) => {
    setExecuteFor(t);
    setExecEquipmentId('');
    setExecChecks(t.items.map(() => false));
    setExecDuration(String(t.estimatedMinutes));
    setExecNotes('');
    setFormError(null);
  };

  const saveTemplate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const items = itemsText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((label, i) => ({ id: `item-${i + 1}`, label }));
      if (items.length === 0) throw new Error('Add at least one checklist item.');
      const body = {
        equipmentType: String(fd.get('equipmentType') ?? ''),
        name: String(fd.get('name') ?? '').trim(),
        frequencyDays: Number(fd.get('frequencyDays') ?? 0),
        estimatedMinutes: Number(fd.get('estimatedMinutes') ?? 0),
        items
      };
      if (editing) {
        await api.put(E.maintPmTemplate(editing.id), body);
      } else {
        await api.post(E.maintPmTemplates, body);
      }
      setTemplateModal(false);
      qc.invalidateQueries({ queryKey: ['maint-pm-templates'] });
    } catch (err) {
      setFormError(err instanceof Error && err.message.startsWith('Add at least')
        ? err.message
        : isNetworkError(err) ? 'Network error — check your connection.' : 'Could not save template.');
    } finally {
      setSaving(false);
    }
  };

  const runExecution = async () => {
    if (!executeFor) return;
    setSaving(true);
    setFormError(null);
    try {
      if (!execEquipmentId) throw new Error('Select the equipment this PM was performed on.');
      await api.post(E.maintPmExecutions, {
        equipmentId: execEquipmentId,
        templateId: executeFor.id,
        checklist: executeFor.items.map((it, i) => ({ ...it, checked: execChecks[i] ?? false })),
        durationMinutes: execDuration ? Number(execDuration) : null,
        notes: execNotes.trim() || null
      });
      setExecuteFor(null);
      qc.invalidateQueries({ queryKey: ['maint-pm-executions'] });
      qc.invalidateQueries({ queryKey: ['maint-equipment'] });
      qc.invalidateQueries({ queryKey: ['maint-equipment-all'] });
    } catch (err) {
      setFormError(err instanceof Error && err.message.startsWith('Select the')
        ? err.message
        : isNetworkError(err) ? 'Network error — check your connection.' : 'Could not record PM execution.');
    } finally {
      setSaving(false);
    }
  };

  const execEquipmentOptions = (equipmentQ.data ?? []).filter(
    (e) => !executeFor || e.type === executeFor.equipmentType
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Preventive Maintenance Checklists</h1>
          <p className="mt-1 text-sm text-slate-500">
            PM task templates per equipment type — execute them and record completion.
          </p>
        </div>
        {canManage ? (
          <Button
            onClick={() => {
              setEditing(null);
              setItemsText('');
              setFormError(null);
              setTemplateModal(true);
            }}
          >
            <Plus size={16} /> New template
          </Button>
        ) : null}
      </div>

      <div className={cardShell}>
        <CardHeader
          icon={<CheckSquare size={16} />}
          title="PM templates"
          subtitle={`${templates.length} template${templates.length === 1 ? '' : 's'}`}
          action={
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="!w-44">
              <option value="">All equipment types</option>
              {Object.entries(EQUIPMENT_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          }
        />
        {templatesQ.isLoading ? (
          <Spinner />
        ) : templatesQ.isError ? (
          <ErrorBox
            message={isNetworkError(templatesQ.error) ? 'Network error.' : 'Failed to load templates.'}
            onRetry={() => templatesQ.refetch()}
          />
        ) : templates.length === 0 ? (
          <EmptyState title="No PM templates yet" sub="Create a template per equipment type to standardize preventive maintenance." />
        ) : (
          <div className="space-y-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-200/70">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge tone="neutral">{EQUIPMENT_TYPE_LABELS[t.equipmentType] ?? t.equipmentType}</Badge>
                    <span className="truncate font-semibold text-slate-800">{t.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="tabular-nums hidden text-xs text-slate-500 sm:inline">
                      Every {t.frequencyDays}d · ~{t.estimatedMinutes} min · {t.items.length} items
                    </span>
                    {canManage ? (
                      <span className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setEditing(t);
                            setItemsText(t.items.map((i) => i.label).join('\n'));
                            setFormError(null);
                            setTemplateModal(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button onClick={() => openExecute(t)}>
                          <Play size={14} /> Execute
                        </Button>
                      </span>
                    ) : null}
                    <ChevronDown
                      size={16}
                      className={`text-slate-400 transition-transform ${expanded === t.id ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>
                {expanded === t.id ? (
                  <ol className="space-y-1.5 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
                    {t.items.map((it, i) => (
                      <li key={it.id} className="flex gap-2">
                        <span className="tabular-nums font-semibold text-violet-600">{i + 1}.</span>
                        <span>{it.label}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={cardShell}>
        <CardHeader
          icon={<CheckSquare size={16} />}
          title="Recent PM executions"
          subtitle="Last 50 completed preventive-maintenance runs."
        />
        {historyQ.isLoading ? (
          <Spinner />
        ) : historyQ.isError ? (
          <ErrorBox
            message={isNetworkError(historyQ.error) ? 'Network error.' : 'Failed to load execution history.'}
            onRetry={() => historyQ.refetch()}
          />
        ) : (
          <DataTable<PmExecution>
            columns={[
              { key: 'executedAt', label: 'Executed', render: (r) => <span className="tabular-nums text-sm">{fmtDateTime(r.executedAt)}</span> },
              { key: 'equipment', label: 'Equipment', render: (r) => <span className="font-medium">{r.equipment?.name ?? '—'}</span> },
              {
                key: 'checklist',
                label: 'Checklist',
                render: (r) => {
                  const done = r.checklist.filter((c) => c.checked).length;
                  return (
                    <span className="tabular-nums text-sm">
                      {done}/{r.checklist.length} items
                    </span>
                  );
                }
              },
              {
                key: 'durationMinutes',
                label: 'Duration',
                render: (r) => <span className="tabular-nums text-sm">{r.durationMinutes != null ? `${r.durationMinutes} min` : '—'}</span>
              },
              { key: 'notes', label: 'Notes', render: (r) => <span className="max-w-xs truncate text-sm text-slate-500">{r.notes ?? '—'}</span> }
            ]}
            rows={historyQ.data ?? []}
            emptyTitle="No PM executions recorded yet."
          />
        )}
      </div>

      {/* Template modal */}
      {templateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTemplateModal(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={editing ? 'Edit PM template' : 'New PM template'}
          >
            <h3 className="mb-4 text-base font-bold text-slate-900">
              {editing ? 'Edit PM template' : 'New PM template'}
            </h3>
            {formError ? (
              <div className="mb-4 rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
            ) : null}
            <form onSubmit={saveTemplate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Equipment type" required>
                  <Select name="equipmentType" defaultValue={editing?.equipmentType ?? 'ROLLER_MILL'}>
                    {Object.entries(EQUIPMENT_TYPE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Template name" required>
                  <TextInput name="name" defaultValue={editing?.name ?? ''} required maxLength={200} placeholder="e.g. Weekly roller check" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Frequency (days)" required>
                  <TextInput type="number" name="frequencyDays" min={1} max={3650} defaultValue={editing?.frequencyDays ?? 7} required className="tabular-nums" />
                </Field>
                <Field label="Estimated duration (min)" required>
                  <TextInput type="number" name="estimatedMinutes" min={1} max={10080} defaultValue={editing?.estimatedMinutes ?? 60} required className="tabular-nums" />
                </Field>
              </div>
              <Field label="Checklist items — one per line" required>
                <TextArea
                  rows={7}
                  value={itemsText}
                  onChange={(e) => setItemsText(e.target.value)}
                  placeholder={'Check roll gap\nInspect belts for wear\nLubricate bearings'}
                />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setTemplateModal(false)}>Cancel</Button>
                <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Create template'}</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Execute modal */}
      {executeFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setExecuteFor(null)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`Execute ${executeFor.name}`}
          >
            <h3 className="mb-1 text-base font-bold text-slate-900">Execute: {executeFor.name}</h3>
            <p className="mb-4 text-xs text-slate-500">
              Recording completion rolls the equipment's next due date forward by its PM interval.
            </p>
            {formError ? (
              <div className="mb-4 rounded-lg bg-critical-bg px-4 py-3 text-sm text-critical-text">{formError}</div>
            ) : null}
            <div className="space-y-4">
              <Field label="Equipment" required>
                {equipmentQ.isLoading ? (
                  <Spinner />
                ) : (
                  <Select value={execEquipmentId} onChange={(e) => setExecEquipmentId(e.target.value)}>
                    <option value="">Select equipment…</option>
                    {execEquipmentOptions.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}{e.location ? ` — ${e.location}` : ''}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Checklist">
                <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200/70 p-3">
                  {executeFor.items.map((it, i) => (
                    <label key={it.id} className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={execChecks[i] ?? false}
                        onChange={(e) => {
                          const next = [...execChecks];
                          next[i] = e.target.checked;
                          setExecChecks(next);
                        }}
                        className="mt-0.5 h-4 w-4 accent-violet-600"
                      />
                      <span className={execChecks[i] ? 'text-slate-400 line-through' : ''}>{it.label}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Actual duration (min)">
                  <TextInput type="number" min={1} value={execDuration} onChange={(e) => setExecDuration(e.target.value)} className="tabular-nums" />
                </Field>
                <Field label="Notes">
                  <TextInput value={execNotes} onChange={(e) => setExecNotes(e.target.value)} maxLength={2000} />
                </Field>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setExecuteFor(null)}>Cancel</Button>
                <Button onClick={runExecution} loading={saving}>
                  <Play size={14} /> Record completion
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
