import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, ChevronLeft, Download, FileText, Plus, Search, X
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { SopDocument } from '../types';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import {
  Button, EmptyState, ErrorBox, Field, SectionTitle, Select, Spinner, TextArea, TextInput
} from '../components/ui';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  UNDER_REVIEW: 'advisory',
  APPROVED: 'pass',
  ARCHIVED: 'neutral'
};

const MODULES = [
  'Procurement', 'Storage', 'Production', 'Quality', 'Maintenance',
  'Sales', 'Finance', 'HR', 'Fleet', 'Warehouse', 'Traceability', 'System'
];

interface ManualForm {
  title: string;
  module: string;
  summary: string;
  content: string;
  effectiveDate: string;
}

const EMPTY_FORM: ManualForm = { title: '', module: '', summary: '', content: '', effectiveDate: '' };

export function Manuals() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('support:manage');
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [viewId, setViewId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ManualForm>(EMPTY_FORM);

  const manualsQ = useQuery({
    queryKey: ['sops', 'MANUAL'],
    queryFn: async () => (await api.get<SopDocument[]>(E.sops + '?docType=MANUAL')).data
  });

  const detailQ = useQuery({
    queryKey: ['sop', viewId],
    queryFn: async () => (await api.get<SopDocument>(E.sop(viewId!))).data,
    enabled: !!viewId
  });

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return (manualsQ.data ?? []).filter(
      (m) =>
        (!moduleFilter || m.module === moduleFilter) &&
        (!s || m.title.toLowerCase().includes(s) || (m.summary ?? '').toLowerCase().includes(s))
    );
  }, [manualsQ.data, search, moduleFilter]);

  const createMut = useMutation({
    mutationFn: async (f: ManualForm) =>
      (await api.post(E.sops, { ...f, docType: 'MANUAL', module: f.module || null })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sops'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    }
  });

  const approveMut = useMutation({
    mutationFn: async (id: string) => (await api.patch(E.sop(id), { status: 'APPROVED' })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sops'] });
      qc.invalidateQueries({ queryKey: ['sop', viewId] });
    }
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    createMut.mutate(form);
  };

  const download = (doc: SopDocument) => {
    const blob = new Blob(
      [`# ${doc.title}\n\n${doc.docNo} · v${doc.version} · ${doc.module ?? 'General'}\n\n${doc.content}`],
      { type: 'text/markdown' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.docNo}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const detail = detailQ.data;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="User Manuals"
        sub="Module-by-module operating manuals with version tracking."
        action={
          canManage ? (
            <Button onClick={() => setShowForm(true)}>
              <Plus size={16} /> New Manual
            </Button>
          ) : undefined
        }
      />

      {viewId && detail ? (
        <div className={`${cardShell}`}>
          <div className="mb-4 flex items-center justify-between">
            <Button variant="secondary" onClick={() => setViewId(null)}>
              <ChevronLeft size={16} /> Back
            </Button>
            <div className="flex gap-2">
              <Badge tone={STATUS_TONE[detail.status] ?? 'neutral'}>{detail.status.replace('_', ' ')}</Badge>
              <Button variant="secondary" onClick={() => download(detail)}>
                <Download size={14} /> Download
              </Button>
              {canManage && detail.status !== 'APPROVED' && (
                <Button onClick={() => approveMut.mutate(detail.id)}>Approve</Button>
              )}
            </div>
          </div>
          <CardHeader
            icon={<BookOpen size={16} />}
            title={detail.title}
            subtitle={`${detail.docNo} · v${detail.version} · ${detail.module ?? 'General'} · Effective ${detail.effectiveDate ? fmtDate(detail.effectiveDate) : '—'}`}
          />
          {detail.summary && <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">{detail.summary}</p>}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">{detail.content}</div>
        </div>
      ) : (
        <>
          <div className={`${cardShell} flex flex-col gap-3 sm:flex-row`}>
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search manuals…"
                className="pl-9"
              />
            </div>
            <Select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="sm:w-52">
              <option value="">All modules</option>
              {MODULES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </div>

          <div className={cardShell}>
            {manualsQ.isLoading ? (
              <Spinner />
            ) : manualsQ.isError ? (
              <ErrorBox message="Failed to load manuals." />
            ) : filtered.length === 0 ? (
              <EmptyState title="No manuals found" sub="Try a different search or module filter." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setViewId(m.id)}
                    className="rounded-xl border border-slate-200/70 p-4 text-left transition-all hover:border-violet-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                        <FileText size={18} />
                      </span>
                      <Badge tone={STATUS_TONE[m.status] ?? 'neutral'}>{m.status.replace('_', ' ')}</Badge>
                    </div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100">{m.title}</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {m.docNo} · v{m.version} · {m.module ?? 'General'}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className={`${cardShell} max-h-[90vh] w-full max-w-2xl overflow-y-auto`}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 dark:text-slate-100">New Manual</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Title" required>
                <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Module">
                  <Select value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })}>
                    <option value="">General</option>
                    {MODULES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Effective Date">
                  <TextInput type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
                </Field>
              </div>
              <Field label="Summary">
                <TextArea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} rows={2} />
              </Field>
              <Field label="Content (Markdown)" required>
                <TextArea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={10} required />
              </Field>
              {createMut.isError && <ErrorBox message="Failed to create manual." />}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={createMut.isPending}>
                  {createMut.isPending ? 'Saving…' : 'Save Manual'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
