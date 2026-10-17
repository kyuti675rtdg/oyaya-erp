import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { AdminModal, AdminNotice, errText } from '../components/AdminModal';
import { Button, Card, Field, SectionTitle, Select, Spinner, TextInput } from '../components/ui';
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
  const { hasClaim } = useAuth();
  const canManage = hasClaim('settings:create');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; integration: ApiIntegration } | null>(null);
  const [form, setForm] = useState({ name: '', type: 'sms', baseUrl: '', enabled: true });
  const [saving, setSaving] = useState(false);

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

  // ── Module 18: integration configuration (create/edit/delete) ──

  const openCreate = () => {
    setNotice(null);
    setForm({ name: '', type: 'sms', baseUrl: '', enabled: true });
    setModal({ mode: 'create' });
  };

  const openEdit = (integration: ApiIntegration) => {
    setNotice(null);
    setForm({
      name: integration.name,
      type: integration.type,
      baseUrl: integration.baseUrl ?? '',
      enabled: integration.enabled,
    });
    setModal({ mode: 'edit', integration });
  };

  const saveIntegration = async () => {
    if (!modal) return;
    setNotice(null);
    if (!form.name.trim()) { setNotice({ ok: false, text: 'Name is required.' }); return; }
    if (form.baseUrl.trim()) {
      try { new URL(form.baseUrl.trim()); }
      catch { setNotice({ ok: false, text: 'Base URL is not a valid URL.' }); return; }
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        baseUrl: form.baseUrl.trim() || null,
        enabled: form.enabled,
      };
      if (modal.mode === 'create') {
        await api.post(E.apiIntegrations, payload);
        setNotice({ ok: true, text: 'Integration added.' });
      } else {
        await api.patch(E.apiIntegration(modal.integration.id), payload);
        setNotice({ ok: true, text: 'Integration updated.' });
      }
      setModal(null);
      qc.invalidateQueries({ queryKey: ['api-integrations'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to save integration.') });
    } finally {
      setSaving(false);
    }
  };

  const removeIntegration = async (integration: ApiIntegration) => {
    if (!window.confirm(`Delete integration "${integration.name}"? Health history is kept.`)) return;
    setNotice(null);
    try {
      await api.delete(E.apiIntegration(integration.id));
      setNotice({ ok: true, text: 'Integration deleted.' });
      qc.invalidateQueries({ queryKey: ['api-integrations'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to delete integration.') });
    }
  };

  return (
    <div className="space-y-6">
      <SectionTitle
        title="API Management & Monitoring"
        sub="External integration health, latency, and uptime. Auto-refreshes every 30 seconds."
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Configure integration
            </Button>
          ) : undefined
        }
      />

      <AdminNotice notice={notice} />

      <Card className="p-5">
        <CardHeader
          icon={<Plug className="h-4 w-4" />}
          title="Integrations"
          subtitle="AfroMessage SMS, ZKTeco and other external services — status at a glance"
        />
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable<ApiIntegration>
            columns={[
              { key: 'name', label: 'Integration', render: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'type', label: 'Type', render: (r) => <span className="text-sm capitalize">{r.type}</span> },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge> },
              {
                key: 'enabled', label: 'State',
                render: (r) => <Badge tone={r.enabled ? 'pass' : 'neutral'}>{r.enabled ? 'Enabled' : 'Paused'}</Badge>,
              },
              { key: 'latencyMs', label: 'Latency', render: (r) => <span className="text-sm">{r.latencyMs != null ? `${r.latencyMs} ms` : '—'}</span> },
              { key: 'uptimePct', label: 'Uptime', render: (r) => <span className="text-sm">{r.uptimePct != null ? `${r.uptimePct.toFixed(1)}%` : '—'}</span> },
              { key: 'lastCheckedAt', label: 'Last Check', render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{r.lastCheckedAt ? fmtDateTime(r.lastCheckedAt) : 'Never'}</span> },
              {
                key: 'id', label: 'Actions',
                render: (r) => (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => setHistoryId(r.id)}>History</Button>
                    <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" disabled={checking === r.id} onClick={() => check(r.id)}>
                      {checking === r.id ? '…' : 'Check now'}
                    </Button>
                    {canManage && (
                      <>
                        <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => openEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button variant="danger" className="!px-3 !py-1.5 !text-xs" onClick={() => removeIntegration(r)}>
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
            rows={data ?? []}
            emptyTitle="No integrations configured."
            emptySub="Use “Configure integration” to add AfroMessage SMS or a ZKTeco device."
          />
        )}
      </Card>

      {modal && (
        <AdminModal
          title={modal.mode === 'create' ? 'Configure integration' : `Edit integration — ${modal.integration.name}`}
          onClose={() => setModal(null)}
        >
          <AdminNotice notice={notice} />
          <div className="space-y-3">
            <Field label="Name" required>
              <TextInput
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. AfroMessage SMS"
              />
            </Field>
            <Field label="Type">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="sms">SMS (AfroMessage)</option>
                <option value="biometric">Biometric / attendance (ZKTeco)</option>
                <option value="webhook">Webhook</option>
                <option value="custom">Custom API</option>
              </Select>
            </Field>
            <Field label="Base URL" hint="Health checks ping this URL. Leave blank to skip ping checks.">
              <TextInput
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://api.afromessage.com"
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#5B35D5]"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled (health checks paused when off)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={saveIntegration} loading={saving}>
                {modal.mode === 'create' ? 'Add integration' : 'Save changes'}
              </Button>
            </div>
          </div>
        </AdminModal>
      )}

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
              { key: 'message', label: 'Message', render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{r.message ?? '—'}</span> },
            ]}
            rows={(history ?? []).map((h, i) => ({ ...h, id: String(i) }))}
            emptyTitle="No history yet."
          />
        </Card>
      )}
    </div>
  );
}
