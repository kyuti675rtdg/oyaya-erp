import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Filter, ListFilter } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { StorageMovementRow } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Button, EmptyState, ErrorBox, Field, SectionTitle, Select, TextInput } from '../components/ui';

const cardShell = 'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const signedFmt = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(Math.abs(n))}` : '0');

const LOCATIONS = ['DRY_POOL', 'TANK_A', 'TANK_B', 'TANK_C'] as const;
const DIRECTIONS = ['IN', 'OUT', 'ADJUST'] as const;
const WHEAT_TYPES = ['SOFT', 'HARD', 'FOREIGN'] as const;

const LOC_LABEL: Record<string, string> = {
  DRY_POOL: 'Dry Pool',
  TANK_A: 'Tank A',
  TANK_B: 'Tank B',
  TANK_C: 'Tank C'
};

function isInflow(r: StorageMovementRow): boolean {
  const d = r.direction.toUpperCase();
  if (d === 'IN') return true;
  if (d === 'OUT') return false;
  // ADJUST: reference distinguishes direction — ADJUST_IN adds, ADJUST_OUT subtracts
  return (r.reference ?? '').toUpperCase().startsWith('ADJUST_IN');
}

function directionBadge(direction: string, isIn: boolean) {
  const d = direction.toUpperCase();
  if (d.startsWith('ADJUST'))
    return <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">ADJUST</span>;
  return isIn ? (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">IN</span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-700">OUT</span>
  );
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

export function StockMovement() {
  const [location, setLocation] = useState('');
  const [direction, setDirection] = useState('');
  const [wheatType, setWheatType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState({
    location: '', direction: '', wheatType: '', from: '', to: '', search: ''
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (applied.location) params.set('locationCode', applied.location);
    if (applied.direction) params.set('direction', applied.direction);
    if (applied.wheatType) params.set('wheatType', applied.wheatType);
    if (applied.from) params.set('from', applied.from);
    if (applied.to) params.set('to', applied.to);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [applied]);

  const movementsQ = useQuery({
    queryKey: ['storage-movements', applied],
    queryFn: async () => (await api.get<StorageMovementRow[]>(`${E.movementsFiltered}${queryString}`)).data,
    refetchInterval: 60000
  });

  // Client-side reference search (no search param on the endpoint)
  const rows = useMemo(() => {
    const all = movementsQ.data ?? [];
    const q = applied.search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) =>
        (r.reference ?? '').toLowerCase().includes(q) ||
        (r.notes ?? '').toLowerCase().includes(q)
    );
  }, [movementsQ.data, applied.search]);

  const summary = useMemo(() => {
    let inQ = 0;
    let outQ = 0;
    for (const r of rows) {
      if (isInflow(r)) inQ += r.quintals;
      else outQ += r.quintals;
    }
    return { inQ, outQ, net: inQ - outQ };
  }, [rows]);

  // Running balance per location: oldest → newest within the filtered set
  const withBalance = useMemo(() => {
    const sorted = [...rows].sort(
      (a, b) => new Date(a.movedAt).getTime() - new Date(b.movedAt).getTime()
    );
    const balances: Record<string, number> = {};
    const out = new Map<string, number>();
    for (const r of sorted) {
      const bal = (balances[r.locationCode] ?? 0) + (isInflow(r) ? r.quintals : -r.quintals);
      balances[r.locationCode] = bal;
      out.set(r.id, bal);
    }
    return out;
  }, [rows]);

  const exportCsv = () => {
    const header = ['Date/Time', 'Location', 'Direction', 'Quantity (Qt)', 'Wheat Type', 'Reference', 'Notes', 'Running Balance (Qt)'];
    const lines = rows.map((r) => {
      const inflow = isInflow(r);
      const cells = [
        fmtDateTime(r.movedAt),
        r.locationCode,
        r.direction,
        inflow ? r.quintals.toFixed(2) : (-r.quintals).toFixed(2),
        r.wheatType ?? '',
        r.reference ?? '',
        (r.notes ?? '').replace(/\r?\n/g, ' '),
        (withBalance.get(r.id) ?? 0).toFixed(2)
      ];
      return cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [header.join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-movements-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const applyFilters = () => setApplied({ location, direction, wheatType, from, to, search });
  const clearFilters = () => {
    setLocation(''); setDirection(''); setWheatType(''); setFrom(''); setTo(''); setSearch('');
    setApplied({ location: '', direction: '', wheatType: '', from: '', to: '', search: '' });
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Stock Movement Ledger"
        sub="Audit trail of every storage movement — dry pool and conditioning tanks"
        action={
          <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
            <Download size={16} /> Export CSV
          </Button>
        }
      />

      {/* Filter bar */}
      <div className={cardShell}>
        <CardHeader icon={<Filter size={16} />} title="Filters" subtitle="Refine the movement ledger" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Field label="Location">
            <Select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">All locations</option>
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>{LOC_LABEL[l]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Direction">
            <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="">All directions</option>
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </Field>
          <Field label="Wheat type">
            <Select value={wheatType} onChange={(e) => setWheatType(e.target.value)}>
              <option value="">All types</option>
              {WHEAT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Reference search">
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reference or notes…"
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={applyFilters}>
            <ListFilter size={16} /> Apply Filters
          </Button>
          <Button variant="secondary" onClick={clearFilters}>
            Clear
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={cardShell}>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Total In</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-800">
            {fmt(summary.inQ)} <span className="text-sm font-semibold text-slate-400">Qt</span>
          </p>
        </div>
        <div className={cardShell}>
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-600">Total Out</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-800">
            {fmt(summary.outQ)} <span className="text-sm font-semibold text-slate-400">Qt</span>
          </p>
        </div>
        <div className={cardShell}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Net Change</p>
          <p
            className={`mt-1 text-2xl font-extrabold tabular-nums ${
              summary.net >= 0 ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {signedFmt(summary.net)} <span className="text-sm font-semibold text-slate-400">Qt</span>
          </p>
        </div>
      </div>

      {/* Ledger table */}
      <div className={cardShell}>
        <CardHeader
          icon={<ListFilter size={16} />}
          title="Movement Ledger"
          subtitle={`${rows.length} movement${rows.length === 1 ? '' : 's'} · newest first`}
        />
        {movementsQ.isPending && <p className="py-10 text-center text-sm text-slate-400">Loading movements…</p>}
        {movementsQ.isError && (
          <ErrorBox message="Could not load stock movements." onRetry={() => movementsQ.refetch()} />
        )}
        {movementsQ.data && rows.length === 0 && (
          <div className="py-6">
            <EmptyState title="No movements found" sub="Try widening the date range or clearing the filters." />
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3">Date/Time</th>
                  <th className="py-2 pr-3">Location</th>
                  <th className="py-2 pr-3">Direction</th>
                  <th className="py-2 pr-3 text-right">Quantity</th>
                  <th className="py-2 pr-3">Wheat Type</th>
                  <th className="py-2 pr-3">Reference</th>
                  <th className="py-2 pr-3">Notes</th>
                  <th className="py-2 text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {[...rows]
                  .sort((a, b) => new Date(b.movedAt).getTime() - new Date(a.movedAt).getTime())
                  .map((r) => {
                    const inflow = isInflow(r);
                    return (
                      <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                        <td className="whitespace-nowrap py-2.5 pr-3 text-slate-600">{fmtDateTime(r.movedAt)}</td>
                        <td className="py-2.5 pr-3 font-semibold text-slate-700">
                          {LOC_LABEL[r.locationCode] ?? r.locationCode}
                        </td>
                        <td className="py-2.5 pr-3">{directionBadge(r.direction, inflow)}</td>
                        <td
                          className={`py-2.5 pr-3 text-right font-bold tabular-nums ${
                            inflow ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {signedFmt(inflow ? r.quintals : -r.quintals)}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-600">{r.wheatType ?? '—'}</td>
                        <td className="py-2.5 pr-3 font-mono text-xs text-slate-500">{r.reference ?? '—'}</td>
                        <td className="max-w-[220px] truncate py-2.5 pr-3 text-xs text-slate-500" title={r.notes ?? ''}>
                          {r.notes ?? '—'}
                        </td>
                        <td className="py-2.5 text-right font-semibold tabular-nums text-slate-700">
                          {fmt(withBalance.get(r.id) ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
