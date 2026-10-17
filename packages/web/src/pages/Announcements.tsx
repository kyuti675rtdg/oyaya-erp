import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCheck, Megaphone, Plus, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Announcement } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import {
  Button, EmptyState, ErrorBox, Field, SectionTitle, Spinner, TextArea, TextInput
} from '../components/ui';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

interface AnnForm {
  title: string;
  body: string;
  targetRoles: string;
  urgent: boolean;
  expiresAt: string;
}

const EMPTY_FORM: AnnForm = { title: '', body: '', targetRoles: '', urgent: false, expiresAt: '' };

export function Announcements() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('support:manage');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AnnForm>(EMPTY_FORM);

  const annQ = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => (await api.get<Announcement[]>(E.announcements)).data
  });

  const unread = useMemo(
    () => (annQ.data ?? []).filter((a) => !(a.reads && a.reads.length > 0)).length,
    [annQ.data]
  );

  const createMut = useMutation({
    mutationFn: async (f: AnnForm) =>
      (await api.post(E.announcements, {
        title: f.title,
        body: f.body,
        targetRoles: f.targetRoles.split(',').map((r) => r.trim()).filter(Boolean),
        urgent: f.urgent,
        expiresAt: f.expiresAt || null
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    }
  });

  const readMut = useMutation({
    mutationFn: async (id: string) => api.post(E.announcementRead(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements'] })
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    createMut.mutate(form);
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        title="System Announcements"
        sub={`${unread} unread announcement${unread === 1 ? '' : 's'}.`}
        action={
          canManage ? (
            <Button onClick={() => setShowForm(true)}>
              <Plus size={16} /> New Announcement
            </Button>
          ) : undefined
        }
      />

      <div className={cardShell}>
        <CardHeader icon={<Megaphone size={16} />} title="Announcements" subtitle="Latest first · urgent pinned" />
        {annQ.isLoading ? (
          <Spinner />
        ) : annQ.isError ? (
          <ErrorBox message="Failed to load announcements." />
        ) : (annQ.data ?? []).length === 0 ? (
          <EmptyState title="No announcements" sub="System announcements will appear here." />
        ) : (
          <div className="space-y-3">
            {(annQ.data ?? []).map((a) => {
              const isRead = a.reads && a.reads.length > 0;
              return (
                <div
                  key={a.id}
                  className={`rounded-xl border p-4 ${a.urgent ? 'border-red-200 bg-red-50/50' : isRead ? 'border-slate-200/70' : 'border-violet-200 bg-violet-50/40'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
                      {a.urgent && <AlertTriangle size={16} className="text-red-500" />}
                      {a.title}
                    </p>
                    <div className="flex items-center gap-2">
                      {a.urgent && <Badge tone="critical">URGENT</Badge>}
                      {!isRead ? (
                        <Button variant="secondary" onClick={() => readMut.mutate(a.id)}>
                          <CheckCheck size={14} /> Mark read
                        </Button>
                      ) : (
                        <Badge tone="pass">Read</Badge>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{a.body}</p>
                  <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                    {a.publishedAt ? fmtDateTime(a.publishedAt) : ''}
                    {a.targetRoles.length > 0 ? ` · Roles: ${a.targetRoles.join(', ')}` : ' · All roles'}
                    {a.expiresAt ? ` · Expires ${fmtDateTime(a.expiresAt)}` : ''}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className={`${cardShell} w-full max-w-lg`}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 dark:text-slate-100">New Announcement</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Title" required>
                <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </Field>
              <Field label="Message" required>
                <TextArea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={5} required />
              </Field>
              <Field label="Target roles (comma separated, blank = all)">
                <TextInput value={form.targetRoles} onChange={(e) => setForm({ ...form, targetRoles: e.target.value })} placeholder="manager, lab" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Expires At">
                  <TextInput type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold text-red-600">
                  <input type="checkbox" checked={form.urgent} onChange={(e) => setForm({ ...form, urgent: e.target.checked })} className="rounded" />
                  Urgent (banner)
                </label>
              </div>
              {createMut.isError && <ErrorBox message="Failed to publish announcement." />}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={createMut.isPending}>
                  {createMut.isPending ? 'Publishing…' : 'Publish'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
