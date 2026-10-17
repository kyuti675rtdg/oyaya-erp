import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FlaskConical, Plus, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { FlourGrade, GradeQualityResult, Product } from '../types';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Field, NumberInput, Select, TextArea, TextInput } from '../components/ui';
import { fmtDate } from '../lib/format';
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

interface GradeForm {
  productId: string;
  gradeCode: string;
  name: string;
  moistureMax: string;
  wetGlutenMin: string;
  wetGlutenMax: string;
  ashMax: string;
  shelfLifeDays: string;
  notes: string;
  isActive: boolean;
}

const EMPTY_FORM: GradeForm = {
  productId: '',
  gradeCode: '',
  name: '',
  moistureMax: '14.0',
  wetGlutenMin: '30.0',
  wetGlutenMax: '33.0',
  ashMax: '0.7',
  shelfLifeDays: '180',
  notes: '',
  isActive: true
};

function specText(g: FlourGrade): string {
  return `moisture ≤${g.moistureMax}% · gluten ${g.wetGlutenMin}–${g.wetGlutenMax}% · ash ≤${g.ashMax}%`;
}

export function FlourGrades() {
  const { canManage } = useFgPerms();
  const hasClaim = useAuth((s) => s.hasClaim);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formState, setFormState] = useState<{ mode: 'create' | 'edit'; grade: FlourGrade | null } | null>(null);
  const [form, setForm] = useState<GradeForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const gradesQ = useQuery({
    queryKey: ['fg-grades'],
    queryFn: async () => (await api.get<FlourGrade[]>(E.fgGrades)).data,
    enabled: hasClaim('fg:view')
  });
  const productsQ = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get<Product[]>(E.products)).data,
    enabled: hasClaim('fg:view') && !!formState
  });
  const qualityQ = useQuery({
    queryKey: ['fg-grade-quality', selectedId],
    queryFn: async () =>
      (await api.get<{ results: GradeQualityResult[] }>(E.fgGradeQuality(selectedId!))).data,
    enabled: hasClaim('fg:view') && !!selectedId
  });

  const grades = gradesQ.data ?? [];
  const products = useMemo(() => productsQ.data ?? [], [productsQ.data]);

  const stats = useMemo(() => {
    const active = grades.filter((g) => g.isActive).length;
    const covered = new Set(grades.filter((g) => g.isActive).map((g) => g.productId)).size;
    return { total: grades.length, active, inactive: grades.length - active, covered };
  }, [grades]);

  const quality = qualityQ.data?.results ?? [];
  const passCount = quality.filter((r) => r.pass).length;

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormState({ mode: 'create', grade: null });
  };

  const openEdit = (g: FlourGrade) => {
    setForm({
      productId: g.productId,
      gradeCode: g.gradeCode,
      name: g.name,
      moistureMax: String(g.moistureMax),
      wetGlutenMin: String(g.wetGlutenMin),
      wetGlutenMax: String(g.wetGlutenMax),
      ashMax: String(g.ashMax),
      shelfLifeDays: String(g.shelfLifeDays),
      notes: g.notes ?? '',
      isActive: g.isActive
    });
    setFormError(null);
    setFormState({ mode: 'edit', grade: g });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        ...(formState!.mode === 'create'
          ? {
              productId: form.productId,
              gradeCode: form.gradeCode.trim(),
              name: form.name.trim()
            }
          : { name: form.name.trim() }),
        moistureMax: Number(form.moistureMax),
        wetGlutenMin: Number(form.wetGlutenMin),
        wetGlutenMax: Number(form.wetGlutenMax),
        ashMax: Number(form.ashMax),
        shelfLifeDays: Number(form.shelfLifeDays),
        notes: form.notes.trim() || null,
        ...(formState!.mode === 'edit' ? { isActive: form.isActive } : {})
      };
      if (formState!.mode === 'create') return (await api.post(E.fgGrades, payload)).data;
      return (await api.patch(E.fgGrade(formState!.grade!.id), payload)).data;
    },
    onSuccess: () => {
      setFormState(null);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['fg-grades'] });
    },
    onError: (e: unknown) =>
      setFormError(e instanceof Error ? e.message : 'Failed to save grade')
  });

  const toggleMut = useMutation({
    mutationFn: async (g: FlourGrade) =>
      (await api.patch(E.fgGrade(g.id), { isActive: !g.isActive })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fg-grades'] })
  });

  if (!hasClaim('fg:view')) {
    return (
      <div className="space-y-4">
        <FgPageHeader title="Flour Grade Management" subtitle="Grade definitions and quality specs" />
        <FgError message="You do not have permission to view flour grades (fg:view)." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FgPageHeader
        title="Flour Grade Management"
        subtitle="Grade definitions per product — moisture ≤14.0%, wet gluten 30–33%, ash ≤0.7%"
        actions={
          canManage ? (
            <button className={violetBtn} onClick={openCreate}>
              <Plus size={15} /> New grade
            </button>
          ) : null
        }
      />

      {gradesQ.isLoading ? (
        <FgKpiSkeleton />
      ) : gradesQ.isError ? (
        <FgError message="Failed to load grades" onRetry={() => gradesQ.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <FgKpi label="Grades" value={String(stats.total)} sub={`${stats.active} active`} icon={<ShieldCheck size={16} />} tone="violet" />
          <FgKpi label="Active" value={String(stats.active)} sub={`${stats.inactive} inactive`} icon={<CheckCircle2 size={16} />} tone="emerald" />
          <FgKpi label="Products covered" value={String(stats.covered)} sub="with an active grade" icon={<FlaskConical size={16} />} tone="slate" />
          <FgKpi
            label="Recent checks passing"
            value={quality.length === 0 ? '—' : `${passCount}/${quality.length}`}
            sub={selectedId ? 'selected grade, last 20 checks' : 'select a grade to inspect'}
            icon={<FlaskConical size={16} />}
            tone={quality.length === 0 ? 'slate' : passCount === quality.length ? 'emerald' : 'amber'}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        {/* Grade list */}
        <div className={`${cardShell} xl:col-span-3`}>
          <CardHeader icon={<ShieldCheck size={16} />} title="Grades" subtitle="Click a grade to see linked quality test results" />
          {gradesQ.isLoading ? (
            <FgSkeleton rows={5} />
          ) : gradesQ.isError ? (
            <FgError message="Failed to load grades" onRetry={() => gradesQ.refetch()} />
          ) : grades.length === 0 ? (
            <FgEmpty title="No grades defined" sub="Create the first flour grade to start spec-based quality checks." />
          ) : (
            <DataTable<FlourGrade>
              columns={[
                {
                  key: 'gradeCode',
                  label: 'Code',
                  mono: true,
                  render: (g) => <span className="font-bold text-violet-700">{g.gradeCode}</span>
                },
                { key: 'name', label: 'Grade', render: (g) => <div><p className="font-semibold">{g.name}</p><p className="text-xs text-slate-500">{g.product?.name ?? g.productId}</p></div> },
                { key: 'spec', label: 'Spec', render: (g) => <span className="tnum text-xs text-slate-600">{specText(g)}</span> },
                { key: 'shelfLifeDays', label: 'Shelf life', mono: true, render: (g) => `${g.shelfLifeDays}d` },
                {
                  key: 'isActive',
                  label: 'Status',
                  render: (g) => (g.isActive ? <FgBadge tone="emerald">Active</FgBadge> : <FgBadge tone="slate">Inactive</FgBadge>)
                },
                {
                  key: 'actions',
                  label: '',
                  render: (g) => (
                    <div className="flex gap-2">
                      <button className={secondaryBtn + ' !px-3 !py-1 !text-xs'} onClick={() => setSelectedId(g.id)}>
                        Quality
                      </button>
                      {canManage ? (
                        <>
                          <button className={secondaryBtn + ' !px-3 !py-1 !text-xs'} onClick={() => openEdit(g)}>
                            Edit
                          </button>
                          <button
                            className={secondaryBtn + ' !px-3 !py-1 !text-xs'}
                            disabled={toggleMut.isPending}
                            onClick={() => toggleMut.mutate(g)}
                          >
                            {g.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </>
                      ) : null}
                    </div>
                  )
                }
              ]}
              rows={grades}
            />
          )}
        </div>

        {/* Linked quality */}
        <div className={`${cardShell} xl:col-span-2`}>
          <CardHeader
            icon={<FlaskConical size={16} />}
            title="Linked quality results"
            subtitle={
              selectedId
                ? `${grades.find((g) => g.id === selectedId)?.name ?? ''} — last 20 lab checks vs spec`
                : 'Select a grade to evaluate recent lab checks'
            }
          />
          {!selectedId ? (
            <FgEmpty title="No grade selected" sub="Pick a grade from the list to see how recent QC lab checks score against its spec." />
          ) : qualityQ.isLoading ? (
            <FgSkeleton rows={5} />
          ) : qualityQ.isError ? (
            <FgError message="Failed to load quality results" onRetry={() => qualityQ.refetch()} />
          ) : quality.length === 0 ? (
            <FgEmpty title="No lab checks found" sub="No QC checks recorded for batches packed into this product yet." />
          ) : (
            <div className="space-y-3">
              {quality.map((r) => (
                <div key={r.id} className={`rounded-xl border p-3.5 ${r.pass ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="tnum text-sm font-bold text-slate-800">
                      {r.batchNo} <span className="font-normal text-slate-500">· {fmtDate(r.sampleTime)}</span>
                    </p>
                    {r.pass ? (
                      <span className="flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} /> PASS</span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-bold text-rose-700"><XCircle size={14} /> FAIL</span>
                    )}
                  </div>
                  <div className="tnum mt-2 grid grid-cols-3 gap-2 text-xs">
                    {r.params.map((p) => (
                      <div key={p.param} className={`rounded-lg px-2 py-1.5 ${p.pass ? 'bg-white/70' : 'bg-white font-bold text-rose-700'}`}>
                        <p className="font-semibold text-slate-500">{p.label}</p>
                        <p>
                          {p.value === null ? '—' : `${p.value.toFixed(1)}${p.unit}`}
                          <span className="text-slate-400">
                            {' '}({p.min !== null ? `≥${p.min}` : ''}{p.min !== null && p.max !== null ? ' ' : ''}{p.max !== null ? `≤${p.max}` : ''})
                          </span>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create / edit modal */}
      {formState && (
        <FgModal
          title={formState.mode === 'create' ? 'New flour grade' : `Edit grade ${formState.grade?.gradeCode}`}
          subtitle="Spec defaults follow mill standards: moisture ≤14.0%, wet gluten 30–33%, ash ≤0.7%"
          onClose={() => {
            setFormState(null);
            setFormError(null);
          }}
          wide
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (formState.mode === 'create' && (!form.productId || !form.gradeCode.trim() || !form.name.trim())) {
                setFormError('Product, grade code and name are required.');
                return;
              }
              saveMut.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {formState.mode === 'create' ? (
                <>
                  <Field label="Product" required>
                    <Select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} required>
                      <option value="" disabled>Select product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Grade code" required hint="Unique per product, e.g. DUKET-N">
                    <TextInput value={form.gradeCode} onChange={(e) => setForm({ ...form, gradeCode: e.target.value.toUpperCase() })} required placeholder="DUKET-N" />
                  </Field>
                </>
              ) : (
                <div className="sm:col-span-2">
                  <Field label="Active">
                    <Select value={form.isActive ? '1' : '0'} onChange={(e) => setForm({ ...form, isActive: e.target.value === '1' })}>
                      <option value="1">Active</option>
                      <option value="0">Inactive</option>
                    </Select>
                  </Field>
                </div>
              )}
              <Field label="Grade name" required>
                <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Duket Normal Grade" />
              </Field>
              <Field label="Shelf life (days)">
                <NumberInput value={form.shelfLifeDays} onChange={(e) => setForm({ ...form, shelfLifeDays: e.target.value })} min={1} step={1} />
              </Field>
              <Field label="Moisture max (%)">
                <NumberInput value={form.moistureMax} onChange={(e) => setForm({ ...form, moistureMax: e.target.value })} step={0.1} min={0} />
              </Field>
              <Field label="Wet gluten min (%)">
                <NumberInput value={form.wetGlutenMin} onChange={(e) => setForm({ ...form, wetGlutenMin: e.target.value })} step={0.1} min={0} />
              </Field>
              <Field label="Wet gluten max (%)">
                <NumberInput value={form.wetGlutenMax} onChange={(e) => setForm({ ...form, wetGlutenMax: e.target.value })} step={0.1} min={0} />
              </Field>
              <Field label="Ash max (%)">
                <NumberInput value={form.ashMax} onChange={(e) => setForm({ ...form, ashMax: e.target.value })} step={0.1} min={0} />
              </Field>
            </div>
            <Field label="Notes">
              <TextArea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Grade notes…" />
            </Field>
            {formError ? <p className="text-sm font-semibold text-rose-700">{formError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryBtn} onClick={() => setFormState(null)}>Cancel</button>
              <button type="submit" className={violetBtn} disabled={saveMut.isPending}>
                {saveMut.isPending ? 'Saving…' : formState.mode === 'create' ? 'Create grade' : 'Save changes'}
              </button>
            </div>
          </form>
        </FgModal>
      )}
    </div>
  );
}
