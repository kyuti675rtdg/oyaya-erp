import { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Save, Trash2, FolderOpen } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { E } from '../../lib/endpoints';
import { exportToCSV, exportToPDF } from '../../lib/exportUtils';
import { useAuth } from '../../store/auth';
import { Button, EmptyState, ErrorBox, Field, Select, Spinner, TextInput } from '../../components/ui';
import { DataTable } from '../../components/DataTable';
import { BiShell, cardShell, ChartCard } from './shared';
import type {
  FinanceCharts,
  HrCharts,
  InventoryCharts,
  ProcurementCharts,
  ProductionCharts,
  QualityCharts,
  SalesCharts
} from './types';

type Row = Record<string, string | number>;

interface TableDef {
  key: string;
  label: string;
  /** Field labels the user can toggle. */
  fields: string[];
  /** Filterable YYYY-MM-DD field (row key), or null when the table has no day granularity. */
  dateField: string | null;
}

interface DomainDef {
  key: string;
  label: string;
  endpoint: string;
  claim: string;
  tables: TableDef[];
  extract: (charts: unknown, tableKey: string) => Row[];
}

const DOMAINS: DomainDef[] = [
  {
    key: 'production',
    label: 'Production',
    endpoint: E.biProduction,
    claim: 'production:view',
    tables: [
      { key: 'outputTrend', label: 'Daily output & extraction', fields: ['Date', 'Output (Q)', 'Extraction %'], dateField: 'Date' },
      { key: 'downtimeByReason', label: 'Downtime by reason (7d)', fields: ['Reason', 'Hours'], dateField: null }
    ],
    extract: (charts: unknown, tableKey: string): Row[] => {
      const c = charts as ProductionCharts;
      if (tableKey === 'downtimeByReason')
        return c.downtimeByReason.map((r) => ({ Date: r.reason, Reason: r.reason, Hours: r.hours }));
      return c.outputTrend.map((r) => ({
        Date: r.day,
        'Output (Q)': r.outputQ,
        'Extraction %': r.extractionPct === null ? '—' : `${r.extractionPct.toFixed(2)}%`
      }));
    }
  },
  {
    key: 'quality',
    label: 'Quality & CAPA',
    endpoint: E.biQuality,
    claim: 'qc:view',
    tables: [
      { key: 'passRateTrend', label: 'Daily pass rate', fields: ['Date', 'Pass rate %', 'Tests'], dateField: 'Date' },
      { key: 'capaAging', label: 'CAPA aging', fields: ['Age bucket', 'CAPAs'], dateField: null },
      { key: 'defectPareto', label: 'Defects by severity (30d)', fields: ['Severity', 'Defects'], dateField: null }
    ],
    extract: (charts: unknown, tableKey: string): Row[] => {
      const c = charts as QualityCharts;
      if (tableKey === 'capaAging') return c.capaAging.map((r) => ({ 'Age bucket': r.bucket, CAPAs: r.count }));
      if (tableKey === 'defectPareto') return c.defectPareto.map((r) => ({ Severity: r.severity, Defects: r.count }));
      return c.passRateTrend.map((r) => ({
        Date: r.day,
        'Pass rate %': r.passRate === null ? '—' : `${r.passRate.toFixed(1)}%`,
        Tests: r.tests
      }));
    }
  },
  {
    key: 'procurement',
    label: 'Procurement',
    endpoint: E.biProcurement,
    claim: 'procurement:view',
    tables: [
      { key: 'intakeTrend', label: 'Daily intake by wheat type', fields: ['Date', 'Soft (Q)', 'Hard (Q)', 'Foreign (Q)'], dateField: 'Date' },
      { key: 'wheatMix', label: 'Wheat mix (30d)', fields: ['Category', 'Quintals'], dateField: null },
      { key: 'priceTrend', label: 'Weekly price trend', fields: ['Week', 'Price (ETB/Q)'], dateField: null }
    ],
    extract: (charts: unknown, tableKey: string): Row[] => {
      const c = charts as ProcurementCharts;
      if (tableKey === 'wheatMix') return c.wheatMix.map((r) => ({ Category: r.category, Quintals: r.quintals }));
      if (tableKey === 'priceTrend') return c.priceTrend.map((r) => ({ Week: r.week, 'Price (ETB/Q)': r.price }));
      return c.intakeTrend.map((r) => ({
        Date: r.day,
        'Soft (Q)': r.soft,
        'Hard (Q)': r.hard,
        'Foreign (Q)': r.foreign
      }));
    }
  },
  {
    key: 'inventory',
    label: 'Inventory',
    endpoint: E.biInventory,
    claim: 'storage:view',
    tables: [
      { key: 'stockLevels', label: 'Stock levels by location', fields: ['Location', 'Stock (Q)', 'Capacity (Q)'], dateField: null },
      { key: 'finishedGoodsByProduct', label: 'Finished goods by product', fields: ['Product', 'Quintals'], dateField: null },
      { key: 'movementTrend', label: 'Daily movements', fields: ['Date', 'Receipts (Q)', 'Issues (Q)'], dateField: 'Date' }
    ],
    extract: (charts: unknown, tableKey: string): Row[] => {
      const c = charts as InventoryCharts;
      if (tableKey === 'finishedGoodsByProduct')
        return c.finishedGoodsByProduct.map((r) => ({ Product: r.product, Quintals: r.quintals }));
      if (tableKey === 'movementTrend')
        return c.movementTrend.map((r) => ({ Date: r.day, 'Receipts (Q)': r.in, 'Issues (Q)': r.out }));
      return c.stockLevels.map((r) => ({ Location: r.name, 'Stock (Q)': r.quintals, 'Capacity (Q)': r.capacity || '—' }));
    }
  },
  {
    key: 'sales',
    label: 'Sales',
    endpoint: E.biSales,
    claim: 'sales:view',
    tables: [
      { key: 'revenueTrend', label: 'Monthly revenue', fields: ['Month', 'Revenue (ETB)'], dateField: null },
      { key: 'salesByProduct', label: 'Sales by product (MTD)', fields: ['Product', 'Dispatched (Q)'], dateField: null }
    ],
    extract: (charts: unknown, tableKey: string): Row[] => {
      const c = charts as SalesCharts;
      if (tableKey === 'salesByProduct')
        return c.salesByProduct.map((r) => ({ Product: r.product, 'Dispatched (Q)': r.quintals }));
      return c.revenueTrend.map((r) => ({ Month: r.month, 'Revenue (ETB)': r.revenue }));
    }
  },
  {
    key: 'finance',
    label: 'Finance',
    endpoint: E.biFinance,
    claim: 'finance:view',
    tables: [
      { key: 'cashFlow', label: 'Weekly cash flow', fields: ['Week', 'Inflow (ETB)', 'Outflow (ETB)'], dateField: null },
      { key: 'expenseBreakdown', label: 'Top supplier spend (90d)', fields: ['Supplier', 'Spend (ETB)'], dateField: null }
    ],
    extract: (charts: unknown, tableKey: string): Row[] => {
      const c = charts as FinanceCharts;
      if (tableKey === 'expenseBreakdown')
        return c.expenseBreakdown.map((r) => ({ Supplier: r.supplier, 'Spend (ETB)': r.amount }));
      return c.cashFlow.map((r) => ({ Week: r.week, 'Inflow (ETB)': r.inflow, 'Outflow (ETB)': r.outflow }));
    }
  },
  {
    key: 'hr',
    label: 'HR & Payroll',
    endpoint: E.biHr,
    claim: 'payroll:view',
    tables: [
      { key: 'attendanceTrend', label: 'Daily attendance', fields: ['Date', 'Present'], dateField: 'Date' },
      { key: 'headcountByDept', label: 'Headcount by department', fields: ['Department', 'Employees'], dateField: null }
    ],
    extract: (charts: unknown, tableKey: string): Row[] => {
      const c = charts as HrCharts;
      if (tableKey === 'headcountByDept')
        return c.headcountByDept.map((r) => ({ Department: r.department, Employees: r.count }));
      return c.attendanceTrend.map((r) => ({ Date: r.day, Present: r.present }));
    }
  }
];

