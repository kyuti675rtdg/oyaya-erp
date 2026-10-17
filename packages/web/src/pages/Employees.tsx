import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, UserRound, Users } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { HrDepartment, HrEmployee, HrPosition, PayrollModeCode } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Field, Select, Spinner, TextInput } from '../components/ui';
import { fmtDate } from '../lib/format';
import {
  HrModal,
  HrNotice,
  hrPrimaryBtn,
  hrSecondaryBtn,
  hrShell,
  modeLabel,
  useHrPerms
} from './HrShared';

const MODES: PayrollModeCode[] = ['FIXED', 'PIECE_RATE', 'TRIP_BASED'];

interface EmployeeForm {
  employeeNo: string;
  name: string;
  phone: string;
  jobTitle: string;
  departmentId: string;
  positionId: string;
  payrollMode: PayrollModeCode;
  baseSalary: string;
  bankName: string;
  bankAccount: string;
  zkPin: string;
  hiredAt: string;
}

const EMPTY_FORM: EmployeeForm = {
  employeeNo: '',
  name: '',
  phone: '',
  jobTitle: '',
  departmentId: '',
  positionId: '',
  payrollMode: 'FIXED',
  baseSalary: '',
  bankName: '',
  bankAccount: '',
  zkPin: '',
  hiredAt: new Date().toISOString().slice(0, 10)
};

