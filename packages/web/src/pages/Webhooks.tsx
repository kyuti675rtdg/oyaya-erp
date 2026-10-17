import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Webhook as WebhookIcon, Plus, Pencil, Trash2, Send, RotateCcw, Power, PowerOff, Eye } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { AdminModal, AdminNotice, errText } from '../components/AdminModal';
import { Button, Card, Field, SectionTitle, Spinner, TextInput } from '../components/ui';
import { useAuth } from '../store/auth';
import { fmtDateTime } from '../lib/format';

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  secret: string | null;
  enabled: boolean;
  deliveryCount: number;
  lastDelivery: { status: string; createdAt: string } | null;
  createdAt: string;
}

interface Delivery {
  id: string;
  event: string;
  status: string;
  attempts: number;
  httpStatus: number | null;
  responseBody: string | null;
  error: string | null;
  createdAt: string;
}

type Notice = { ok: boolean; text: string } | null;

function emptyForm() {
  return { name: '', url: '', secret: '', events: [] as string[], enabled: true };
}

const DELIVERY_TONE: Record<string, 'pass' | 'critical' | 'neutral'> = {
  delivered: 'pass',
  failed: 'critical',
};

/**
 * Webhook Management (Module 18).
 * Outbound webhook CRUD, event subscriptions, delivery log with retry,
 * and a "send test event" action that performs a real delivery attempt.
 */
