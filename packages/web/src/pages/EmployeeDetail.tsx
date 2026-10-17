import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  Building2,
  Calendar,
  Clock,
  Mail,
  Phone,
  ShieldCheck,
  UserRound
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, Card, ErrorBox, Spinner } from '../components/ui';
import { fmtBirr, fmtDate, fmtDateTime } from '../lib/format';
import { hrShell } from './HrShared';
import type { AttendanceRecord, HrEmployee } from '../types';

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right text-sm font-medium text-ink dark:text-white">{value}</dd>
    </div>
  );
}

export function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();

  const empQ = useQuery({
    queryKey: ['hr-employee', id],
    queryFn: async () => (await api.get<HrEmployee>(E.hrEmployee(id ?? ''))).data,
    enabled: !!id
  });

  const attQ = useQuery({
    queryKey: ['hr-employee-attendance', id],
    queryFn: async () =>
      (await api.get<AttendanceRecord[]>(`${E.hrAttendance}?employeeId=${id}&limit=10`)).data,
    enabled: !!id
  });

  if (empQ.isLoading) return <Spinner label="Loading employee..." />;
  if (empQ.isError)
    return (
      <div>
        <Link to="/hr/employees" className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-600 hover:underline dark:text-violet-400">
          <ArrowLeft size={16} /> Back to employees
        </Link>
        <div className="mt-4">
          <ErrorBox message="Failed to load employee." onRetry={() => empQ.refetch()} />
        </div>
      </div>
    );

  const emp = empQ.data;
  if (!emp)
    return (
      <div>
        <Link to="/hr/employees" className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-600 hover:underline dark:text-violet-400">
          <ArrowLeft size={16} /> Back to employees
        </Link>
        <p className="mt-4 text-slate-500 dark:text-slate-400">Employee not found.</p>
      </div>
    );

  const attendance = attQ.data ?? [];
  const presentCount = attendance.filter((a) => a.status === 'PRESENT').length;

  return (
    <div>
      <Link to="/hr/employees" className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-600 hover:underline dark:text-violet-400">
        <ArrowLeft size={16} /> Back to employees
      </Link>

      {/* Profile header */}
      <div className={`${hrShell} mt-3 relative overflow-hidden`}>
        <div className="absolute right-0 top-0 h-32 w-32 rounded-bl-full bg-violet-100/50 dark:bg-violet-500/10" aria-hidden="true" />
        <div className="relative flex flex-wrap items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-2xl font-extrabold text-white dark:bg-violet-500">
            {emp.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight text-ink dark:text-white">{emp.name}</h1>
              <Badge tone={emp.isActive ? 'pass' : 'neutral'}>{emp.isActive ? 'Active' : 'Inactive'}</Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
              <span className="tnum font-semibold">ID: {emp.employeeNo}</span>
              <span className="flex items-center gap-1"><Building2 size={13} /> {emp.departmentRef?.name ?? emp.department ?? '—'}</span>
              <span className="flex items-center gap-1"><ShieldCheck size={13} /> {emp.position?.title ?? emp.jobTitle}</span>
            </p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-700/50">
            <p className="tnum text-xl font-bold text-ink dark:text-white">{presentCount}/{attendance.length}</p>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Recent attendance</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-700/50">
            <p className="tnum text-xl font-bold text-ink dark:text-white">{emp.payrollMode?.replace('_', ' ') ?? '—'}</p>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Payroll mode</p>
          </div>
          <div className="rounded-xl bg-violet-50 p-3 text-center dark:bg-violet-500/10">
            <p className="tnum text-xl font-bold text-violet-700 dark:text-violet-300">
              {emp.baseSalary ? fmtBirr(emp.baseSalary) : '—'}
            </p>
            <p className="text-xs font-medium text-violet-600 dark:text-violet-400">Base salary</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-700/50">
            <p className="flex items-center justify-center gap-1 text-xl font-bold text-ink dark:text-white">
              <Calendar size={16} className="text-slate-400" />
              <span className="tnum text-base">{fmtDate(emp.hiredAt)}</span>
            </p>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Hired date</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Personal & employment details */}
        <Card className="p-5">
          <CardHeader
            icon={<UserRound className="h-4 w-4" />}
            title="Employment details"
            subtitle="Personal information and job assignment"
          />
          <dl className="divide-y divide-slate-100 dark:divide-slate-700">
            <DetailRow label="Employee ID" value={<span className="tnum font-bold">{emp.employeeNo}</span>} />
            <DetailRow label="Full name" value={emp.name} />
            <DetailRow label="Position" value={emp.position?.title ?? emp.jobTitle} />
            <DetailRow label="Department" value={emp.departmentRef?.name ?? emp.department ?? '—'} />
            <DetailRow
              label="Phone"
              value={emp.phone ? (
                <span className="inline-flex items-center gap-1.5 tnum"><Phone size={13} className="text-slate-400" />{emp.phone}</span>
              ) : '—'}
            />
            <DetailRow label="Payroll mode" value={<Badge tone="neutral">{emp.payrollMode?.replace('_', ' ')}</Badge>} />
            <DetailRow label="Hired" value={fmtDateTime(emp.hiredAt)} />
          </dl>
        </Card>

        {/* Payroll & bank details */}
        <Card className="p-5">
          <CardHeader
            icon={<Banknote className="h-4 w-4" />}
            title="Payroll & banking"
            subtitle="Salary configuration and payment details"
          />
          <dl className="divide-y divide-slate-100 dark:divide-slate-700">
            <DetailRow
              label="Base salary"
              value={emp.baseSalary ? <span className="tnum font-bold text-emerald-700 dark:text-emerald-300">{fmtBirr(emp.baseSalary)}</span> : '—'}
            />
            <DetailRow label="Bank" value={emp.bankName ?? '—'} />
            <DetailRow label="Account no" value={emp.bankAccount ? <span className="tnum">{emp.bankAccount}</span> : '—'} />
            <DetailRow label="Biometric PIN" value={emp.zkPin ? <span className="tnum">••••{String(emp.zkPin).slice(-2)}</span> : '—'} />
            <DetailRow
              label="Status"
              value={<Badge tone={emp.isActive ? 'pass' : 'neutral'}>{emp.isActive ? 'Active' : 'Inactive'}</Badge>}
            />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to={`/hr/payslips?employeeId=${emp.id}`}>
              <Button variant="secondary" className="!px-3 !py-1.5 !text-xs">
                <Mail size={14} /> View payslips
              </Button>
            </Link>
            <Link to={`/hr/attendance?employeeId=${emp.id}`}>
              <Button variant="secondary" className="!px-3 !py-1.5 !text-xs">
                <Clock size={14} /> Attendance history
              </Button>
            </Link>
          </div>
        </Card>
      </div>

      {/* Recent attendance */}
      <div className={`${hrShell} mt-4`}>
        <CardHeader
          icon={<BadgeCheck className="h-4 w-4" />}
          title="Recent attendance"
          subtitle="Last 10 attendance records"
        />
        {attQ.isLoading ? (
          <Spinner label="Loading attendance..." />
        ) : attQ.isError ? (
          <ErrorBox message="Failed to load attendance." onRetry={() => attQ.refetch()} />
        ) : (
          <DataTable<AttendanceRecord>
            columns={[
              { key: 'date', label: 'Date', render: (r) => <span className="tnum">{fmtDate(r.date)}</span> },
              {
                key: 'status', label: 'Status',
                render: (r) => (
                  <Badge tone={r.status === 'PRESENT' ? 'pass' : r.status === 'ABSENT' ? 'critical' : 'advisory'}>
                    {r.status.replace('_', ' ')}
                  </Badge>
                )
              },
              { key: 'checkIn', label: 'Check-in', render: (r) => <span className="tnum text-sm">{r.checkIn ?? '—'}</span> },
              { key: 'checkOut', label: 'Check-out', render: (r) => <span className="tnum text-sm">{r.checkOut ?? '—'}</span> },
              { key: 'workHours', label: 'Hours', render: (r) => <span className="tnum">{Number(r.workHours).toFixed(1)}h</span> },
            ]}
            rows={attendance}
            emptyTitle="No attendance records."
            emptySub="Records will appear here once attendance is logged."
          />
        )}
      </div>
    </div>
  );
}
