import { useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, RefreshCw, Clock3, Gauge, Server } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { AdminNotice, errText } from '../components/AdminModal';
import { Button, Card, SectionTitle, Spinner } from '../components/ui';
import { useAuth } from '../store/auth';
import { fmtDateTime } from '../lib/format';

interface ApiIntegration {
  id: string;
  name: string;
  type: string;
  baseUrl: string | null;
  status: string;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  uptimePct: number | null;
  enabled: boolean;
}

interface HealthLog {
  status: string;
  latencyMs: number | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  online: 'pass',
  degraded: 'advisory',
  offline: 'critical',
  unknown: 'neutral',
};

function toneForLatency(ms: number | null): 'pass' | 'advisory' | 'critical' | 'neutral' {
  if (ms == null) return 'neutral';
  if (ms < 1000) return 'pass';
  if (ms < 3000) return 'advisory';
  return 'critical';
}

function HealthBars({ history }: { history: HealthLog[] }) {
  const last24 = history.slice(0, 24).reverse();
  if (last24.length === 0) return <span className="text-xs text-slate-400 dark:text-slate-500">No checks yet</span>;
  return (
    <div className="flex h-8 items-end gap-[3px]" aria-label="Recent check history">
      {last24.map((h, i) => (
        <div
          key={i}
          title={`${h.status} — ${h.latencyMs ?? '—'} ms — ${fmtDateTime(h.createdAt)}`}
          className={`w-2.5 rounded-sm ${
            h.status === 'online'
              ? 'bg-pass-text/70'
              : h.status === 'degraded'
                ? 'bg-advisory-text/70'
                : 'bg-critical-text/70'
          }`}
          style={{ height: `${h.status === 'online' ? 100 : 45}%` }}
        />
      ))}
    </div>
  );
}

/**
 * API Health & Status Monitoring (Module 18).
 * Live view of integration endpoint health: current status, latency, uptime
 * and the last 24 check results per integration. Runs checks via /api-monitor.
 */
export function ApiHealth() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('settings:create');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);

  const { data: integrations, isLoading } = useQuery({
    queryKey: ['api-integrations'],
    queryFn: async () => (await api.get<ApiIntegration[]>(E.apiIntegrations)).data,
    refetchInterval: 30000,
  });

  const historyQueries = useQueries({
    queries: (integrations ?? []).map((i) => ({
      queryKey: ['api-health', i.id],
      queryFn: async () => (await api.get<HealthLog[]>(E.apiHealthHistory(i.id))).data,
      enabled: true,
      staleTime: 30000,
    })),
  });

  const historyById = useMemo(() => {
    const map = new Map<string, HealthLog[]>();
    (integrations ?? []).forEach((i, idx) => {
      map.set(i.id, historyQueries[idx]?.data ?? []);
    });
    return map;
  }, [integrations, historyQueries]);

  const checkAll = async () => {
    setCheckingAll(true);
    setNotice(null);
    try {
      const enabled = (integrations ?? []).filter((i) => i.enabled);
      await Promise.all(enabled.map((i) => api.post(E.apiHealthCheck(i.id))));
      setNotice({ ok: true, text: `Health check completed for ${enabled.length} integration(s).` });
      qc.invalidateQueries({ queryKey: ['api-integrations'] });
      qc.invalidateQueries({ queryKey: ['api-health'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Health check failed.') });
    } finally {
      setCheckingAll(false);
    }
  };

  const avgLatency = useMemo(() => {
    const vals = (integrations ?? []).map((i) => i.latencyMs).filter((v): v is number => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }, [integrations]);
  const onlineCount = (integrations ?? []).filter((i) => i.status === 'online').length;
  const totalCount = integrations?.length ?? 0;

  return (
    <div>
      <SectionTitle
        title="API Health & Status"
        sub="Live endpoint health, response times and uptime for every external integration"
        action={
          canManage ? (
            <Button onClick={checkAll} loading={checkingAll} disabled={totalCount === 0}>
              <RefreshCw className="h-4 w-4" /> Run health checks
            </Button>
          ) : undefined
        }
      />
      <AdminNotice notice={notice} />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pass-bg text-pass-text">
              <Server className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-bold tabular-nums text-ink dark:text-white">
                {onlineCount}<span className="text-base text-slate-400 dark:text-slate-500">/{totalCount}</span>
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Integrations online</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
              <Gauge className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-bold tabular-nums text-ink dark:text-white">
                {avgLatency != null ? `${avgLatency} ms` : '—'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Average latency</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
              <Clock3 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-bold tabular-nums text-ink dark:text-white">
                {totalCount
                  ? `${(((integrations ?? []).reduce((a, i) => a + (i.uptimePct ?? 0), 0) / totalCount)).toFixed(1)}%`
                  : '—'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Average uptime (rolling)</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <CardHeader
          icon={<Activity className="h-4 w-4" />}
          title="Endpoint status"
          subtitle="Auto-refreshes every 30 seconds. Bars show the last 24 checks."
        />
        {isLoading ? (
          <Spinner label="Loading integration health..." />
        ) : (
          <DataTable<ApiIntegration>
            columns={[
              { key: 'name', label: 'Integration', render: (r) => <span className="font-semibold text-ink dark:text-white">{r.name}</span> },
              { key: 'baseUrl', label: 'Endpoint', render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.baseUrl ?? '—'}</span> },
              {
                key: 'status', label: 'Status',
                render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>,
              },
              {
                key: 'latencyMs', label: 'Latency', mono: true,
                render: (r) => <Badge tone={toneForLatency(r.latencyMs)}>{r.latencyMs != null ? `${r.latencyMs} ms` : '—'}</Badge>,
              },
              { key: 'uptimePct', label: 'Uptime', mono: true, render: (r) => <span className="tabular-nums">{r.uptimePct != null ? `${r.uptimePct.toFixed(1)}%` : '—'}</span> },
              { key: 'lastCheckedAt', label: 'Last check', render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{r.lastCheckedAt ? fmtDateTime(r.lastCheckedAt) : 'Never'}</span> },
              {
                key: 'id', label: 'Recent checks',
                render: (r) => <HealthBars history={historyById.get(r.id) ?? []} />,
              },
            ]}
            rows={integrations ?? []}
            emptyTitle="No integrations configured."
            emptySub="Add one from API Monitoring → Configure integration."
          />
        )}
      </Card>
    </div>
  );
}
