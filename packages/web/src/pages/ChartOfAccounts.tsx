import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenText, Pencil, Plus, Search, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { ChartOfAccount } from '../types';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import {
  Button,
  Card,
  Field,
  NumberInput,
  Select,
  Spinner,
  TextInput
} from '../components/ui';
import { errMsg, AccountTypeBadge } from './finCommon';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;

interface FormState {
  code: string;
  name: string;
  type: string;
  parentId: string;
  isActive: boolean;
}

const EMPTY: FormState = { code: '', name: '', type: 'ASSET', parentId: '', isActive: true };

export function ChartOfAccounts() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ChartOfAccount | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('finance:create');
  const qc = useQueryClient();

  const coaQ = useQuery({
    queryKey: ['coa'],
    queryFn: async () => (await api.get<ChartOfAccount[]>(E.coa)).data
  });

  const rows = useMemo(() => {
    const list = coaQ.data ?? [];
    return list.filter(
      (a) =>
        (!typeFilter || a.type === typeFilter) &&
        (!search ||
          a.code.includes(search) ||
          a.name.toLowerCase().includes(search.toLowerCase()))
    );
  }, [coaQ.data, search, typeFilter]);

  const childrenOf = (id: string) => (coaQ.data ?? []).filter((a) => a.parentId === id);

  const saveM = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        ...(form.parentId ? { parentId: form.parentId } : {})
      };
      if (editing) {
        return (
          await api.put<ChartOfAccount>(E.coaItem(editing.id), {
            ...payload,
            isActive: form.isActive
          })
        ).data;
      }
      return (await api.post<ChartOfAccount>(E.coa, payload)).data;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['coa'] });
      setModalOpen(false);
      setEditing(null);
      setNotice({ ok: true, text: `Account ${saved.code} — ${saved.name} saved.` });
    },
    onError: (err) => setNotice({ ok: false, text: errMsg(err) })
  });

  const toggleActiveM = useMutation({
    mutationFn: async (row: ChartOfAccount) =>
      (await api.put<ChartOfAccount>(E.coaItem(row.id), { isActive: !row.isActive })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coa'] }),
    onError: (err) => setNotice({ ok: false, text: errMsg(err) })
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setModalOpen(true);
  };
  const openEdit = (row: ChartOfAccount) => {
    setEditing(row);
    setForm({
      code: row.code,
      name: row.name,
      type: row.type,
      parentId: row.parentId ?? '',
      isActive: row.isActive
    });
    setModalOpen(true);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      setNotice({ ok: false, text: 'Account code and name are required.' });
      return;
    }
    saveM.mutate();
  };

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<BookOpenText className="h-4 w-4" />}
          title="Chart of Accounts"
          subtitle="Double-entry account master — codes, types, hierarchy and active status"
          action={
            canManage ? (
              <Button onClick={openCreate} className="!px-4">
                <Plus className="h-4 w-4" /> New account
              </Button>
            ) : null
          }
        />

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code or name..."
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>

        {notice ? (
          <p
            className={`mb-4 rounded-lg px-4 py-2.5 text-sm font-semibold ${
              notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {notice.text}
          </p>
        ) : null}

        {coaQ.isLoading ? (
          <Spinner label="Loading accounts..." />
        ) : (
          <DataTable<ChartOfAccount>
            columns={[
              {
                key: 'code',
                label: 'Code',
                mono: true,
                render: (r) => <span className="font-bold text-ink">{r.code}</span>
              },
              {
                key: 'name',
                label: 'Account name',
                render: (r) => (
                  <div>
                    <span className="font-semibold text-ink">{r.name}</span>
                    {childrenOf(r.id).length > 0 ? (
                      <p className="text-xs text-slate-400">
                        Parent of {childrenOf(r.id).length} sub-account
                        {childrenOf(r.id).length === 1 ? '' : 's'}
                      </p>
                    ) : null}
                  </div>
                )
              },
              { key: 'type', label: 'Type', render: (r) => <AccountTypeBadge type={r.type} /> },
              {
                key: 'status',
                label: 'Status',
                render: (r) =>
                  r.isActive ? (
                    <Badge tone="pass">Active</Badge>
                  ) : (
                    <Badge tone="neutral">Inactive</Badge>
                  )
              },
              {
                key: 'actions',
                label: '',
                render: (r) =>
                  canManage ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(r)}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:underline"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => toggleActiveM.mutate(r)}
                        className="text-sm font-semibold text-slate-500 hover:underline"
                      >
                        {r.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  ) : null
              }
            ]}
            rows={rows}
            emptyTitle="No accounts found"
            emptySub="Add accounts to build the chart used by every journal posting."
          />
        )}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink">
                  {editing ? 'Edit account' : 'New account'}
                </h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  Peachtree-style numeric codes keep the ledger sortable.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Account code" required>
                  <NumberInput
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="e.g. 6200"
                  />
                </Field>
                <Field label="Account type" required>
                  <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Account name" required>
                <TextInput
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Office Rent Expense"
                />
              </Field>
              <Field label="Parent account" hint="Optional — group sub-accounts under a parent.">
                <Select
                  value={form.parentId}
                  onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                >
                  <option value="">None (top level)</option>
                  {(coaQ.data ?? [])
                    .filter((a) => !editing || a.id !== editing.id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                </Select>
              </Field>
              {editing ? (
                <Field label="Active">
                  <Select
                    value={form.isActive ? '1' : '0'}
                    onChange={(e) => setForm({ ...form, isActive: e.target.value === '1' })}
                  >
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                  </Select>
                </Field>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saveM.isPending}>
                  {editing ? 'Save changes' : 'Create account'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
