import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus, Search, Wrench, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { TechSupportRecord } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import {
  Button, EmptyState, ErrorBox, Field, SectionTitle, Select, Spinner, TextArea, TextInput
} from '../components/ui';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const CATEGORIES: Record<string, string> = {
  network: 'Network',
  hardware: 'Hardware',
  software: 'Software',
  training: 'Training',
  other: 'Other'
};

// Known issues database (seeded, client-side reference)
const KNOWN_ISSUES = [
  { issue: 'ERP login fails on shared tablet', fix: 'Clear browser cache; each shift should use its own device profile.' },
  { issue: 'Weighbridge reading not syncing', fix: 'Check RS-232 cable and restart the weighbridge service from API Monitor.' },
  { issue: 'Lab check overdue alerts firing early', fix: 'Verify shift start times in Shift Management; alerts use shift clock.' },
  { issue: 'SMS alerts not delivering', fix: 'Confirm AfroMessage token is configured; check SMS log for QUEUED status.' }
];

interface RecForm {
  title: string;
  category: string;
  description: string;
  resolution: string;
  durationMins: string;
}

const EMPTY_FORM: RecForm = { title: '', category: 'software', description: '', resolution: '', durationMins: '' };

export function TechSupport() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('support:manage');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RecForm>(EMPTY_FORM);

  const recordsQ = useQuery({
    queryKey: ['tech-records'],
    queryFn: async () => (await api.get<TechSupportRecord[]>(E.techRecords)).data
  });

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return (recordsQ.data ?? []).filter(
      (r) =>
        (!catFilter || r.category === catFilter) &&
        (!s || r.title.toLowerCase().includes(s) || r.description.toLowerCase().includes(s) || (r.resolution ?? '').toLowerCase().includes(s))
    );
  }, [recordsQ.data, search, catFilter]);

  const createMut = useMutation({
    mutationFn: async (f: RecForm) =>
      (await api.post(E.techRecords, {
        title: f.title,
        category: f.category,
        description: f.description,
        resolution: f.resolution || null,
        durationMins: f.durationMins ? Number(f.durationMins) : null
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tech-records'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    }
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    createMut.mutate(form);
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Technical Support Records"
        sub="Session logs, resolution records and known issues."
        action={
          canManage ? (
            <Button onClick={() => setShowForm(true)}>
              <Plus size={16} /> Log Session
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 space-y-5 lg:col-span-8">
          <div className={`${cardShell} flex flex-col gap-3 sm:flex-row`}>
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search records…"
                className="pl-9"
              />
            </div>
            <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="sm:w-48">
              <option value="">All categories</option>
              {Object.entries(CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </div>

          <div className={cardShell}>
            <CardHeader icon={<Wrench size={16} />} title="Support Sessions" subtitle={`${filtered.length} records`} />
            {recordsQ.isLoading ? (
              <Spinner />
            ) : recordsQ.isError ? (
              <ErrorBox message="Failed to load records." />
            ) : filtered.length === 0 ? (
              <EmptyState title="No records found" sub="Log the first support session." />
            ) : (
              <div className="space-y-3">
                {filtered.map((r) => (
                  <div key={r.id} className="rounded-xl border border-slate-200/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold text-slate-800 dark:text-slate-100">{r.title}</p>
                      <div className="flex gap-2">
                        <Badge tone="neutral">{CATEGORIES[r.category]}</Badge>
                        {r.resolvedAt ? (
                          <Badge tone="pass"><CheckCircle2 size={12} className="mr-1" /> Resolved</Badge>
                        ) : (
                          <Badge tone="advisory">Open</Badge>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {r.recordNo} · {fmtDateTime(r.createdAt)}{r.durationMins ? ` · ${r.durationMins} min` : ''}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{r.description}</p>
                    {r.resolution && (
                      <div className="mt-2 rounded-lg bg-emerald-50 p-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Resolution</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">{r.resolution}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={`${cardShell} col-span-12 h-fit lg:col-span-4`}>
          <CardHeader icon={<CheckCircle2 size={16} />} title="Known Issues" subtitle="Quick fixes database" />
          <div className="space-y-3">
            {KNOWN_ISSUES.map((k, i) => (
              <div key={i} className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{k.issue}</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{k.fix}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className={`${cardShell} max-h-[90vh] w-full max-w-lg overflow-y-auto`}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 dark:text-slate-100">Log Support Session</h3>
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
                <Field label="Duration (minutes)">
                  <TextInput type="number" min="0" value={form.durationMins} onChange={(e) => setForm({ ...form, durationMins: e.target.value })} />
                </Field>
              </div>
              <Field label="Description" required>
                <TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} required />
              </Field>
              <Field label="Resolution (leave blank if open)">
                <TextArea value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} rows={3} />
              </Field>
              {createMut.isError && <ErrorBox message="Failed to log session." />}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={createMut.isPending}>
                  {createMut.isPending ? 'Saving…' : 'Save Record'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
