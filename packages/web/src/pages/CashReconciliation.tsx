import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, PiggyBank } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { useAuth } from '../store/auth';
import type { CashReconciliation } from '../types';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, NumberInput, SectionTitle, Spinner, TextInput } from '../components/ui';
import { fmtBirr, fmtDate } from '../lib/format';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const RECON_TONE: Record<string, BadgeTone> = {
  BALANCED: 'pass',
  VARIANCE_OPEN: 'critical',
  RESOLVED: 'neutral'
};

export function CashReconciliation() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canResolve = hasClaim('sales:approve');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [reconDate, setReconDate] = useState(todayISO());
  const [collected, setCollected] = useState('');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [depositRefBy, setDepositRefBy] = useState<Record<string, string>>({});
  const [resolveNotes, setResolveNotes] = useState<Record<string, string>>({});

  const reconQ = useQuery({
    queryKey: ['cash-reconciliation'],
    queryFn: async () => (await api.get<CashReconciliation[]>(E.cashReconciliations)).data
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['cash-reconciliation'] });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const c = Number(collected);
    if (!reconDate || !Number.isFinite(c) || c < 0) {
      setNotice({ ok: false, text: 'Date and a non-negative collected amount are required.' });
      return;
    }
    setSaving(true);
    try {
      const r = await api.post<CashReconciliation>(E.cashReconciliations, {
        reconDate: new Date(`${reconDate}T00:00:00`).toISOString(),
        collectedBirr: c,
        ...(expected.trim() !== '' ? { expectedBirr: Number(expected) } : {}),
        notes: notes.trim() || undefined
      });
      setNotice({
        ok: r.data.status === 'BALANCED',
        text:
          r.data.status === 'BALANCED'
            ? 'Day reconciled — collected matches expected.'
            : `Variance flagged: ${fmtBirr(r.data.varianceBirr)}. Investigate before closing the day.`
      });
      setCollected('');
      setExpected('');
      setNotes('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save reconciliation.' });
    } finally {
      setSaving(false);
    }
  };

  const resolve = async (id: string) => {
    setNotice(null);
    try {
      await api.post(E.cashReconResolve(id), { notes: resolveNotes[id]?.trim() || undefined });
      setNotice({ ok: true, text: 'Variance resolved with explanation.' });
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to resolve variance.' });
    }
  };

  const deposit = async (id: string) => {
    const ref = depositRefBy[id]?.trim();
    if (!ref) {
      setNotice({ ok: false, text: 'Enter a bank deposit reference.' });
      return;
    }
    setNotice(null);
    try {
      await api.post(E.cashReconDeposit(id), { depositRef: ref });
      setNotice({ ok: true, text: 'Bank deposit recorded.' });
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record deposit.' });
    }
  };

  return (
    <div>
      <SectionTitle title="Cash Reconciliation" sub="Daily cash collected vs expected, variances and bank deposits" />

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

      <Card className="p-5">
        <CardHeader icon={<Banknote className="h-4 w-4" />} title="Daily cash count" subtitle="Expected auto-computes from receipts + agent settlements when left blank" />
        <form onSubmit={create} className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <Field label="Date" required>
            <TextInput type="date" value={reconDate} onChange={(e) => setReconDate(e.target.value)} required />
          </Field>
          <Field label="Collected (ETB)" required>
            <NumberInput value={collected} onChange={(e) => setCollected(e.target.value)} min={0} step="0.01" placeholder="0.00" className="text-xl" />
          </Field>
          <Field label="Expected (ETB, optional)" hint="Blank = auto from system receipts">
            <NumberInput value={expected} onChange={(e) => setExpected(e.target.value)} min={0} step="0.01" placeholder="Auto" />
          </Field>
          <Field label="Notes">
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={saving} className="w-full">
              <PiggyBank className="mr-1 h-4 w-4" /> Reconcile day
            </Button>
          </div>
        </form>
      </Card>

      <div className="mt-6">
        <SectionTitle title="Reconciliations" />
        {reconQ.isLoading ? (
          <Spinner label="Loading reconciliations..." />
        ) : (
          <DataTable<CashReconciliation>
            columns={[
              { key: 'reconDate', label: 'Date', render: (r) => <span className="tnum font-bold">{fmtDate(r.reconDate)}</span> },
              { key: 'expectedBirr', label: 'Expected', mono: true, render: (r) => fmtBirr(r.expectedBirr) },
              { key: 'collectedBirr', label: 'Collected', mono: true, render: (r) => fmtBirr(r.collectedBirr) },
              {
                key: 'varianceBirr',
                label: 'Variance',
                mono: true,
                render: (r) => (
                  <span className={`tnum font-bold ${Number(r.varianceBirr) !== 0 ? 'text-critical-text' : 'text-pass-text'}`}>
                    {fmtBirr(r.varianceBirr)}
                  </span>
                )
              },
              {
                key: 'deposit',
                label: 'Bank deposit',
                render: (r) =>
                  r.depositRef ? (
                    <span className="tnum text-xs">
                      {r.depositRef}
                      {r.depositedAt ? ` · ${fmtDate(r.depositedAt)}` : ''}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <TextInput
                        value={depositRefBy[r.id] ?? ''}
                        onChange={(e) => setDepositRefBy((p) => ({ ...p, [r.id]: e.target.value }))}
                        placeholder="Deposit ref"
                        className="!w-28 !py-1 text-xs"
                      />
                      <Button variant="ghost" onClick={() => deposit(r.id)} className="px-2 py-1 text-xs">
                        Save
                      </Button>
                    </span>
                  )
              },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={RECON_TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge>
              },
              {
                key: 'actions',
                label: '',
                render: (r) =>
                  r.status === 'VARIANCE_OPEN' && canResolve ? (
                    <span className="inline-flex items-center gap-1">
                      <TextInput
                        value={resolveNotes[r.id] ?? ''}
                        onChange={(e) => setResolveNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                        placeholder="Resolution note"
                        className="!w-32 !py-1 text-xs"
                      />
                      <Button variant="secondary" onClick={() => resolve(r.id)} className="px-2 py-1 text-xs">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Resolve
                      </Button>
                    </span>
                  ) : null
              }
            ]}
            rows={reconQ.data ?? []}
            emptyTitle="No reconciliations yet"
            emptySub="Reconcile today's cash to close the day."
          />
        )}
      </div>
    </div>
  );
}
