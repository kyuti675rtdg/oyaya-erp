import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Lock, Play } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { HrPayrollLine, HrPayrollRun } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Field, Select, Spinner, TextInput } from '../components/ui';
import { fmtBirr, fmtDate, fmtQ } from '../lib/format';
import {
  HrNotice,
  hrPrimaryBtn,
  hrSecondaryBtn,
  hrShell,
  modeLabel,
  runPeriodLabel,
  useHrPerms
} from './HrShared';

function statusTone(s: string): 'advisory' | 'pass' | 'neutral' {
  if (s === 'DRAFT') return 'advisory';
  if (s === 'APPROVED') return 'neutral';
  return 'pass';
}

export function PayrollProcessing() {
  const { canManage, canApprove } = useHrPerms();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [group, setGroup] = useState('ALL');
  const [selectedRunId, setSelectedRunId] = useState('');const runsQ = useQuery({
    queryKey: ['hr-payroll-runs'],
    queryFn: async () => (await api.get<HrPayrollRun[]>(E.hrPayrollRuns)).data
  });
  const runQ = useQuery({
    queryKey: ['hr-payroll-run', selectedRunId],
    queryFn: async () => (await api.get<HrPayrollRun>(E.hrPayrollRun(selectedRunId))).data,
    enabled: !!selectedRunId
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['hr-payroll-runs'] });
    queryClient.invalidateQueries({ queryKey: ['hr-payroll-run'] });
  };

  const computeM = useMutation({
    mutationFn: async (payload: { year: number; month: number }) =>
      (await api.post<HrPayrollRun>(E.hrPayrollRuns, { year: payload.year, month: payload.month })).data,
    onSuccess: (run) => {
      setNotice({ ok: true, text: `Payroll computed for ${runPeriodLabel(run)} — review lines, then approve.` });
      setSelectedRunId(run.id);
      invalidate();
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Compute failed.' })
  });

  const approveM = useMutation({
    mutationFn: async (id: string) => (await api.post(E.hrPayrollRunApprove(id))).data,
    onSuccess: () => {
      setNotice({ ok: true, text: 'Payroll run approved. It can now be posted to finance.' });
      invalidate();
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Approval failed.' })
  });

  const postM = useMutation({
    mutationFn: async (id: string) => (await api.post<HrPayrollRun>(E.hrPayrollRunPost(id))).data,
    onSuccess: (run) => {
      setNotice({
        ok: true,
        text: `Posted to finance (journal ${run.journalEntryId ?? ''}) — run is now locked and payslips are generated.`
      });
      invalidate();
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Posting failed.' })
  });

  const onCompute = (e: FormEvent) => {
    e.preventDefault();
    const [y, m] = period.split('-').map(Number);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      setNotice({ ok: false, text: 'Select a valid pay period.' });
      return;
    }
    computeM.mutate({ year: y, month: m });
  };

  const run = runQ.data;
  const lines = (run?.lines ?? []).filter((l) => group === 'ALL' || l.mode === group);
  const totals = lines.reduce(
    (acc, l) => ({
      gross: acc.gross + Number(l.grossBirr),
      allow: acc.allow + Number(l.allowanceBirr),
      ded: acc.ded + Number(l.deductionBirr),
      net: acc.net + Number(l.netBirr)
    }),
    { gross: 0, allow: 0, ded: 0, net: 0 }
  );

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white">
          <ClipboardList className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Payroll Processing & Approval</h1>
          <p className="text-sm text-slate-500">
            Compute → review → approve → post to finance. Posted runs are locked.
          </p>
        </div>
      </div>

      {notice ? <HrNotice ok={notice.ok} text={notice.text} /> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={hrShell}>
          <CardHeader icon={<Play className="h-4 w-4" />} title="New payroll run" subtitle="All three payroll modes are computed together" />
          {canManage ? (
            <form onSubmit={onCompute} className="space-y-4">
              <Field label="Pay period" required>
                <TextInput type="month" value={period} onChange={(e) => setPeriod(e.target.value)} required />
              </Field>
              <button type="submit" className={hrPrimaryBtn + ' w-full'} disabled={computeM.isPending}>
                {computeM.isPending ? 'Computing...' : 'Compute payroll run'}
              </button>
            </form>
          ) : (
            <p className="text-sm text-slate-500">You need payroll management rights to compute a run.</p>
          )}

          <h3 className="mb-3 mt-8 text-sm font-bold uppercase tracking-widest text-slate-500">Workflow</h3>
          <ol className="space-y-2 text-sm text-slate-600">
            <li className="flex gap-2"><span className="tnum font-bold text-violet-700">1.</span> Compute creates a DRAFT run with one line per active employee.</li>
            <li className="flex gap-2"><span className="tnum font-bold text-violet-700">2.</span> Review the lines and totals below.</li>
            <li className="flex gap-2"><span className="tnum font-bold text-violet-700">3.</span> Approve (requires <code className="rounded bg-slate-100 px-1">hr:approve</code>) moves DRAFT → APPROVED.</li>
            <li className="flex gap-2"><span className="tnum font-bold text-violet-700">4.</span> Post writes the payroll journal to Finance (Dr 6000 / Cr 2000) and generates payslips — the run locks.</li>
          </ol>
        </div>

        <div className="lg:col-span-2">
          <div className={hrShell}>
            <CardHeader icon={<ClipboardList className="h-4 w-4" />} title="Payroll runs" subtitle="Newest first" />
            {runsQ.isLoading ? (
              <Spinner label="Loading runs..." />
            ) : (
              <DataTable<HrPayrollRun>
                columns={[
                  { key: 'period', label: 'Period', render: (r) => <span className="tnum font-bold">{runPeriodLabel(r)}</span> },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (r) => (
                      <Badge tone={statusTone(r.status)}>
                        {r.status === 'POSTED' ? <Lock className="mr-1 inline h-3 w-3" /> : null}
                        {r.status}
                      </Badge>
                    )
                  },
                  { key: 'lines', label: 'Lines', mono: true, render: (r) => r._count?.lines ?? '—' },
                  { key: 'created', label: 'Computed', render: (r) => fmtDate(r.createdAt) },
                  { key: 'approved', label: 'Approved', render: (r) => (r.approvedAt ? fmtDate(r.approvedAt) : '—') },
                  {
                    key: 'open',
                    label: '',
                    render: (r) => (
                      <button className={hrSecondaryBtn + ' px-3 py-1.5 text-xs'} onClick={() => setSelectedRunId(r.id)}>
                        Review
                      </button>
                    )
                  }
                ]}
                rows={runsQ.data ?? []}
                emptyTitle="No payroll runs yet"
              />
            )}
          </div>

          {selectedRunId ? (
            <div className={`${hrShell} mt-4`}>
              <CardHeader
                icon={<CheckCircle2 className="h-4 w-4" />}
                title={`Run review ${run ? `— ${runPeriodLabel(run)}` : ''}`}
                subtitle="Verify every line before approval — filter by employee group"
                action={
                  run && canApprove ? (
                    <div className="flex gap-2">
                      {run.status === 'DRAFT' ? (
                        <button className={hrPrimaryBtn} disabled={approveM.isPending} onClick={() => approveM.mutate(run.id)}>
                          <CheckCircle2 className="h-4 w-4" /> {approveM.isPending ? 'Approving...' : 'Approve run'}
                        </button>
                      ) : null}
                      {run.status === 'APPROVED' ? (
                        <button className={hrPrimaryBtn} disabled={postM.isPending} onClick={() => postM.mutate(run.id)}>
                          <Lock className="h-4 w-4" /> {postM.isPending ? 'Posting...' : 'Post to finance'}
                        </button>
                      ) : null}
                    </div>
                  ) : undefined
                }
              />
              {runQ.isLoading ? (
                <Spinner label="Loading lines..." />
              ) : (
                <>
                  <div className="mb-4 flex items-center gap-3">
                    <Field label="Employee group">
                      <Select value={group} onChange={(e) => setGroup(e.target.value)}>
                        <option value="ALL">All employees</option>
                        <option value="FIXED">Fixed salary</option>
                        <option value="PIECE_RATE">Piece-rate</option>
                        <option value="TRIP_BASED">Drivers</option>
                      </Select>
                    </Field>
                    <p className="text-xs text-slate-500">Review lines for one payroll mode at a time.</p>
                  </div>
                  <div className="tnum mb-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <p className="text-xs text-slate-500">Gross</p>
                      <p className="font-bold">{fmtBirr(totals.gross)}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <p className="text-xs text-slate-500">Allowances</p>
                      <p className="font-bold text-emerald-700">+{fmtBirr(totals.allow)}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <p className="text-xs text-slate-500">Deductions</p>
                      <p className="font-bold text-red-700">−{fmtBirr(totals.ded)}</p>
                    </div>
                    <div className="rounded-xl bg-violet-50 px-4 py-3">
                      <p className="text-xs text-violet-600">Net payable</p>
                      <p className="font-bold text-violet-800">{fmtBirr(totals.net)}</p>
                    </div>
                  </div>
                  <DataTable<HrPayrollLine>
                    columns={[
                      { key: 'emp', label: 'Employee', render: (r) => `${r.employee?.name ?? r.employeeId} (${r.employee?.employeeNo ?? ''})` },
                      { key: 'mode', label: 'Mode', render: (r) => modeLabel(r.mode) },
                      { key: 'base', label: 'Base', mono: true, render: (r) => fmtBirr(Number(r.baseBirr)) },
                      { key: 'ot', label: 'Overtime', mono: true, render: (r) => `${Number(r.overtimeHours).toFixed(1)}h / ${fmtBirr(Number(r.overtimeBirr))}` },
                      { key: 'piece', label: 'Piece', mono: true, render: (r) => `${fmtQ(Number(r.pieceQuintals))}q / ${fmtBirr(Number(r.pieceBirr))}` },
                      { key: 'trips', label: 'Trips', mono: true, render: (r) => `${r.trips} / ${fmtBirr(Number(r.tripBirr))}` },
                      { key: 'gross', label: 'Gross', mono: true, render: (r) => fmtBirr(Number(r.grossBirr)) },
                      { key: 'allow', label: '+Allow', mono: true, render: (r) => fmtBirr(Number(r.allowanceBirr)) },
                      { key: 'ded', label: '−Deduct', mono: true, render: (r) => fmtBirr(Number(r.deductionBirr)) },
                      {
                        key: 'net',
                        label: 'Net',
                        mono: true,
                        render: (r) => <span className="font-bold text-violet-700">{fmtBirr(Number(r.netBirr))}</span>
                      }
                    ]}
                    rows={lines}
                    emptyTitle="No lines in this run"
                  />
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
