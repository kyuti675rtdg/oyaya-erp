import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Handshake, Plus, Scale } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { AgentStockPlacement, Customer, PackagingSize, Product } from '../types';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner, TextInput } from '../components/ui';
import { fmtBirr, fmtDate, fmtQ } from '../lib/format';

const PLACE_TONE: Record<string, BadgeTone> = {
  PLACED: 'advisory',
  PARTIALLY_SETTLED: 'advisory',
  SETTLED: 'pass',
  RETURNED: 'neutral'
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AgentStock() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterCustomer, setFilterCustomer] = useState('');
  const [settleBy, setSettleBy] = useState<Record<string, { bags: string; quintals: string }>>({});

  const [customerId, setCustomerId] = useState('');
  const [productId, setProductId] = useState('');
  const [packId, setPackId] = useState('');
  const [bags, setBags] = useState('');
  const [quintals, setQuintals] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [notes, setNotes] = useState('');

  const placementsQ = useQuery({
    queryKey: ['agent-placements', filterCustomer],
    queryFn: async () =>
      (
        await api.get<AgentStockPlacement[]>(
          filterCustomer ? `${E.agentPlacements}?customerId=${filterCustomer}` : E.agentPlacements
        )
      ).data
  });
  const customersQ = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await api.get<Customer[]>(E.customers)).data
  });
  const productsQ = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get<Product[]>(E.products)).data
  });
  const packsQ = useQuery({
    queryKey: ['packaging-sizes'],
    queryFn: async () => (await api.get<PackagingSize[]>(E.packagingSizes)).data
  });

  const packKgBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of packsQ.data ?? []) m.set(p.id, Number(p.kg));
    return m;
  }, [packsQ.data]);

  const totals = useMemo(() => {
    let placed = 0;
    let settled = 0;
    let value = 0;
    for (const p of placementsQ.data ?? []) {
      const sq = (p.settlements ?? []).reduce((s, x) => s + Number(x.quintals), 0);
      placed += Number(p.quintals);
      settled += sq;
      value += (p.settlements ?? []).reduce((s, x) => s + Number(x.amountBirr), 0);
    }
    return { placed, settled, outstanding: placed - settled, value };
  }, [placementsQ.data]);

  const createPlacement = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const q = Number(quintals);
    const up = Number(unitPrice);
    if (!customerId || !productId || !Number.isFinite(q) || q <= 0 || !Number.isFinite(up) || up <= 0) {
      setNotice({ ok: false, text: 'Agent, product, positive quantity and unit price are required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.agentPlacements, {
        customerId,
        productId,
        packagingSizeId: packId || null,
        bags: Number(bags) || 0,
        quintals: q,
        unitPriceBirr: up,
        notes: notes.trim() || undefined
      });
      setNotice({ ok: true, text: 'Stock placed with agent — tracked as consignment until settled.' });
      setCustomerId('');
      setProductId('');
      setPackId('');
      setBags('');
      setQuintals('');
      setUnitPrice('');
      setNotes('');
      qc.invalidateQueries({ queryKey: ['agent-placements'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create placement.' });
    } finally {
      setSaving(false);
    }
  };

  const settle = async (p: AgentStockPlacement) => {
    const v = settleBy[p.id];
    const q = Number(v?.quintals);
    if (!v || !Number.isFinite(q) || q <= 0) {
      setNotice({ ok: false, text: 'Enter a positive settlement quantity.' });
      return;
    }
    setNotice(null);
    try {
      await api.post(E.agentPlacementSettle(p.id), {
        bags: Number(v.bags) || 0,
        quintals: q
      });
      setNotice({ ok: true, text: `Settled ${fmtQ(q)} q for ${p.placementNo} — revenue posted to the GL.` });
      setSettleBy((prev) => ({ ...prev, [p.id]: { bags: '', quintals: '' } }));
      qc.invalidateQueries({ queryKey: ['agent-placements'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Settlement failed.' });
    }
  };

  return (
    <div>
      <SectionTitle title="Agent Stock Placement" sub="Stock placed with sales agents — consignment tracking and settlement" />

      {notice ? (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
            notice.ok
              ? 'border-pass-text/30 bg-pass-bg text-pass-text'
              : 'border-critical-text/30 bg-critical-bg text-critical-text'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Placed (q)', value: fmtQ(totals.placed) },
          { label: 'Settled (q)', value: fmtQ(totals.settled) },
          { label: 'Outstanding (q)', value: fmtQ(totals.outstanding) },
          { label: 'Settled value', value: fmtBirr(totals.value) }
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-xs text-slate-500">{k.label}</p>
            <p className="tnum mt-1 text-xl font-extrabold text-ink">{k.value}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-4 p-5">
        <CardHeader icon={<Handshake className="h-4 w-4" />} title="Place stock with agent" subtitle="Consignment — revenue is recognized when the agent settles" />
        <form onSubmit={createPlacement} className="grid grid-cols-1 gap-3 md:grid-cols-4 lg:grid-cols-8">
          <Field label="Agent (customer)" required>
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">Select</option>
              {(customersQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Product" required>
            <Select value={productId} onChange={(e) => setProductId(e.target.value)} required>
              <option value="">Select</option>
              {(productsQ.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pack size">
            <Select
              value={packId}
              onChange={(e) => {
                setPackId(e.target.value);
                const kg = packKgBy.get(e.target.value) ?? 0;
                if (kg > 0 && bags) setQuintals(String(((Number(bags) * kg) / 100).toFixed(2)));
              }}
            >
              <option value="">Bulk</option>
              {(packsQ.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bags">
            <NumberInput
              value={bags}
              onChange={(e) => {
                setBags(e.target.value);
                const kg = packKgBy.get(packId) ?? 0;
                if (kg > 0) setQuintals(String(((Number(e.target.value) * kg) / 100).toFixed(2)));
              }}
              min={0}
              step="1"
              placeholder="0"
            />
          </Field>
          <Field label="Quintals" required>
            <NumberInput value={quintals} onChange={(e) => setQuintals(e.target.value)} min={0} step="0.01" placeholder="0.00" />
          </Field>
          <Field label="Unit price (ETB/q)" required>
            <NumberInput value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} min={0} step="0.01" placeholder="0.00" />
          </Field>
          <Field label="Notes">
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={saving} className="w-full">
              <Plus className="mr-1 h-4 w-4" /> Place
            </Button>
          </div>
        </form>
      </Card>

      <div className="mt-6">
        <div className="mb-3 flex items-center gap-3">
          <SectionTitle title="Placements" />
          <Select value={filterCustomer} onChange={(e) => setFilterCustomer(e.target.value)} className="!w-56">
            <option value="">All agents</option>
            {(customersQ.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        {placementsQ.isLoading ? (
          <Spinner label="Loading placements..." />
        ) : (
          <DataTable<AgentStockPlacement>
            columns={[
              { key: 'placementNo', label: 'Placement', render: (r) => <span className="tnum font-bold">{r.placementNo}</span> },
              { key: 'agent', label: 'Agent', render: (r) => r.customer?.name ?? r.customerId },
              { key: 'product', label: 'Product', render: (r) => `${r.product?.name ?? r.productId}${r.packagingSize ? ` · ${r.packagingSize.label}` : ''}` },
              {
                key: 'placed',
                label: 'Placed',
                mono: true,
                render: (r) => (
                  <span className="tnum">
                    {fmtQ(r.quintals)} q{r.bags > 0 ? ` (${r.bags} bags)` : ''}
                  </span>
                )
              },
              {
                key: 'outstanding',
                label: 'Outstanding',
                mono: true,
                render: (r) => {
                  const sq = (r.settlements ?? []).reduce((s, x) => s + Number(x.quintals), 0);
                  return fmtQ(Number(r.quintals) - sq);
                }
              },
              { key: 'placedAt', label: 'Placed', render: (r) => fmtDate(r.placedAt) },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={PLACE_TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge>
              },
              {
                key: 'settle',
                label: 'Settle',
                render: (r) =>
                  !['SETTLED', 'RETURNED'].includes(r.status) ? (
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="q"
                        value={settleBy[r.id]?.quintals ?? ''}
                        onChange={(e) =>
                          setSettleBy((p) => ({ ...p, [r.id]: { bags: p[r.id]?.bags ?? '', quintals: e.target.value } }))
                        }
                        className="tnum w-20 rounded-lg border border-line px-2 py-1 text-right text-xs"
                      />
                      <Button variant="secondary" onClick={() => settle(r)} className="px-2 py-1 text-xs">
                        <Scale className="mr-1 h-3 w-3" /> Settle
                      </Button>
                    </span>
                  ) : null
              }
            ]}
            rows={placementsQ.data ?? []}
            emptyTitle="No placements"
            emptySub="Place consignment stock with a sales agent."
          />
        )}
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Settlement posts Dr 1000 (Cash) / Cr 4000 (Revenue) to the finance GL. Today: {todayISO()}.
      </p>
    </div>
  );
}
