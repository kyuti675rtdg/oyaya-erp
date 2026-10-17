import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Eye, HelpCircle, LifeBuoy, Pin, Plus, Search, Star, X
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate, fmtInt } from '../lib/format';
import { useAuth } from '../store/auth';
import type { KbArticle } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import {
  Button, EmptyState, ErrorBox, Field, SectionTitle, Select, Spinner, TextArea, TextInput
} from '../components/ui';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const CATEGORIES: Record<string, string> = {
  faq: 'FAQs',
  troubleshooting: 'Troubleshooting',
  howto: 'How-To Guides',
  guide: 'Guides'
};

interface KbForm {
  title: string;
  category: string;
  tags: string;
  content: string;
  faq: boolean;
  pinned: boolean;
}

const EMPTY_FORM: KbForm = { title: '', category: 'howto', tags: '', content: '', faq: false, pinned: false };

export function KnowledgeBase() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('support:manage');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [viewId, setViewId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<KbForm>(EMPTY_FORM);

  const kbQ = useQuery({
    queryKey: ['kb'],
    queryFn: async () => (await api.get<KbArticle[]>(E.kb)).data
  });

  const detailQ = useQuery({
    queryKey: ['kb', viewId],
    queryFn: async () => (await api.get<KbArticle>(E.kbArticle(viewId!))).data,
    enabled: !!viewId
  });

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return (kbQ.data ?? []).filter(
      (a) =>
        (!catFilter || a.category === catFilter) &&
        (!s ||
          a.title.toLowerCase().includes(s) ||
          a.content.toLowerCase().includes(s) ||
          a.tags.some((t) => t.toLowerCase().includes(s)))
    );
  }, [kbQ.data, search, catFilter]);

  const popular = useMemo(
    () => [...(kbQ.data ?? [])].sort((a, b) => b.views - a.views).slice(0, 5),
    [kbQ.data]
  );

  const createMut = useMutation({
    mutationFn: async (f: KbForm) =>
      (await api.post(E.kb, {
        ...f,
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean)
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    }
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    createMut.mutate(form);
  };

  const detail = detailQ.data;
  const related = useMemo(() => {
    if (!detail) return [];
    return (kbQ.data ?? [])
      .filter((a) => a.id !== detail.id && (a.category === detail.category || a.tags.some((t) => detail.tags.includes(t))))
      .slice(0, 4);
  }, [kbQ.data, detail]);

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Knowledge Base"
        sub="Searchable FAQs, troubleshooting guides and how-tos."
        action={
          canManage ? (
            <Button onClick={() => setShowForm(true)}>
              <Plus size={16} /> New Article
            </Button>
          ) : undefined
        }
      />

      {viewId && detail ? (
        <div className="grid grid-cols-12 gap-5">
          <div className={`${cardShell} col-span-12 lg:col-span-8`}>
            <div className="mb-4 flex items-center justify-between">
              <Button variant="secondary" onClick={() => setViewId(null)}>
                <ChevronLeft size={16} /> Back
              </Button>
              <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Eye size={14} /> {fmtInt(detail.views)} views
              </span>
            </div>
            <CardHeader
              icon={<LifeBuoy size={16} />}
              title={detail.title}
              subtitle={`${CATEGORIES[detail.category]} · Updated ${fmtDate(detail.updatedAt)}`}
            />
            {detail.tags.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {detail.tags.map((t) => (
                  <span key={t} className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">{detail.content}</div>
          </div>
          <div className={`${cardShell} col-span-12 h-fit lg:col-span-4`}>
            <h3 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Related Articles</h3>
            {related.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No related articles.</p>
            ) : (
              <div className="space-y-2">
                {related.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setViewId(a.id)}
                    className="block w-full rounded-lg border border-slate-200/70 p-3 text-left text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-violet-300"
                  >
                    {a.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-12 space-y-5 lg:col-span-8">
            <div className={`${cardShell} flex flex-col gap-3 sm:flex-row`}>
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <TextInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search articles, tags, content…"
                  className="pl-9"
                />
              </div>
              <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="sm:w-52">
                <option value="">All categories</option>
                {Object.entries(CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </div>

            <div className={cardShell}>
              {kbQ.isLoading ? (
                <Spinner />
              ) : kbQ.isError ? (
                <ErrorBox message="Failed to load knowledge base." />
              ) : filtered.length === 0 ? (
                <EmptyState title="No articles found" sub="Try a different search term." />
              ) : (
                <div className="divide-y divide-slate-100">
                  {filtered.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setViewId(a.id)}
                      className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                          {a.faq ? <HelpCircle size={16} /> : <LifeBuoy size={16} />}
                        </span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate font-semibold text-slate-800 dark:text-slate-100">
                            {a.pinned && <Pin size={13} className="shrink-0 text-amber-500" />}
                            {a.title}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {CATEGORIES[a.category]} · {fmtInt(a.views)} views
                          </p>
                        </div>
                      </div>
                      {a.faq && <Badge tone="advisory">FAQ</Badge>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={`${cardShell} col-span-12 h-fit lg:col-span-4`}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
              <Star size={15} className="text-amber-500" /> Popular Articles
            </h3>
            {popular.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No articles yet.</p>
            ) : (
              <div className="space-y-2">
                {popular.map((a, i) => (
                  <button
                    key={a.id}
                    onClick={() => setViewId(a.id)}
                    className="flex w-full items-start gap-2 rounded-lg p-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    <span className="font-bold tabular-nums text-slate-300">{i + 1}</span>
                    <span className="font-medium text-slate-700 dark:text-slate-200">{a.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog" aria-modal="true">
          <div className={`${cardShell} max-h-[90vh] w-full max-w-2xl overflow-y-auto`}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 dark:text-slate-100">New Article</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Title" required>
                <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Category">
                  <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {Object.entries(CATEGORIES).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tags (comma separated)">
                  <TextInput value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="mill, roller, gap" />
                </Field>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={form.faq} onChange={(e) => setForm({ ...form, faq: e.target.checked })} className="rounded" />
                  Mark as FAQ
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} className="rounded" />
                  Pin to top
                </label>
              </div>
              <Field label="Content (Markdown)" required>
                <TextArea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={10} required />
              </Field>
              {createMut.isError && <ErrorBox message="Failed to create article." />}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={createMut.isPending}>
                  {createMut.isPending ? 'Saving…' : 'Publish'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
