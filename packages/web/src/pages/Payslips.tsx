import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { HrPayrollRun, Payslip } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Field, Select, Spinner, TextInput,
  ErrorBox} from '../components/ui';
import { downloadCsv, fmtBirr, fmtDate, hrShell, runPeriodLabel } from './HrShared';

function BreakdownRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={`text-sm ${bold ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{label}</span>
      <span className={`tnum text-sm ${bold ? 'font-bold text-slate-900' : 'text-slate-700'}`}>{value}</span>
    </div>
  );
}

export function Payslips() {
  const [runId, setRunId] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Payslip | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const runsQ = useQuery({
    queryKey: ['hr-payroll-runs'],
    queryFn: async () => (await api.get<HrPayrollRun[]>(E.hrPayrollRuns)).data
  });
  const slipsQ = useQuery({
    queryKey: ['hr-payslips', runId],
    queryFn: async () =>
      (await api.get<Payslip[]>(E.hrPayslips, { params: runId ? { runId } : {} })).data,
    enabled: runsQ.isSuccess
  });

  const slips = (slipsQ.data ?? []).filter((s) =>
    search
      ? (s.employee?.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (s.employee?.employeeNo ?? '').toLowerCase().includes(search.toLowerCase())
      : true
  );

  const totals = slips.reduce(
    (acc, s) => ({
      gross: acc.gross + Number(s.grossBirr),
      allow: acc.allow + Number(s.allowanceBirr),
      ded: acc.ded + Number(s.deductionBirr),
      net: acc.net + Number(s.netBirr)
    }),
    { gross: 0, allow: 0, ded: 0, net: 0 }
  );

  const exportSummary = () => {
    const run = (runsQ.data ?? []).find((r) => r.id === runId);
    downloadCsv(
      `payroll-summary-${run ? runPeriodLabel(run) : 'all'}.csv`,
      ['Employee ID', 'Name', 'Gross (ETB)', 'Allowances (ETB)', 'Deductions (ETB)', 'Net (ETB)', 'Period'],
      slips.map((s) => [
        s.employee?.employeeNo ?? '',
        s.employee?.name ?? '',
        Number(s.grossBirr).toFixed(2),
        Number(s.allowanceBirr).toFixed(2),
        Number(s.deductionBirr).toFixed(2),
        Number(s.netBirr).toFixed(2),
        s.payrollRun ? runPeriodLabel(s.payrollRun) : ''
      ])
    );
  };

  const printSlip = () => {
    const el = printRef.current;
    if (!el) return;
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return;
    w.document.write(
      `<html><head><title>Payslip</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#111}table{width:100%;border-collapse:collapse}td{padding:6px 4px;border-bottom:1px solid #e2e8f0;font-size:13px}.h{font-size:18px;font-weight:bold}.sub{color:#64748b;font-size:12px}.tot td{font-weight:bold;border-top:2px solid #111}</style></head><body>${el.innerHTML}</body></html>`
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const b = selected?.breakdown ?? {};

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white">
            <FileText className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Payslips & Payroll Reports</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Individual payslips, payroll summaries and CSV export
            </p>
          </div>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          onClick={exportSummary}
        >
          <Download className="h-4 w-4" /> Export summary CSV
        </button>
      </div>

      <div className={`${hrShell} mb-4 grid grid-cols-1 gap-4 md:grid-cols-3`}>
        <Field label="Payroll run">
          <Select value={runId} onChange={(e) => { setRunId(e.target.value); setSelected(null); }}>
            <option value="">All runs</option>
            {(runsQ.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {runPeriodLabel(r)} — {r.status} ({r._count?.lines ?? 0} staff)
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Search employee">
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or employee ID..." />
        </Field>
        <div className="tnum flex items-end gap-5 pb-2 text-sm text-slate-600 dark:text-slate-300">
          <span><span className="font-bold text-slate-900 dark:text-slate-100">{fmtBirr(totals.gross)}</span> gross</span>
          <span><span className="font-bold text-violet-700">{fmtBirr(totals.net)}</span> net</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={hrShell}>
          <CardHeader
            icon={<FileText className="h-4 w-4" />}
            title={`Payslips (${slips.length})`}
            subtitle="Select a slip to view and print"
          />
          {slipsQ.isLoading ? (
            <Spinner label="Loading payslips..." />
          ) : slipsQ.isError ? (
          <ErrorBox message="Failed to load payslips." onRetry={() => slipsQ.refetch()} />
        ) : (
            <DataTable<Payslip>
              columns={[
                { key: 'emp', label: 'Employee', render: (r) => `${r.employee?.name ?? '—'} (${r.employee?.employeeNo ?? ''})` },
                {
                  key: 'period',
                  label: 'Period',
                  render: (r) => <span className="tnum">{r.payrollRun ? runPeriodLabel(r.payrollRun) : '—'}</span>
                },
                { key: 'gross', label: 'Gross', mono: true, render: (r) => fmtBirr(Number(r.grossBirr)) },
                {
                  key: 'net',
                  label: 'Net pay',
                  mono: true,
                  render: (r) => <span className="font-bold text-violet-700">{fmtBirr(Number(r.netBirr))}</span>
                },
                {
                  key: 'open',
                  label: '',
                  render: (r) => (
                    <button
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      onClick={() => setSelected(r)}
                    >
                      View
                    </button>
                  )
                }
              ]}
              rows={slips}
              emptyTitle="No payslips yet"
              emptySub="Payslips are generated when a payroll run is posted to finance."
            />
          )}
        </div>

        <div className={hrShell}>
          <CardHeader
            icon={<Printer className="h-4 w-4" />}
            title="Payslip"
            subtitle={selected ? `${selected.employee?.name} — ${selected.payrollRun ? runPeriodLabel(selected.payrollRun) : ''}` : 'Select a slip'}
            action={
              selected ? (
                <button
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                  onClick={printSlip}
                >
                  <Printer className="h-4 w-4" /> Print
                </button>
              ) : undefined
            }
          />
          {selected ? (
            <div ref={printRef}>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <p className="h text-center">OYAYA FLOUR PRODUCTION COMPANY PLC</p>
                <p className="sub mt-1 text-center">
                  Payslip — {selected.payrollRun ? runPeriodLabel(selected.payrollRun) : ''}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <p><span className="sub">Employee: </span><strong>{selected.employee?.name}</strong></p>
                  <p><span className="sub">ID: </span><strong className="tnum">{selected.employee?.employeeNo}</strong></p>
                  <p><span className="sub">Position: </span>{(selected.employee as { jobTitle?: string })?.jobTitle ?? '—'}</p>
                  <p><span className="sub">Pay mode: </span>{String(b.mode ?? '').replace('_', ' ')}</p>
                </div>
                <table className="mt-4">
                  <tbody>
                    <BreakdownRow label="Base salary" value={fmtBirr(Number(b.base ?? 0))} />
                    <BreakdownRow
                      label={`Overtime (${Number(b.overtimeHours ?? 0).toFixed(1)}h)`}
                      value={fmtBirr(Number(b.overtime ?? 0))}
                    />
                    <BreakdownRow
                      label={`Piece-rate (${Number(b.pieceQuintals ?? 0).toFixed(1)} q)`}
                      value={fmtBirr(Number(b.piece ?? 0))}
                    />
                    <BreakdownRow
                      label={`Trip pay (${b.trips ?? 0} trips)`}
                      value={fmtBirr(Number(b.trip ?? 0))}
                    />
                    <BreakdownRow label="Allowances" value={'+' + fmtBirr(Number(selected.allowanceBirr))} />
                    <BreakdownRow label="Deductions" value={'−' + fmtBirr(Number(selected.deductionBirr))} />
                    <tr className="tot">
                      <td>Net pay</td>
                      <td className="tnum text-right">{fmtBirr(Number(selected.netBirr))}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="sub mt-4">
                  Generated {fmtDate(selected.generatedAt)} · Oyaya Flour Mill ERP — HR & Payroll
                </p>
              </div>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">No payslip selected.</p>
          )}
        </div>
      </div>

      <div className={`${hrShell} mt-4`}>
        <CardHeader
          icon={<FileText className="h-4 w-4" />}
          title="Payroll status report"
          subtitle="Run lifecycle across periods"
        />
        <DataTable<HrPayrollRun>
          columns={[
            { key: 'period', label: 'Period', render: (r) => <span className="tnum font-bold">{runPeriodLabel(r)}</span> },
            {
              key: 'status',
              label: 'Status',
              render: (r) => (
                <Badge tone={r.status === 'POSTED' ? 'pass' : r.status === 'APPROVED' ? 'neutral' : 'advisory'}>
                  {r.status}
                </Badge>
              )
            },
            { key: 'staff', label: 'Staff paid', mono: true, render: (r) => r._count?.lines ?? '—' },
            { key: 'approved', label: 'Approved', render: (r) => (r.approvedAt ? fmtDate(r.approvedAt) : '—') },
            { key: 'posted', label: 'Posted to finance', render: (r) => (r.postedAt ? fmtDate(r.postedAt) : '—') }
          ]}
          rows={runsQ.data ?? []}
          emptyTitle="No payroll runs yet"
        />
      </div>
    </div>
  );
}
