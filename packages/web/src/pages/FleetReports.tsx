import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtBirr } from '../lib/format';
import type { FleetSummary } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, ErrorBox, Field, Spinner, TextInput } from '../components/ui';

const cardShell = 'bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5';

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

type CsvKind = 'trips' | 'fuel' | 'maintenance' | 'expenses' | 'summary';

export function FleetReports() {
  const [from, setFrom] = useState(todayMinus(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<CsvKind | null>(null);

  const summaryQ = useQuery({
    queryKey: ['fleet-report-summary', from, to],
    queryFn: async () => (await api.get<FleetSummary[]>(E.fleetReportSummary(from, to))).data
  });

  const downloadCsv = async (kind: CsvKind) => {
    // Fetch through the authed api client (Bearer <redacted>), then trigger a Blob download.
    try {
      setNotice(null);
      setDownloading(kind);
      const res = await api.get(E.fleetReportCsv(kind, from, to), { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind}-fleet-${from}-to-${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setNotice('CSV export failed — check your connection and retry.');
    } finally {
      setDownloading(null);
    }
  };

  const rows = summaryQ.data ?? [];
  const fleetTotal = rows.reduce(
    (s, r) => ({
      km: s.km + r.totalKm,
      fuel: s.fuel + r.fuelCostBirr,
      exp: s.exp + r.expenseCostBirr,
      maint: s.maint + r.maintenanceCostBirr,
      total: s.total + r.totalCostBirr,
      liters: s.liters + r.fuelLiters,
      trips: s.trips + r.tripCount
    }),
    { km: 0, fuel: 0, exp: 0, maint: 0, total: 0, liters: 0, trips: 0 }
  );
  const avgKmPerL = fleetTotal.liters > 0 && fleetTotal.km > 0 ? fleetTotal.km / fleetTotal.liters : null;
  const avgCostPerKm = fleetTotal.km > 0 ? fleetTotal.total / fleetTotal.km : null;

  return (
    <div className="space-y-5">
      <div className={cardShell}>
        <CardHeader
          icon={<BarChart3 size={16} />}
          title="Fleet Reports"
          subtitle="Cost-per-km, fuel efficiency and maintenance summaries per vehicle"
          action={
            <div className="flex flex-wrap items-end gap-2">
              <Field label="From">
                <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Button variant="secondary" onClick={() => summaryQ.refetch()}>
                Refresh
              </Button>
            </div>
          }
        />

        <div className="mb-4 flex flex-wrap gap-2">
          {(['summary', 'trips', 'fuel', 'maintenance', 'expenses'] as CsvKind[]).map((kind) => (
            <Button key={kind} variant="secondary" onClick={() => downloadCsv(kind)} loading={downloading === kind}>
              <Download size={14} /> {kind[0].toUpperCase() + kind.slice(1)} CSV
            </Button>
          ))}
        </div>
        {notice ? (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{notice}</div>
        ) : null}

        {summaryQ.isLoading ? (
          <Spinner label="Building report..." />
        ) : summaryQ.isError ? (
          <ErrorBox message="Could not build the report." onRetry={() => summaryQ.refetch()} />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-3">
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500">Fleet cost (period)</p>
                <p className="text-xl font-bold text-slate-800 tabular-nums">{fmtBirr(fleetTotal.total)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500">Total km</p>
                <p className="text-xl font-bold text-slate-800 tabular-nums">{fleetTotal.km.toLocaleString('en-US')}</p>
              </div>
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500">Avg cost / km</p>
                <p className="text-xl font-bold text-slate-800 tabular-nums">{avgCostPerKm != null ? fmtBirr(avgCostPerKm) : '—'}</p>
              </div>
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500">Avg fuel efficiency</p>
                <p className="text-xl font-bold text-slate-800 tabular-nums">
                  {avgKmPerL != null ? `${avgKmPerL.toFixed(2)} km/L` : '—'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500">Trips</p>
                <p className="text-xl font-bold text-slate-800 tabular-nums">{fleetTotal.trips}</p>
              </div>
            </div>

            <DataTable<FleetSummary>
              columns={[
                { key: 'plateNo', label: 'Vehicle', render: (r) => <span className="font-bold tabular-nums">{r.plateNo}</span> },
                { key: 'ownership', label: 'Ownership', render: (r) => <Badge tone={r.ownership === 'OWNED' ? 'pass' : 'advisory'}>{r.ownership}</Badge> },
                { key: 'trips', label: 'Trips', mono: true, render: (r) => String(r.tripCount) },
                { key: 'km', label: 'Km', mono: true, render: (r) => r.totalKm.toLocaleString('en-US') },
                { key: 'fuelCost', label: 'Fuel (ETB)', mono: true, render: (r) => fmtBirr(r.fuelCostBirr) },
                { key: 'expenses', label: 'Expenses (ETB)', mono: true, render: (r) => fmtBirr(r.expenseCostBirr) },
                { key: 'maint', label: 'Maintenance (ETB)', mono: true, render: (r) => fmtBirr(r.maintenanceCostBirr) },
                { key: 'total', label: 'Total (ETB)', mono: true, render: (r) => fmtBirr(r.totalCostBirr) },
                { key: 'eff', label: 'km / L', mono: true, render: (r) => (r.kmPerLiter != null ? r.kmPerLiter.toFixed(2) : '—') },
                {
                  key: 'cpk',
                  label: 'Cost / km (ETB)',
                  mono: true,
                  render: (r) => (
                    <span className={`font-bold ${r.costPerKmBirr != null && r.costPerKmBirr > 60 ? 'text-red-600' : ''}`}>
                      {r.costPerKmBirr != null ? fmtBirr(r.costPerKmBirr) : '—'}
                    </span>
                  )
                }
              ]}
              rows={rows}
              emptyTitle="No report data for this period."
              emptySub="Log trips with odometer readings, fuel and costs to build the summary."
            />
            <p className="mt-3 text-xs text-slate-500">
              Cost / km = (fuel + operating expenses + maintenance) ÷ odometer km in the period. See the Utilization page for per-vehicle utilization percentages.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
