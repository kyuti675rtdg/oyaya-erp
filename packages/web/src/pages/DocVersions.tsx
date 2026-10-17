import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, History, Lock, RotateCcw, Upload, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate, fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Document } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { cardShell, formatFileSize, readFileAsBase64 } from './DocShared';

export function DocVersions() {
  const qc = useQueryClient();
  const { hasClaim, user } = useAuth();
  const canManage = hasClaim('documents:manage');
  const fileRef = useRef<HTMLInputElement>(null);
  const [docId, setDocId] = useState('');
  const [showCheckin, setShowCheckin] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [restoreVid, setRestoreVid] = useState<string | null>(null);

  const docsQ = useQuery({
    queryKey: ['documents', 'all'],
    queryFn: async () => (await api.get<Document[]>(E.docLib + '?archived=false')).data,
  });

  const detailQ = useQuery({
    queryKey: ['document', docId],
    queryFn: async () => (await api.get<Document>(E.docItem(docId))).data,
    enabled: !!docId,
  });

  const doc = detailQ.data;
  const checkedOutByMe = doc?.checkedOutById === user?.id;
  const checkedOutByOther = !!doc?.checkedOutById && !checkedOutByMe;

  const checkoutMut = useMutation({
    mutationFn: async () => (await api.post(E.docCheckout(docId), {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', docId] });
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  const checkinMut = useMutation({
    mutationFn: async () => {
      if (!pendingFile) throw new Error('No file selected');
      const contentBase64 = await readFileAsBase64(pendingFile);
      return (
        await api.post(E.docCheckin(docId), {
          fileName: pendingFile.name,
          mimeType: pendingFile.type || 'application/octet-stream',
          contentBase64,
          changeNote: changeNote || null,
        })
      ).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', docId] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      setShowCheckin(false);
      setPendingFile(null);
      setChangeNote('');
    },
  });

  const restoreMut = useMutation({
    mutationFn: async (vid: string) => (await api.post(E.docVersionRestore(docId, vid), {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', docId] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      setRestoreVid(null);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pendingFile) return;
    checkinMut.mutate();
  };

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<History size={16} />}
          title="Version Control"
          subtitle="Check-out, check-in and restore document versions"
        />
        <div className="max-w-md">
          <Field label="Select document">
            <Select value={docId} onChange={(e) => setDocId(e.target.value)}>
              <option value="">Choose a document…</option>
              {(docsQ.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.docNo} — {d.title} (v{d.version})
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {!docId ? (
        <div className={cardShell}>
          <EmptyState title="No document selected" sub="Pick a document above to manage its versions." />
        </div>
      ) : detailQ.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner label="Loading…" />
        </div>
      ) : detailQ.isError || !doc ? (
        <ErrorBox message="Failed to load document." onRetry={() => detailQ.refetch()} />
      ) : (
        <>
          <div className={`${cardShell} flex flex-wrap items-center gap-4`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {doc.title} <span className="font-normal text-slate-500 dark:text-slate-400">· v{doc.version}</span>
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {doc.docNo} · {formatFileSize(doc.fileSize)} · {doc.fileName}
              </p>
            </div>
            {doc.checkedOutById ? (
              <Badge tone="advisory">
                <Lock size={11} className="mr-1 inline" />
                {checkedOutByMe ? 'Checked out by you' : 'Checked out'}
              </Badge>
            ) : (
              <Badge tone="pass">Available</Badge>
            )}
            {canManage && !doc.checkedOutById ? (
              <Button onClick={() => checkoutMut.mutate()} loading={checkoutMut.isPending}>
                <Lock size={14} /> Check Out
              </Button>
            ) : null}
            {canManage && checkedOutByMe ? (
              <Button onClick={() => setShowCheckin(true)}>
                <Upload size={14} /> Check In New Version
              </Button>
            ) : null}
            {checkedOutByOther ? (
              <p className="text-xs font-semibold text-amber-600">Another user is editing this document.</p>
            ) : null}
          </div>

          <div className={cardShell}>
            <CardHeader icon={<History size={16} />} title="Version History" subtitle={`${doc.versions?.length ?? 0} versions`} />
            {(doc.versions ?? []).length === 0 ? (
              <EmptyState title="No versions" sub="Version history will appear here." />
            ) : (
              <div className="divide-y divide-slate-50">
                {(doc.versions ?? []).map((v, i) => (
                  <div key={v.id} className="flex items-center gap-3 py-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${
                        i === 0 ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      v{v.version}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{v.fileName}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {formatFileSize(v.fileSize)} · {fmtDateTime(v.createdAt)}
                        {v.changeNote ? ` · ${v.changeNote}` : ''}
                      </p>
                    </div>
                    {i === 0 ? <Badge tone="pass">Current</Badge> : null}
                    {canManage && i > 0 ? (
                      <button
                        type="button"
                        onClick={() => setRestoreVid(v.id)}
                        title="Restore this version"
                        className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-violet-50 hover:text-violet-700"
                      >
                        <RotateCcw size={15} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {showCheckin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog" aria-modal="true">
          <form onSubmit={submit} className={`${cardShell} w-full max-w-md space-y-4 !p-6`}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Check In New Version</h3>
              <button
                type="button"
                onClick={() => setShowCheckin(false)}
                className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
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
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/60 px-4 py-8 text-center hover:border-violet-300"
            >
              <Upload size={22} className="text-violet-500" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{pendingFile ? pendingFile.name : 'Select updated file'}</p>
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)} />
            </div>
            <Field label="Change note">
              <TextArea
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                placeholder="What changed in this version?"
                rows={3}
              />
            </Field>
            {checkinMut.isError ? <ErrorBox message="Check-in failed." onRetry={() => checkinMut.reset()} /> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setShowCheckin(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={checkinMut.isPending} disabled={!pendingFile}>
                <Check size={14} /> Check In
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {restoreVid ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog" aria-modal="true">
          <div className={`${cardShell} w-full max-w-sm space-y-4 !p-6`}>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Restore version?</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              This creates a new version from the selected older file. The current version is preserved in history.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRestoreVid(null)}>
                Cancel
              </Button>
              <Button loading={restoreMut.isPending} onClick={() => restoreMut.mutate(restoreVid)}>
                <RotateCcw size={14} /> Restore
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
