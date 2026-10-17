import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FolderOpen, FolderPlus, Pencil, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { DocFolder } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextInput } from '../components/ui';
import { DOC_MODULES, cardShell } from './DocShared';

interface FolderForm {
  name: string;
  parentId: string;
  module: string;
}

const EMPTY: FolderForm = { name: '', parentId: '', module: '' };

export function DocFolders() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('documents:manage');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DocFolder | null>(null);
  const [form, setForm] = useState<FolderForm>(EMPTY);
  const [moduleFilter, setModuleFilter] = useState('');

  const foldersQ = useQuery({
    queryKey: ['doc-folders', moduleFilter],
    queryFn: async () =>
      (await api.get<DocFolder[]>(E.docFolders + (moduleFilter ? `?module=${encodeURIComponent(moduleFilter)}` : ''))).data,
  });

  const tree = useMemo(() => {
    const list = foldersQ.data ?? [];
    const byParent = new Map<string | null, DocFolder[]>();
    list.forEach((f) => {
      const key = f.parentId ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(f);
    });
    const out: { folder: DocFolder; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      (byParent.get(parentId) ?? []).forEach((f) => {
        out.push({ folder: f, depth });
        walk(f.id, depth + 1);
      });
    };
    walk(null, 0);
    return out;
  }, [foldersQ.data]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setShowForm(true);
  };

  const openEdit = (f: DocFolder) => {
    setEditing(f);
    setForm({ name: f.name, parentId: f.parentId ?? '', module: f.module ?? '' });
    setShowForm(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name, parentId: form.parentId || null, module: form.module || null };
      return editing
        ? (await api.patch(E.docFolder(editing.id), payload)).data
        : (await api.post(E.docFolders, payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doc-folders'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => (await api.delete(E.docFolder(id))).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doc-folders'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    saveMut.mutate();
  };

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<FolderOpen size={16} />}
          title="Folders & Categories"
          subtitle="Organize documents by module and topic"
          action={
            <>
              <Select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="!w-40">
                <option value="">All modules</option>
                {DOC_MODULES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
              {canManage ? (
                <Button onClick={openCreate}>
                  <FolderPlus size={14} /> New Folder
                </Button>
              ) : null}
            </>
          }
        />
        {foldersQ.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner label="Loading folders…" />
          </div>
        ) : foldersQ.isError ? (
          <ErrorBox message="Failed to load folders." onRetry={() => foldersQ.refetch()} />
        ) : tree.length === 0 ? (
          <EmptyState title="No folders yet" sub="Create folders to organize the document library." />
        ) : (
          <div className="divide-y divide-slate-50">
            {tree.map(({ folder, depth }) => (
              <div
                key={folder.id}
                className="flex items-center gap-3 py-2.5"
                style={{ paddingLeft: depth * 28 }}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                  <FolderOpen size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{folder.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {folder.module ?? 'General'} · {folder._count?.documents ?? 0} docs · {fmtDate(folder.createdAt)}
                  </p>
                </div>
                {(folder._count?.documents ?? 0) > 0 ? (
                  <Badge tone="neutral">{folder._count!.documents} files</Badge>
                ) : null}
                {canManage ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(folder)}
                      title="Rename"
                      className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMut.mutate(folder.id)}
                      title="Delete"
                      className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog" aria-modal="true">
          <form onSubmit={submit} className={`${cardShell} w-full max-w-md space-y-4 !p-6`}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{editing ? 'Rename Folder' : 'New Folder'}</h3>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <Field label="Folder name">
              <TextInput
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Procurement Contracts"
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Parent folder">
                <Select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
                  <option value="">Top level</option>
                  {(foldersQ.data ?? [])
                    .filter((f) => f.id !== editing?.id)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Module">
                <Select value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })}>
                  <option value="">General</option>
                  {DOC_MODULES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {saveMut.isError ? <ErrorBox message="Save failed." onRetry={() => saveMut.reset()} /> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saveMut.isPending}>
                <Check size={14} /> Save
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
