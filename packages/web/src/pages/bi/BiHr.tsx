import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Clock, Download, FileText, UserCheck, Users, Wallet } from 'lucide-react';
import { E } from '../../lib/endpoints';
import { fmtBirr, fmtInt, fmtQ } from '../../lib/format';
import { exportToCSV, exportToPDF } from '../../lib/exportUtils';
import { KpiCard } from '../../components/KpiCard';
import { Button } from '../../components/ui';
import { BiError, BiLoading, BiShell, CHART_COLORS, ChartCard, NoAccessState, PIE_COLORS, fmtPct1, useBiQuery } from './shared';
import type { HrBi } from './types';

const CLAIM = 'payroll:view';

export function BiHr() {
  const { allowed, data, isLoading, isError, refetch } = useBiQuery<HrBi>('bi-hr', E.biHr, [CLAIM]);

  if (!allowed) return <NoAccessState domain="HR & Payroll" />;
  if (isLoading) return <BiLoading />;
  if (isError || !data) return <BiError onRetry={() => refetch()} />;

  const { kpis, charts } = data;
  const attendanceRows = charts.attendanceTrend.map((r) => ({
    Date: r.day,
    Present: r.present
  }));

  const actions = (
    <>
      <Button variant="ghost" onClick={() => exportToCSV(attendanceRows, `oyaya-attendance-trend-${Date.now()}.csv`)} title="Export attendance trend as CSV">
        <Download className="mr-1.5 h-4 w-4" /> CSV
      </Button>
      <Button
        variant="ghost"
        onClick={() => exportToPDF('HR — 14-day attendance trend', ['Date', 'Present'], attendanceRows)}
        title="Export as PDF"
      >
        <FileText className="mr-1.5 h-4 w-4" /> PDF
      </Button>
    </>
  );

  return (
    <BiShell
      icon={<Users className="h-6 w-6" />}
      title="HR & Payroll"
      subtitle={`Workforce and payroll cost${kpis.payrollPeriod ? ` · payroll period ${kpis.payrollPeriod}` : ''}`}
      actions={actions}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Users className="h-6 w-6" />} label="Headcount (active)" value={fmtInt(kpis.headcount)} index={0} />
        <KpiCard
          icon={<UserCheck className="h-6 w-6" />}
          label={`Present today${kpis.attendancePct !== null ? ` · ${fmtPct1(kpis.attendancePct)}` : ''}`}
          value={fmtInt(kpis.attendanceToday)}
          tone="green"
          index={1}
        />
        <KpiCard
          icon={<Clock className="h-6 w-6" />}
          label="Overtime hours (period)"
          value={`${fmtQ(kpis.overtimeHoursMTD)} h`}
          tone="amber"
          index={2}
        />
        <KpiCard icon={<Wallet className="h-6 w-6" />} label="Payroll cost (period)" value={fmtBirr(kpis.payrollCostMTD)} tone="blue" index={3} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard icon={<Users className="h-4 w-4" />} title="Headcount by department" subtitle="Active employees">
          {charts.headcountByDept.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No active employees.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={charts.headcountByDept} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="department" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={130} />
                <Tooltip formatter={(v: unknown) => [fmtInt(Number(v)), 'Employees']} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {charts.headcountByDept.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard icon={<UserCheck className="h-4 w-4" />} title="Attendance trend — last 14 days" subtitle="Unique employees punching in per day">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={charts.attendanceTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip formatter={(v: unknown) => [fmtInt(Number(v)), 'Present']} />
              <Line type="monotone" dataKey="present" stroke={CHART_COLORS.violet} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </BiShell>
  );
}
