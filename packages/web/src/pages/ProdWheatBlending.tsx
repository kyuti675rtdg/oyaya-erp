import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import { useAuth } from '../store/auth';
import type {
  BlendCompliance,
  BlendRecipe,
  FlourProductType,
  ProductionBatch
} from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import {
  Button,
  EmptyState,
  ErrorBox,
  Field,
  NumberInput,
  SectionTitle,
  Select,
  Spinner,
  TextArea,
  TextInput
} from '../components/ui';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const PRODUCT_OPTIONS: { value: FlourProductType; label: string }[] = [
  { value: 'DUKET_NORMAL', label: 'Duket — Normal grade' },
  { value: 'DUKET_SPECIAL', label: 'Duket — Special grade' },
  { value: 'FURISHKA', label: 'Furishka' },
  { value: 'FINO', label: 'Fino' },
  { value: 'FERNACHO', label: 'Fernacho' }
];

function productLabel(v: string): string {
  return PRODUCT_OPTIONS.find((o) => o.value === v)?.label ?? v.replace('_', ' ');
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function BlendBar({ hard, soft, foreign }: { hard: number; soft: number; foreign: number }) {
  const parts = [
    { k: 'Hard', v: hard, c: 'bg-orange-600' },
    { k: 'Soft', v: soft, c: 'bg-amber-400' },
    { k: 'Foreign', v: foreign, c: 'bg-blue-500' }
  ].filter((p) => p.v > 0);
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  return (
    <div className="flex h-5 w-full max-w-[220px] overflow-hidden rounded-full bg-slate-100">
      {parts.map((p) => (
        <div
          key={p.k}
          className={`${p.c} flex items-center justify-center`}
          style={{ width: `${(p.v / total) * 100}%` }}
        >
          <span className="tabular-nums text-[10px] font-bold text-white">
            {Math.round((p.v / total) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export function ProdWheatBlending() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('production:manage');

  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterProduct, setFilterProduct] = useState('');

  // Create form
  const [name, setName] = useState('');
  const [productType, setProductType] = useState<FlourProductType>('DUKET_NORMAL');
  const [hardPct, setHardPct] = useState('50');
  const [softPct, setSoftPct] = useState('30');
  const [foreignPct, setForeignPct] = useState('20');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');

  // Compliance check
  const [cmpBatchId, setCmpBatchId] = useState('');
  const [cmpProduct, setCmpProduct] = useState<FlourProductType>('DUKET_NORMAL');
  const [cmpResult, setCmpResult] = useState<BlendCompliance | null>(null);
  const [cmpLoading, setCmpLoading] = useState(false);

  const recipesQ = useQuery({
    queryKey: ['prod-blend-recipes', filterProduct],
    queryFn: async () =>
      (
        await api.get<BlendRecipe[]>(
          `${E.prodBlendRecipes}${filterProduct ? `?productType=${filterProduct}` : ''}`
        )
      ).data
  });
  const batchesQ = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(E.batches)).data
  });

  const pctSum = useMemo(
    () => num(hardPct) + num(softPct) + num(foreignPct),
    [hardPct, softPct, foreignPct]
  );
  const pctValid = Math.abs(pctSum - 100) <= 0.01;

  const saveRecipe = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      if (!name.trim()) {
        setNotice({ ok: false, text: 'Recipe name is required.' });
        return;
      }
      if (!pctValid) {
        setNotice({
          ok: false,
          text: `Blend percentages must sum to 100 (currently ${pctSum.toFixed(1)}).`
        });
        return;
      }
      const r = await submitOrQueue('prod-blend-recipe', E.prodBlendRecipes, {
        name: name.trim(),
        productType,
        hardPct: num(hardPct),
        softPct: num(softPct),
        foreignPct: num(foreignPct),
        isActive,
        notes: notes.trim() || null
      });
      setNotice({
        ok: true,
        text: r.queued
          ? 'Recipe saved offline — will sync automatically.'
          : 'Blend recipe saved.'
      });
      setName('');
      setNotes('');
      qc.invalidateQueries({ queryKey: ['prod-blend-recipes'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save recipe.' });
    } finally {
      setSaving(false);
    }
  };

  const activateRecipe = async (id: string) => {
    setNotice(null);
    try {
      await api.post(E.prodBlendRecipeActivate(id));
      setNotice({ ok: true, text: 'Recipe activated. Other recipes for this product were deactivated.' });
      qc.invalidateQueries({ queryKey: ['prod-blend-recipes'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to activate recipe.' });
    }
  };

  const runCompliance = async () => {
    setNotice(null);
    setCmpResult(null);
    if (!cmpBatchId) {
      setNotice({ ok: false, text: 'Select a batch to check compliance.' });
      return;
    }
    setCmpLoading(true);
    try {
      const res = await api.get<BlendCompliance>(E.prodBlendCompliance(cmpBatchId, cmpProduct));
      setCmpResult(res.data);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Compliance check failed.' });
    } finally {
      setCmpLoading(false);
    }
  };

  const recipes = recipesQ.data ?? [];
  const activeByProduct = useMemo(() => {
    const m = new Map<string, BlendRecipe>();
    for (const r of recipes) if (r.isActive) m.set(r.productType, r);
    return m;
  }, [recipes]);

  return (
    <div>
      <SectionTitle
        title="Wheat Blending & Formulation"
        sub="Standard blend recipes per product, one active recipe each — e.g. Duket Normal: 50% Hard / 30% Soft / 20% Foreign"
        action={
          <Select
            value={filterProduct}
            onChange={(e) => setFilterProduct(e.target.value)}
            aria-label="Filter by product"
          >
            <option value="">All products</option>
            {PRODUCT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        }
      />

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {canManage ? (
          <div className={cardShell}>
            <CardHeader
              icon={<FlaskConical size={16} />}
              title="New blend recipe"
              subtitle="Percentages must sum to 100"
            />
            <form onSubmit={saveRecipe} className="space-y-4">
              <Field label="Recipe name" required>
                <TextInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Duket Normal v3"
                  required
                />
              </Field>
              <Field label="Product" required>
                <Select
                  value={productType}
                  onChange={(e) => setProductType(e.target.value as FlourProductType)}
                >
                  {PRODUCT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Hard %" required>
                  <NumberInput value={hardPct} onChange={(e) => setHardPct(e.target.value)} min={0} max={100} step="0.1" />
                </Field>
                <Field label="Soft %" required>
                  <NumberInput value={softPct} onChange={(e) => setSoftPct(e.target.value)} min={0} max={100} step="0.1" />
                </Field>
                <Field label="Foreign %" required>
                  <NumberInput
                    value={foreignPct}
                    onChange={(e) => setForeignPct(e.target.value)}
                    min={0}
                    max={100}
                    step="0.1"
                  />
                </Field>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-600">
                  Sum: <span className={`tabular-nums font-bold ${pctValid ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {pctSum.toFixed(1)}%
                  </span>
                </span>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 accent-violet-700"
                  />
                  Set as active recipe
                </label>
              </div>
              <Field label="Notes">
                <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </Field>
              <Button type="submit" loading={saving} className="w-full">
                Save recipe
              </Button>
            </form>
          </div>
        ) : null}

        <div className={canManage ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <div className={cardShell}>
            <CardHeader
              icon={<ShieldCheck size={16} />}
              title="Recipes"
              subtitle="Active recipe per product is used for compliance checks"
            />
            {recipesQ.isLoading ? (
              <Spinner label="Loading recipes..." />
            ) : recipesQ.isError ? (
              <ErrorBox message="Failed to load recipes." onRetry={() => recipesQ.refetch()} />
            ) : (
              <>
                <div className="hidden md:block">
                  <DataTable<BlendRecipe>
                    columns={[
                      { key: 'name', label: 'Recipe', render: (r) => <span className="font-bold text-slate-800">{r.name}</span> },
                      { key: 'productType', label: 'Product', render: (r) => productLabel(r.productType) },
                      {
                        key: 'blend',
                        label: 'Blend',
                        render: (r) => <BlendBar hard={num(r.hardPct)} soft={num(r.softPct)} foreign={num(r.foreignPct)} />
                      },
                      {
                        key: 'isActive',
                        label: 'Status',
                        render: (r) =>
                          r.isActive ? <Badge tone="pass">Active</Badge> : <Badge tone="neutral">Inactive</Badge>
                      },
                      {
                        key: 'actions',
                        label: '',
                        render: (r) =>
                          canManage && !r.isActive ? (
                            <button
                              onClick={() => activateRecipe(r.id)}
                              className="text-sm font-semibold text-violet-primary hover:underline"
                            >
                              Set active
                            </button>
                          ) : null
                      }
                    ]}
                    rows={recipes}
                    emptyTitle="No blend recipes"
                    emptySub="Define the standard blend for each flour product."
                  />
                </div>
                <div className="space-y-3 md:hidden">
                  {recipes.length === 0 ? (
                    <EmptyState title="No blend recipes" sub="Define the standard blend for each flour product." />
                  ) : (
                    recipes.map((r) => (
                      <div key={r.id} className="rounded-xl border border-slate-200/70 p-4">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800">{r.name}</span>
                          {r.isActive ? <Badge tone="pass">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{productLabel(r.productType)}</p>
                        <div className="mt-2">
                          <BlendBar hard={num(r.hardPct)} soft={num(r.softPct)} foreign={num(r.foreignPct)} />
                        </div>
                        <p className="tabular-nums mt-2 text-xs text-slate-500">
                          Hard {num(r.hardPct).toFixed(1)}% · Soft {num(r.softPct).toFixed(1)}% · Foreign {num(r.foreignPct).toFixed(1)}%
                        </p>
                        {canManage && !r.isActive ? (
                          <Button variant="secondary" className="mt-3 w-full" onClick={() => activateRecipe(r.id)}>
                            Set active
                          </Button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={`${cardShell} mt-4`}>
        <CardHeader
          icon={<ShieldCheck size={16} />}
          title="Compliance check"
          subtitle="Compare a batch's locked blend against the active recipe"
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Production batch">
            <Select value={cmpBatchId} onChange={(e) => setCmpBatchId(e.target.value)}>
              <option value="">Select batch</option>
              {(batchesQ.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNo} — {b.productType.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Product recipe">
            <Select value={cmpProduct} onChange={(e) => setCmpProduct(e.target.value as FlourProductType)}>
              {PRODUCT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button onClick={runCompliance} loading={cmpLoading} className="w-full md:w-auto">
              Check compliance
            </Button>
          </div>
        </div>

        {cmpResult ? (
          <div className="mt-4 rounded-xl border border-slate-200/70 p-4">
            <div className="flex flex-wrap items-center gap-3">
              {cmpResult.recipe ? (
                <Badge tone={cmpResult.withinTolerance ? 'pass' : 'critical'}>
                  {cmpResult.withinTolerance
                    ? `Compliant vs ${cmpResult.recipe.name}`
                    : `Deviation vs ${cmpResult.recipe.name}`}
                </Badge>
              ) : (
                <Badge tone="advisory">No active recipe — nothing to compare</Badge>
              )}
              <span className="tabular-nums text-xs text-slate-500">
                Tolerance ±{cmpResult.tolerancePct}%
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {(
                [
                  { k: 'hard', label: 'Hard' },
                  { k: 'soft', label: 'Soft' },
                  { k: 'foreign', label: 'Foreign' }
                ] as const
              ).map((p) => (
                <div key={p.k} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{p.label}</p>
                  <p className="tabular-nums mt-1 text-sm">
                    Actual <span className="font-bold">{cmpResult.actual[`${p.k}Pct`].toFixed(1)}%</span>
                  </p>
                  {cmpResult.recipe ? (
                    <p className="tabular-nums text-sm">
                      Recipe <span className="font-bold">{num(cmpResult.recipe[`${p.k}Pct`]).toFixed(1)}%</span>{' '}
                      <span
                        className={`font-bold ${
                          Math.abs(cmpResult.deviation[p.k]) <= cmpResult.tolerancePct
                            ? 'text-emerald-700'
                            : 'text-rose-600'
                        }`}
                      >
                        ({cmpResult.deviation[p.k] >= 0 ? '+' : ''}
                        {cmpResult.deviation[p.k].toFixed(1)})
                      </span>
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {activeByProduct.size > 0 ? (
        <div className={`${cardShell} mt-4`}>
          <CardHeader
            icon={<FlaskConical size={16} />}
            title="Active recipes at a glance"
            subtitle="One active recipe per product"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...activeByProduct.entries()].map(([pt, r]) => (
              <div key={pt} className="rounded-xl border border-slate-200/70 p-4">
                <p className="text-sm font-bold text-slate-800">{productLabel(pt)}</p>
                <p className="text-xs text-slate-500">{r.name}</p>
                <div className="mt-2">
                  <BlendBar hard={num(r.hardPct)} soft={num(r.softPct)} foreign={num(r.foreignPct)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
