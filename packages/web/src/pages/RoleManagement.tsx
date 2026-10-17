import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Pencil, Save, ShieldCheck, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { AdminModal, AdminNotice, errText } from '../components/AdminModal';
import { Button, Card, Field, SectionTitle, Spinner, TextInput, TextArea } from '../components/ui';
import { useAuth } from '../store/auth';

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
}

interface Permission {
  id: string;
  code: string;
  module: string;
  action: string;
  scope: string;
}

type Notice = { ok: boolean; text: string } | null;

/**
 * RBAC role & permission management.
 * Left: role list (create/edit). Right: permission matrix (module x action)
 * with checkboxes persisted per role via POST /master/roles/:id/permissions.
 */
export function RoleManagement() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('settings:create'); // UI alias -> master:manage
  const [notice, setNotice] = useState<Notice>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [roleModal, setRoleModal] = useState<{ mode: 'create' } | { mode: 'edit'; role: Role } | null>(null);
  const [roleForm, setRoleForm] = useState({ name: '', description: '' });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const rolesQ = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: async () => (await api.get<Role[]>(E.roles)).data,
  });
  const permsQ = useQuery({
    queryKey: ['rbac-permissions'],
    queryFn: async () => (await api.get<Permission[]>(E.permissions)).data,
  });

  const rolePermsQ = useQuery({
    queryKey: ['rbac-role-perms', selectedRoleId],
    queryFn: async () => (await api.get<Permission[]>(E.rolePermissions(selectedRoleId!))).data,
    enabled: !!selectedRoleId,
  });

  const selectedRole = useMemo(
    () => (rolesQ.data ?? []).find((r) => r.id === selectedRoleId) ?? null,
    [rolesQ.data, selectedRoleId]
  );

  const selectRole = (id: string) => {
    setSelectedRoleId(id);
    setChecked(new Set());
    setDirty(false);
    setNotice(null);
  };

  // Sync checkboxes when the role's permissions load; once the user edits, the
  // draft set takes over until the next save / role switch.
  const effectiveChecked = useMemo(() => {
    if (dirty || !rolePermsQ.data) return checked;
    return new Set(rolePermsQ.data.map((p) => p.id));
  }, [dirty, checked, rolePermsQ.data]);

  const togglePerm = (permId: string) => {
    setChecked((prev) => {
      const next = new Set(prev.size ? prev : effectiveChecked);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return next;
    });
    setDirty(true);
  };

  const savePermissions = async () => {
    if (!selectedRoleId) return;
    setSaving(true);
    setNotice(null);
    try {
      await api.post(E.rolePermissions(selectedRoleId), { permissionIds: [...checked] });
      setNotice({ ok: true, text: `Permissions saved for ${selectedRole?.name ?? 'role'}.` });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['rbac-role-perms', selectedRoleId] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to save permissions.') });
    } finally {
      setSaving(false);
    }
  };

  const openRoleModal = (mode: 'create' | 'edit', role?: Role) => {
    setNotice(null);
    setRoleForm({ name: role?.name ?? '', description: role?.description ?? '' });
    setRoleModal(mode === 'create' ? { mode: 'create' } : { mode: 'edit', role: role! });
  };

  const saveRole = async () => {
    if (!roleModal) return;
    if (!roleForm.name.trim()) {
      setNotice({ ok: false, text: 'Role name is required.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const payload = { name: roleForm.name.trim(), description: roleForm.description.trim() || undefined };
      if (roleModal.mode === 'create') {
        await api.post(E.roles, payload);
        setNotice({ ok: true, text: 'Role created — select it to assign permissions.' });
      } else {
        await api.put(E.role(roleModal.role.id), payload);
        setNotice({ ok: true, text: 'Role updated.' });
      }
      setRoleModal(null);
      qc.invalidateQueries({ queryKey: ['rbac-roles'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to save role.') });
    } finally {
      setSaving(false);
    }
  };

  // Group permissions: module -> [permissions]
  const permGroups = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const p of permsQ.data ?? []) {
      const list = groups.get(p.module) ?? [];
      list.push(p);
      groups.set(p.module, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [permsQ.data]);

  const roles = rolesQ.data ?? [];

  return (
    <div>
      <SectionTitle
        title="Role & Permission Management"
        sub="Define roles and control exactly which permission codes each role grants"
        action={
          canManage ? (
            <Button onClick={() => openRoleModal('create')}>
              <Plus className="h-4 w-4" /> New role
            </Button>
          ) : undefined
        }
      />
      <AdminNotice notice={notice} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* ── Role list ── */}
        <Card className="p-5 xl:col-span-2">
          <CardHeader
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Roles"
            subtitle={`${roles.length} role(s)`}
          />
          {rolesQ.isLoading ? (
            <Spinner label="Loading roles..." />
          ) : (
            <DataTable<Role>
              columns={[
                {
                  key: 'name', label: 'Role',
                  render: (r) => (
                    <button
                      type="button"
                      onClick={() => selectRole(r.id)}
                      className={`text-left font-semibold ${selectedRoleId === r.id ? 'text-navy underline' : 'text-ink'}`}
                    >
                      {r.name}
                    </button>
                  ),
                },
                {
                  key: 'isSystem', label: 'Type',
                  render: (r) => <Badge tone={r.isSystem ? 'neutral' : 'pass'}>{r.isSystem ? 'System' : 'Custom'}</Badge>,
                },
                ...(canManage
                  ? [
                      {
                        key: 'id', label: '',
                        render: (r: Role) => (
                          <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => openRoleModal('edit', r)}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Button>
                        ),
                      },
                    ]
                  : []),
              ]}
              rows={roles}
              emptyTitle="No roles defined."
            />
          )}
          {selectedRole?.description ? (
            <p className="mt-3 text-sm text-slate-500">{selectedRole.description}</p>
          ) : null}
        </Card>

        {/* ── Permission matrix ── */}
        <Card className="p-5 xl:col-span-3">
          <CardHeader
            icon={<KeyRound className="h-4 w-4" />}
            title={selectedRole ? `Permissions — ${selectedRole.name}` : 'Permission matrix'}
            subtitle={
              selectedRole
                ? 'Tick the codes this role grants. Saving replaces the whole set.'
                : 'Select a role on the left to edit its permissions.'
            }
            action={
              selectedRole && canManage ? (
                <Button onClick={savePermissions} loading={saving} disabled={!dirty}>
                  <Save className="h-4 w-4" /> Save permissions
                </Button>
              ) : undefined
            }
          />
          {!selectedRole ? (
            <div className="rounded-xl border border-dashed border-line bg-alabaster px-6 py-10 text-center">
              <Lock className="mx-auto mb-2 h-6 w-6 text-slate-400" />
              <p className="font-semibold text-slate-700">No role selected</p>
              <p className="mt-1 text-sm text-slate-500">Pick a role to view and edit its permission matrix.</p>
            </div>
          ) : rolePermsQ.isLoading || permsQ.isLoading ? (
            <Spinner label="Loading permissions..." />
          ) : (
            <div className="space-y-4">
              {permGroups.map(([module, perms]) => {
                const granted = perms.filter((p) => effectiveChecked.has(p.id)).length;
                return (
                  <div key={module} className="rounded-xl border border-line p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-bold capitalize text-ink">{module}</p>
                      <Badge tone={granted > 0 ? 'pass' : 'neutral'}>
                        {granted}/{perms.length}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                      {perms.map((p) => (
                        <label
                          key={p.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                            effectiveChecked.has(p.id) ? 'border-navy/40 bg-navy/5' : 'border-line bg-white'
                          } ${canManage ? '' : 'opacity-70'}`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[#5B35D5]"
                            checked={effectiveChecked.has(p.id)}
                            onChange={() => togglePerm(p.id)}
                            disabled={!canManage}
                          />
                          <span>
                            <span className="font-semibold text-slate-800">{p.action}</span>
                            <span className="block font-mono text-[11px] text-slate-400">{p.code}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {roleModal && (
        <AdminModal
          title={roleModal.mode === 'create' ? 'New role' : `Edit role — ${roleModal.role.name}`}
          onClose={() => setRoleModal(null)}
        >
          <AdminNotice notice={notice} />
          <div className="space-y-3">
            <Field label="Role name" required>
              <TextInput
                value={roleForm.name}
                onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                placeholder="e.g. Warehouse Supervisor"
              />
            </Field>
            <Field label="Description">
              <TextArea
                value={roleForm.description}
                onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                placeholder="What this role is responsible for"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setRoleModal(null)}>Cancel</Button>
              <Button onClick={saveRole} loading={saving}>
                {roleModal.mode === 'create' ? 'Create role' : 'Save changes'}
              </Button>
            </div>
          </div>
        </AdminModal>
      )}
    </div>
  );
}
