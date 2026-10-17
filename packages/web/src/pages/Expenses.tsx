import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ReceiptText, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { ChartOfAccount, ExpenseCategory, ExpenseClaim } from '../types';
import { useAuth } from '../store/auth';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import {
  Button,
  Card,
  Field,
  NumberInput,
  Select,
  Spinner,
  TextArea,
  TextInput
} from '../components/ui';
import { fmtBirr, fmtDateTime } from '../lib/format';
import { errMsg, StatusBadge } from './finCommon';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

type Tab = 'claims' | 'categories';

export function Expenses() {
  const [tab, setTab] = useState<Tab>('claims');
  const [statusFilter, setStatusFilter] = useState('');
  const [claimModal, setClaimModal] = useState(false);
  const [catModal, setCatModal] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [claimForm, setClaimForm] = useState({
    title: '',
    categoryId: '',
    amountBirr: '',
    glAccountCode: '',
    notes: ''
  });
  const [catForm, setCatForm] = useState({ name: '', glAccountCode: '' });
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('finance:create');
  const canApprove = hasClaim('finance:approve');
  const qc = useQueryClient();

  const claimsQ = useQuery({
    queryKey: ['expense-claims', statusFilter],
    queryFn: async () =>
      (await api.get<ExpenseClaim[]>(E.expenseClaims + (statusFilter ? `?status=${statusFilter}` : ''))).data,
    enabled: tab === 'claims'
  });
  const categoriesQ = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => (await api.get<ExpenseCategory[]>(E.expenseCategories)).data,
    enabled: tab === 'categories'
  });
  const coaQ = useQuery({
    queryKey: ['coa'],
    queryFn: async () => (await api.get<ChartOfAccount[]>(E.coa)).data
  });

  const expenseAccounts = (coaQ.data ?? []).filter(
    (a) => a.isActive && (a.type === 'EXPENSE' || a.type === 'ASSET')
  );
  const activeCategories = (categoriesQ.data ?? []).filter((c) => c.isActive);

  const invalidateClaims = () => {
    qc.invalidateQueries({ queryKey: ['expense-claims'] });
    qc.invalidateQueries({ queryKey: ['expense-categories'] });
  };

  const createClaimM = useMutation({
    mutationFn: async () =>
      (
        await api.post<ExpenseClaim>(E.expenseClaims, {
          title: claimForm.title.trim(),
          categoryId: claimForm.categoryId,
          amountBirr: Number(claimForm.amountBirr),
          glAccountCode: claimForm.glAccountCode || undefined,
          notes: claimForm.notes.trim() || undefined
        })
      ).data,
    onSuccess: (c) => {
      invalidateClaims();
      setClaimModal(false);
      setClaimForm({ title: '', categoryId: '', amountBirr: '', glAccountCode: '', notes: '' });
      setNotice({ ok: true, text: `Claim ${c.claimNo} created as DRAFT.` });
    },
    onError: (err) => setNotice({ ok: false, text: errMsg(err) })
  });

  const actionM = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'submit' | 'approve' | 'reject' | 'pay' }) =>
      (
        await api.post<ExpenseClaim>(
          action === 'submit'
            ? E.expenseClaimSubmit(id)
            : action === 'approve'
              ? E.expenseClaimApprove(id)
              : action === 'reject'
                ? E.expenseClaimReject(id)
                : E.expenseClaimPay(id)
        )
      ).data,
    onSuccess: (c) => {
      invalidateClaims();
      setNotice({ ok: true, text: `Claim ${c.claimNo} → ${c.status}.` });
    },
    onError: (err) => setNotice({ ok: false, text: errMsg(err) })
  });

  const createCatM = useMutation({
    mutationFn: async () =>
      (
        await api.post<ExpenseCategory>(E.expenseCategories, {
          name: catForm.name.trim(),
          glAccountCode: catForm.glAccountCode || undefined
        })
      ).data,
    onSuccess: (c) => {
      invalidateClaims();
      setCatModal(false);
      setCatForm({ name: '', glAccountCode: '' });
      setNotice({ ok: true, text: `Category "${c.name}" added.` });
    },
    onError: (err) => setNotice({ ok: false, text: errMsg(err) })
  });

  const submitClaim = (e: FormEvent) => {
    e.preventDefault();
    if (!claimForm.title.trim() || !claimForm.categoryId) {
      setNotice({ ok: false, text: 'Title and category are required.' });
      return;
    }
    if (!(Number(claimForm.amountBirr) > 0)) {
      setNotice({ ok: false, text: 'Enter a positive amount.' });
      return;
    }
    createClaimM.mutate();
  };

  const submitCat = (e: FormEvent) => {
    e.preventDefault();
    if (!catForm.name.trim()) {
      setNotice({ ok: false, text: 'Category name is required.' });
      return;
    }
    createCatM.mutate();
  };

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<ReceiptText className="h-4 w-4" />}
          title="Expense Management"
          subtitle="Expense claims with submit → approve → pay workflow — paying posts automatically to the ledger"
          action={
            canManage ? (
              <div className="flex gap-2">
                {tab === 'categories' ? (
                  <Button onClick={() => setCatModal(true)} className="!px-4">
                    <Plus className="h-4 w-4" /> Category
                  </Button>
                ) : (
                  <Button onClick={() => setClaimModal(true)} className="!px-4">
                    <Plus className="h-4 w-4" /> New claim
                  </Button>
                )}
              </div>
            ) : null
          }
        />

        <div className="mb-5 flex flex-wrap gap-2">
          {(
            [
              { key: 'claims', label: 'Claims' },
              { key: 'categories', label: 'Categories' }
            ] as { key: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`touch rounded-lg px-4 text-sm font-semibold ${
                tab === t.key
                  ? 'bg-navy text-white'
                  : 'border border-line bg-white text-slate-600 hover:bg-alabaster'
              }`}
            >
              {t.label}
            </button>
          ))}
          {tab === 'claims' ? (
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="ml-auto !w-auto"
            >
              <option value="">All statuses</option>
              {['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          ) : null}
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

        {tab === 'claims' ? (
          claimsQ.isLoading ? (
            <Spinner label="Loading claims..." />
          ) : (
            <DataTable<ExpenseClaim>
              columns={[
                {
                  key: 'claimNo',
                  label: 'Claim',
                  mono: true,
                  render: (r) => <span className="font-bold text-ink dark:text-white">{r.claimNo}</span>
                },
                { key: 'title', label: 'Title', render: (r) => <span className="block max-w-xs">{r.title}</span> },
                { key: 'category', label: 'Category', render: (r) => r.category?.name ?? '—' },
                {
                  key: 'glAccountCode',
                  label: 'GL account',
                  mono: true,
                  render: (r) => r.glAccountCode
                },
                { key: 'amountBirr', label: 'Amount', mono: true, render: (r) => fmtBirr(r.amountBirr) },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'createdAt', label: 'Raised', render: (r) => fmtDateTime(r.createdAt) },
                {
                  key: 'actions',
                  label: '',
                  render: (r) => (
                    <div className="flex flex-wrap items-center gap-2">
                      {r.status === 'DRAFT' && canManage ? (
                        <button
                          onClick={() => actionM.mutate({ id: r.id, action: 'submit' })}
                          className="text-sm font-semibold text-violet-700 hover:underline"
                        >
                          Submit
                        </button>
                      ) : null}
                      {r.status === 'SUBMITTED' && canApprove ? (
                        <>
                          <button
                            onClick={() => actionM.mutate({ id: r.id, action: 'approve' })}
                            className="text-sm font-semibold text-emerald-700 hover:underline"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => actionM.mutate({ id: r.id, action: 'reject' })}
                            className="text-sm font-semibold text-red-600 hover:underline"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                      {r.status === 'APPROVED' && canApprove ? (
                        <button
                          onClick={() => actionM.mutate({ id: r.id, action: 'pay' })}
                          className="text-sm font-semibold text-navy hover:underline"
                        >
                          Pay & post
                        </button>
                      ) : null}
                    </div>
                  )
                }
              ]}
              rows={claimsQ.data ?? []}
              emptyTitle="No expense claims"
              emptySub="Staff expense claims are raised here and paid after approval."
            />
          )
        ) : categoriesQ.isLoading ? (
          <Spinner label="Loading categories..." />
        ) : (
          <DataTable<ExpenseCategory>
            columns={[
              { key: 'name', label: 'Category', render: (r) => <span className="font-bold text-ink dark:text-white">{r.name}</span> },
              {
                key: 'glAccountCode',
                label: 'Default GL account',
                mono: true,
                render: (r) => r.glAccountCode ?? <span className="text-slate-400 dark:text-slate-500">—</span>
              },
              {
                key: 'isActive',
                label: 'Status',
                render: (r) =>
                  r.isActive ? <StatusBadge status="POSTED" /> : <StatusBadge status="CANCELLED" />
              }
            ]}
            rows={categoriesQ.data ?? []}
            emptyTitle="No categories yet"
            emptySub="Group expenses — transport, utilities, maintenance, office supplies..."
          />
        )}
      </div>

      {claimModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink dark:text-white">New expense claim</h3>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  Created as DRAFT, then submitted for approval.
                </p>
              </div>
              <button
                onClick={() => setClaimModal(false)}
                className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitClaim} className="space-y-4">
              <Field label="Title" required>
                <TextInput
                  value={claimForm.title}
                  onChange={(e) => setClaimForm({ ...claimForm, title: e.target.value })}
                  placeholder="e.g. Diesel for generator — October"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category" required>
                  <Select
                    value={claimForm.categoryId}
                    onChange={(e) => setClaimForm({ ...claimForm, categoryId: e.target.value })}
                  >
                    <option value="">Select...</option>
                    {activeCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount (ETB)" required>
                  <NumberInput
                    value={claimForm.amountBirr}
                    onChange={(e) => setClaimForm({ ...claimForm, amountBirr: e.target.value })}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </Field>
              </div>
              <Field label="GL account" hint="Defaults to the category's account.">
                <Select
                  value={claimForm.glAccountCode}
                  onChange={(e) => setClaimForm({ ...claimForm, glAccountCode: e.target.value })}
                >
                  <option value="">Use category default</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Notes">
                <TextArea
                  value={claimForm.notes}
                  onChange={(e) => setClaimForm({ ...claimForm, notes: e.target.value })}
                />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setClaimModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={createClaimM.isPending}>
                  Create claim
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {catModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <Card className="max-h-[92vh] w-full max-w-md overflow-y-auto p-6">
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-lg font-bold text-ink dark:text-white">New expense category</h3>
              <button
                onClick={() => setCatModal(false)}
                className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitCat} className="space-y-4">
              <Field label="Category name" required>
                <TextInput
                  value={catForm.name}
                  onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                  placeholder="e.g. Fuel & transport"
                />
              </Field>
              <Field label="Default GL account" hint="Expense or Asset account to debit.">
                <Select
                  value={catForm.glAccountCode}
                  onChange={(e) => setCatForm({ ...catForm, glAccountCode: e.target.value })}
                >
                  <option value="">None</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setCatModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={createCatM.isPending}>
                  Add category
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
