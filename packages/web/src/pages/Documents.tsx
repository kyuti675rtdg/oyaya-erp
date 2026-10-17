import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive, Check, Download, FileText, FolderOpen, Grid3X3, List, Lock, Plus, Search, Trash2, Upload, X
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { DocFolder, Document } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextInput } from '../components/ui';
import { DOC_CATEGORIES, DOC_STATUS_TONE, cardShell, fileKindLabel, formatFileSize, readFileAsBase64 } from './DocShared';

interface UploadForm {
  title: string;
  description: string;
  category: string;
  tags: string;
  folderId: string;
  retentionUntil: string;
}

const EMPTY_FORM: UploadForm = { title: '', description: '', category: 'General', tags: '', folderId: '', retentionUntil: '' };

export function Documents() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('documents:manage');
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [folderId, setFolderId] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState<UploadForm>(EMPTY_FORM);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Document | null>(null);

  const docsQ = useQuery({
    queryKey: ['documents', { search, category, status, folderId }],
    queryFn: async () =>
      (
        await api.get<Document[]>(
          E.docLib +
            `?${new URLSearchParams({
              ...(search ? { search } : {}),
              ...(category ? { category } : {}),
              ...(status ? { status } : {}),
              ...(folderId ? { folderId } : {}),
              archived: 'false',
            }).toString()}`
        )
      ).data,
  });

  const foldersQ = useQuery({
    queryKey: ['doc-folders'],
    queryFn: async () => (await api.get<DocFolder[]>(E.docFolders)).data,
  });

  const folderName = useMemo(() => {
    const map = new Map((foldersQ.data ?? []).map((f) => [f.id, f.name]));
    return (id: string | null) => (id ? map.get(id) ?? '—' : '—');
  }, [foldersQ.data]);

  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!pendingFile) throw new Error('No file selected');
      const contentBase64 = await readFileAsBase64(pendingFile);
      return (
        await api.post(E.docLib, {
          title: form.title || pendingFile.name,
          description: form.description || null,
          category: form.category,
          tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
          folderId: form.folderId || null,
          fileName: pendingFile.name,
          mimeType: pendingFile.type || 'application/octet-stream',
          contentBase64,
          retentionUntil: form.retentionUntil || null,
        })
      ).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      setShowUpload(false);
      setForm(EMPTY_FORM);
      setPendingFile(null);
      setUploading(false);
    },
    onError: () => setUploading(false),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => (await api.delete(E.docItem(id))).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      setConfirmDelete(null);
    },
  });

  const archiveMut = useMutation({
    mutationFn: async (id: string) => (await api.post(E.docArchive(id), {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pendingFile) return;
    setUploading(true);
    uploadMut.mutate();
  };

  const download = (doc: Document) => {
    window.open(`${api.defaults.baseURL}${E.docDownload(doc.id)}`, '_blank');
  };

  const renderCard = (doc: Document) => (
    <div key={doc.id} className={`${cardShell} group flex flex-col gap-3 !p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
          <FileText size={20} />
        </div>
        <Badge tone={DOC_STATUS_TONE[doc.status] ?? 'neutral'}>{doc.status.replace('_', ' ')}</Badge>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100" title={doc.title}>
          {doc.title}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {doc.docNo} · v{doc.version} · {fileKindLabel(doc.mimeType, doc.fileName)}
        </p>
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span className="truncate">{formatFileSize(doc.fileSize)}</span>
        <span>{fmtDate(doc.updatedAt)}</span>
      </div>
      {doc.checkedOutById ? (
        <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600">
          <Lock size={12} /> Checked out
        </p>
      ) : null}
      <div className="mt-auto flex items-center gap-1 border-t border-slate-100 dark:border-slate-700 pt-3">
        <button
          type="button"
          onClick={() => download(doc)}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50"
        >
          <Download size={14} /> Open
        </button>
        {canManage ? (
          <>
            <button
              type="button"
              onClick={() => archiveMut.mutate(doc.id)}
              title="Archive"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <Archive size={15} />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(doc)}
              title="Delete"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            >
              <Trash2 size={15} />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className={`${cardShell}`}>
        <CardHeader
          icon={<FileText size={16} />}
          title="Document Library"
          subtitle="Central repository for all factory documents"
          action={
            <>
              <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
                <button
                  type="button"
                  onClick={() => setView('grid')}
                  className={`rounded-md p-1.5 ${view === 'grid' ? 'bg-violet-100 text-violet-700' : 'text-slate-400'}`}
                  aria-label="Grid view"
                >
                  <Grid3X3 size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className={`rounded-md p-1.5 ${view === 'list' ? 'bg-violet-100 text-violet-700' : 'text-slate-400'}`}
                  aria-label="List view"
                >
                  <List size={15} />
                </button>
              </div>
              {canManage ? (
                <Button onClick={() => setShowUpload(true)}>
                  <Upload size={14} /> Upload
                </Button>
              ) : null}
            </>
          }
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, description, file…"
              className="!pl-9"
            />
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {DOC_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED'].map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </Select>
          <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">All folders</option>
            {(foldersQ.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {docsQ.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Loading documents…" />
        </div>
      ) : docsQ.isError ? (
        <ErrorBox message="Failed to load documents." onRetry={() => docsQ.refetch()} />
      ) : (docsQ.data ?? []).length === 0 ? (
        <div className={cardShell}>
          <EmptyState title="No documents yet" sub="Upload the first document to start the library." />
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(docsQ.data ?? []).map(renderCard)}
        </div>
      ) : (
        <div className={`${cardShell} overflow-x-auto !p-0`}>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-5 py-3 font-semibold">Document</th>
                <th className="px-5 py-3 font-semibold">Folder</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Size</th>
                <th className="px-5 py-3 font-semibold">Updated</th>
                <th className="px-5 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(docsQ.data ?? []).map((doc) => (
                <tr key={doc.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 dark:bg-slate-800/60/60">
                  <td className="px-5 py-3">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{doc.title}</p>
                    <p className="text-xs text-slate-500">
                      {doc.docNo} · v{doc.version} · {fileKindLabel(doc.mimeType, doc.fileName)}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-600">{folderName(doc.folderId)}</td>
                  <td className="px-5 py-3">
                    <Badge tone={DOC_STATUS_TONE[doc.status] ?? 'neutral'}>{doc.status.replace('_', ' ')}</Badge>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">{formatFileSize(doc.fileSize)}</td>
                  <td className="px-5 py-3 text-slate-600">{fmtDate(doc.updatedAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => download(doc)}
                        title="Download"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-violet-50 hover:text-violet-700"
                      >
                        <Download size={15} />
                      </button>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(doc)}
                          title="Delete"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showUpload ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog" aria-modal="true">
          <form onSubmit={submit} className={`${cardShell} w-full max-w-lg space-y-4 !p-6`}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Upload Document</h3>
              <button
                type="button"
                onClick={() => setShowUpload(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60/60 px-4 py-8 text-center hover:border-violet-300 hover:bg-violet-50/40"
            >
              <Upload size={24} className="text-violet-500" />
              {pendingFile ? (
                <p className="text-sm font-semibold text-slate-700">{pendingFile.name}</p>
              ) : (
                <p className="text-sm text-slate-500">
                  Click to select a file <span className="text-slate-400">(PDF, Word, Excel, images…)</span>
                </p>
              )}
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Field label="Title">
              <TextInput
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={pendingFile?.name ?? 'Document title'}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {DOC_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Folder">
                <Select value={form.folderId} onChange={(e) => setForm({ ...form, folderId: e.target.value })}>
                  <option value="">No folder</option>
                  {(foldersQ.data ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Tags (comma separated)">
              <TextInput
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="policy, 2026, finance"
              />
            </Field>
            <Field label="Description">
              <TextInput
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description"
              />
            </Field>
            {uploadMut.isError ? <ErrorBox message="Upload failed. Try again." onRetry={() => uploadMut.reset()} /> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setShowUpload(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={uploading} disabled={!pendingFile}>
                <Check size={14} /> Upload
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog" aria-modal="true">
          <div className={`${cardShell} w-full max-w-sm space-y-4 !p-6`}>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Delete document?</h3>
            <p className="text-sm text-slate-600">
              <FolderOpen size={14} className="mr-1 inline" />
              “{confirmDelete.title}” and all its versions will be permanently removed.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={deleteMut.isPending} onClick={() => deleteMut.mutate(confirmDelete.id)}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
