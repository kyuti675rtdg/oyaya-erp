import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { useAuth } from '../store/auth';
import type { YieldAlert } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import {
  Button,
  EmptyState,
  ErrorBox,
  Field,
  SectionTitle,
  Select,
  Spinner,
  TextArea
} from '../components/ui';
import { fmtDateTime } from '../lib/format';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const ALERT_LABELS: Record<string, string> = {
  LOW_EXTRACTION: 'Low extraction',
  LOW_OUTPUT_VS_PLAN: 'Low output vs plan',
  EXCESS_DOWNTIME: 'Excess downtime'
};

function severityTone(s: string): 'critical' | 'advisory' {
  return s === 'RED' ? 'critical' : 'advisory';
}

export function ProdYieldAlerts() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canApprove = hasClaim('production:approve');

  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [ackId, setAckId] = useState<string | null>(null);
  const [ackNotes, setAckNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const alertsQ = useQuery({
    queryKey: ['prod-yield-alerts', statusFilter, severityFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (severityFilter) params.set('severity', severityFilter);
      const qs = params.toString();
      return (await api.get<YieldAlert[]>(`${E.prodYieldAlerts}${qs ? `?${qs}` : ''}`)).data;
    },
    refetchInterval: 60000
  });

  const alerts = alertsQ.data ?? [];
  const counts = useMemo(() => {
    const open = alerts.filter((a) => a.status === 'OPEN');
    return {
      open: open.length,
      red: open.filter((a) => a.severity === 'RED').length,
      amber: open.filter((a) => a.severity === 'AMBER').length,
      acked: alerts.filter((a) => a.status === 'ACKNOWLEDGED').length
    };
  }, [alerts]);

  const acknowledge = async (e: FormEvent) => {
    e.preventDefault();
    if (!ackId) return;
    setNotice(null);
    setSaving(true);
    try {
      await api.post(E.prodYieldAlertAck(ackId), { ackNotes: ackNotes.trim() || null });
      setNotice({ ok: true, text: 'Alert acknowledged.' });
      setAckId(null);
      setAckNotes('');
      qc.invalidateQueries({ queryKey: ['prod-yield-alerts'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to acknowledge alert.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Production Yield Alerts"
        sub="Low extraction, low output vs plan, excess downtime — acknowledge with production approval"
        action={
          <div className="flex gap-2">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="RESOLVED">Resolved</option>
            </Select>
            <Select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Filter by severity">
              <option value="">All severities</option>
              <option value="RED">Red</option>
              <option value="AMBER">Amber</option>
            </Select>
          </div>
        }
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

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Open alerts', value: counts.open, tone: counts.open > 0 ? 'text-amber-700' : 'text-slate-800' },
          { label: 'Red (critical)', value: counts.red, tone: counts.red > 0 ? 'text-rose-600' : 'text-slate-800' },
          { label: 'Amber (warning)', value: counts.amber, tone: 'text-amber-700' },
          { label: 'Acknowledged', value: counts.acked, tone: 'text-slate-800' }
        ].map((k) => (
          <div key={k.label} className={`${cardShell} !p-4`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{k.label}</p>
            <p className={`tabular-nums mt-1 text-2xl font-bold ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className={cardShell}>
        <CardHeader
          icon={<AlertTriangle size={16} />}
          title="Alerts"
          subtitle="Automatic alerts from flour output, plan completion and downtime"
        />
        {alertsQ.isLoading ? (
          <Spinner label="Loading alerts..." />
        ) : alertsQ.isError ? (
          <ErrorBox message="Failed to load alerts." onRetry={() => alertsQ.refetch()} />
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable<YieldAlert>
                columns={[
                  {
                    key: 'severity',
                    label: 'Severity',
                    render: (r) => <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>
                  },
                  {
                    key: 'alertType',
                    label: 'Type',
                    render: (r) => <span className="font-semibold text-slate-800 dark:text-slate-100">{ALERT_LABELS[r.alertType] ?? r.alertType}</span>
                  },
                  { key: 'message', label: 'Details', render: (r) => <span className="text-sm">{r.message}</span> },
                  { key: 'createdAt', label: 'Raised', render: (r) => fmtDateTime(r.createdAt) },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (r) => {
                      const tone: 'critical' | 'advisory' | 'pass' | 'neutral' =
                        r.status === 'OPEN'
                          ? r.severity === 'RED' ? 'critical' : 'advisory'
                          : r.status === 'ACKNOWLEDGED'
                            ? 'neutral'
                            : 'pass';
                      return <Badge tone={tone}>{r.status}</Badge>;
                    }
                  },
                  {
                    key: 'actions',
                    label: '',
                    render: (r) =>
                      canApprove && r.status === 'OPEN' ? (
                        <button
                          onClick={() => setAckId(r.id)}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-violet-primary hover:underline"
                        >
                          <CheckCircle2 size={13} /> Acknowledge
                        </button>
                      ) : r.status === 'ACKNOWLEDGED' && r.acknowledgedAt ? (
                        <span className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
                          {fmtDateTime(r.acknowledgedAt)}
                        </span>
                      ) : null
                  }
                ]}
                rows={alerts}
                emptyTitle="No alerts"
                emptySub="Yield and downtime alerts appear here automatically."
              />
            </div>
            <div className="space-y-3 md:hidden">
              {alerts.length === 0 ? (
                <EmptyState title="No alerts" sub="Yield and downtime alerts appear here automatically." />
              ) : (
                alerts.map((r) => (
                  <div
                    key={r.id}
                    className={`rounded-xl border p-4 ${
                      r.severity === 'RED' ? 'border-critical-text/50 bg-critical-bg/40' : 'border-slate-200/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>
                      <span className="tabular-nums text-xs text-slate-500 dark:text-slate-400">{fmtDateTime(r.createdAt)}</span>
                    </div>
                    <p className="mt-2 text-sm font-bold text-slate-800 dark:text-slate-100">{ALERT_LABELS[r.alertType] ?? r.alertType}</p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{r.message}</p>
                    {r.status === 'OPEN' ? (
                      <Badge tone="advisory" className="mt-2">Open</Badge>
                    ) : (
                      <Badge tone={r.status === 'ACKNOWLEDGED' ? 'neutral' : 'pass'} className="mt-2">{r.status}</Badge>
                    )}
                    {canApprove && r.status === 'OPEN' ? (
                      <Button variant="secondary" className="mt-3 w-full" onClick={() => setAckId(r.id)}>
                        <CheckCircle2 size={14} /> Acknowledge
                      </Button>
                    ) : null}
                    {r.ackNotes ? <p className="mt-2 text-xs italic text-slate-500 dark:text-slate-400">“{r.ackNotes}”</p> : null}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {ackId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Acknowledge alert</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Confirming you have seen and actioned this alert. Requires production approval rights.
            </p>
            <form onSubmit={acknowledge} className="mt-4 space-y-4">
              <Field label="Acknowledgement notes">
                <TextArea
                  value={ackNotes}
                  onChange={(e) => setAckNotes(e.target.value)}
                  rows={3}
                  placeholder="What was done about it?"
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" loading={saving} className="flex-1">
                  Acknowledge
                </Button>
                <Button type="button" variant="secondary" onClick={() => setAckId(null)} className="flex-1">
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {!canApprove ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Acknowledging alerts requires <span className="font-semibold">production:approve</span> rights.
        </p>
      ) : null}
    </div>
  );
}

