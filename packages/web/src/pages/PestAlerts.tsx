import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { PestAlert } from '../types';
import { Badge } from '../components/Badge';
import { Button, ErrorBox, Field, SectionTitle, Select, Spinner } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { AlertSeverityBadge, cardShell, PestCardHeader, PestKpi, pretty } from './PestCommon';

const ALERT_TYPE_LABEL: Record<string, string> = {
  OVERDUE_INSPECTION: 'Overdue inspection',
  PERSISTENT_INFESTATION: 'Persistent infestation',
  TREATMENT_DUE: 'Treatment due'
};

export function PestAlerts() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('pest:manage');

  const [showAcknowledged, setShowAcknowledged] = useState<'open' | 'acked' | 'all'>('open');
  const [severityFilter, setSeverityFilter] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const alertsQ = useQuery({
    queryKey: ['pest-alerts', showAcknowledged, severityFilter || undefined],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (showAcknowledged === 'open') params.acknowledged = 'false';
      else if (showAcknowledged === 'acked') params.acknowledged = 'true';
      if (severityFilter) params.severity = severityFilter;
      return (await api.get<PestAlert[]>(E.pestAlerts, { params })).data;
    }
  });

  const kpis = useMemo(() => {
    const all = alertsQ.data ?? [];
    const open = all.filter((x) => !x.acknowledged);
    return {
      open: open.length,
      critical: open.filter((x) => x.severity === 'CRITICAL').length,
      warning: open.filter((x) => x.severity === 'WARNING').length,
      acked: all.filter((x) => x.acknowledged).length
    };
  }, [alertsQ.data]);

  const refresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const res = await api.post<{ created: number }>(E.pestAlertsRefresh, {});
      setNotice({
        ok: true,
        text: res.data.created > 0 ? `${res.data.created} new alert(s) raised.` : 'Alerts refreshed — nothing new.'
      });
      qc.invalidateQueries({ queryKey: ['pest-alerts'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Refresh failed.' });
    } finally {
      setRefreshing(false);
    }
  };

  const acknowledge = async (id: string) => {
    try {
      await api.post(E.pestAlertAcknowledge(id), {});
      qc.invalidateQueries({ queryKey: ['pest-alerts'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Acknowledge failed.' });
    }
  };

  return (
    <div>
      <SectionTitle
        title="Pest Control Alerts"
        sub="Overdue inspections, persistent infestations and due treatments — acknowledge when handled"
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

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <PestKpi label="Open alerts" value={kpis.open} tone="violet" sub="Need attention" />
        <PestKpi label="Critical" value={kpis.critical} tone="rose" sub="Escalate urgently" />
        <PestKpi label="Warning" value={kpis.warning} tone="amber" sub="Due soon / overdue" />
        <PestKpi label="Acknowledged" value={kpis.acked} tone="emerald" sub="Handled" />
      </div>

      <div className={cardShell}>
        <PestCardHeader
          icon={<Bell size={16} />}
          title="Alert center"
          subtitle="Derived from inspection schedules, follow-ups and evidence"
          action={
            canManage ? (
              <Button onClick={refresh} loading={refreshing} className="px-4 py-2 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <RefreshCw size={14} /> Refresh alerts
                </span>
              </Button>
            ) : null
          }
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Show">
            <Select value={showAcknowledged} onChange={(e) => setShowAcknowledged(e.target.value as typeof showAcknowledged)}>
              <option value="open">Open alerts</option>
              <option value="acked">Acknowledged</option>
              <option value="all">All</option>
            </Select>
          </Field>
          <Field label="Severity">
            <Select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
              <option value="">All severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="WARNING">Warning</option>
              <option value="INFO">Info</option>
            </Select>
          </Field>
        </div>

        <div className="mt-4">
          {alertsQ.isLoading ? (
            <Spinner label="Loading alerts..." />
          ) : alertsQ.isError ? (
            <ErrorBox message="Could not load alerts." onRetry={() => alertsQ.refetch()} />
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable<PestAlert>
                  columns={[
                    {
                      key: 'severity',
                      label: 'Severity',
                      render: (r) => <AlertSeverityBadge severity={r.severity} />
                    },
                    {
                      key: 'type',
                      label: 'Type',
                      render: (r) => <span className="font-semibold text-sm">{ALERT_TYPE_LABEL[r.type] ?? pretty(r.type)}</span>
                    },
                    { key: 'message', label: 'Message', render: (r) => <span className="block max-w-md text-sm">{r.message}</span> },
                    { key: 'createdAt', label: 'Raised', render: (r) => <span className="tnum">{fmtDateTime(r.createdAt)}</span>, mono: true },
                    {
                      key: 'status',
                      label: 'Status',
                      render: (r) =>
                        r.acknowledged ? (
                          <Badge tone="pass">Acknowledged</Badge>
                        ) : (
                          <Badge tone="neutral">Open</Badge>
                        )
                    },
                    {
                      key: 'actions',
                      label: '',
                      render: (r) =>
                        canManage && !r.acknowledged ? (
                          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => acknowledge(r.id)}>
                            Acknowledge
                          </Button>
                        ) : null
                    }
                  ]}
                  rows={alertsQ.data ?? []}
                  emptyTitle="No alerts"
                  emptySub="The alert center is quiet. Refresh to re-scan schedules and follow-ups."
                />
              </div>
              <div className="space-y-3 md:hidden">
                {(alertsQ.data ?? []).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    No alerts.
                  </div>
                ) : (
                  (alertsQ.data ?? []).map((r) => (
                    <div key={r.id} className={cardShell}>
                      <div className="flex items-start justify-between gap-2">
                        <AlertSeverityBadge severity={r.severity} />
                        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{fmtDateTime(r.createdAt)}</span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{ALERT_TYPE_LABEL[r.type] ?? pretty(r.type)}</p>
                      <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{r.message}</p>
                      {canManage && !r.acknowledged ? (
                        <Button variant="secondary" className="mt-3 w-full py-2 text-xs" onClick={() => acknowledge(r.id)}>
                          Acknowledge
                        </Button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
