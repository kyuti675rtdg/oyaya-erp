import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  FlaskConical,
  History,
  Pencil,
  RotateCcw,
  Ruler,
  Sprout,
  Truck,
  Wheat,
  X
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { QcAuditEntry, QcThreshold, QcThresholdRow } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, NumberInput, Select, Spinner, TextInput } from '../components/ui';
import { fmtDateTime } from '../lib/format';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-sm p-5';

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode; blurb: string }> = {
  intake: {
    label: 'Incoming wheat (intake)',
    icon: <Truck size={16} />,
    blurb: 'Wheat acceptance at the gate — gluten ≥ 20%, moisture ≤ 13.5%, impurity ≤ 6%, hectoliter ≥ 74, germination ≤ 1%.'
  },
  inprocess: {
    label: 'In-process (2-hour shift checks)',
    icon: <Wheat size={16} />,
    blurb: 'Mill-floor checks every 2 hours — conditioning moistures, flour moisture, gluten, ash, color, granulation.'
  },
  flour: {
    label: 'Finished flour (per batch / product)',
    icon: <FlaskConical size={16} />,
    blurb: 'Final acceptance per batch and product — Duket, Furishka, Fino, Fernacho.'
  }
};

function rangeText(t: QcThreshold): string {
  const min = t.minValue === null || t.minValue === undefined ? null : Number(t.minValue);
  const max = t.maxValue === null || t.maxValue === undefined ? null : Number(t.maxValue);
  const unit = t.unit ? ` ${t.unit}` : '';
  if (min !== null && max !== null) return `${min} – ${max}${unit}`;
  if (min !== null) return `≥ ${min}${unit}`;
  if (max !== null) return `≤ ${max}${unit}`;
  return '—';
}

interface EditState {
  minValue: string;
  maxValue: string;
  unit: string;
  isActive: boolean;
}

function toEdit(t: QcThresholdRow): EditState {
  return {
    minValue: t.minValue === null || t.minValue === undefined ? '' : String(Number(t.minValue)),
    maxValue: t.maxValue === null || t.maxValue === undefined ? '' : String(Number(t.maxValue)),
    unit: t.unit ?? '',
    isActive: t.isActive
  };
}

