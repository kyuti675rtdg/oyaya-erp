import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Button, Card, SectionTitle, Spinner } from '../components/ui';
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
  message: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  online: 'pass',
  degraded: 'advisory',
  offline: 'critical',
  unknown: 'neutral',
};

export function ApiMonitor() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['api-integrations'],
    queryFn: async () => (await api.get<ApiIntegration[]>(E.apiIntegrations)).data,
    refetchInterval: 30000,
  });

  const { data: history } = useQuery({
    queryKey: ['api-health', historyId],
    queryFn: async () => (await api.get<HealthLog[]>(E.apiHealthHistory(historyId!))).data,
    enabled: !!historyId,
  });

  const check = async (id: string) => {
    setChecking(id);
    setNotice(null);
    try {
      await api.post(E.apiHealthCheck(id));
      setNotice({ ok: true, text: 'Health check completed.' });
      qc.invalidateQueries({ queryKey: ['api-integrations'] });
    } catch {
      setNotice({ ok: false, text: 'Health check failed.' });
    } finally {
      setChecking(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionTitle
        title="API Management & Monitoring"
        sub="External integration health, latency, and uptime. Auto-refreshes every 30 seconds."
      />

      {notice && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${notice.ok ? 'bg-pass-bg text-pass-text' : 'bg-critical-bg text-critical-text'}`}>
          {notice.text}
        </div>
      )}

      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable<ApiIntegration>
            columns={[
              { key: 'name', label: 'Integration', render: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'type', label: 'Type', render: (r) => <span className="text-sm capitalize">{r.type}</span> },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge> },
              { key: 'latencyMs', label: 'Latency', render: (r) => <span className="text-sm">{r.latencyMs != null ? `${r.latencyMs} ms` : '—'}</span> },
              { key: 'uptimePct', label: 'Uptime', render: (r) => <span className="text-sm">{r.uptimePct != null ? `${r.uptimePct.toFixed(1)}%` : '—'}</span> },
              { key: 'lastCheckedAt', label: 'Last Check', render: (r) => <span className="text-sm text-slate-500">{r.lastCheckedAt ? fmtDateTime(r.lastCheckedAt) : 'Never'}</span> },
              {
                key: 'id', label: '',
                render: (r) => (
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setHistoryId(r.id)}>History</Button>
                    <Button disabled={checking === r.id} onClick={() => check(r.id)}>
                      {checking === r.id ? '…' : 'Check now'}
                    </Button>
                  </div>
                ),
              },
            ]}
            rows={data ?? []}
            emptyTitle="No integrations configured."
          />
        )}
      </Card>

      {historyId && (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold">Health History</h3>
            <Button variant="secondary" onClick={() => setHistoryId(null)}>Close</Button>
          </div>
          <DataTable<HealthLog & { id: string }>
            columns={[
              { key: 'createdAt', label: 'Time', render: (r) => <span className="text-sm">{fmtDateTime(r.createdAt)}</span> },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge> },
              { key: 'latencyMs', label: 'Latency', render: (r) => <span className="text-sm">{r.latencyMs != null ? `${r.latencyMs} ms` : '—'}</span> },
              { key: 'message', label: 'Message', render: (r) => <span className="text-sm text-slate-500">{r.message ?? '—'}</span> },
            ]}
            rows={(history ?? []).map((h, i) => ({ ...h, id: String(i) }))}
            emptyTitle="No history yet."
          />
        </Card>
      )}
    </div>
  );
}
