import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArchiveRestore, CalendarClock, Download, FileText } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Document } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, Spinner } from '../components/ui';
import { cardShell, fileKindLabel, formatFileSize } from './DocShared';

const RETENTION_PERIODS = [
  { label: '1 year', days: 365 },
  { label: '3 years', days: 365 * 3 },
  { label: '5 years', days: 365 * 5 },
  { label: '7 years', days: 365 * 7 },
  { label: '10 years', days: 365 * 10 },
];

export function DocArchive() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('documents:manage');
  const [retentionDoc, setRetentionDoc] = useState<Document | null>(null);

  const archivedQ = useQuery({
    queryKey: ['documents', 'archived'],
    queryFn: async () => (await api.get<Document[]>(E.docLib + '?archived=true')).data,
  });

  const activeQ = useQuery({
    queryKey: ['documents', 'retention'],
    queryFn: async () => (await api.get<Document[]>(E.docLib + '?archived=false')).data,
  });

  const expiring = useMemo(() => {
    const now = new Date();
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    return (activeQ.data ?? []).filter((d) => {
      if (!d.retentionUntil) return false;
      const r = new Date(d.retentionUntil);
      return r <= soon;
    }).sort((a, b) => new Date(a.retentionUntil!).getTime() - new Date(b.retentionUntil!).getTime());
  }, [activeQ.data]);

  const restoreMut = useMutation({
    mutationFn: async (id: string) => (await api.post(E.docRestore(id), {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  const setRetentionMut = useMutation({
    mutationFn: async ({ id, days }: { id: string; days: number }) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return (await api.patch(E.docItem(id), { retentionUntil: d.toISOString().slice(0, 10) })).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      setRetentionDoc(null);
    },
  });

  const download = (doc: Document) => {
    window.open(`${api.defaults.baseURL}${E.docDownload(doc.id)}`, '_blank');
  };

  return (
    <div className="space-y-5">
      {expiring.length > 0 ? (
        <div className={`${cardShell} !border-amber-200 bg-amber-50/50`}>
          <CardHeader icon={<AlertTriangle size={16} />} title="Retention Expiry Alerts" subtitle={`${expiring.length} document(s) expire within 30 days`} />
          <div className="divide-y divide-amber-100">
            {expiring.map((d) => {
              const overdue = new Date(d.retentionUntil!) < new Date();
              return (
                <div key={d.id} className="flex items-center gap-3 py-2.5">
                  <FileText size={16} className="shrink-0 text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{d.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {d.docNo} · expires {fmtDate(d.retentionUntil)}
                    </p>
                  </div>
                  <Badge tone={overdue ? 'critical' : 'advisory'}>{overdue ? 'Expired' : 'Expiring'}</Badge>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => setRetentionDoc(d)}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                    >
                      Extend
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className={cardShell}>
        <CardHeader
          icon={<CalendarClock size={16} />}
          title="Retention Policies"
          subtitle="Set how long active documents must be kept"
        />
        {activeQ.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner label="Loading…" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {RETENTION_PERIODS.map((p) => {
              const count = (activeQ.data ?? []).filter((d) => {
                if (!d.retentionUntil) return false;
                const diff = Math.round((new Date(d.retentionUntil).getTime() - Date.now()) / 86400000);
                return diff >= p.days - 60 && diff <= p.days + 60;
              }).length;
              return (
                <div key={p.label} className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 p-3 text-center">
                  <p className="text-lg font-extrabold tabular-nums text-slate-800 dark:text-slate-100">{count}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{p.label} retention</p>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Assign a retention period per document from the library or the expiring list above.
        </p>
      </div>

      <div className={cardShell}>
        <CardHeader icon={<ArchiveRestore size={16} />} title="Archived Documents" subtitle={`${(archivedQ.data ?? []).length} in archive`} />
        {archivedQ.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner label="Loading archive…" />
          </div>
        ) : archivedQ.isError ? (
          <ErrorBox message="Failed to load archive." onRetry={() => archivedQ.refetch()} />
        ) : (archivedQ.data ?? []).length === 0 ? (
          <EmptyState title="Archive is empty" sub="Archived documents will appear here." />
        ) : (
          <div className="divide-y divide-slate-50">
            {(archivedQ.data ?? []).map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                  <FileText size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{d.title}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {d.docNo} · v{d.version} · {fileKindLabel(d.mimeType, d.fileName)} · {formatFileSize(d.fileSize)} · archived {fmtDate(d.updatedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => download(d)}
                  title="Download"
                  className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-violet-50 hover:text-violet-700"
                >
                  <Download size={15} />
                </button>
                {canManage ? (
                  <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => restoreMut.mutate(d.id)} loading={restoreMut.isPending}>
                    <ArchiveRestore size={13} /> Restore
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {retentionDoc ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className={`${cardShell} w-full max-w-sm space-y-4 !p-6`}>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Set Retention Period</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">{retentionDoc.title}</p>
            <div className="grid grid-cols-2 gap-2">
              {RETENTION_PERIODS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setRetentionMut.mutate({ id: retentionDoc.id, days: p.days })}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:border-violet-300 hover:bg-violet-50"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setRetentionDoc(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
