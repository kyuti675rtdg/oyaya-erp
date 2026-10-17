import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, FilePlus2, LayoutTemplate, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { DocTemplate } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { DOC_CATEGORIES, cardShell } from './DocShared';

interface TemplateForm {
  name: string;
  category: string;
  description: string;
  content: string;
}

const EMPTY: TemplateForm = { name: '', category: 'General', description: '', content: '' };

export function DocTemplates() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('documents:manage');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TemplateForm>(EMPTY);
  const [useTpl, setUseTpl] = useState<DocTemplate | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const templatesQ = useQuery({
    queryKey: ['doc-templates'],
    queryFn: async () => (await api.get<DocTemplate[]>(E.docTemplateList)).data,
  });

  const filtered = (templatesQ.data ?? []).filter((t) => !categoryFilter || t.category === categoryFilter);

  const createMut = useMutation({
    mutationFn: async () => (await api.post(E.docTemplates, { ...form, description: form.description || null })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doc-templates'] });
      setShowForm(false);
      setForm(EMPTY);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => (await api.delete(E.docTemplate(id))).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-templates'] }),
  });

  const useMut = useMutation({
    mutationFn: async () => (await api.post(E.docTemplateUse(useTpl!.id), { title: newTitle })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      setUseTpl(null);
      setNewTitle('');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    createMut.mutate();
  };

  const submitUse = (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !useTpl) return;
    useMut.mutate();
  };

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<LayoutTemplate size={16} />}
          title="Document Templates"
          subtitle="Reusable templates for SOPs, reports, letters"
          action={
            <>
              <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="!w-40">
                <option value="">All categories</option>
                {DOC_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              {canManage ? (
                <Button onClick={() => setShowForm(true)}>
                  <FilePlus2 size={14} /> New Template
                </Button>
              ) : null}
            </>
          }
        />
        {templatesQ.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner label="Loading templates…" />
          </div>
        ) : templatesQ.isError ? (
          <ErrorBox message="Failed to load templates." onRetry={() => templatesQ.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No templates yet" sub="Create reusable document templates." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => (
              <div key={t.id} className={`${cardShell} flex flex-col gap-3 !p-4`}>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                  <LayoutTemplate size={18} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{t.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t.category} · {fmtDate(t.updatedAt)}
                  </p>
                  {t.description ? <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{t.description}</p> : null}
                </div>
                <div className="mt-auto flex items-center gap-2 border-t border-slate-100 dark:border-slate-700 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setUseTpl(t);
                      setNewTitle('');
                    }}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                  >
                    <Copy size={14} /> Use Template
                  </button>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => deleteMut.mutate(t.id)}
                      title="Delete"
                      className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog" aria-modal="true">
          <form onSubmit={submit} className={`${cardShell} max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto !p-6`}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">New Template</h3>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Template name">
                <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Milling SOP Template" required />
              </Field>
              <Field label="Category">
                <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {DOC_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Description">
              <TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is this template for?" />
            </Field>
            <Field label="Content (markdown)">
              <TextArea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={10} placeholder="# Title&#10;&#10;## Section 1&#10;..." />
            </Field>
            {createMut.isError ? <ErrorBox message="Save failed." onRetry={() => createMut.reset()} /> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createMut.isPending}>
                <Check size={14} /> Save Template
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {useTpl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog" aria-modal="true">
          <form onSubmit={submitUse} className={`${cardShell} w-full max-w-md space-y-4 !p-6`}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Create from Template</h3>
              <button type="button" onClick={() => setUseTpl(null)} className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Template: <span className="font-semibold">{useTpl.name}</span>
            </p>
            <Field label="New document title">
              <TextInput value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Milling SOP — Shift A" required />
            </Field>
            {useMut.isError ? <ErrorBox message="Failed to create document." onRetry={() => useMut.reset()} /> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setUseTpl(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={useMut.isPending}>
                <Check size={14} /> Create Document
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
