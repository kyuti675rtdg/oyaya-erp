import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, ChevronLeft, ClipboardList, Plus, Search, X
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
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  UNDER_REVIEW: 'advisory',
  APPROVED: 'pass',
  ARCHIVED: 'neutral'
};

const SOP_CATEGORIES = ['Wheat Intake', 'Milling Operations', 'Laboratory Testing', 'Sanitation', 'Safety', 'Maintenance', 'Warehouse', 'General'];

const SOP_TEMPLATES: Record<string, string> = {
  'Wheat Intake': '## 1. Truck Arrival\nRecord vehicle plate, driver and arrival time at the intake gate.\n\n## 2. Weighbridge\nCapture gross weight. Direct truck to sampling bay.\n\n## 3. Sampling & Lab Test\nCollect representative sample. Test moisture ≤ 13.5%, impurity ≤ 6%, gluten ≥ 20%, hectoliter ≥ 74%.\n\n## 4. Decision\nACCEPT if all parameters pass. CONDITIONAL for minor deviations with manager approval. REJECT and return if critical failure.\n\n## 5. Unloading & Tare\nUnload into dry pool. Capture tare weight. Compute net quintals.',
  'Milling Operations': '## 1. Pre-Shift Check\nVerify tank release status, roller gaps, and aspiration.\n\n## 2. Mill Start-Up\nStart in sequence: aspiration → rolls → feed. Confirm steady load.\n\n## 3. In-Process Monitoring\nCheck extraction rate hourly. Duket yield below 78% triggers auto-flag.\n\n## 4. Flour Output\nRecord output per grade. Transfer to finished goods with batch labels.\n\n## 5. Shutdown & Cleaning\nFlush system, record downtime, hand over log to next shift.'
};

interface SopForm {
  title: string;
  module: string;
  summary: string;
  content: string;
  effectiveDate: string;
  reviewDate: string;
}

const EMPTY_FORM: SopForm = { title: '', module: '', summary: '', content: '', effectiveDate: '', reviewDate: '' };

export function SOPs() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('support:manage');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewId, setViewId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SopForm>(EMPTY_FORM);

  const sopsQ = useQuery({
    queryKey: ['sops', 'SOP'],
    queryFn: async () => (await api.get<SopDocument[]>(E.sops + '?docType=SOP')).data
  });

  const detailQ = useQuery({
    queryKey: ['sop', viewId],
    queryFn: async () => (await api.get<SopDocument>(E.sop(viewId!))).data,
    enabled: !!viewId
  });

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return (sopsQ.data ?? []).filter(
      (d) =>
        (!catFilter || d.module === catFilter) &&
        (!statusFilter || d.status === statusFilter) &&
        (!s || d.title.toLowerCase().includes(s) || d.content.toLowerCase().includes(s))
    );
  }, [sopsQ.data, search, catFilter, statusFilter]);

  const createMut = useMutation({
    mutationFn: async (f: SopForm) =>
      (await api.post(E.sops, { ...f, docType: 'SOP', module: f.module || null })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sops'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    }
  });

  const statusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      (await api.patch(E.sop(id), { status })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sops'] });
      qc.invalidateQueries({ queryKey: ['sop', viewId] });
    }
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    createMut.mutate(form);
  };

  const applyTemplate = (cat: string) => {
    setForm((f) => ({ ...f, module: cat, content: SOP_TEMPLATES[cat] ?? f.content }));
  };

  const detail = detailQ.data;
  const steps = useMemo(() => {
    if (!detail) return [];
    return detail.content.split(/^##\s+/m).filter((s) => s.trim());
  }, [detail]);

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Standard Operating Procedures"
        sub="Approved procedures with version control and effective dates."
        action={
          canManage ? (
            <Button onClick={() => setShowForm(true)}>
              <Plus size={16} /> New SOP
            </Button>
          ) : undefined
        }
      />

      {viewId && detail ? (
        <div className={cardShell}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setViewId(null)}>
              <ChevronLeft size={16} /> Back
            </Button>
            <div className="flex flex-wrap gap-2">
              <Badge tone={STATUS_TONE[detail.status] ?? 'neutral'}>{detail.status.replace('_', ' ')}</Badge>
              <Badge tone="neutral">v{detail.version}</Badge>
              {canManage && detail.status === 'DRAFT' && (
                <Button variant="secondary" onClick={() => statusMut.mutate({ id: detail.id, status: 'UNDER_REVIEW' })}>
                  Submit for Review
                </Button>
              )}
              {canManage && detail.status === 'UNDER_REVIEW' && (
                <Button onClick={() => statusMut.mutate({ id: detail.id, status: 'APPROVED' })}>
                  <CheckCircle2 size={14} /> Approve
                </Button>
              )}
            </div>
          </div>
          <CardHeader
            icon={<ClipboardList size={16} />}
            title={detail.title}
            subtitle={`${detail.docNo} · ${detail.module ?? 'General'} · Effective ${detail.effectiveDate ? fmtDate(detail.effectiveDate) : '—'}${detail.reviewDate ? ` · Review by ${fmtDate(detail.reviewDate)}` : ''}`}
          />
          {detail.summary && <p className="mb-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{detail.summary}</p>}
          <ol className="space-y-4">
            {steps.map((step, i) => {
              const [heading, ...body] = step.split('\n');
              return (
                <li key={i} className="flex gap-4 rounded-xl border border-slate-100 p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <h4 className="font-bold text-slate-800">{heading.trim()}</h4>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{body.join('\n').trim()}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <>
          <div className={`${cardShell} flex flex-col gap-3 sm:flex-row`}>
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SOPs…"
                className="pl-9"
              />
            </div>
            <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="sm:w-48">
              <option value="">All categories</option>
              {SOP_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-44">
              <option value="">All statuses</option>
              {Object.keys(STATUS_TONE).map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </Select>
          </div>

          <div className={cardShell}>
            {sopsQ.isLoading ? (
              <Spinner />
            ) : sopsQ.isError ? (
              <ErrorBox message="Failed to load SOPs." />
            ) : filtered.length === 0 ? (
              <EmptyState title="No SOPs found" sub="Create the first standard operating procedure." />
            ) : (
              <div className="divide-y divide-slate-100">
                {filtered.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setViewId(d.id)}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-800">{d.title}</p>
                      <p className="text-xs text-slate-500">
                        {d.docNo} · v{d.version} · {d.module ?? 'General'} · Effective {d.effectiveDate ? fmtDate(d.effectiveDate) : '—'}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[d.status] ?? 'neutral'}>{d.status.replace('_', ' ')}</Badge>
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
              <h3 className="font-bold text-slate-800">New SOP</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Title" required>
                <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </Field>
              <Field label="Category">
                <Select
                  value={form.module}
                  onChange={(e) => {
                    setForm({ ...form, module: e.target.value });
                    applyTemplate(e.target.value);
                  }}
                >
                  <option value="">Select…</option>
                  {SOP_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Effective Date">
                  <TextInput type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
                </Field>
                <Field label="Review Date">
                  <TextInput type="date" value={form.reviewDate} onChange={(e) => setForm({ ...form, reviewDate: e.target.value })} />
                </Field>
              </div>
              <Field label="Summary">
                <TextArea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} rows={2} />
              </Field>
              <Field label="Procedure Steps (use ## for step headings)" required>
                <TextArea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={10} required />
              </Field>
              {createMut.isError && <ErrorBox message="Failed to create SOP." />}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={createMut.isPending}>
                  {createMut.isPending ? 'Saving…' : 'Save SOP'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