export function QualityStandards() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({ minValue: '', maxValue: '', unit: '', isActive: true });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);

  const thresholdsQ = useQuery({
    queryKey: ['qc-thresholds'],
    queryFn: async () => (await api.get<QcThresholdRow[]>(E.qcThresholds)).data
  });

  const auditQ = useQuery({
    queryKey: ['qc-threshold-audit', auditId],
    queryFn: async () => (await api.get<QcAuditEntry[]>(E.qcThresholdAudit(auditId as string))).data,
    enabled: auditId !== null
  });

  const grouped = useMemo(() => {
    const rows = thresholdsQ.data ?? [];
    const map: Record<string, QcThresholdRow[]> = {};
    for (const r of rows) {
      (map[r.category] ??= []).push(r);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => a.param.localeCompare(b.param));
    return map;
  }, [thresholdsQ.data]);

  const categories = useMemo(
    () => Object.keys(CATEGORY_META).filter((c) => grouped[c] && grouped[c].length > 0),
    [grouped]
  );

  const seed = async () => {
    setSeeding(true);
    setNotice(null);
    try {
      const r = await api.post<{ ok: boolean; created: number; updated: number }>(E.qcThresholdsSeed);
      setNotice({
        ok: true,
        text: `Standard thresholds seeded — ${r.data.created} created, ${r.data.updated} refreshed.`
      });
      qc.invalidateQueries({ queryKey: ['qc-thresholds'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Seeding failed.' });
    } finally {
      setSeeding(false);
    }
  };

  const startEdit = (t: QcThresholdRow) => {
    setEditingId(t.id);
    setEdit(toEdit(t));
    setNotice(null);
  };

  const saveEdit = async (e: FormEvent, t: QcThresholdRow) => {
    e.preventDefault();
    setSavingId(t.id);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        minValue: edit.minValue === '' ? null : Number(edit.minValue),
        maxValue: edit.maxValue === '' ? null : Number(edit.maxValue),
        unit: edit.unit === '' ? null : edit.unit,
        isActive: edit.isActive
      };
      await api.put(`${E.qcThresholds}/${t.id}`, payload);
      setEditingId(null);
      setNotice({ ok: true, text: `Threshold “${t.code}” updated — change recorded in the audit trail.` });
      qc.invalidateQueries({ queryKey: ['qc-thresholds'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Update failed.' });
    } finally {
      setSavingId(null);
    }
  };

  const auditTarget = (thresholdsQ.data ?? []).find((t) => t.id === auditId) ?? null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Quality Standards &amp; Thresholds</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Configurable lab thresholds with a full audit trail. Intake, in-process and flour
            standards are kept separate.
          </p>
        </div>
        <Button onClick={seed} loading={seeding} variant="secondary">
          <RotateCcw size={16} /> Seed standard thresholds
        </Button>
      </div>

      {notice ? (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
            notice.ok
              ? 'border-pass-text/30 bg-pass-bg text-pass-text'
              : 'border-critical-text/30 bg-critical-bg text-critical-text'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      {thresholdsQ.isLoading ? (
        <Spinner label="Loading thresholds..." />
      ) : thresholdsQ.isError ? (
        <ErrorBox
          message="Could not load quality thresholds."
          onRetry={() => thresholdsQ.refetch()}
        />
      ) : categories.length === 0 ? (
        <div className={cardShell}>
          <EmptyState
            title="No thresholds configured"
            sub="Seed the domain-standard thresholds to get started — intake, in-process and flour standards."
          />
          <div className="mt-4 flex justify-center">
            <Button onClick={seed} loading={seeding}>
              <RotateCcw size={16} /> Seed standard thresholds
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {categories.map((cat) => {
            const meta = CATEGORY_META[cat];
            const rows = grouped[cat];
            return (
              <section key={cat} className={cardShell}>
                <CardHeader
                  icon={meta.icon}
                  title={meta.label}
                  subtitle={meta.blurb}
                  action={<Badge tone="neutral">{rows.length} parameters</Badge>}
                />
                {/* Desktop table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr>
                        <th className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Parameter</th>
                        <th className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Standard</th>
                        <th className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</th>
                        <th className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <ThresholdRowDesktop
                          key={t.id}
                          t={t}
                          editing={editingId === t.id}
                          edit={edit}
                          setEdit={setEdit}
                          saving={savingId === t.id}
                          onEdit={() => startEdit(t)}
                          onCancel={() => setEditingId(null)}
                          onSave={(e) => saveEdit(e, t)}
                          onAudit={() => setAuditId(t.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile stacked cards */}
                <div className="space-y-3 md:hidden">
                  {rows.map((t) => (
                    <ThresholdRowMobile
                      key={t.id}
                      t={t}
                      editing={editingId === t.id}
                      edit={edit}
                      setEdit={setEdit}
                      saving={savingId === t.id}
                      onEdit={() => startEdit(t)}
                      onCancel={() => setEditingId(null)}
                      onSave={(e) => saveEdit(e, t)}
                      onAudit={() => setAuditId(t.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Audit trail panel */}
      {auditId ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-800 p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold text-ink">
                <History size={16} /> Audit trail
              </h3>
              <button
                onClick={() => setAuditId(null)}
                className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mb-4 font-mono text-xs text-slate-500 dark:text-slate-400">{auditTarget?.code}</p>
            {auditQ.isLoading ? (
              <Spinner label="Loading audit trail..." />
            ) : (auditQ.data ?? []).length === 0 ? (
              <EmptyState title="No audit entries" sub="Changes to this threshold will appear here." />
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto">
                {(auditQ.data ?? []).map((a) => (
                  <li key={a.id} className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/60 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={a.action === 'CREATE' ? 'pass' : 'advisory'}>{a.action}</Badge>
                      <span className="tabular-nums text-xs text-slate-500 dark:text-slate-400">{fmtDateTime(a.createdAt)}</span>
                    </div>
                    {a.changes ? (
                      <pre className="mt-2 max-h-24 overflow-auto rounded bg-white dark:bg-slate-800 p-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {JSON.stringify(a.changes, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {/* Cross-links to the lab workspaces that consume these standards */}
      <div className={`mt-5 ${cardShell}`}>
        <CardHeader
          icon={<Ruler size={16} />}
          title="Where these standards apply"
          subtitle="Each workspace reads its own category — intake vs in-process vs flour are never mixed."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link
            to="/incoming-inspection"
            className="flex items-center justify-between rounded-xl border border-slate-200/70 p-4 hover:border-violet-300 hover:bg-violet-50/50"
          >
            <span>
              <span className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                <Sprout size={15} className="text-violet-600" /> Incoming inspection
              </span>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Intake wheat lab tests per truck</span>
            </span>
            <ArrowRight size={16} className="text-slate-400 dark:text-slate-500" />
          </Link>
          <Link
            to="/qc"
            className="flex items-center justify-between rounded-xl border border-slate-200/70 p-4 hover:border-violet-300 hover:bg-violet-50/50"
          >
            <span>
              <span className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                <Wheat size={15} className="text-violet-600" /> In-process lab checks
              </span>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">2-hour shift checks on the mill floor</span>
            </span>
            <ArrowRight size={16} className="text-slate-400 dark:text-slate-500" />
          </Link>
          <Link
            to="/quality/flour-tests"
            className="flex items-center justify-between rounded-xl border border-slate-200/70 p-4 hover:border-violet-300 hover:bg-violet-50/50"
          >
            <span>
              <span className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                <FlaskConical size={15} className="text-violet-600" /> Flour quality tests
              </span>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Finished flour per batch per product</span>
            </span>
            <ArrowRight size={16} className="text-slate-400 dark:text-slate-500" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function EditForm({
  t,
  edit,
  setEdit,
  saving,
  onCancel,
  onSave
}: {
  t: QcThresholdRow;
  edit: EditState;
  setEdit: (e: EditState) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: (e: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSave} className="flex flex-wrap items-end gap-2">
      <div className="w-24">
        <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Min</label>
        <NumberInput
          value={edit.minValue}
          onChange={(e) => setEdit({ ...edit, minValue: e.target.value })}
          step="0.001"
          placeholder="—"
        />
      </div>
      <div className="w-24">
        <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Max</label>
        <NumberInput
          value={edit.maxValue}
          onChange={(e) => setEdit({ ...edit, maxValue: e.target.value })}
          step="0.001"
          placeholder="—"
        />
      </div>
      <div className="w-24">
        <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Unit</label>
        <TextInput
          value={edit.unit}
          onChange={(e) => setEdit({ ...edit, unit: e.target.value })}
          placeholder="%"
          maxLength={20}
        />
      </div>
      <div className="w-28">
        <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Status</label>
        <Select
          value={edit.isActive ? 'on' : 'off'}
          onChange={(e) => setEdit({ ...edit, isActive: e.target.value === 'on' })}
        >
          <option value="on">Active</option>
          <option value="off">Inactive</option>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={saving} className="px-4 py-2 text-sm">
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="px-4 py-2 text-sm">
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ThresholdRowDesktop(props: {
  t: QcThresholdRow;
  editing: boolean;
  edit: EditState;
  setEdit: (e: EditState) => void;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (e: FormEvent) => void;
  onAudit: () => void;
}) {
  const { t, editing } = props;
  return (
    <tr className="border-t border-slate-100 dark:border-slate-700 align-top hover:bg-slate-50/60">
      <td className="px-3 py-3">
        <p className="font-semibold text-slate-800 dark:text-slate-100">{t.param}</p>
        <p className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{t.code}</p>
      </td>
      <td className="px-3 py-3">
        {editing ? (
          <EditForm
            t={t}
            edit={props.edit}
            setEdit={props.setEdit}
            saving={props.saving}
            onCancel={props.onCancel}
            onSave={props.onSave}
          />
        ) : (
          <span className="tabular-nums font-semibold text-ink">{rangeText(t)}</span>
        )}
      </td>
      <td className="px-3 py-3">
        <Badge tone={t.isActive ? 'pass' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
      </td>
      <td className="px-3 py-3">
        <div className="flex justify-end gap-1">
          {!editing ? (
            <button
              onClick={props.onEdit}
              className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-violet-50 hover:text-violet-700"
              title="Edit threshold"
            >
              <Pencil size={15} />
            </button>
          ) : null}
          <button
            onClick={props.onAudit}
            className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-violet-50 hover:text-violet-700"
            title="Audit trail"
          >
            <History size={15} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function ThresholdRowMobile(props: {
  t: QcThresholdRow;
  editing: boolean;
  edit: EditState;
  setEdit: (e: EditState) => void;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (e: FormEvent) => void;
  onAudit: () => void;
}) {
  const { t, editing } = props;
  return (
    <div className="rounded-xl border border-slate-200/70 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{t.param}</p>
          <p className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{t.code}</p>
        </div>
        <Badge tone={t.isActive ? 'pass' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
      </div>
      {editing ? (
        <div className="mt-3">
          <EditForm
            t={t}
            edit={props.edit}
            setEdit={props.setEdit}
            saving={props.saving}
            onCancel={props.onCancel}
            onSave={props.onSave}
          />
        </div>
      ) : (
        <>
          <p className="mt-2 tabular-nums text-lg font-bold text-ink">{rangeText(t)}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={props.onEdit} className="flex-1 px-3 py-2 text-sm">
              <Pencil size={14} /> Edit
            </Button>
            <Button variant="secondary" onClick={props.onAudit} className="flex-1 px-3 py-2 text-sm">
              <History size={14} /> History
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
