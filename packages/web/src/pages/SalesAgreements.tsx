import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeDollarSign, FileCheck2, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { useAuth } from '../store/auth';
import type { Customer, PackagingSize, PriceTier, Product, SalesAgreement } from '../types';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner, TextInput } from '../components/ui';
import { fmtBirr, fmtDate } from '../lib/format';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const AGREEMENT_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  ACTIVE: 'pass',
  EXPIRED: 'critical',
  SUSPENDED: 'advisory'
};

interface DraftLine {
  productId: string;
  packagingSizeId: string;
  priceBirr: string;
  tiers: PriceTier[];
}

export function SalesAgreements() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canApprove = hasClaim('sales:approve');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Agreement form
  const [customerId, setCustomerId] = useState('');
  const [name, setName] = useState('');
  const [validFrom, setValidFrom] = useState(todayISO());
  const [validTo, setValidTo] = useState(todayISO());
  const [discountPct, setDiscountPct] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);

  // Line editor
  const [lineProductId, setLineProductId] = useState('');
  const [linePackId, setLinePackId] = useState('');
  const [linePrice, setLinePrice] = useState('');
  const [draftTiers, setDraftTiers] = useState<PriceTier[]>([]);
  const [tierMinBags, setTierMinBags] = useState('');
  const [tierDiscount, setTierDiscount] = useState('');

  // Quote lookup
  const [qCustomerId, setQCustomerId] = useState('');
  const [qProductId, setQProductId] = useState('');
  const [qPackId, setQPackId] = useState('');
  const [qBags, setQBags] = useState('');
  const [quote, setQuote] = useState<{ priceBirr: number; agreementNo: string | null; discountPct: number } | null>(null);
  const [quoting, setQuoting] = useState(false);

  const agreementsQ = useQuery({
    queryKey: ['sales-agreements'],
    queryFn: async () => (await api.get<SalesAgreement[]>(E.salesAgreements)).data
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

  const expanded = (agreementsQ.data ?? []).find((a) => a.id === expandedId) ?? null;

  const effectiveStatus = (a: SalesAgreement): string => {
    if (a.status === 'ACTIVE' && a.validTo && a.validTo.slice(0, 10) < todayISO()) return 'EXPIRED';
    return a.status;
  };

  const addTier = () => {
    const mb = Number(tierMinBags);
    if (!Number.isFinite(mb) || mb <= 0) {
      setNotice({ ok: false, text: 'Tier needs a positive minimum bag count.' });
      return;
    }
    const t: PriceTier = { minBags: Math.round(mb) };
    if (tierDiscount.trim() !== '') t.discountPct = Number(tierDiscount);
    setDraftTiers((p) => [...p, t]);
    setTierMinBags('');
    setTierDiscount('');
  };

  const addLine = () => {
    const p = Number(linePrice);
    if (!lineProductId || !Number.isFinite(p) || p <= 0) {
      setNotice({ ok: false, text: 'Product and a positive price are required for a line.' });
      return;
    }
    setLines((prev) => [
      ...prev,
      { productId: lineProductId, packagingSizeId: linePackId, priceBirr: linePrice, tiers: draftTiers }
    ]);
    setLineProductId('');
    setLinePackId('');
    setLinePrice('');
    setDraftTiers([]);
  };

  const createAgreement = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!customerId || !name.trim() || lines.length === 0) {
      setNotice({ ok: false, text: 'Customer, agreement name and at least one price line are required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.salesAgreements, {
        customerId,
        name: name.trim(),
        validFrom: new Date(`${validFrom}T00:00:00`).toISOString(),
        validTo: new Date(`${validTo}T00:00:00`).toISOString(),
        discountPct: discountPct.trim() === '' ? 0 : Number(discountPct),
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({
          productId: l.productId,
          packagingSizeId: l.packagingSizeId || null,
          priceBirr: Number(l.priceBirr),
          tiers: l.tiers.length > 0 ? l.tiers : undefined
        }))
      });
      setNotice({ ok: true, text: 'Price agreement created as DRAFT.' });
      setCustomerId('');
      setName('');
      setDiscountPct('');
      setNotes('');
      setLines([]);
      qc.invalidateQueries({ queryKey: ['sales-agreements'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create agreement.' });
    } finally {
      setSaving(false);
    }
  };

  const approve = async (id: string) => {
    setNotice(null);
    try {
      await api.post(E.salesAgreementApprove(id));
      setNotice({ ok: true, text: 'Agreement activated.' });
      qc.invalidateQueries({ queryKey: ['sales-agreements'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to approve agreement.' });
    }
  };

  const runQuote = async () => {
    setNotice(null);
    if (!qCustomerId || !qProductId) {
      setNotice({ ok: false, text: 'Select a customer and product to quote.' });
      return;
    }
    setQuoting(true);
    try {
      const qs = new URLSearchParams({
        customerId: qCustomerId,
        productId: qProductId,
        ...(qPackId ? { packagingSizeId: qPackId } : {}),
        ...(qBags ? { bags: qBags } : {})
      }).toString();
      const r = await api.get<{ priceBirr: number; agreementNo: string | null; discountPct: number }>(
        E.salesPriceQuote(qs)
      );
      setQuote(r.data);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Quote lookup failed.' });
    } finally {
      setQuoting(false);
    }
  };

  const productNameBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of productsQ.data ?? []) m.set(p.id, p.name);
    return m;
  }, [productsQ.data]);
  const packLabelBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of packsQ.data ?? []) m.set(p.id, p.label);
    return m;
  }, [packsQ.data]);

  return (
    <div>
      <SectionTitle title="Customer Pricing & Sales Agreements" sub="Price lists per customer, product and pack size with validity periods and discount tiers" />

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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <CardHeader icon={<BadgeDollarSign className="h-4 w-4" />} title="New price agreement" subtitle="Lines define per-product prices; tiers add volume discounts" />
          <form onSubmit={createAgreement} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Customer" required>
                <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                  <option value="">Select customer</option>
                  {(customersQ.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Agreement name" required>
                <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q4 wholesale pricing" required />
              </Field>
              <Field label="Valid from" required>
                <TextInput type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required />
              </Field>
              <Field label="Valid to" required>
                <TextInput type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} required />
              </Field>
              <Field label="Default discount %" hint="Applies to all lines unless a tier overrides it">
                <NumberInput value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} min={0} max={100} step="0.1" placeholder="0" />
              </Field>
              <Field label="Notes">
                <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
              </Field>
            </div>

            <div className="rounded-xl border border-line p-4">
              <h4 className="mb-3 text-sm font-bold text-ink">Price lines</h4>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Product">
                  <Select value={lineProductId} onChange={(e) => setLineProductId(e.target.value)}>
                    <option value="">Select</option>
                    {(productsQ.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Pack size">
                  <Select value={linePackId} onChange={(e) => setLinePackId(e.target.value)}>
                    <option value="">Any</option>
                    {(packsQ.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Price (ETB/q)">
                  <NumberInput value={linePrice} onChange={(e) => setLinePrice(e.target.value)} min={0} step="0.01" placeholder="0.00" />
                </Field>
                <div className="flex items-end">
                  <Button type="button" variant="secondary" onClick={addLine} className="w-full">
                    <Plus className="mr-1 h-4 w-4" /> Add line
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Tier: min bags" hint="Volume discount tier">
                  <NumberInput value={tierMinBags} onChange={(e) => setTierMinBags(e.target.value)} min={0} step="1" placeholder="e.g. 100" />
                </Field>
                <Field label="Tier: discount %">
                  <NumberInput value={tierDiscount} onChange={(e) => setTierDiscount(e.target.value)} min={0} max={100} step="0.1" placeholder="e.g. 2" />
                </Field>
                <div className="flex items-end">
                  <Button type="button" variant="ghost" onClick={addTier} className="w-full">
                    Add tier
                  </Button>
                </div>
                <div className="flex items-end text-xs text-slate-500 dark:text-slate-400">
                  {draftTiers.length > 0
                    ? draftTiers.map((t, i) => (
                        <span key={i} className="mr-1 rounded bg-slate-100 dark:bg-slate-700 px-2 py-1">
                          ≥{t.minBags} bags: {t.discountPct ?? 0}%
                        </span>
                      ))
                    : 'No tiers for this line'}
                </div>
              </div>

              {lines.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {lines.map((l, i) => (
                    <li key={i} className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
                      <span>
                        {productNameBy.get(l.productId)} {l.packagingSizeId ? `· ${packLabelBy.get(l.packagingSizeId)}` : ''} —{' '}
                        <span className="tnum font-bold">{fmtBirr(Number(l.priceBirr))}/q</span>
                        {l.tiers.length > 0 ? <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">+{l.tiers.length} tier(s)</span> : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                        className="text-critical-text hover:underline"
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <Button type="submit" loading={saving} className="w-full">
              Create agreement (DRAFT)
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <CardHeader icon={<Search className="h-4 w-4" />} title="Agreement price quote" subtitle="Effective price for a customer today" />
          <div className="space-y-4">
            <Field label="Customer">
              <Select value={qCustomerId} onChange={(e) => setQCustomerId(e.target.value)}>
                <option value="">Select customer</option>
                {(customersQ.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Product">
              <Select value={qProductId} onChange={(e) => setQProductId(e.target.value)}>
                <option value="">Select product</option>
                {(productsQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pack size">
                <Select value={qPackId} onChange={(e) => setQPackId(e.target.value)}>
                  <option value="">Any</option>
                  {(packsQ.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Bags (for tiers)">
                <NumberInput value={qBags} onChange={(e) => setQBags(e.target.value)} min={0} step="1" placeholder="0" />
              </Field>
            </div>
            <Button onClick={runQuote} loading={quoting} variant="secondary" className="w-full">
              Look up price
            </Button>
            {quote ? (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800 px-4 py-3 text-sm">
                {quote.agreementNo ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Agreement</span>
                      <span className="tnum font-bold">{quote.agreementNo}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Price</span>
                      <span className="tnum text-lg font-extrabold text-ink">{fmtBirr(quote.priceBirr)}/q</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Discount</span>
                      <span className="tnum font-semibold">{quote.discountPct}%</span>
                    </div>
                  </>
                ) : (
                  <p className="text-slate-500 dark:text-slate-400">No active agreement covers this customer/product.</p>
                )}
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <SectionTitle title="Agreements" />
        {agreementsQ.isLoading ? (
          <Spinner label="Loading agreements..." />
        ) : (
          <DataTable<SalesAgreement>
            columns={[
              { key: 'agreementNo', label: 'Agreement', render: (r) => <span className="tnum font-bold">{r.agreementNo}</span> },
              { key: 'name', label: 'Name', render: (r) => r.name },
              { key: 'customer', label: 'Customer', render: (r) => r.customer?.name ?? r.customerId },
              {
                key: 'validity',
                label: 'Validity',
                render: (r) => (
                  <span className="tnum text-xs">
                    {fmtDate(r.validFrom)} → {fmtDate(r.validTo)}
                  </span>
                )
              },
              { key: 'lines', label: 'Lines', mono: true, render: (r) => String(r.lines?.length ?? 0) },
              {
                key: 'status',
                label: 'Status',
                render: (r) => {
                  const s = effectiveStatus(r);
                  return <Badge tone={AGREEMENT_TONE[s] ?? 'neutral'}>{s}</Badge>;
                }
              },
              {
                key: 'actions',
                label: '',
                render: (r) => (
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="px-2 py-1 text-xs">
                      {expandedId === r.id ? 'Hide' : 'Lines'}
                    </Button>
                    {r.status === 'DRAFT' && canApprove ? (
                      <Button variant="secondary" onClick={() => approve(r.id)} className="px-2 py-1 text-xs">
                        <FileCheck2 className="mr-1 h-3 w-3" /> Activate
                      </Button>
                    ) : null}
                  </div>
                )
              }
            ]}
            rows={agreementsQ.data ?? []}
            emptyTitle="No agreements yet"
            emptySub="Create a price agreement to lock customer pricing."
          />
        )}
        {expanded ? (
          <Card className="mt-3 p-5">
            <CardHeader
              icon={<BadgeDollarSign className="h-4 w-4" />}
              title={`${expanded.agreementNo} — price lines`}
              subtitle={expanded.name}
              action={
                <Button variant="ghost" onClick={() => setExpandedId(null)} className="px-2 py-1 text-xs">
                  Close
                </Button>
              }
            />
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-1">Product</th>
                  <th className="py-1">Pack size</th>
                  <th className="py-1 text-right">Price (ETB/q)</th>
                  <th className="py-1">Discount tiers</th>
                </tr>
              </thead>
              <tbody>
                {(expanded.lines ?? []).map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="py-1">{l.product?.name ?? l.productId}</td>
                    <td className="py-1">{l.packagingSize?.label ?? 'Any'}</td>
                    <td className="tnum py-1 text-right font-semibold">{fmtBirr(l.priceBirr)}</td>
                    <td className="py-1 text-xs text-slate-500 dark:text-slate-400">
                      {(l.tiers ?? []).map((t, i) => (
                        <span key={i} className="mr-1 rounded bg-slate-100 dark:bg-slate-700 px-2 py-0.5">
                          ≥{t.minBags} bags → {t.priceBirr !== undefined ? fmtBirr(t.priceBirr) : `${t.discountPct ?? 0}% off`}
                        </span>
                      ))}
                      {(l.tiers ?? []).length === 0 ? '—' : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