interface SavedReport {
  id: string;
  name: string;
  domainKey: string;
  tableKey: string;
  fields: string[];
  dateFrom: string;
  dateTo: string;
  savedAt: string;
}

const STORAGE_KEY = 'oyaya-bi-reports';

function loadSaved(): SavedReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ReportBuilder() {
  const { hasClaim } = useAuth();
  const accessible = useMemo(() => DOMAINS.filter((d) => hasClaim(d.claim)), [hasClaim]);

  const [domainKey, setDomainKey] = useState(accessible[0]?.key ?? '');
  const [tableKey, setTableKey] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reportName, setReportName] = useState('');
  const [saved, setSaved] = useState<SavedReport[]>(() => loadSaved());
  const [notice, setNotice] = useState<string | null>(null);

  const domain = DOMAINS.find((d) => d.key === domainKey);
  const table = domain?.tables.find((t) => t.key === tableKey) ?? domain?.tables[0];

  // Reset table/fields when the domain changes.
  useEffect(() => {
    const t = domain?.tables[0];
    setTableKey(t?.key ?? '');
    setFields(t?.fields ?? []);
  }, [domainKey]);

  const payloadQ = useQuery({
    queryKey: ['bi-report', domainKey],
    queryFn: async () => (await api.get<{ charts: unknown }>(domain!.endpoint)).data,
    enabled: !!domain
  });

  const rows = useMemo((): Row[] => {
    if (!domain || !table || !payloadQ.data) return [];
    const all = domain.extract(payloadQ.data.charts, table.key);
    // Project to the selected fields.
    const projected = all.map((r) => {
      const out: Row = {};
      for (const f of fields) if (f in r) out[f] = r[f];
      return out;
    });
    if (!table.dateField || (!dateFrom && !dateTo)) return projected;
    // Day labels are display labels ("17 Oct"); the payload rows also carry
    // ISO `key` fields where available — re-derive from the extractor is not
    // exposed, so filter only when the row's date parses.
    return projected.filter((r) => {
      const raw = String(r[table.dateField!]);
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return true;
      if (dateFrom && d < new Date(dateFrom)) return false;
      if (dateTo && d > new Date(`${dateTo}T23:59:59`)) return false;
      return true;
    });
  }, [domain, table, fields, payloadQ.data, dateFrom, dateTo]);

  const toggleField = (f: string) =>
    setFields((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const saveReport = () => {
    const name = reportName.trim() || `${domain?.label} — ${table?.label}`;
    const def: SavedReport = {
      id: `rpt-${Date.now()}`,
      name,
      domainKey,
      tableKey: table?.key ?? '',
      fields,
      dateFrom,
      dateTo,
      savedAt: new Date().toISOString()
    };
    const next = [def, ...saved];
    setSaved(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setReportName('');
    setNotice(`Report "${name}" saved.`);
    setTimeout(() => setNotice(null), 3000);
  };

  const loadReport = (r: SavedReport) => {
    setDomainKey(r.domainKey);
    // domain effect resets table/fields; apply after a tick.
    setTimeout(() => {
      setTableKey(r.tableKey);
      setFields(r.fields);
      setDateFrom(r.dateFrom);
      setDateTo(r.dateTo);
    }, 0);
    setNotice(`Loaded "${r.name}".`);
    setTimeout(() => setNotice(null), 3000);
  };

  const deleteReport = (id: string) => {
    const next = saved.filter((r) => r.id !== id);
    setSaved(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const exportTitle = `Oyaya BI — ${domain?.label} / ${table?.label}`;

  if (accessible.length === 0) {
    return (
      <BiShell icon={<FileSpreadsheet className="h-6 w-6" />} title="Report Builder" subtitle="Build and export custom BI reports">
        <EmptyState title="No data domains available" sub="Your role has no BI permissions, so no report domains are accessible." />
      </BiShell>
    );
  }

  return (
    <BiShell
      icon={<FileSpreadsheet className="h-6 w-6" />}
      title="Report Builder"
      subtitle="Pick a domain, choose fields, preview and export"
      actions={
        <>
          <Button variant="ghost" disabled={rows.length === 0} onClick={() => exportToCSV(rows, `${domainKey}-${tableKey}-${Date.now()}.csv`)}>
            <Download className="mr-1.5 h-4 w-4" /> CSV
          </Button>
          <Button
            variant="ghost"
            disabled={rows.length === 0}
            onClick={() => exportToPDF(exportTitle, fields, rows)}
          >
            <FileText className="mr-1.5 h-4 w-4" /> PDF
          </Button>
        </>
      }
    >
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
          {notice}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard icon={<FileSpreadsheet className="h-4 w-4" />} title="1 · Domain & table" subtitle="What to report on">
          <div className="space-y-4">
            <Field label="Data domain">
              <Select value={domainKey} onChange={(e) => setDomainKey(e.target.value)}>
                {accessible.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Table">
              <Select value={table?.key ?? ''} onChange={(e) => {
                const t = domain?.tables.find((x) => x.key === e.target.value);
                setTableKey(e.target.value);
                setFields(t?.fields ?? []);
              }}>
                {domain?.tables.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fields">
              <div className="flex flex-wrap gap-2">
                {table?.fields.map((f) => (
                  <label
                    key={f}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      fields.includes(f)
                        ? 'border-violet-300 bg-violet-50 text-violet-700'
                        : 'border-slate-200 bg-white text-slate-500'
                    }`}
                  >
                    <input type="checkbox" className="sr-only" checked={fields.includes(f)} onChange={() => toggleField(f)} />
                    {f}
                  </label>
                ))}
              </div>
            </Field>
          </div>
        </ChartCard>

        <ChartCard icon={<FileSpreadsheet className="h-4 w-4" />} title="2 · Filters" subtitle="Narrow the rows">
          <div className="space-y-4">
            {table?.dateField ? (
              <>
                <Field label="From date">
                  <TextInput type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </Field>
                <Field label="To date">
                  <TextInput type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </Field>
              </>
            ) : (
              <p className="text-sm text-slate-500">
                This table has no day-level date column, so date filtering is not applicable.
              </p>
            )}
            {(dateFrom || dateTo) && (
              <Button variant="ghost" onClick={() => { setDateFrom(''); setDateTo(''); }}>
                Clear dates
              </Button>
            )}
            <p className="text-xs text-slate-400">
              Tip: export always uses the currently selected fields and filters.
            </p>
          </div>
        </ChartCard>

        <ChartCard icon={<Save className="h-4 w-4" />} title="3 · Save definition" subtitle="Reuse this report later">
          <div className="space-y-4">
            <Field label="Report name">
              <TextInput
                placeholder={`${domain?.label} — ${table?.label}`}
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
              />
            </Field>
            <Button onClick={saveReport}>
              <Save className="mr-1.5 h-4 w-4" /> Save report
            </Button>
            {saved.length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Saved reports ({saved.length})</p>
                <div className="max-h-48 space-y-1.5 overflow-y-auto">
                  {saved.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                      <button
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-semibold text-slate-700 hover:text-violet-700"
                        onClick={() => loadReport(r)}
                        title="Load this report"
                      >
                        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{r.name}</span>
                      </button>
                      <button className="shrink-0 text-slate-400 hover:text-rose-500" onClick={() => deleteReport(r.id)} title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ChartCard>
      </div>

      <div className={cardShell}>
        <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-800">Preview</h2>
            <p className="text-xs text-slate-500">
              {rows.length} row{rows.length === 1 ? '' : 's'} · {fields.length} field{fields.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        {payloadQ.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner label="Loading data..." />
          </div>
        ) : payloadQ.isError ? (
          <ErrorBox message="Failed to load report data." onRetry={() => payloadQ.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No rows to preview" sub="Select at least one field, or adjust your filters." />
        ) : (
          <DataTable
            columns={fields.map((f) => ({ key: f, label: f }))}
            rows={rows.slice(0, 100).map((r, i) => ({ id: String(i), ...r }))}
            keyOf={(r) => r.id ?? 'row'}
          />
        )}
        {rows.length > 100 ? (
          <p className="mt-2 text-xs text-slate-400">Showing the first 100 of {rows.length} rows — exports include all rows.</p>
        ) : null}
      </div>
    </BiShell>
  );
}
