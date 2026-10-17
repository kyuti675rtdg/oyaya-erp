import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calculator, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { AttendanceRecord, EmployeeAllowance, HrEmployee } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Field, Spinner, TextInput } from '../components/ui';
import { downloadCsv, fmtBirr, hrShell, useHrPerms } from './HrShared';

const STANDARD_SHIFT_HOURS = 8;

function isWeekendUtc(dateIso: string): boolean {
  const dow = new Date(dateIso).getUTCDay();
  return dow === 0 || dow === 6;
}

interface PreviewLine {
  employee: HrEmployee;
  base: number;
  otHours: number;
  otBirr: number;
  allowances: number;
  deductions: number;
  net: number;
}

export function FixedPayroll() {
  useHrPerms();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [y, m] = period.split('-').map(Number);

  const employeesQ = useQuery({
    queryKey: ['hr-employees-fixed'],
    queryFn: async () =>
      (await api.get<HrEmployee[]>(E.hrEmployees, { params: { payrollMode: 'FIXED', isActive: 'true' } })).data
  });
  const attendanceQ = useQuery({
    queryKey: ['hr-attendance', 'fixed', period],
    queryFn: async () =>
      (
        await api.get<AttendanceRecord[]>(E.hrAttendance, {
          params: {
            from: new Date(y, m - 1, 1).toISOString(),
            to: new Date(y, m, 1).toISOString()
          }
        })
      ).data,
    enabled: Number.isInteger(y) && Number.isInteger(m)
  });
  const allowancesQ = useQuery({
    queryKey: ['hr-allowances-all'],
    queryFn: async () => (await api.get<EmployeeAllowance[]>(E.hrAllowances)).data
  });

  const lines: PreviewLine[] = useMemo(() => {
    const emps = employeesQ.data ?? [];
    const att = attendanceQ.data ?? [];
    const assigns = allowancesQ.data ?? [];
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 1);
    return emps.map((emp) => {
      const base = Number(emp.baseSalary ?? 0);
      const hourly = base > 0 ? base / (30 * STANDARD_SHIFT_HOURS) : 0;
      let otHours = 0;
      let otBirr = 0;
      for (const r of att.filter((a) => a.employeeId === emp.id)) {
        const worked = Number(r.workHours) + Number(r.overtimeHours);
        const ot = Math.max(0, worked - STANDARD_SHIFT_HOURS);
        if (ot > 0) {
          otHours += ot;
          otBirr += ot * hourly * (isWeekendUtc(r.date) ? 2 : 1.5);
        }
      }
      let allowances = 0;
      let deductions = 0;
      for (const a of assigns.filter((x) => x.employeeId === emp.id && x.isActive && x.type?.isActive)) {
        const t = a.type!;
        if (t.appliesTo.length > 0 && !t.appliesTo.includes('FIXED')) continue;
        const recurring = t.recurrence === 'RECURRING' && !a.oneTimeDate;
        const oneTimeInMonth =
          a.oneTimeDate && new Date(a.oneTimeDate) >= monthStart && new Date(a.oneTimeDate) < monthEnd;
        if (!recurring && !oneTimeInMonth) continue;
        const raw = a.overrideAmount != null ? Number(a.overrideAmount) : Number(t.amount);
        const value = t.calc === 'PERCENT' ? (base * raw) / 100 : raw;
        if (t.kind === 'ALLOWANCE') allowances += value;
        else deductions += value;
      }
      const gross = base + otBirr;
      const net = gross + allowances - deductions;
      return { employee: emp, base, otHours, otBirr, allowances, deductions, net };
    });
  }, [employeesQ.data, attendanceQ.data, allowancesQ.data, y, m]);

  const totals = lines.reduce(
    (acc, l) => ({
      base: acc.base + l.base,
      ot: acc.ot + l.otBirr,
      allow: acc.allow + l.allowances,
      ded: acc.ded + l.deductions,
      net: acc.net + l.net
    }),
    { base: 0, ot: 0, allow: 0, ded: 0, net: 0 }
  );

  const exportCsv = () => {
    downloadCsv(
      `fixed-payroll-${period}.csv`,
      ['Employee ID', 'Name', 'Base (ETB)', 'OT hours', 'OT pay (ETB)', 'Allowances (ETB)', 'Deductions (ETB)', 'Net (ETB)'],
      lines.map((l) => [
        l.employee.employeeNo,
        l.employee.name,
        l.base.toFixed(2),
        l.otHours.toFixed(2),
        l.otBirr.toFixed(2),
        l.allowances.toFixed(2),
        l.deductions.toFixed(2),
        l.net.toFixed(2)
      ])
    );
  };

  const loading = employeesQ.isLoading || attendanceQ.isLoading || allowancesQ.isLoading;

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Wallet className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Fixed Salary & Overtime</h1>
            <p className="text-sm text-slate-500">
              Monthly computation preview — base + overtime (1.5× weekday / 2× weekend) ± allowances
            </p>
          </div>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </div>

      <div className={`${hrShell} mb-4 flex flex-wrap items-end gap-4`}>
        <Field label="Pay month">
          <TextInput type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <Badge tone="neutral">Preview — final figures are computed by the payroll run</Badge>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          { label: 'Total base', value: fmtBirr(totals.base) },
          { label: 'Total overtime', value: fmtBirr(totals.ot) },
          { label: 'Total allowances', value: fmtBirr(totals.allow) },
          { label: 'Total deductions', value: fmtBirr(totals.ded) },
          { label: 'Total net', value: fmtBirr(totals.net) }
        ].map((k) => (
          <div key={k.label} className={hrShell}>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{k.label}</p>
            <p className="tnum mt-2 text-xl font-bold text-slate-900">{k.value}</p>
          </div>
        ))}
      </div>

      <div className={hrShell}>
        <CardHeader
          icon={<Calculator className="h-4 w-4" />}
          title={`Salary computation — ${period}`}
          subtitle={`${lines.length} fixed-salary employees`}
        />
        {loading ? (
          <Spinner label="Computing..." />
        ) : (
          <DataTable
            columns={[
              { key: 'no', label: 'ID', render: (r) => <span className="tnum font-bold">{r.employee.employeeNo}</span> },
              { key: 'name', label: 'Name', render: (r) => r.employee.name },
              { key: 'base', label: 'Base', mono: true, render: (r) => fmtBirr(r.base) },
              { key: 'otH', label: 'OT hours', mono: true, render: (r) => r.otHours.toFixed(2) },
              { key: 'otB', label: 'OT pay', mono: true, render: (r) => fmtBirr(r.otBirr) },
              { key: 'allow', label: 'Allowances', mono: true, render: (r) => fmtBirr(r.allowances) },
              { key: 'ded', label: 'Deductions', mono: true, render: (r) => fmtBirr(r.deductions) },
              {
                key: 'net',
                label: 'Net pay',
                mono: true,
                render: (r) => <span className="font-bold text-violet-700">{fmtBirr(r.net)}</span>
              }
            ]}
            rows={lines.map((l) => ({ ...l, id: l.employee.id }))}
            emptyTitle="No fixed-salary employees"
            emptySub="Add employees with salary type 'Fixed salary'."
          />
        )}
      </div>
    </div>
  );
}
