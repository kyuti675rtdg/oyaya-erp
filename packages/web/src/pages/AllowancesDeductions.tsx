import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { AllowanceDeductionType, EmployeeAllowance, HrEmployee, PayrollModeCode } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Field, Select, Spinner, TextInput,
  ErrorBox} from '../components/ui';
import { fmtBirr, fmtDate } from '../lib/format';
import {
  HrModal,
  HrNotice,
  hrPrimaryBtn,
  hrSecondaryBtn,
  hrShell,
  modeLabel,
  useHrPerms
} from './HrShared';

interface TypeForm {
  code: string;
  name: string;
  kind: 'ALLOWANCE' | 'DEDUCTION';
  calc: 'FIXED' | 'PERCENT';
  amount: string;
  recurrence: 'RECURRING' | 'ONE_TIME';
}

interface AssignForm {
  employeeId: string;
  typeId: string;
  oneTimeDate: string;
  overrideAmount: string;
  notes: string;
}

export function AllowancesDeductions() {
  const { canManage } = useHrPerms();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [editingType, setEditingType] = useState<AllowanceDeductionType | null>(null);
  const [typeForm, setTypeForm] = useState<TypeForm>({
    code: '',
    name: '',
    kind: 'ALLOWANCE',
    calc: 'FIXED',
    amount: '',
    recurrence: 'RECURRING'
  });
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignForm, setAssignForm] = useState<AssignForm>({
    employeeId: '',
    typeId: '',
    oneTimeDate: '',
    overrideAmount: '',
    notes: ''
  });

  const typesQ = useQuery({
    queryKey: ['hr-allowance-types'],
    queryFn: async () => (await api.get<AllowanceDeductionType[]>(E.hrAllowanceTypes)).data
  });
  const assignsQ = useQuery({
    queryKey: ['hr-allowances'],
    queryFn: async () => (await api.get<EmployeeAllowance[]>(E.hrAllowances)).data
  });
  const employeesQ = useQuery({
    queryKey: ['hr-employees-active'],
    queryFn: async () =>
      (await api.get<HrEmployee[]>(E.hrEmployees, { params: { isActive: 'true' } })).data
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['hr-allowance-types'] });
    queryClient.invalidateQueries({ queryKey: ['hr-allowances'] });
  };

  const typeM = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      editingType
        ? (await api.put(E.hrAllowanceType(editingType.id), payload)).data
        : (await api.post(E.hrAllowanceTypes, payload)).data,
    onSuccess: () => {
      setNotice({ ok: true, text: editingType ? 'Type updated.' : 'Allowance/deduction type created.' });
      setShowTypeForm(false);
      setEditingType(null);
      refresh();
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' })
  });

  const assignM = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await api.post(E.hrAllowances, payload)).data,
    onSuccess: () => {
      setNotice({ ok: true, text: 'Assigned to employee.' });
      setShowAssignForm(false);
      setAssignForm({ employeeId: '', typeId: '', oneTimeDate: '', overrideAmount: '', notes: '' });
      refresh();
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Assignment failed.' })
  });

  const unassignM = useMutation({
    mutationFn: async (id: string) => api.delete(E.hrAllowance(id)),
    onSuccess: () => {
      setNotice({ ok: true, text: 'Assignment removed.' });
      refresh();
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Remove failed.' })
  });

  const openTypeCreate = () => {
    setEditingType(null);
    setTypeForm({ code: '', name: '', kind: 'ALLOWANCE', calc: 'FIXED', amount: '', recurrence: 'RECURRING' });
    setShowTypeForm(true);
  };
  const openTypeEdit = (t: AllowanceDeductionType) => {
    setEditingType(t);
    setTypeForm({
      code: t.code,
      name: t.name,
      kind: t.kind,
      calc: t.calc,
      amount: String(t.amount),
      recurrence: t.recurrence
    });
    setShowTypeForm(true);
  };
  const submitType = (e: FormEvent) => {
    e.preventDefault();
    if (!typeForm.code.trim() || !typeForm.name.trim() || !typeForm.amount) {
      setNotice({ ok: false, text: 'Code, name and amount are required.' });
      return;
    }
    typeM.mutate({
      code: typeForm.code.trim().toUpperCase(),
      name: typeForm.name.trim(),
      kind: typeForm.kind,
      calc: typeForm.calc,
      amount: Number(typeForm.amount),
      appliesTo: [],
      recurrence: typeForm.recurrence
    });
  };

  const submitAssign = (e: FormEvent) => {
    e.preventDefault();
    if (!assignForm.employeeId || !assignForm.typeId) {
      setNotice({ ok: false, text: 'Select an employee and a type.' });
      return;
    }
    assignM.mutate({
      employeeId: assignForm.employeeId,
      typeId: assignForm.typeId,
      oneTimeDate: assignForm.oneTimeDate
        ? new Date(`${assignForm.oneTimeDate}T00:00:00Z`).toISOString()
        : null,
      overrideAmount: assignForm.overrideAmount ? Number(assignForm.overrideAmount) : null,
      notes: assignForm.notes.trim() || null
    });
  };

  const amountText = (t: AllowanceDeductionType) =>
    t.calc === 'PERCENT' ? `${Number(t.amount)}% of base` : fmtBirr(Number(t.amount));

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Scale className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Allowances & Deductions</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Recurring and one-time allowance / deduction types, assigned to employees
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <button className={hrSecondaryBtn} onClick={openTypeCreate}>
              <Plus className="h-4 w-4" /> Type
            </button>
            <button className={hrPrimaryBtn} onClick={() => setShowAssignForm(true)}>
              <Plus className="h-4 w-4" /> Assign
            </button>
          </div>
        ) : null}
      </div>

      {notice ? <HrNotice ok={notice.ok} text={notice.text} /> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={hrShell}>
          <CardHeader
            icon={<Scale className="h-4 w-4" />}
            title="Allowance & deduction types"
            subtitle="Fixed ETB or % of base salary · recurring or one-time"
          />
          {typesQ.isLoading ? (
            <Spinner label="Loading types..." />
          ) : (
            <DataTable<AllowanceDeductionType>
              columns={[
                { key: 'name', label: 'Name', render: (r) => `${r.name} (${r.code})` },
                {
                  key: 'kind',
                  label: 'Kind',
                  render: (r) => (
                    <Badge tone={r.kind === 'ALLOWANCE' ? 'pass' : 'critical'}>{r.kind}</Badge>
                  )
                },
                { key: 'amount', label: 'Amount', mono: true, render: (r) => amountText(r) },
                {
                  key: 'rec',
                  label: 'Recurrence',
                  render: (r) => (
                    <Badge tone={r.recurrence === 'RECURRING' ? 'neutral' : 'advisory'}>
                      {r.recurrence.replace('_', ' ')}
                    </Badge>
                  )
                },
                ...(canManage
                  ? [
                      {
                        key: 'edit',
                        label: '',
                        render: (r: AllowanceDeductionType) => (
                          <button className={hrSecondaryBtn + ' px-3 py-1.5 text-xs'} onClick={() => openTypeEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )
                      }
                    ]
                  : [])
              ]}
              rows={typesQ.data ?? []}
              emptyTitle="No types defined"
              emptySub="Create housing, transport, meal, tax, pension, advance types."
            />
          )}
        </div>

        <div className={hrShell}>
          <CardHeader
            icon={<Scale className="h-4 w-4" />}
            title="Employee assignments"
            subtitle="Which types apply to which employees"
          />
          {assignsQ.isLoading ? (
            <Spinner label="Loading assignments..." />
          ) : (
            <DataTable<EmployeeAllowance>
              columns={[
                { key: 'emp', label: 'Employee', render: (r) => r.employee?.name ?? '—' },
                {
                  key: 'type',
                  label: 'Type',
                  render: (r) => (
                    <span>
                      {r.type?.name}{' '}
                      <Badge tone={r.type?.kind === 'ALLOWANCE' ? 'pass' : 'critical'}>{r.type?.kind}</Badge>
                    </span>
                  )
                },
                {
                  key: 'value',
                  label: 'Value',
                  mono: true,
                  render: (r) =>
                    r.overrideAmount != null
                      ? fmtBirr(Number(r.overrideAmount))
                      : r.type
                        ? r.type.calc === 'PERCENT'
                          ? `${Number(r.type.amount)}%`
                          : fmtBirr(Number(r.type.amount))
                        : '—'
                },
                {
                  key: 'when',
                  label: 'Applies',
                  render: (r) =>
                    r.oneTimeDate ? (
                      <span className="text-xs">One-time · {fmtDate(r.oneTimeDate)}</span>
                    ) : (
                      <span className="text-xs">Every run</span>
                    )
                },
                ...(canManage
                  ? [
                      {
                        key: 'del',
                        label: '',
                        render: (r: EmployeeAllowance) => (
                          <button
                            className={hrSecondaryBtn + ' px-3 py-1.5 text-xs text-red-700'}
                            onClick={() => unassignM.mutate(r.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )
                      }
                    ]
                  : [])
              ]}
              rows={assignsQ.data ?? []}
              emptyTitle="No assignments yet"
            />
          )}
        </div>
      </div>

      {showTypeForm ? (
        <HrModal title={editingType ? 'Edit type' : 'New allowance / deduction type'} onClose={() => setShowTypeForm(false)}>
          <form onSubmit={submitType} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Code" required>
              <TextInput value={typeForm.code} onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value })} placeholder="HOUSING" required />
            </Field>
            <Field label="Name" required>
              <TextInput value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} placeholder="Housing allowance" required />
            </Field>
            <Field label="Kind">
              <Select value={typeForm.kind} onChange={(e) => setTypeForm({ ...typeForm, kind: e.target.value as 'ALLOWANCE' | 'DEDUCTION' })}>
                <option value="ALLOWANCE">Allowance</option>
                <option value="DEDUCTION">Deduction</option>
              </Select>
            </Field>
            <Field label="Calculation">
              <Select value={typeForm.calc} onChange={(e) => setTypeForm({ ...typeForm, calc: e.target.value as 'FIXED' | 'PERCENT' })}>
                <option value="FIXED">Fixed ETB</option>
                <option value="PERCENT">% of base salary</option>
              </Select>
            </Field>
            <Field label={typeForm.calc === 'PERCENT' ? 'Percent' : 'Amount (ETB)'} required>
              <TextInput type="number" min="0" step="0.01" value={typeForm.amount} onChange={(e) => setTypeForm({ ...typeForm, amount: e.target.value })} required />
            </Field>
            <Field label="Recurrence">
              <Select value={typeForm.recurrence} onChange={(e) => setTypeForm({ ...typeForm, recurrence: e.target.value as 'RECURRING' | 'ONE_TIME' })}>
                <option value="RECURRING">Recurring (every run)</option>
                <option value="ONE_TIME">One-time</option>
              </Select>
            </Field>
            <div className="flex justify-end gap-2 md:col-span-2">
              <button type="button" className={hrSecondaryBtn} onClick={() => setShowTypeForm(false)}>
                Cancel
              </button>
              <button type="submit" className={hrPrimaryBtn} disabled={typeM.isPending}>
                {typeM.isPending ? 'Saving...' : 'Save type'}
              </button>
            </div>
          </form>
        </HrModal>
      ) : null}

      {showAssignForm ? (
        <HrModal title="Assign to employee" onClose={() => setShowAssignForm(false)}>
          <form onSubmit={submitAssign} className="space-y-4">
            <Field label="Employee" required>
              <Select value={assignForm.employeeId} onChange={(e) => setAssignForm({ ...assignForm, employeeId: e.target.value })} required>
                <option value="">—</option>
                {(employeesQ.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.employeeNo}) · {modeLabel(e.payrollMode as PayrollModeCode)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Allowance / deduction type" required>
              <Select value={assignForm.typeId} onChange={(e) => setAssignForm({ ...assignForm, typeId: e.target.value })} required>
                <option value="">—</option>
                {(typesQ.data ?? [])
                  .filter((t) => t.isActive)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {t.kind} ({amountText(t)})
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="One-time date" hint="Leave empty for recurring application">
              <TextInput type="date" value={assignForm.oneTimeDate} onChange={(e) => setAssignForm({ ...assignForm, oneTimeDate: e.target.value })} />
            </Field>
            <Field label="Override amount (ETB)" hint="Leave empty to use the type default">
              <TextInput type="number" min="0" step="0.01" value={assignForm.overrideAmount} onChange={(e) => setAssignForm({ ...assignForm, overrideAmount: e.target.value })} />
            </Field>
            <Field label="Notes">
              <TextInput value={assignForm.notes} onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className={hrSecondaryBtn} onClick={() => setShowAssignForm(false)}>
                Cancel
              </button>
              <button type="submit" className={hrPrimaryBtn} disabled={assignM.isPending}>
                {assignM.isPending ? 'Saving...' : 'Assign'}
              </button>
            </div>
          </form>
        </HrModal>
      ) : null}
    </div>
  );
}
