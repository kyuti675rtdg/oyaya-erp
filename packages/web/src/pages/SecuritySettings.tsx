import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Fingerprint, Save, Info } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { AdminNotice, errText } from '../components/AdminModal';
import { Button, Card, Field, NumberInput, SectionTitle, Spinner } from '../components/ui';
import { useAuth } from '../store/auth';

type Notice = { ok: boolean; text: string } | null;

interface AdminUserLite {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  mfaEnabled: boolean;
  role: { name: string };
}

const PREF_KEYS = [
  'security.minPasswordLength',
  'security.requireUppercase',
  'security.requireLowercase',
  'security.requireDigit',
  'security.requireSymbol',
  'security.passwordExpiryDays',
  'security.sessionTimeoutMin',
  'security.maxLoginAttempts',
  'security.lockoutMinutes',
] as const;

function BoolRow({
  label, hint, value, onChange, disabled
}: {
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</p>
        {hint ? <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
      </div>
      <input
        type="checkbox"
        className="h-5 w-5 accent-[#5B35D5]"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * Security & MFA (Module 18).
 * Password policy + session/lockout configuration are persisted to the
 * backend settings store. Lockout attempt counting, session expiry
 * enforcement and TOTP MFA enrollment are NOT yet implemented in the
 * auth backend — the UI states that honestly instead of faking status.
 */
export function SecuritySettings() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('settings:create');
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const prefsQ = useQuery({
    queryKey: ['security-prefs'],
    queryFn: async () => (await api.get<Record<string, string>>(E.settingsPreferences)).data,
  });
  const usersQ = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await api.get<AdminUserLite[]>(E.users)).data,
  });

  useEffect(() => {
    if (prefsQ.data && !initialized) {
      const d: Record<string, string> = {};
      for (const k of PREF_KEYS) d[k] = prefsQ.data[k] ?? '';
      setDraft(d);
      setInitialized(true);
    }
  }, [prefsQ.data, initialized]);

  const save = async () => {
    setNotice(null);
    const minLen = Number(draft['security.minPasswordLength']);
    if (!Number.isFinite(minLen) || minLen < 6 || minLen > 32) {
      setNotice({ ok: false, text: 'Minimum password length must be between 6 and 32.' });
      return;
    }
    for (const k of ['security.passwordExpiryDays', 'security.sessionTimeoutMin', 'security.maxLoginAttempts', 'security.lockoutMinutes']) {
      const v = Number(draft[k]);
      if (!Number.isFinite(v) || v < 0) {
        setNotice({ ok: false, text: `${k.replace('security.', '')} must be a non-negative number.` });
        return;
      }
    }
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      for (const k of PREF_KEYS) payload[k] = draft[k] ?? '';
      await api.put(E.settingsPreferences, payload);
      setNotice({ ok: true, text: 'Security policy saved.' });
      qc.invalidateQueries({ queryKey: ['security-prefs'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to save security policy.') });
    } finally {
      setSaving(false);
    }
  };

  const users = usersQ.data ?? [];
  const mfaOn = users.filter((u) => u.mfaEnabled).length;

  return (
    <div>
      <SectionTitle
        title="Security & MFA"
        sub="Password policy, session & lockout configuration, and per-user MFA status"
      />
      <AdminNotice notice={notice} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <CardHeader
            icon={<ShieldAlert className="h-4 w-4" />}
            title="Password policy"
            subtitle="Applies to new passwords set by administrators"
            action={
              canManage ? (
                <Button onClick={save} loading={saving} disabled={!initialized}>
                  <Save className="h-4 w-4" /> Save policy
                </Button>
              ) : undefined
            }
          />
          {!initialized ? (
            <Spinner label="Loading policy..." />
          ) : (
            <div className="space-y-3">
              <Field label="Minimum password length" hint="6–32 characters">
                <NumberInput
                  value={draft['security.minPasswordLength']}
                  onChange={(e) => setDraft({ ...draft, 'security.minPasswordLength': e.target.value })}
                  min={6} max={32} disabled={!canManage}
                />
              </Field>
              <BoolRow
                label="Require uppercase letter"
                value={draft['security.requireUppercase'] === 'true'}
                onChange={(v) => setDraft({ ...draft, 'security.requireUppercase': String(v) })}
                disabled={!canManage}
              />
              <BoolRow
                label="Require lowercase letter"
                value={draft['security.requireLowercase'] === 'true'}
                onChange={(v) => setDraft({ ...draft, 'security.requireLowercase': String(v) })}
                disabled={!canManage}
              />
              <BoolRow
                label="Require digit"
                value={draft['security.requireDigit'] === 'true'}
                onChange={(v) => setDraft({ ...draft, 'security.requireDigit': String(v) })}
                disabled={!canManage}
              />
              <BoolRow
                label="Require symbol"
                value={draft['security.requireSymbol'] === 'true'}
                onChange={(v) => setDraft({ ...draft, 'security.requireSymbol': String(v) })}
                disabled={!canManage}
              />
              <Field label="Password expiry (days)" hint="0 = never expires">
                <NumberInput
                  value={draft['security.passwordExpiryDays']}
                  onChange={(e) => setDraft({ ...draft, 'security.passwordExpiryDays': e.target.value })}
                  min={0} disabled={!canManage}
                />
              </Field>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <CardHeader
              icon={<ShieldAlert className="h-4 w-4" />}
              title="Session & lockout"
              subtitle="Configuration stored for the authentication layer"
            />
            {!initialized ? (
              <Spinner label="Loading..." />
            ) : (
              <div className="space-y-3">
                <Field label="Session timeout (minutes)" hint="Idle time before automatic sign-out">
                  <NumberInput
                    value={draft['security.sessionTimeoutMin']}
                    onChange={(e) => setDraft({ ...draft, 'security.sessionTimeoutMin': e.target.value })}
                    min={0} disabled={!canManage}
                  />
                </Field>
                <Field label="Max failed login attempts" hint="Before the account is locked">
                  <NumberInput
                    value={draft['security.maxLoginAttempts']}
                    onChange={(e) => setDraft({ ...draft, 'security.maxLoginAttempts': e.target.value })}
                    min={0} disabled={!canManage}
                  />
                </Field>
                <Field label="Lockout duration (minutes)">
                  <NumberInput
                    value={draft['security.lockoutMinutes']}
                    onChange={(e) => setDraft({ ...draft, 'security.lockoutMinutes': e.target.value })}
                    min={0} disabled={!canManage}
                  />
                </Field>
                <div className="flex items-start gap-2 rounded-xl border border-advisory-text/30 bg-advisory-bg px-3 py-2.5">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-advisory-text" />
                  <p className="text-xs text-advisory-text">
                    Session timeout and login-attempt lockout are stored configuration; enforcement in the
                    authentication service is a planned backend update. Password policy applies to new passwords
                    set from User Management today.
                  </p>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <CardHeader
              icon={<Fingerprint className="h-4 w-4" />}
              title="Multi-factor authentication"
              subtitle={`${mfaOn} of ${users.length} user(s) have MFA enabled`}
            />
            {usersQ.isLoading ? (
              <Spinner label="Loading users..." />
            ) : (
              <DataTable<AdminUserLite>
                columns={[
                  { key: 'name', label: 'User', render: (r) => <span className="font-semibold text-ink dark:text-white">{r.name}</span> },
                  {
                    key: 'mfaEnabled', label: 'MFA',
                    render: (r) => <Badge tone={r.mfaEnabled ? 'pass' : 'neutral'}>{r.mfaEnabled ? 'Enabled' : 'Not enrolled'}</Badge>,
                  },
                  {
                    key: 'isActive', label: 'Account',
                    render: (r) => <Badge tone={r.isActive ? 'pass' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>,
                  },
                ]}
                rows={users}
                emptyTitle="No users found."
              />
            )}
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-alabaster px-3 py-2.5">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
              <p className="text-xs text-slate-600 dark:text-slate-300">
                TOTP enrollment (QR code setup) is not yet implemented in the backend — MFA status above is
                read-only. Enrollment will be added in a future update.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
