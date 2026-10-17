import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Share2, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate, fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Document } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextInput } from '../components/ui';
import { cardShell } from './DocShared';

interface ShareForm {
  permission: 'VIEW' | 'EDIT';
  expiresAt: string;
  createLink: boolean;
}

export function DocSharing() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('documents:manage');
  const [docId, setDocId] = useState('');
  const [showShare, setShowShare] = useState(false);
  const [form, setForm] = useState<ShareForm>({ permission: 'VIEW', expiresAt: '', createLink: true });
  const [copied, setCopied] = useState<string | null>(null);

  const docsQ = useQuery({
    queryKey: ['documents', 'all3'],
    queryFn: async () => (await api.get<Document[]>(E.docLib + '?archived=false')).data,
  });

  const sharesQ = useQuery({
    queryKey: ['doc-shares', docId],
    queryFn: async () => (await api.get<import('../types').DocShare[]>(E.docShares(docId))).data,
    enabled: !!docId,
  });

  const createMut = useMutation({
    mutationFn: async () =>
      (
        await api.post(E.docShareCreate(docId), {
          permission: form.permission,
          expiresAt: form.expiresAt || null,
          createLink: form.createLink,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doc-shares', docId] });
      setShowShare(false);
      setForm({ permission: 'VIEW', expiresAt: '', createLink: true });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (sid: string) => (await api.delete(E.docShareDelete(sid))).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-shares', docId] }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    createMut.mutate();
  };

  const shareUrl = (token: string | null) =>
    token ? `${window.location.origin}${E.docSharedLink(token)}` : '';

  const copyLink = async (token: string | null, id: string) => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  const selected = (docsQ.data ?? []).find((d) => d.id === docId);

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<Share2 size={16} />}
          title="Sharing & Access"
          subtitle="Share documents with links, users and roles"
          action={
            canManage && docId ? (
              <Button onClick={() => setShowShare(true)}>
                <Link2 size={14} /> New Share
              </Button>
            ) : null
          }
        />
        <div className="max-w-md">
          <Field label="Select document">
            <Select value={docId} onChange={(e) => setDocId(e.target.value)}>
              <option value="">Choose a document…</option>
              {(docsQ.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.docNo} — {d.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {!docId ? (
        <div className={cardShell}>
          <EmptyState title="No document selected" sub="Pick a document to manage its shares." />
        </div>
      ) : (
        <div className={cardShell}>
          <CardHeader
            icon={<Link2 size={16} />}
            title={`Shares for “${selected?.title ?? ''}”`}
            subtitle={`${(sharesQ.data ?? []).length} active share(s)`}
          />
          {sharesQ.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner label="Loading shares…" />
            </div>
          ) : sharesQ.isError ? (
            <ErrorBox message="Failed to load shares." onRetry={() => sharesQ.refetch()} />
          ) : (sharesQ.data ?? []).length === 0 ? (
            <EmptyState title="No shares yet" sub="Create a share link or grant access above." />
          ) : (
            <div className="divide-y divide-slate-50">
              {(sharesQ.data ?? []).map((s) => {
                const expired = s.expiresAt && new Date(s.expiresAt) < new Date();
                return (
                  <div key={s.id} className="flex items-center gap-3 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                      <Link2 size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={s.permission === 'EDIT' ? 'advisory' : 'neutral'}>{s.permission}</Badge>
                        {s.token ? <Badge tone="pass">Link</Badge> : null}
                        {expired ? <Badge tone="critical">Expired</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {s.accessCount} access{s.accessCount === 1 ? '' : 'es'}
                        {s.expiresAt ? ` · expires ${fmtDate(s.expiresAt)}` : ' · no expiry'} · created{' '}
                        {fmtDateTime(s.createdAt)}
                      </p>
                      {s.token ? (
                        <p className="mt-0.5 truncate font-mono text-[11px] text-violet-700">{shareUrl(s.token)}</p>
                      ) : null}
                    </div>
                    {s.token && !expired ? (
                      <button
                        type="button"
                        onClick={() => copyLink(s.token, s.id)}
                        title="Copy link"
                        className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-violet-50 hover:text-violet-700"
                      >
                        {copied === s.id ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                      </button>
                    ) : null}
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => deleteMut.mutate(s.id)}
                        title="Revoke"
                        className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-500 dark:text-slate-400">
            Link shares work without login — anyone with the link can open the file until it expires or is revoked.
            User/role shares are recorded for audit.
          </p>
        </div>
      )}

      {showShare ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form onSubmit={submit} className={`${cardShell} w-full max-w-md space-y-4 !p-6`}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">New Share</h3>
              <button type="button" onClick={() => setShowShare(false)} className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <Field label="Permission">
              <Select value={form.permission} onChange={(e) => setForm({ ...form, permission: e.target.value as 'VIEW' | 'EDIT' })}>
                <option value="VIEW">View only</option>
                <option value="EDIT">View & edit</option>
              </Select>
            </Field>
            <Field label="Expiry date (optional)">
              <TextInput type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={form.createLink}
                onChange={(e) => setForm({ ...form, createLink: e.target.checked })}
                className="h-4 w-4 rounded accent-violet-600"
              />
              Generate public share link
            </label>
            {createMut.isError ? <ErrorBox message="Share failed." onRetry={() => createMut.reset()} /> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setShowShare(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createMut.isPending}>
                <Check size={14} /> Create Share
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
