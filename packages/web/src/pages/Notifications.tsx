import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell, BellOff, CheckCheck, MessageSquare, Send, Smartphone
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import type { AppNotification, SmsLogEntry } from '../types';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import {
  Button, EmptyState, ErrorBox, SectionTitle, Select, Spinner
} from '../components/ui';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const TYPE_TONE: Record<string, BadgeTone> = {
  info: 'neutral',
  success: 'pass',
  warning: 'advisory',
  alert: 'critical'
};

const SMS_STATUS_TONE: Record<string, BadgeTone> = {
  QUEUED: 'advisory',
  SENT: 'neutral',
  FAILED: 'critical',
  DELIVERED: 'pass'
};

export function Notifications() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'inbox' | 'sms'>('inbox');
  const [typeFilter, setTypeFilter] = useState('');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const notifQ = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get<AppNotification[]>(E.notifications)).data,
    enabled: tab === 'inbox'
  });

  const smsQ = useQuery({
    queryKey: ['sms-log'],
    queryFn: async () => (await api.get<SmsLogEntry[]>(E.smsLog)).data,
    enabled: tab === 'sms'
  });

  const filtered = useMemo(() => {
    return (notifQ.data ?? []).filter(
      (n) => (!typeFilter || n.type === typeFilter) && (!showUnreadOnly || !n.read)
    );
  }, [notifQ.data, typeFilter, showUnreadOnly]);

  const unreadCount = useMemo(() => (notifQ.data ?? []).filter((n) => !n.read).length, [notifQ.data]);

  const readMut = useMutation({
    mutationFn: async (id: string) => api.patch(E.notificationRead(id), {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] })
  });

  const readAllMut = useMutation({
    mutationFn: async () => api.post(E.notificationsReadAll),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] })
  });

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Notifications"
        sub="In-system alerts, SMS log and delivery configuration."
        action={
          tab === 'inbox' && unreadCount > 0 ? (
            <Button variant="secondary" onClick={() => readAllMut.mutate()}>
              <CheckCheck size={14} /> Mark all read
            </Button>
          ) : undefined
        }
      />

      <div className="flex gap-2">
        <Button variant={tab === 'inbox' ? 'primary' : 'secondary'} onClick={() => setTab('inbox')}>
          <Bell size={15} /> In-System {unreadCount > 0 && `(${unreadCount})`}
        </Button>
        <Button variant={tab === 'sms' ? 'primary' : 'secondary'} onClick={() => setTab('sms')}>
          <MessageSquare size={15} /> SMS Log
        </Button>
      </div>

      {tab === 'inbox' && (
        <>
          <div className={`${cardShell} flex flex-col gap-3 sm:flex-row`}>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="sm:w-48">
              <option value="">All types</option>
              <option value="info">Info</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="alert">Alert</option>
            </Select>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={showUnreadOnly} onChange={(e) => setShowUnreadOnly(e.target.checked)} className="rounded" />
              Unread only
            </label>
          </div>

          <div className={cardShell}>
            {notifQ.isLoading ? (
              <Spinner />
            ) : notifQ.isError ? (
              <ErrorBox message="Failed to load notifications." />
            ) : filtered.length === 0 ? (
              <EmptyState
                title="All caught up"
                sub="No notifications match the current filter."
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {filtered.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => !n.read && readMut.mutate(n.id)}
                    className={`flex w-full items-start gap-3 py-3 text-left ${n.read ? 'opacity-70' : ''} hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500`}
                  >
                    <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read ? 'bg-slate-200' : 'bg-violet-500'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-800">
                        {n.title}
                        <Badge tone={TYPE_TONE[n.type] ?? 'neutral'}>{n.type}</Badge>
                      </p>
                      {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
                      <p className="mt-1 text-xs tabular-nums text-slate-400">{fmtDateTime(n.createdAt)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'sms' && (
        <div className="grid grid-cols-12 gap-5">
          <div className={`${cardShell} col-span-12 lg:col-span-8`}>
            <CardHeader icon={<MessageSquare size={16} />} title="SMS Delivery Log" subtitle="AfroMessage outbound history" />
            {smsQ.isLoading ? (
              <Spinner />
            ) : smsQ.isError ? (
              <ErrorBox message="Failed to load SMS log." />
            ) : (smsQ.data ?? []).length === 0 ? (
              <EmptyState title="No SMS sent yet" sub="Alerts queue here until the AfroMessage token is configured." />
            ) : (
              <div className="divide-y divide-slate-100">
                {(smsQ.data ?? []).map((s) => (
                  <div key={s.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-sm font-semibold text-slate-700">{s.to}</p>
                      <Badge tone={SMS_STATUS_TONE[s.status] ?? 'neutral'}>{s.status}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{s.message}</p>
                    <p className="mt-1 text-xs tabular-nums text-slate-400">
                      {s.trigger ? `${s.trigger} · ` : ''}{fmtDateTime(s.createdAt)} · {s.attempts} attempt{s.attempts === 1 ? '' : 's'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="col-span-12 space-y-5 lg:col-span-4">
            <div className={cardShell}>
              <CardHeader icon={<Smartphone size={16} />} title="SMS Configuration" subtitle="AfroMessage provider" />
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Provider</span>
                  <span className="font-semibold text-slate-800">AfroMessage</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">API Token</span>
                  <Badge tone="advisory">Awaiting token</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Queue</span>
                  <span className="font-semibold tabular-nums text-slate-800">
                    {(smsQ.data ?? []).filter((s) => s.status === 'QUEUED').length} queued
                  </span>
                </div>
              </div>
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                SMS alerts queue locally until the AfroMessage API token is provided. Configure it in the API monitor integration settings.
              </p>
            </div>

            <div className={cardShell}>
              <CardHeader icon={<Send size={16} />} title="Notification Templates" subtitle="SMS trigger events" />
              <div className="space-y-2 text-sm">
                {['INTAKE_FLAGGED', 'LOW_YIELD', 'LAB_OVERDUE', 'CONDITIONING_DONE', 'STOCK_LOW', 'TICKET_ESCALATED'].map((t) => (
                  <div key={t} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="font-mono text-xs font-semibold text-slate-700">{t}</span>
                    <Badge tone="pass">Enabled</Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className={cardShell}>
              <CardHeader icon={<BellOff size={16} />} title="Preferences" subtitle="Per-user notification settings" />
              <div className="space-y-3">
                {['Quality alerts', 'Production alerts', 'Ticket updates', 'Announcement digests'].map((p) => (
                  <label key={p} className="flex items-center justify-between text-sm text-slate-700">
                    {p}
                    <input type="checkbox" defaultChecked className="h-4 w-4 rounded accent-violet-600" />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
