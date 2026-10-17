import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, UserPlus, ShieldCheck, KeyRound, Power, PowerOff, Pencil, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { AdminModal, AdminNotice, errText } from '../components/AdminModal';
import { Button, Card, Field, SectionTitle, Select, Spinner, TextInput } from '../components/ui';
import { useAuth } from '../store/auth';
import { fmtDateTime } from '../lib/format';

interface RoleInfo {
  id: string;
  name: string;
  isSystem: boolean;
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  roleId: string;
  mfaEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  role: RoleInfo;
}

type Notice = { ok: boolean; text: string } | null;

function emptyForm() {
  return { name: '', email: '', phone: '', password: '', roleId: '' };
}

export function UserManagement() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('settings:create'); // UI alias -> master:manage
  const [notice, setNotice] = useState<Notice>(null);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; user: AdminUser } | null>(null);
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [detailUser, setDetailUser] = useState<AdminUser | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const usersQ = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await api.get<AdminUser[]>(E.users)).data,
  });
  const rolesQ = useQuery({
    queryKey: ['admin-roles'],
    queryFn: async () => (await api.get<RoleInfo[]>(E.roles)).data,
  });

  const openCreate = () => {
    setNotice(null);
    setForm(emptyForm());
    setModal({ mode: 'create' });
  };

  const openEdit = (user: AdminUser) => {
    setNotice(null);
    setForm({ name: user.name, email: user.email, phone: user.phone ?? '', password: '', roleId: user.roleId });
    setModal({ mode: 'edit', user });
  };

  const save = async () => {
    if (!modal) return;
    setNotice(null);
    if (!form.name.trim() || !form.email.trim() || !form.roleId) {
      setNotice({ ok: false, text: 'Name, email and role are required.' });
      return;
    }
    if (modal.mode === 'create' && form.password.length < 8) {
      setNotice({ ok: false, text: 'Password must be at least 8 characters.' });
      return;
    }
    if (modal.mode === 'edit' && form.password && form.password.length < 8) {
      setNotice({ ok: false, text: 'New password must be at least 8 characters (leave blank to keep the current one).' });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        roleId: form.roleId,
      };
      if (form.password) payload.password = form.password;
      if (modal.mode === 'create') {
        const companyId = await defaultCompanyId();
        await api.post(E.users, { ...payload, companyId, isActive: true });
      } else {
        await api.put(E.user(modal.user.id), payload);
      }
      setNotice({ ok: true, text: modal.mode === 'create' ? 'User created.' : 'User updated.' });
      setModal(null);
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to save user.') });
    } finally {
      setSaving(false);
    }
  };

  // The user belongs to the (single) company this ERP is deployed for.
  const defaultCompanyId = async () => {
    const c = await api.get<{ id: string }>(E.settingsCompany);
    return c.data.id;
  };

  const toggleActive = async (user: AdminUser) => {
    setNotice(null);
    try {
      if (user.isActive) {
        await api.delete(E.user(user.id)); // backend soft-deactivates
      } else {
        await api.put(E.user(user.id), { isActive: true });
      }
      setNotice({ ok: true, text: user.isActive ? `${user.name} deactivated.` : `${user.name} reactivated.` });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to update user status.') });
    }
  };

  const resetPassword = async () => {
    if (!resetFor) return;
    setNotice(null);
    if (newPassword.length < 8) {
      setNotice({ ok: false, text: 'New password must be at least 8 characters.' });
      return;
    }
    setSaving(true);
    try {
      await api.put(E.user(resetFor.id), { password: newPassword });
      setNotice({ ok: true, text: `Password reset for ${resetFor.name}.` });
      setResetFor(null);
      setNewPassword('');
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to reset password.') });
    } finally {
      setSaving(false);
    }
  };

  const roles = rolesQ.data ?? [];

  return (
    <div>
      <SectionTitle
        title="User Account Management"
        sub="Create accounts, assign roles, activate or deactivate access, and reset passwords"
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <UserPlus className="h-4 w-4" /> New user
            </Button>
          ) : undefined
        }
      />
      <AdminNotice notice={notice} />

      <Card className="p-5">
        <CardHeader
          icon={<Users className="h-4 w-4" />}
          title="System users"
          subtitle={`${(usersQ.data ?? []).length} account(s)`}
        />
        {usersQ.isLoading ? (
          <Spinner label="Loading users..." />
        ) : (
          <DataTable<AdminUser>
            columns={[
              { key: 'name', label: 'Name', render: (r) => (
                <button onClick={() => setDetailUser(r)} className="font-semibold text-ink dark:text-white hover:text-violet-600 dark:hover:text-violet-400 hover:underline text-left">
                  {r.name}
                </button>
              ) },
              { key: 'email', label: 'Email', render: (r) => <span className="text-sm">{r.email}</span> },
              {
                key: 'role', label: 'Role',
                render: (r) => (
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <ShieldCheck className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                    {r.role?.name ?? '—'}
                  </span>
                ),
              },
              {
                key: 'isActive', label: 'Status',
                render: (r) => <Badge tone={r.isActive ? 'pass' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>,
              },
              {
                key: 'mfaEnabled', label: 'MFA',
                render: (r) => <Badge tone={r.mfaEnabled ? 'pass' : 'neutral'}>{r.mfaEnabled ? 'On' : 'Off'}</Badge>,
              },
              { key: 'createdAt', label: 'Created', render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{fmtDateTime(r.createdAt)}</span> },
              ...(canManage
                ? [
                    {
                      key: 'id', label: 'Actions',
                      render: (r: AdminUser) => (
                        <div className="flex flex-wrap gap-1.5">
                          <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => { setResetFor(r); setNewPassword(''); setNotice(null); }}>
                            <KeyRound className="h-3.5 w-3.5" /> Reset
                          </Button>
                          <Button
                            variant={r.isActive ? 'danger' : 'secondary'}
                            className="!px-3 !py-1.5 !text-xs"
                            onClick={() => toggleActive(r)}
                          >
                            {r.isActive ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                            {r.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
            rows={usersQ.data ?? []}
            emptyTitle="No users found."
            emptySub="Create the first account to get started."
          />
        )}
      </Card>

      {modal && (
        <AdminModal
          title={modal.mode === 'create' ? 'New user' : `Edit user — ${modal.user.name}`}
          onClose={() => setModal(null)}
        >
          <AdminNotice notice={notice} />
          <div className="space-y-3">
            <Field label="Full name" required>
              <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Abebe Tesfaye" />
            </Field>
            <Field label="Email (login)" required>
              <TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@oyaya.et" />
            </Field>
            <Field label="Phone">
              <TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="09..." />
            </Field>
            <Field
              label={modal.mode === 'create' ? 'Password' : 'New password'}
              required={modal.mode === 'create'}
              hint={modal.mode === 'edit' ? 'Leave blank to keep the current password.' : 'Minimum 8 characters.'}
            >
              <TextInput
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Role" required>
              <Select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                <option value="">— Select role —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.isSystem ? ' (system)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={save} loading={saving}>
                {modal.mode === 'create' ? 'Create user' : 'Save changes'}
              </Button>
            </div>
          </div>
        </AdminModal>
      )}

      {resetFor && (
        <AdminModal title={`Reset password — ${resetFor.name}`} onClose={() => setResetFor(null)}>
          <AdminNotice notice={notice} />
          <Field label="New password" required hint="Minimum 8 characters. The user should change it after next login.">
            <TextInput type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setResetFor(null)}>Cancel</Button>
            <Button onClick={resetPassword} loading={saving}>Reset password</Button>
          </div>
        </AdminModal>
      )}

      {/* User detail drawer */}
      {detailUser && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`User details for ${detailUser.name}`}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetailUser(null)} />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white dark:bg-slate-800 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-line dark:border-slate-700 p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40 text-lg font-bold text-violet-700 dark:text-violet-300">
                    {detailUser.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="truncate text-lg font-bold text-ink dark:text-white">{detailUser.name}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{detailUser.email}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={detailUser.isActive ? 'pass' : 'neutral'}>
                    {detailUser.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  <Badge tone={detailUser.mfaEnabled ? 'pass' : 'neutral'}>
                    MFA {detailUser.mfaEnabled ? 'On' : 'Off'}
                  </Badge>
                </div>
              </div>
              <button
                onClick={() => setDetailUser(null)}
                className="touch shrink-0 rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Close details"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-700/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Role</p>
                <p className="flex items-center gap-2 font-semibold text-ink dark:text-white">
                  <ShieldCheck className="h-4 w-4 text-violet-600" />
                  {detailUser.role?.name ?? '—'}
                  {detailUser.role?.isSystem ? <span className="text-xs text-slate-500">(system)</span> : null}
                </p>
              </div>

              <dl className="divide-y divide-slate-100 dark:divide-slate-700">
                {detailUser.phone ? (
                  <div className="flex justify-between py-2.5">
                    <dt className="text-sm text-slate-500 dark:text-slate-400">Phone</dt>
                    <dd className="text-sm font-medium text-ink dark:text-white tnum">{detailUser.phone}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between py-2.5">
                  <dt className="text-sm text-slate-500 dark:text-slate-400">Created</dt>
                  <dd className="text-sm font-medium text-ink dark:text-white">{fmtDateTime(detailUser.createdAt)}</dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-sm text-slate-500 dark:text-slate-400">Last updated</dt>
                  <dd className="text-sm font-medium text-ink dark:text-white">{fmtDateTime(detailUser.updatedAt)}</dd>
                </div>
              </dl>

              {canManage ? (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => { setDetailUser(null); openEdit(detailUser); }}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => { setDetailUser(null); setResetFor(detailUser); setNewPassword(''); }}>
                    <KeyRound className="h-3.5 w-3.5" /> Reset password
                  </Button>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
