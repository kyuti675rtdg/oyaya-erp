import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { submitOrQueue } from '../lib/sync';
import type { ProductionBatch } from '../types';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner } from '../components/ui';
import { fmtDateTime, fmtQ } from '../lib/format';

export function Batches() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [productType, setProductType] = useState('HARD_FLOUR');
  const [wheatWeighedQ, setWheatWeighedQ] = useState('');
  const [softQ, setSoftQ] = useState('');
  const [hardQ, setHardQ] = useState('');
  const [foreignQ, setForeignQ] = useState('');

  const batchesQ = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get<ProductionBatch[]>(E.batches)).data
  });

  const createBatch = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      const q = Number(wheatWeighedQ);
      const s = Number(softQ);
      const h = Number(hardQ);
      const f = Number(foreignQ);
      if (
        !Number.isFinite(q) || q <= 0 ||
        ![s, h, f].every((v) => Number.isFinite(v) && v >= 0) ||
        s + h + f <= 0
      ) {
        setNotice({ ok: false, text: 'A positive weighed quantity and blend quintals are required.' });
        return;
      }
      const total = s + h + f;
      const r = await submitOrQueue('production-batch', E.batches, {
        productType,
        blendSoftPct: (s / total) * 100,
        blendHardPct: (h / total) * 100,
        blendForeignPct: (f / total) * 100,
        blendSoftQ: s,
        blendHardQ: h,
        blendForeignQ: f,
        wheatWeighedQ: q
      });
      setNotice({
        ok: true,
        text: r.queued
          ? 'Batch saved offline — will sync automatically.'
          : 'Batch created with its per-batch blend ratio.'
      });
      setWheatWeighedQ('');
      setSoftQ('');
      setHardQ('');
      setForeignQ('');
      qc.invalidateQueries({ queryKey: ['batches'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to create batch.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Production Batches"
        sub="Batch is defined at the wheat-weighing stage, before conditioning or milling begins"
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
        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold text-ink">New batch</h3>
          <form onSubmit={createBatch} className="space-y-4">
            <Field label="Target product type" required>
              <Select value={productType} onChange={(e) => setProductType(e.target.value)}>
                <option value="HARD_FLOUR">Hard flour</option>
                <option value="SOFT_FLOUR">Soft flour</option>
              </Select>
            </Field>
            <Field label="Wheat weighed (quintals)" required>
              <NumberInput value={wheatWeighedQ} onChange={(e) => setWheatWeighedQ(e.target.value)} min={0} step="0.1" placeholder="0.0" />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Soft (q)" required>
                <NumberInput value={softQ} onChange={(e) => setSoftQ(e.target.value)} min={0} step="0.1" placeholder="0.0" />
              </Field>
              <Field label="Hard (q)" required>
                <NumberInput value={hardQ} onChange={(e) => setHardQ(e.target.value)} min={0} step="0.1" placeholder="0.0" />
              </Field>
              <Field label="Foreign (q)" required>
                <NumberInput value={foreignQ} onChange={(e) => setForeignQ(e.target.value)} min={0} step="0.1" placeholder="0.0" />
              </Field>
            </div>
            <p className="text-xs text-slate-500">
              The lab sets a fresh blend per batch; percentages are computed from the quintal quantities and locked to the batch.
            </p>
            <Button type="submit" loading={saving} className="w-full">
              Create batch
            </Button>
          </form>
        </Card>

        <div className="lg:col-span-2">
          {batchesQ.isLoading ? (
            <Spinner label="Loading batches..." />
          ) : (
            <DataTable<ProductionBatch>
              columns={[
                { key: 'batchNo', label: 'Batch', render: (r) => <span className="tnum font-bold text-ink">{r.batchNo}</span> },
                { key: 'productType', label: 'Product', render: (r) => r.productType.replace('_', ' ') },
                { key: 'wheatWeighedQ', label: 'Weighed (q)', mono: true, render: (r) => fmtQ(r.wheatWeighedQ) },
                {
                  key: 'blend',
                  label: 'Blend',
                  render: () => <Badge tone="pass">Set</Badge>
                },
                { key: 'status', label: 'Status' },
                { key: 'createdAt', label: 'Created', render: (r) => fmtDateTime(r.createdAt) },
                {
                  key: 'open',
                  label: '',
                  render: (r) => (
                    <Link to={`/batches/${r.id}`} className="font-semibold text-navy hover:underline">
                      Open
                    </Link>
                  )
                }
              ]}
              rows={batchesQ.data ?? []}
              emptyTitle="No batches yet"
              emptySub="Define a batch at the weighing stage to begin."
            />
          )}
        </div>
      </div>
    </div>
  );
}
