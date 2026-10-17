import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { AgentSettlementReportRow, DeliveryPerformanceReport, SalesSummaryReport } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, SectionTitle, Spinner, TextInput } from '../components/ui';
import { fmtBirr, fmtDate, fmtQ } from '../lib/format';

function monthAgoISO(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function toCSV(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}

function downloadCSV(name: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

type Tab = 'summary' | 'delivery' | 'agents';

export function SalesReports() {
  const [tab, setTab] = useState<Tab>('summary');
  const [from, setFrom] = useState(monthAgoISO());
  const [to, setTo] = useState(todayISO());

  const qs = `?from=${new Date(`${from}T00:00:00`).toISOString()}&to=${new Date(`${to}T23:59:59`).toISOString()}`;

  const summaryQ = useQuery({
    queryKey: ['sales-report-summary', from, to],
    queryFn: async () => (await api.get<SalesSummaryReport>(E.salesReportsSummary(qs))).data,
    enabled: tab === 'summary'
  });
  const deliveryQ = useQuery({
    queryKey: ['sales-report-delivery', from, to],
    queryFn: async () => (await api.get<DeliveryPerformanceReport>(E.salesReportsDelivery(qs))).data,
    enabled: tab === 'delivery'
  });
  const agentsQ = useQuery({
    queryKey: ['sales-report-agents', from, to],
    queryFn: async () => (await api.get<AgentSettlementReportRow[]>(E.salesReportsAgents(qs))).data,
    enabled: tab === 'agents'
  });

  const s = summaryQ.data;
  const totalRevenue = (s?.revenueByMonth ?? []).reduce((x, r) => x + r.amountBirr, 0);
  const totalQ = (s?.byProduct ?? []).reduce((x, r) => x + r.quintals, 0);

  const exportSummary = () => {
    if (!s) return;
    downloadCSV(
      `sales-summary-${from}-${to}.csv`,
      toCSV(
        ['Section', 'Name', 'Quantity (q)', 'Bags', 'Amount (ETB)'],
        [
          ...s.byProduct.map((r) => ['Product', r.productName, r.quintals, r.bags, ''] as (string | number)[]),
          ...s.byCustomer.map((r) => ['Customer', r.customerName, r.quintals, r.orders, ''] as (string | number)[]),
          ...s.revenueByMonth.map((r) => ['Revenue month', r.month, '', '', r.amountBirr] as (string | number)[])
        ]
      )
    );
  };

  const exportDelivery = () => {
    const d = deliveryQ.data;
    if (!d) return;
    downloadCSV(
      `delivery-performance-${from}-${to}.csv`,
      toCSV(
        ['Exit note', 'Vehicle', 'Area', 'Dispatched', 'Requested', 'Verdict', 'Quintals'],
        d.rows.map((r) => [
          r.exitNoteNo,
          r.plateNo ?? '',
          r.area,
          fmtDate(r.dispatchedAt),
          r.requestedDate ? fmtDate(r.requestedDate) : '',
          r.verdict,
          r.quintals
        ])
      )
    );
  };

  const exportAgents = () => {
    const rows = agentsQ.data ?? [];
    downloadCSV(
      `agent-settlements-${from}-${to}.csv`,
      toCSV(
        ['Placement', 'Agent', 'Product', 'Placed (q)', 'Settled (q)', 'Settled (ETB)', 'Outstanding (q)', 'Status'],
        rows.map((r) => [
          r.placementNo,
          r.agentName,
          r.productName,
          r.placedQuintals,
          r.settledQuintals,
          r.settledAmountBirr,
          r.outstandingQuintals,
          r.status
        ])
      )
    );
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'summary', label: 'Sales summary' },
    { id: 'delivery', label: 'Delivery performance' },
    { id: 'agents', label: 'Agent settlements' }
  ];

  return (
    <div>
      <SectionTitle title="Sales & Distribution Reports" sub="Sales by product, customer and period · delivery performance · agent settlements" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-line bg-white p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-40" />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-40" />
          </Field>
        </div>
        <Button
          variant="secondary"
          onClick={tab === 'summary' ? exportSummary : tab === 'delivery' ? exportDelivery : exportAgents}
          className="ml-auto"
        >
          <Download className="mr-1 h-4 w-4" /> Export CSV
        </Button>
      </div>

      {tab === 'summary' ? (
        summaryQ.isLoading ? (
          <Spinner label="Loading summary..." />
        ) : s ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: 'Total revenue (period)', value: fmtBirr(totalRevenue) },
                { label: 'Total dispatched (q)', value: fmtQ(totalQ) },
                { label: 'Active customers', value: String(s.byCustomer.length) },
                {
                  label: 'Invoices in period',
                  value: String((s.byInvoiceStatus ?? []).reduce((x, r) => x + r.count, 0))
                }
              ].map((k) => (
                <Card key={k.label} className="p-4">
                  <p className="text-xs text-slate-500">{k.label}</p>
                  <p className="tnum mt-1 text-xl font-extrabold text-ink">{k.value}</p>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="p-5">
                <CardHeader icon={<BarChart3 className="h-4 w-4" />} title="Sales by product" subtitle="Dispatched quintals in period" />
                <DataTable<SalesSummaryReport['byProduct'][number] & { id: string }>
                  columns={[
                    { key: 'productName', label: 'Product', render: (r) => r.productName },
                    { key: 'quintals', label: 'Quintals', mono: true, render: (r) => fmtQ(r.quintals) },
                    { key: 'bags', label: 'Bags', mono: true, render: (r) => String(r.bags) }
                  ]}
                  rows={s.byProduct.map((r) => ({ ...r, id: r.productId }))}
                  emptyTitle="No dispatches in period"
                />
              </Card>
              <Card className="p-5">
                <CardHeader icon={<BarChart3 className="h-4 w-4" />} title="Sales by customer" subtitle="Orders in period" />
                <DataTable<SalesSummaryReport['byCustomer'][number] & { id: string }>
                  columns={[
                    { key: 'customerName', label: 'Customer', render: (r) => r.customerName },
                    { key: 'orders', label: 'Orders', mono: true, render: (r) => String(r.orders) },
                    { key: 'quintals', label: 'Quintals', mono: true, render: (r) => fmtQ(r.quintals) }
                  ]}
                  rows={s.byCustomer.map((r) => ({ ...r, id: r.customerId }))}
                  emptyTitle="No orders in period"
                />
              </Card>
              <Card className="p-5">
                <CardHeader icon={<BarChart3 className="h-4 w-4" />} title="Revenue by month" subtitle="Invoiced revenue recognized" />
                <DataTable<SalesSummaryReport['revenueByMonth'][number] & { id: string }>
                  columns={[
                    { key: 'month', label: 'Month', render: (r) => <span className="tnum font-bold">{r.month}</span> },
                    { key: 'amountBirr', label: 'Revenue', mono: true, render: (r) => fmtBirr(r.amountBirr) }
                  ]}
                  rows={s.revenueByMonth.map((r) => ({ ...r, id: r.month }))}
                  emptyTitle="No invoiced revenue in period"
                />
              </Card>
              <Card className="p-5">
                <CardHeader icon={<BarChart3 className="h-4 w-4" />} title="Dispatch by destination & pack" subtitle="Logistics mix" />
                <DataTable<SalesSummaryReport['byDestination'][number] & { id: string }>
                  columns={[
                    { key: 'area', label: 'Destination', render: (r) => r.area },
                    { key: 'dispatches', label: 'Dispatches', mono: true, render: (r) => String(r.dispatches) }
                  ]}
                  rows={s.byDestination.map((r) => ({ ...r, id: r.area }))}
                  emptyTitle="No dispatches in period"
                />
                <div className="mt-3 flex flex-wrap gap-1">
                  {s.byPackSize.map((p) => (
                    <span key={p.label} className="tnum rounded bg-slate-100 px-2 py-1 text-xs">
                      {p.label}: {p.bags} bags
                    </span>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No data.</p>
        )
      ) : null}

      {tab === 'delivery' ? (
        deliveryQ.isLoading ? (
          <Spinner label="Loading delivery performance..." />
        ) : deliveryQ.data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: 'Dispatches', value: String(deliveryQ.data.totals.dispatches) },
                { label: 'On time', value: String(deliveryQ.data.totals.onTime) },
                { label: 'Late', value: String(deliveryQ.data.totals.late) },
                { label: 'On-time %', value: `${deliveryQ.data.onTimePct}%` }
              ].map((k) => (
                <Card key={k.label} className="p-4">
                  <p className="text-xs text-slate-500">{k.label}</p>
                  <p className="tnum mt-1 text-xl font-extrabold text-ink">{k.value}</p>
                </Card>
              ))}
            </div>
            <Card className="p-5">
              <CardHeader icon={<BarChart3 className="h-4 w-4" />} title="Dispatch timeliness" subtitle="Dispatched vs requested delivery date" />
              <DataTable
                columns={[
                  { key: 'exitNoteNo', label: 'Exit note', render: (r) => <span className="tnum font-bold">{r.exitNoteNo}</span> },
                  { key: 'plateNo', label: 'Vehicle', render: (r) => <span className="tnum">{r.plateNo ?? '—'}</span> },
                  { key: 'area', label: 'Area', render: (r) => r.area },
                  { key: 'dispatchedAt', label: 'Dispatched', render: (r) => fmtDate(r.dispatchedAt) },
                  { key: 'requestedDate', label: 'Requested', render: (r) => (r.requestedDate ? fmtDate(r.requestedDate) : '—') },
                  { key: 'quintals', label: 'Qty (q)', mono: true, render: (r) => fmtQ(r.quintals) },
                  {
                    key: 'verdict',
                    label: 'Verdict',
                    render: (r) => (
                      <Badge tone={r.verdict === 'ON_TIME' ? 'pass' : r.verdict === 'LATE' ? 'critical' : 'neutral'}>
                        {r.verdict.replace('_', ' ')}
                      </Badge>
                    )
                  }
                ]}
                rows={deliveryQ.data.rows}
                emptyTitle="No dispatches in period"
              />
            </Card>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No data.</p>
        )
      ) : null}

      {tab === 'agents' ? (
        agentsQ.isLoading ? (
          <Spinner label="Loading agent settlements..." />
        ) : (
          <Card className="p-5">
            <CardHeader icon={<BarChart3 className="h-4 w-4" />} title="Agent settlements" subtitle="Consignment placements and settlement progress" />
            <DataTable<AgentSettlementReportRow>
              columns={[
                { key: 'placementNo', label: 'Placement', render: (r) => <span className="tnum font-bold">{r.placementNo}</span> },
                { key: 'agentName', label: 'Agent', render: (r) => r.agentName },
                { key: 'productName', label: 'Product', render: (r) => r.productName },
                { key: 'placedQuintals', label: 'Placed (q)', mono: true, render: (r) => fmtQ(r.placedQuintals) },
                { key: 'settledQuintals', label: 'Settled (q)', mono: true, render: (r) => fmtQ(r.settledQuintals) },
                { key: 'settledAmountBirr', label: 'Settled (ETB)', mono: true, render: (r) => fmtBirr(r.settledAmountBirr) },
                {
                  key: 'outstandingQuintals',
                  label: 'Outstanding (q)',
                  mono: true,
                  render: (r) => (
                    <span className={`tnum font-bold ${r.outstandingQuintals > 0 ? 'text-advisory-text' : 'text-pass-text'}`}>
                      {fmtQ(r.outstandingQuintals)}
                    </span>
                  )
                },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'SETTLED' ? 'pass' : 'advisory'}>{r.status.replace('_', ' ')}</Badge> }
              ]}
              rows={agentsQ.data ?? []}
              emptyTitle="No agent placements in period"
            />
          </Card>
        )
      ) : null}
    </div>
  );
}
