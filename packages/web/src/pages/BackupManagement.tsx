import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, Download, Save, Info, CalendarClock, HardDrive } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { AdminNotice, errText } from '../components/AdminModal';
import { Button, Card, Field, NumberInput, SectionTitle, Spinner, TextInput } from '../components/ui';
import { useAuth } from '../store/auth';

type Notice = { ok: boolean; text: string } | null;

interface BackupStatus {
  schedule: string;
  retentionDays: number;
  manualSupported: boolean;
  message: string;
}

const EXPORT_LINKS: Array<{ label: string; hint: string; path: string }> = [
  { label: 'Audit log (CSV)', hint: 'Full audited change history', path: E.auditLogExport },
  { label: 'SMS logs', hint: 'Via SMS module — /sms/logs', path: '/sms/logs' },
];

/**
 * Backup & Data Management (Module 18).
 * Shows the automated backup schedule and retention policy; manual
 * on-demand backup is NOT supported by the backend and is labelled
 * honestly. Master-data exports link to the existing CSV endpoints.
 */
export function BackupManagement() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('settings:create');
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState({ schedule: '', retentionDays: '' });
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  const statusQ = useQuery({
    queryKey: ['backup-status'],
    queryFn: async () => (await api.get<BackupStatus>(E.settingsBackupStatus)).data,
  });

  useEffect(() => {
    if (statusQ.data && !initialized) {
      setDraft({ schedule: statusQ.data.schedule, retentionDays: String(statusQ.data.retentionDays) });
      setInitialized(true);
    }
  }, [statusQ.data, initialized]);

  const save = async () => {
    setNotice(null);
    const days = Number(draft.retentionDays);
    if (!draft.schedule.trim()) { setNotice({ ok: false, text: 'Schedule is required.' }); return; }
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      setNotice({ ok: false, text: 'Retention must be between 1 and 3650 days.' });
      return;
    }
    setSaving(true);
    try {
      await api.put(E.settingsPreferences, {
        'backup.schedule': draft.schedule.trim(),
        'backup.retentionDays': String(days),
      });
      setNotice({ ok: true, text: 'Backup schedule & retention policy saved.' });
      qc.invalidateQueries({ queryKey: ['backup-status'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to save backup settings.') });
    } finally {
      setSaving(false);
    }
  };

  const downloadExport = (path: string, filename: string) => {
    setNotice(null);
    const base = api.defaults.baseURL ?? '';
    const token = useAuth.getState().token;
    fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setNotice({ ok: true, text: `${filename} downloaded.` });
      })
      .catch((err) => setNotice({ ok: false, text: errText(err, 'Export failed.') }));
  };

  return (
    <div>
      <SectionTitle
        title="Backup & Data Management"
        sub="Automated backup schedule, retention policy and master-data exports"
      />
      <AdminNotice notice={notice} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <CardHeader
            icon={<DatabaseBackup className="h-4 w-4" />}
            title="Automated backups"
            subtitle="Database dump schedule and retention"
            action={
              canManage ? (
                <Button onClick={save} loading={saving} disabled={!initialized}>
                  <Save className="h-4 w-4" /> Save
                </Button>
              ) : undefined
            }
          />
          {statusQ.isLoading || !initialized ? (
            <Spinner label="Loading backup status..." />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-line p-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pass-bg text-pass-text">
                  <CalendarClock className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <Field label="Backup schedule">
                    <TextInput
                      value={draft.schedule}
                      onChange={(e) => setDraft({ ...draft, schedule: e.target.value })}
                      placeholder="daily 02:00 EAT"
                      disabled={!canManage}
                    />
                  </Field>
                </div>
              </div>
              <Field label="Retention (days)" hint="How long automated dumps are kept">
                <NumberInput
                  value={draft.retentionDays}
                  onChange={(e) => setDraft({ ...draft, retentionDays: e.target.value })}
                  min={1}
                  max={3650}
                  disabled={!canManage}
                />
              </Field>
              <div className="flex items-center gap-3 rounded-xl border border-line p-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <HardDrive className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Manual backup</p>
                  <Badge tone={statusQ.data?.manualSupported ? 'pass' : 'neutral'}>
                    {statusQ.data?.manualSupported ? 'Supported' : 'Not supported'}
                  </Badge>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-xl border border-advisory-text/30 bg-advisory-bg px-3 py-2.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-advisory-text" />
                <p className="text-xs text-advisory-text">{statusQ.data?.message}</p>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader
            icon={<Download className="h-4 w-4" />}
            title="Data exports"
            subtitle="Download master data as CSV for offline records"
          />
          <div className="space-y-2.5">
            {EXPORT_LINKS.map((l) => (
              <div
                key={l.path}
                className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-800">{l.label}</p>
                  <p className="text-xs text-slate-500">{l.hint}</p>
                </div>
                <Button
                  variant="secondary"
                  className="!px-3 !py-1.5 !text-xs"
                  onClick={() =>
                    downloadExport(l.path, `${l.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`)
                  }
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-alabaster px-3 py-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <p className="text-xs text-slate-600">
              Full database dumps are produced by the automated backup workflow, not from this screen.
              More entity-level CSV exports (suppliers, products, employees) can be added on request.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
