import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, Download, Search, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { AdminNotice, errText } from '../components/AdminModal';
import { Button, Card, Field, SectionTitle, Select, Spinner, TextInput } from '../components/ui';
import { useAuth } from '../store/auth';
import { fmtDateTime } from '../lib/format';

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: unknown;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

interface AuditResponse {
  data: AuditEntry[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const ACTION_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  CREATE: 'pass',
  UPDATE: 'advisory',
  DELETE: 'critical',
  APPROVE: 'pass',
  REJECT: 'critical',
  LOGIN: 'neutral',
  TEST: 'neutral',
  RETRY: 'advisory',
};

function emptyFilters() {
  return { action: '', entityType: '', userId: '', from: '', to: '', search: '' };
}

/**
 * System Audit Logs & Compliance (Module 18).
 * Frontend for the existing /audit-log API: filter by action, entity type,
 * user, date range and free text; paginated table; CSV export.
 */
export function AuditLogs() {
  const [filters, setFilters] = useState(emptyFilters());
  const [applied, setApplied] = useState(emptyFilters());
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const facetsQ = useQuery({
    queryKey: ['audit-facets'],
    queryFn: async () => (await api.get<{ actions: string[]; entityTypes: string[] }>(E.auditLogFacets)).data,
  });

  const buildParams = (p: typeof applied, pageNo: number) => {
    const params = new URLSearchParams();
    params.set('page', String(pageNo));
    params.set('pageSize', '50');
    if (p.action) params.set('action', p.action);
    if (p.entityType) params.set('entityType', p.entityType);
    if (p.userId) params.set('userId', p.userId);
    if (p.from) params.set('from', new Date(p.from).toISOString());
    if (p.to) params.set('to', new Date(p.to).toISOString());
    if (p.search) params.set('search', p.search);
    return params.toString();
  };

  const logsQ = useQuery({
    queryKey: ['audit-logs', applied, page],
    queryFn: async () => (await api.get<AuditResponse>(`${E.auditLogs}?${buildParams(applied, page)}`)).data,
  });

  const apply = () => {
    setApplied(filters);
    setPage(1);
  };

  const clear = () => {
    const f = emptyFilters();
    setFilters(f);
    setApplied(f);
    setPage(1);
  };

  const exportCsv = () => {
    setNotice(null);
    try {
      // The export endpoint streams a CSV attachment through the same
      // authenticated API client base URL.
      const base = api.defaults.baseURL ?? '';
      const qs = buildParams(applied, 1).replace(/page=\d+&?/, '').replace(/pageSize=\d+&?/, '');
      const url = `${base}${E.auditLogExport}${qs ? `?${qs}` : ''}`;
      const token = useAuth.getState().token;
      // Fetch with auth header so the download carries the session.
      fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then(async (res) => {
          if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
          const blob = await res.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setNotice({ ok: true, text: 'Audit log exported as CSV.' });
        })
        .catch((err) => setNotice({ ok: false, text: errText(err, 'Export failed.') }));
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Export failed.') });
    }
  };

  const pagination = logsQ.data?.pagination;
  const rows = logsQ.data?.data ?? [];

  return (
    <div>
      <SectionTitle
        title="System Audit Logs"
        sub="Every audited create, update, delete and approval — filterable and exportable for compliance"
        action={
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />
      <AdminNotice notice={notice} />

      <Card className="mb-4 p-5">
        <CardHeader icon={<Search className="h-4 w-4" />} title="Filters" subtitle="Applied on search" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Action">
            <Select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
              <option value="">All actions</option>
              {(facetsQ.data?.actions ?? []).map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </Select>
          </Field>
          <Field label="Entity type">
            <Select value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}>
              <option value="">All entity types</option>
              {(facetsQ.data?.entityTypes ?? []).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="User ID">
            <TextInput
              value={filters.userId}
              onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
              placeholder="Filter by user id"
            />
          </Field>
          <Field label="From">
            <TextInput type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </Field>
          <Field label="Search">
            <TextInput
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              placeholder="Action, entity, user, changes…"
            />
          </Field>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={apply}>
            <Search className="h-4 w-4" /> Search
          </Button>
          <Button variant="secondary" onClick={clear}>
            <X className="h-4 w-4" /> Clear
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader
          icon={<ScrollText className="h-4 w-4" />}
          title="Audit trail"
          subtitle={pagination ? `${pagination.total} entr${pagination.total === 1 ? 'y' : 'ies'} — page ${pagination.page} of ${pagination.totalPages}` : ''}
        />
        {logsQ.isLoading ? (
          <Spinner label="Loading audit logs..." />
        ) : (
          <>
            <DataTable<AuditEntry>
              columns={[
                { key: 'createdAt', label: 'Timestamp', render: (r) => <span className="whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">{fmtDateTime(r.createdAt)}</span> },
                {
                  key: 'user', label: 'User',
                  render: (r) => (
                    <span className="text-sm">
                      {r.user ? (
                        <>
                          <span className="font-semibold text-ink dark:text-white">{r.user.name}</span>
                          <span className="block text-xs text-slate-400 dark:text-slate-500">{r.user.email}</span>
                        </>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">System</span>
                      )}
                    </span>
                  ),
                },
                { key: 'action', label: 'Action', render: (r) => <Badge tone={ACTION_TONE[r.action] ?? 'neutral'}>{r.action}</Badge> },
                { key: 'entityType', label: 'Entity', render: (r) => <span className="text-sm">{r.entityType}</span> },
                { key: 'entityId', label: 'Entity ID', render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.entityId ?? '—'}</span> },
                {
                  key: 'changes', label: 'Changes',
                  render: (r) => (
                    <span className="block max-w-[320px] truncate font-mono text-xs text-slate-500 dark:text-slate-400" title={JSON.stringify(r.changes ?? {})}>
                      {JSON.stringify(r.changes ?? {})}
                    </span>
                  ),
                },
              ]}
              rows={rows}
              emptyTitle="No audit entries match the filters."
            />
            {pagination && pagination.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span className="text-sm tabular-nums text-slate-500 dark:text-slate-400">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <Button variant="secondary" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