export function Employees() {
  const { canManage } = useHrPerms();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('true');
  const [editing, setEditing] = useState<HrEmployee | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EmployeeForm>(EMPTY_FORM);

  const listQ = useQuery({
    queryKey: ['hr-employees', search, modeFilter, activeFilter],
    queryFn: async () =>
      (
        await api.get<HrEmployee[]>(E.hrEmployees, {
          params: {
            ...(search ? { q: search } : {}),
            ...(modeFilter ? { payrollMode: modeFilter } : {}),
            ...(activeFilter ? { isActive: activeFilter } : {})
          }
        })
      ).data
  });
  const deptsQ = useQuery({
    queryKey: ['hr-departments'],
    queryFn: async () => (await api.get<HrDepartment[]>(E.hrDepartments)).data
  });
  const positionsQ = useQuery({
    queryKey: ['hr-positions'],
    queryFn: async () => (await api.get<HrPosition[]>(E.hrPositions)).data
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['hr-employees'] });

  const saveM = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editing) return (await api.put(E.hrEmployee(editing.id), payload)).data;
      return (await api.post(E.hrEmployees, payload)).data;
    },
    onSuccess: () => {
      setNotice({ ok: true, text: editing ? 'Employee updated.' : 'Employee created.' });
      setShowForm(false);
      setEditing(null);
      invalidate();
    },
    onError: (err) =>
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' })
  });

  const deactivateM = useMutation({
    mutationFn: async (id: string) => (await api.delete(E.hrEmployee(id))).data,
    onSuccess: () => {
      setNotice({ ok: true, text: 'Employee deactivated.' });
      invalidate();
    },
    onError: (err) =>
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Deactivation failed.' })
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };
  const openEdit = (emp: HrEmployee) => {
    setEditing(emp);
    setForm({
      employeeNo: emp.employeeNo,
      name: emp.name,
      phone: emp.phone ?? '',
      jobTitle: emp.jobTitle,
      departmentId: emp.departmentId ?? '',
      positionId: emp.positionId ?? '',
      payrollMode: emp.payrollMode,
      baseSalary: emp.baseSalary != null ? String(emp.baseSalary) : '',
      bankName: emp.bankName ?? '',
      bankAccount: emp.bankAccount ?? '',
      zkPin: emp.zkPin ?? '',
      hiredAt: emp.hiredAt.slice(0, 10)
    });
    setShowForm(true);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!form.employeeNo.trim() || !form.name.trim() || !form.jobTitle.trim()) {
      setNotice({ ok: false, text: 'Employee ID, name and job title are required.' });
      return;
    }
    saveM.mutate({
      employeeNo: form.employeeNo.trim(),
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      jobTitle: form.jobTitle.trim(),
      departmentId: form.departmentId || null,
      positionId: form.positionId || null,
      payrollMode: form.payrollMode,
      baseSalary: form.baseSalary ? Number(form.baseSalary) : null,
      bankName: form.bankName.trim() || null,
      bankAccount: form.bankAccount.trim() || null,
      zkPin: form.zkPin.trim() || null,
      hiredAt: new Date(form.hiredAt).toISOString()
    });
  };

  const rows = listQ.data ?? [];

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Employee Records</h1>
            <p className="text-sm text-slate-500">
              Staff registry — fixed salary, piece-rate and driver payroll modes, bank details
            </p>
          </div>
        </div>
        {canManage ? (
          <button className={hrPrimaryBtn} onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add employee
          </button>
        ) : null}
      </div>

      {notice ? <HrNotice ok={notice.ok} text={notice.text} /> : null}

      <div className={`${hrShell} mb-4`}>
        <CardHeader
          icon={<Search className="h-4 w-4" />}
          title="Filters"
          subtitle="Search by name or employee ID"
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or ID..."
          />
          <Select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
            <option value="">All salary types</option>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {modeLabel(m)}
              </option>
            ))}
          </Select>
          <Select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
            <option value="">All</option>
          </Select>
        </div>
      </div>

      <div className={hrShell}>
        <CardHeader
          icon={<UserRound className="h-4 w-4" />}
          title={`Employees (${rows.length})`}
          subtitle="Click edit to update details; delete deactivates (history is kept)"
        />
        {listQ.isLoading ? (
          <Spinner label="Loading employees..." />
        ) : (
          <DataTable<HrEmployee>
            columns={[
              { key: 'no', label: 'ID', render: (r) => <span className="tnum font-bold">{r.employeeNo}</span> },
              { key: 'name', label: 'Name', render: (r) => r.name },
              { key: 'title', label: 'Position', render: (r) => r.position?.title ?? r.jobTitle },
              {
                key: 'dept',
                label: 'Department',
                render: (r) => r.departmentRef?.name ?? r.department ?? '—'
              },
              {
                key: 'mode',
                label: 'Salary type',
                render: (r) => <Badge tone={r.payrollMode === 'FIXED' ? 'neutral' : 'advisory'}>{modeLabel(r.payrollMode)}</Badge>
              },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={r.isActive ? 'pass' : 'critical'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
              },
              { key: 'hired', label: 'Hired', render: (r) => fmtDate(r.hiredAt) },
              ...(canManage
                ? [
                    {
                      key: 'actions',
                      label: '',
                      render: (r: HrEmployee) => (
                        <div className="flex gap-2">
                          <button className={hrSecondaryBtn + ' px-3 py-1.5 text-xs'} onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                          {r.isActive ? (
                            <button
                              className={hrSecondaryBtn + ' px-3 py-1.5 text-xs text-red-700'}
                              onClick={() => deactivateM.mutate(r.id)}
                            >
                              Deactivate
                            </button>
                          ) : null}
                        </div>
                      )
                    }
                  ]
                : [])
            ]}
            rows={rows}
            emptyTitle="No employees found"
            emptySub="Add the first employee record."
          />
        )}
      </div>

      {showForm ? (
        <HrModal
          title={editing ? 'Edit employee' : 'Add employee'}
          subtitle={editing ? editing.name : 'New staff record'}
          onClose={() => setShowForm(false)}
          wide
        >
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Employee ID" required>
              <TextInput value={form.employeeNo} onChange={(e) => setForm({ ...form, employeeNo: e.target.value })} required />
            </Field>
            <Field label="Full name" required>
              <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label="Job title" required>
              <TextInput value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} required />
            </Field>
            <Field label="Phone">
              <TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Department">
              <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">—</option>
                {(deptsQ.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Position">
              <Select value={form.positionId} onChange={(e) => setForm({ ...form, positionId: e.target.value })}>
                <option value="">—</option>
                {(positionsQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Salary type" required>
              <Select
                value={form.payrollMode}
                onChange={(e) => setForm({ ...form, payrollMode: e.target.value as PayrollModeCode })}
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {modeLabel(m)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Base salary (ETB)" hint="Fixed-salary staff only">
              <TextInput
                type="number"
                min="0"
                step="0.01"
                value={form.baseSalary}
                onChange={(e) => setForm({ ...form, baseSalary: e.target.value })}
              />
            </Field>
            <Field label="Bank name">
              <TextInput value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
            </Field>
            <Field label="Bank account">
              <TextInput value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
            </Field>
            <Field label="ZKTeco PIN" hint="Biometric device PIN for attendance">
              <TextInput value={form.zkPin} onChange={(e) => setForm({ ...form, zkPin: e.target.value })} />
            </Field>
            <Field label="Hire date">
              <TextInput type="date" value={form.hiredAt} onChange={(e) => setForm({ ...form, hiredAt: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 md:col-span-2">
              <button type="button" className={hrSecondaryBtn} onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" className={hrPrimaryBtn} disabled={saveM.isPending}>
                {saveM.isPending ? 'Saving...' : editing ? 'Save changes' : 'Add employee'}
              </button>
            </div>
          </form>
        </HrModal>
      ) : null}
    </div>
  );
}
