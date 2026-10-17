import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, MessageSquareText, Save, Eye, EyeOff } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { CardHeader } from '../components/CardHeader';
import { AdminNotice, errText } from '../components/AdminModal';
import { Button, Card, Field, SectionTitle, Spinner, TextInput } from '../components/ui';
import { useAuth } from '../store/auth';

type Notice = { ok: boolean; text: string } | null;

const SMS_KEYS = ['sms.provider', 'sms.afromessageToken', 'sms.senderId'] as const;

const EVENT_DEFS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'sms.notify.intakeCreated', label: 'Intake created', hint: 'Notify when a wheat intake is recorded' },
  { key: 'sms.notify.qcFailed', label: 'QC check failed', hint: 'Notify when a lab check fails a threshold' },
  { key: 'sms.notify.lowStock', label: 'Low stock', hint: 'Notify on low flour / packaging stock alerts' },
  { key: 'sms.notify.payrollRun', label: 'Payroll run completed', hint: 'Notify when a payroll run is posted' },
  { key: 'sms.notify.maintenanceDue', label: 'Maintenance due', hint: 'Notify when preventive maintenance is due' },
];

const ALL_KEYS = [...SMS_KEYS, ...EVENT_DEFS.map((e) => e.key)];

/**
 * Notification & SMS Configuration (Module 18).
 * AfroMessage provider credentials plus per-event notification toggles,
 * persisted in the backend settings store. The actual SMS sending service
 * reads these settings; queued SMS can be inspected under the SMS module.
 */
export function NotificationSettings() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('settings:create');
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);

  const prefsQ = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: async () => (await api.get<Record<string, string>>(E.settingsPreferences)).data,
  });

  useEffect(() => {
    if (prefsQ.data && !initialized) {
      const d: Record<string, string> = {};
      for (const k of ALL_KEYS) d[k] = prefsQ.data[k] ?? '';
      setDraft(d);
      setInitialized(true);
    }
  }, [prefsQ.data, initialized]);

  const save = async () => {
    setNotice(null);
    if (!draft['sms.senderId']?.trim()) {
      setNotice({ ok: false, text: 'Sender ID is required.' });
      return;
    }
    setSaving(true);
    try {
      await api.put(E.settingsPreferences, { ...draft });
      setNotice({ ok: true, text: 'Notification settings saved.' });
      qc.invalidateQueries({ queryKey: ['notification-prefs'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to save notification settings.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Notification & SMS Configuration"
        sub="AfroMessage provider credentials and per-event notification preferences"
        action={
          canManage ? (
            <Button onClick={save} loading={saving} disabled={!initialized}>
              <Save className="h-4 w-4" /> Save settings
            </Button>
          ) : undefined
        }
      />
      <AdminNotice notice={notice} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <CardHeader
            icon={<MessageSquareText className="h-4 w-4" />}
            title="SMS provider — AfroMessage"
            subtitle="Credentials used by the outbound SMS service"
          />
          {!initialized ? (
            <Spinner label="Loading settings..." />
          ) : (
            <div className="space-y-3">
              <Field label="Provider" hint="Only AfroMessage is supported in this deployment.">
                <TextInput value={draft['sms.provider'] || 'afromessage'} disabled />
              </Field>
              <Field label="AfroMessage API token" hint="Stored server-side. Queued SMS send only when a token is configured.">
                <div className="relative">
                  <TextInput
                    type={showToken ? 'text' : 'password'}
                    value={draft['sms.afromessageToken']}
                    onChange={(e) => setDraft({ ...draft, 'sms.afromessageToken': e.target.value })}
                    autoComplete="new-password"
                    placeholder="Paste API token"
                    className="pr-12"
                    disabled={!canManage}
                  />
                  <button
                    type="button"
                    aria-label={showToken ? 'Hide token' : 'Show token'}
                    onClick={() => setShowToken((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-500 hover:bg-slate-100"
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Sender ID" required hint="Shown as the SMS sender name.">
                <TextInput
                  value={draft['sms.senderId']}
                  onChange={(e) => setDraft({ ...draft, 'sms.senderId': e.target.value })}
                  placeholder="Oyaya"
                  disabled={!canManage}
                />
              </Field>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader
            icon={<BellRing className="h-4 w-4" />}
            title="Event notifications"
            subtitle="Choose which ERP events trigger an SMS notification"
          />
          {!initialized ? (
            <Spinner label="Loading settings..." />
          ) : (
            <div className="space-y-2.5">
              {EVENT_DEFS.map((ev) => (
                <div
                  key={ev.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{ev.label}</p>
                    <p className="text-xs text-slate-500">{ev.hint}</p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[#5B35D5]"
                    checked={draft[ev.key] === 'true'}
                    onChange={(e) => setDraft({ ...draft, [ev.key]: String(e.target.checked) })}
                    disabled={!canManage}
                    aria-label={ev.label}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