export function Webhooks() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('settings:create');
  const [notice, setNotice] = useState<Notice>(null);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; hook: Webhook } | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [retryId, setRetryId] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<Webhook | null>(null);

  const hooksQ = useQuery({
    queryKey: ['webhooks'],
    queryFn: async () => (await api.get<Webhook[]>(E.webhooks)).data,
  });
  const eventsQ = useQuery({
    queryKey: ['webhook-events'],
    queryFn: async () => (await api.get<string[]>(E.webhookEvents)).data,
  });
  const deliveriesQ = useQuery({
    queryKey: ['webhook-deliveries', logFor?.id],
    queryFn: async () => (await api.get<Delivery[]>(E.webhookDeliveries(logFor!.id))).data,
    enabled: !!logFor,
  });

  const allEvents = eventsQ.data ?? [];

  const openCreate = () => {
    setNotice(null);
    setForm(emptyForm());
    setModal({ mode: 'create' });
  };
  const openEdit = (hook: Webhook) => {
    setNotice(null);
    setForm({ name: hook.name, url: hook.url, secret: hook.secret ?? '', events: [...hook.events], enabled: hook.enabled });
    setModal({ mode: 'edit', hook });
  };

  const toggleEvent = (ev: string) => {
    setForm((f) => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter((e) => e !== ev) : [...f.events, ev],
    }));
  };

  const save = async () => {
    if (!modal) return;
    setNotice(null);
    if (!form.name.trim()) { setNotice({ ok: false, text: 'Name is required.' }); return; }
    if (!form.url.trim()) { setNotice({ ok: false, text: 'URL is required.' }); return; }
    if (form.events.length === 0) { setNotice({ ok: false, text: 'Select at least one event.' }); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        url: form.url.trim(),
        events: form.events,
        secret: form.secret.trim() || null,
        enabled: form.enabled,
      };
      if (modal.mode === 'create') {
        await api.post(E.webhooks, payload);
        setNotice({ ok: true, text: 'Webhook created.' });
      } else {
        await api.patch(E.webhook(modal.hook.id), payload);
        setNotice({ ok: true, text: 'Webhook updated.' });
      }
      setModal(null);
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to save webhook.') });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (hook: Webhook) => {
    if (!window.confirm(`Delete webhook "${hook.name}"? Delivery history is kept.`)) return;
    setNotice(null);
    try {
      await api.delete(E.webhook(hook.id));
      setNotice({ ok: true, text: 'Webhook deleted.' });
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to delete webhook.') });
    }
  };

  const toggleEnabled = async (hook: Webhook) => {
    setNotice(null);
    try {
      await api.patch(E.webhook(hook.id), { enabled: !hook.enabled });
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to update webhook.') });
    }
  };

  const sendTest = async (hook: Webhook) => {
    setTestingId(hook.id);
    setNotice(null);
    try {
      const res = await api.post<{ status: string; error: string | null }>(E.webhookTest(hook.id));
      setNotice(
        res.data.status === 'delivered'
          ? { ok: true, text: `Test event delivered to ${hook.name}.` }
          : { ok: false, text: `Test delivery failed: ${res.data.error ?? 'unknown error'}. See the delivery log.` }
      );
      qc.invalidateQueries({ queryKey: ['webhooks'] });
      qc.invalidateQueries({ queryKey: ['webhook-deliveries'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Test delivery failed.') });
    } finally {
      setTestingId(null);
    }
  };

  const retry = async (hookId: string, deliveryId: string) => {
    setRetryId(deliveryId);
    setNotice(null);
    try {
      const res = await api.post<{ status: string; error: string | null }>(E.webhookDeliveryRetry(hookId, deliveryId));
      setNotice(
        res.data.status === 'delivered'
          ? { ok: true, text: 'Delivery retried successfully.' }
          : { ok: false, text: `Retry failed: ${res.data.error ?? 'unknown error'}.` }
      );
      qc.invalidateQueries({ queryKey: ['webhook-deliveries'] });
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Retry failed.') });
    } finally {
      setRetryId(null);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Webhook Management"
        sub="Outbound event subscriptions, delivery log and retries"
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> New webhook
            </Button>
          ) : undefined
        }
      />
      <AdminNotice notice={notice} />

      <Card className="p-5">
        <CardHeader
          icon={<WebhookIcon className="h-4 w-4" />}
          title="Configured webhooks"
          subtitle={`${(hooksQ.data ?? []).length} endpoint(s)`}
        />
        {hooksQ.isLoading ? (
          <Spinner label="Loading webhooks..." />
        ) : (
          <DataTable<Webhook>
            columns={[
              { key: 'name', label: 'Name', render: (r) => <span className="font-semibold text-ink">{r.name}</span> },
              { key: 'url', label: 'URL', render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.url}</span> },
              {
                key: 'events', label: 'Events',
                render: (r) => (
                  <div className="flex max-w-[220px] flex-wrap gap-1">
                    {r.events.map((e) => (
                      <span key={e} className="rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 dark:text-slate-300">{e}</span>
                    ))}
                  </div>
                ),
              },
              {
                key: 'enabled', label: 'State',
                render: (r) => <Badge tone={r.enabled ? 'pass' : 'neutral'}>{r.enabled ? 'Enabled' : 'Paused'}</Badge>,
              },
              {
                key: 'lastDelivery', label: 'Last delivery',
                render: (r) =>
                  r.lastDelivery ? (
                    <span className="flex items-center gap-1.5">
                      <Badge tone={DELIVERY_TONE[r.lastDelivery.status] ?? 'neutral'}>{r.lastDelivery.status}</Badge>
                      <span className="text-xs text-slate-400 dark:text-slate-500">{fmtDateTime(r.lastDelivery.createdAt)}</span>
                    </span>
                  ) : (
                    <span className="text-sm text-slate-400 dark:text-slate-500">Never</span>
                  ),
              },
              ...(canManage
                ? [
                    {
                      key: 'id', label: 'Actions',
                      render: (r: Webhook) => (
                        <div className="flex flex-wrap gap-1.5">
                          <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => setLogFor(r)}>
                            <Eye className="h-3.5 w-3.5" /> Log
                          </Button>
                          <Button
                            variant="secondary" className="!px-3 !py-1.5 !text-xs"
                            onClick={() => sendTest(r)} disabled={testingId === r.id}
                          >
                            <Send className="h-3.5 w-3.5" /> {testingId === r.id ? 'Sending…' : 'Test'}
                          </Button>
                          <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => toggleEnabled(r)}>
                            {r.enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                            {r.enabled ? 'Pause' : 'Resume'}
                          </Button>
                          <Button variant="danger" className="!px-3 !py-1.5 !text-xs" onClick={() => remove(r)}>
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </Button>
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
            rows={hooksQ.data ?? []}
            emptyTitle="No webhooks configured."
            emptySub="Add an endpoint to start receiving ERP events."
          />
        )}
      </Card>

      {modal && (
        <AdminModal
          title={modal.mode === 'create' ? 'New webhook' : `Edit webhook — ${modal.hook.name}`}
          onClose={() => setModal(null)}
          wide
        >
          <AdminNotice notice={notice} />
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name" required>
                <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Finance notifier" />
              </Field>
              <Field label="Endpoint URL" required>
                <TextInput value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/hook" />
              </Field>
            </div>
            <Field label="Shared secret" hint="Sent as the X-Webhook-Secret header. Leave blank for none.">
              <TextInput
                type="password"
                value={form.secret}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
                autoComplete="new-password"
                placeholder="Optional secret"
              />
            </Field>
            <Field label="Subscribed events" required>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {allEvents.map((ev) => (
                  <label key={ev} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#5B35D5]"
                      checked={form.events.includes(ev)}
                      onChange={() => toggleEvent(ev)}
                    />
                    <span className="font-mono text-xs">{ev}</span>
                  </label>
                ))}
              </div>
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#5B35D5]"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled (deliveries paused when off)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={save} loading={saving}>{modal.mode === 'create' ? 'Create webhook' : 'Save changes'}</Button>
            </div>
          </div>
        </AdminModal>
      )}

      {logFor && (
        <AdminModal title={`Delivery log — ${logFor.name}`} sub={logFor.url} onClose={() => setLogFor(null)} wide>
          {deliveriesQ.isLoading ? (
            <Spinner label="Loading deliveries..." />
          ) : (
            <DataTable<Delivery>
              columns={[
                { key: 'createdAt', label: 'Time', render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{fmtDateTime(r.createdAt)}</span> },
                { key: 'event', label: 'Event', render: (r) => <span className="font-mono text-xs">{r.event}</span> },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={DELIVERY_TONE[r.status] ?? 'neutral'}>{r.status}</Badge> },
                { key: 'httpStatus', label: 'HTTP', mono: true, render: (r) => <span className="tabular-nums">{r.httpStatus ?? '—'}</span> },
                { key: 'attempts', label: 'Attempts', mono: true, render: (r) => <span className="tabular-nums">{r.attempts}</span> },
                { key: 'error', label: 'Error', render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{r.error ?? '—'}</span> },
                ...(canManage
                  ? [
                      {
                        key: 'id', label: '',
                        render: (r: Delivery) =>
                          r.status === 'failed' ? (
                            <Button
                              variant="secondary" className="!px-3 !py-1.5 !text-xs"
                              onClick={() => retry(logFor.id, r.id)}
                              disabled={retryId === r.id}
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> {retryId === r.id ? 'Retrying…' : 'Retry'}
                            </Button>
                          ) : null,
                      },
                    ]
                  : []),
              ]}
              rows={deliveriesQ.data ?? []}
              emptyTitle="No deliveries yet."
              emptySub="Use “Test” on the webhook row to send a test event."
            />
          )}
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => setLogFor(null)}>Close</Button>
          </div>
        </AdminModal>
      )}
    </div>
  );
}
