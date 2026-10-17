import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, PenLine } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { CardHeader } from '../components/CardHeader';
import { Button, SectionTitle, Select, Spinner } from '../components/ui';
import { Badge } from '../components/Badge';
import type { NcSignoff } from '../types';
import { NC_DECISION_LABEL, NC_SEVERITY_LABEL, cardShell, severityTone, signoffTone } from './NcShared';

export function NcSignOff() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [signing, setSigning] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState('PENDING');

  const queueQ = useQuery({
    queryKey: ['nc-signoffs', fStatus],
    queryFn: async () => {
      const qs = fStatus ? `${E.ncSignoffs}?status=${fStatus}` : E.ncSignoffs;
      return (await api.get<NcSignoff[]>(qs)).data;
    }
  });

  const sign = async (id: string, role: 'quality' | 'production') => {
    setSigning(id);
    setNotice(null);
    try {
      await api.post(E.ncSignoffSign(id), { role });
      setNotice({ ok: true, text: `${role === 'quality' ? 'Quality' : 'Production'} sign-off recorded.` });
      qc.invalidateQueries({ queryKey: ['nc-signoffs'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Sign-off failed.' });
    } finally {
      setSigning(null);
    }
  };

  const rows = useMemo(() => queueQ.data ?? [], [queueQ.data]);

  return (
    <div>
      <SectionTitle
        title="Quality & Production Sign-Off"
        sub="Dual sign-off queue — both quality and production must sign NC closures and dispositions"
      />

      {notice ? (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
            notice.ok
              ? 'border-pass-text/30 bg-pass-bg text-pass-text'
              : 'border-critical-text/30 bg-critical-bg text-critical-text'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className={cardShell}>
        <CardHeader
          icon={<ClipboardCheck size={16} />}
          title="Sign-off queue"
          subtitle="Pending requests need both signatures to complete"
          action={
            <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter by status">
              <option value="PENDING">Pending</option>
              <option value="COMPLETED">Completed</option>
              <option value="">All</option>
            </Select>
          }
        />

        {queueQ.isLoading ? (
          <Spinner label="Loading sign-off queue..." />
        ) : queueQ.isError ? (
          <div className="rounded-xl border border-critical-text/30 bg-critical-bg px-4 py-6 text-center text-sm text-critical-text">
            Failed to load the queue. Check your connection and retry.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-alabaster px-6 py-10 text-center">
            <p className="font-semibold text-slate-700 dark:text-slate-200">Queue is clear</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {fStatus === 'PENDING' ? 'No pending sign-off requests.' : 'No sign-off requests found.'}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr>
                      {['NC', 'Kind', 'Severity', 'Disposition', 'Quality', 'Production', 'Status', ''].map((h) => (
                        <th key={h} className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id} className="border-t border-line hover:bg-alabaster">
                        <td className="px-4 py-3">
                          <span className="font-bold tabular-nums text-ink">{s.nc?.ncNo ?? '—'}</span>
                          <span className="block max-w-xs truncate text-xs text-slate-500 dark:text-slate-400" title={s.nc?.description}>
                            {s.nc?.description}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={s.kind === 'CLOSURE' ? 'critical' : 'advisory'}>
                            {s.kind === 'CLOSURE' ? 'Closure' : 'Disposition'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {s.nc ? <Badge tone={severityTone(s.nc.severity)}>{NC_SEVERITY_LABEL[s.nc.severity]}</Badge> : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                          {s.nc?.disposition ? NC_DECISION_LABEL[s.nc.disposition.decision] : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {s.qualitySignById ? (
                            <span className="text-pass-text font-semibold">{fmtDateTime(s.qualitySignedAt)}</span>
                          ) : s.status === 'PENDING' ? (
                            <Button
                              variant="secondary"
                              className="px-3 py-2 text-xs"
                              disabled={signing === s.id}
                              onClick={() => sign(s.id, 'quality')}
                            >
                              <PenLine size={12} /> {signing === s.id ? 'Signing…' : 'Sign'}
                            </Button>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {s.productionSignById ? (
                            <span className="text-pass-text font-semibold">{fmtDateTime(s.productionSignedAt)}</span>
                          ) : s.status === 'PENDING' ? (
                            <Button
                              variant="secondary"
                              className="px-3 py-2 text-xs"
                              disabled={signing === s.id}
                              onClick={() => sign(s.id, 'production')}
                            >
                              <PenLine size={12} /> {signing === s.id ? 'Signing…' : 'Sign'}
                            </Button>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={signoffTone(s.status)}>{s.status === 'PENDING' ? 'Pending' : 'Completed'}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400 dark:text-slate-500 tabular-nums">{fmtDateTime(s.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="space-y-3 md:hidden">
              {rows.map((s) => (
                <div key={s.id} className="rounded-xl border border-line bg-white dark:bg-slate-800 p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold tabular-nums text-ink">{s.nc?.ncNo ?? '—'}</span>
                    <Badge tone={signoffTone(s.status)}>{s.status === 'PENDING' ? 'Pending' : 'Completed'}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{s.nc?.description}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {s.kind === 'CLOSURE' ? 'Closure' : 'Disposition'} sign-off
                    {s.nc?.disposition ? ` · ${NC_DECISION_LABEL[s.nc.disposition.decision]}` : ''}
                  </p>
                  {s.status === 'PENDING' ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        variant="secondary"
                        className="px-3 py-2 text-sm"
                        disabled={!!s.qualitySignById || signing === s.id}
                        onClick={() => sign(s.id, 'quality')}
                      >
                        {s.qualitySignById ? 'Q signed' : 'Quality sign'}
                      </Button>
                      <Button
                        variant="secondary"
                        className="px-3 py-2 text-sm"
                        disabled={!!s.productionSignById || signing === s.id}
                        onClick={() => sign(s.id, 'production')}
                      >
                        {s.productionSignById ? 'P signed' : 'Production sign'}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
