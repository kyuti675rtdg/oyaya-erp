import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins, Sparkles, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { AdvanceBalance, Customer, SalesInvoice } from '../types';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner } from '../components/ui';
import { fmtBirr, fmtDate } from '../lib/format';

const ADV_TONE: Record<string, BadgeTone> = { OPEN: 'advisory', PARTIAL: 'advisory', APPLIED: 'pass' };

export function SalesAdvances() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [amount, setAmount] = useState('');

  // Balance lookup
  const [balCustomerId, setBalCustomerId] = useState('');
  const [applyInvoiceId, setApplyInvoiceId] = useState('');
  const [applyAmount, setApplyAmount] = useState('');
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const customersQ = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await api.get<Customer[]>(E.customers)).data
  });
  const balanceQ = useQuery({
    queryKey: ['advance-balance', balCustomerId],
    queryFn: async () => (await api.get<AdvanceBalance>(E.advanceBalance(balCustomerId))).data,
    enabled: !!balCustomerId
  });
  const invoicesQ = useQuery({
    queryKey: ['sales-invoices'],
    queryFn: async () => (await api.get<SalesInvoice[]>(E.salesInvoices)).data
  });

  const unpaidInvoices = (invoicesQ.data ?? []).filter(
    (i) => i.customerId === balCustomerId && i.status !== 'PAID'
  );

  const recordAdvance = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const a = Number(amount);
    if (!customerId || !Number.isFinite(a) || a <= 0) {
      setNotice({ ok: false, text: 'Customer and a positive amount are required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.advances, { customerId, amountBirr: a });
      setNotice({ ok: true, text: 'Advance recorded — available for auto-application to invoices.' });
      setAmount('');
      qc.invalidateQueries({ queryKey: ['advance-balance', customerId] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record advance.' });
    } finally {
      setSaving(false);
    }
  };

  const autoApply = async () => {
    if (!balCustomerId) return;
    setNotice(null);
    setSaving(true);
    try {
      const r = await api.post<{ applied: number; invoiceCount: number }>(E.advancesAutoApply, {
        customerId: balCustomerId
      });
      setNotice({
        ok: true,
        text: `Auto-applied ${fmtBirr(r.data.applied)} across ${r.data.invoiceCount} invoice(s).`
      });
      qc.invalidateQueries({ queryKey: ['advance-balance', balCustomerId] });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Auto-apply failed.' });
    } finally {
      setSaving(false);
    }
  };

  const applyOne = async (advanceId: string) => {
    if (!applyInvoiceId) {
      setNotice({ ok: false, text: 'Select an unpaid invoice to apply against.' });
      return;
    }
    setNotice(null);
    setApplyingId(advanceId);
    try {
      await api.post(E.advanceApply(advanceId), {
        invoiceId: applyInvoiceId,
        ...(applyAmount.trim() !== '' ? { amountBirr: Number(applyAmount) } : {})
      });
      setNotice({ ok: true, text: 'Advance applied to invoice.' });
      setApplyAmount('');
      qc.invalidateQueries({ queryKey: ['advance-balance', balCustomerId] });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to apply advance.' });
    } finally {
      setApplyingId(null);
    }
  };

  const bal = balanceQ.data?.balance;

  return (
    <div>
      <SectionTitle title="Customer Advance Payments" sub="Advance receipts, balance tracking and auto-application to invoices" />

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
          <CardHeader icon={<HandCoins className="h-4 w-4" />} title="Record advance" subtitle="Cash received before delivery" />
          <form onSubmit={recordAdvance} className="space-y-4">
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
            <Field label="Amount (ETB)" required>
              <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} min={0} step="0.01" placeholder="0.00" className="text-xl" />
            </Field>
            <Button type="submit" loading={saving} className="w-full">
              Record advance
            </Button>
          </form>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <CardHeader
            icon={<Wallet className="h-4 w-4" />}
            title="Advance balance & application"
            subtitle="Track what is available and apply it to unpaid invoices"
            action={
              balCustomerId ? (
                <Button variant="secondary" onClick={autoApply} loading={saving} className="text-xs">
                  <Sparkles className="mr-1 h-3.5 w-3.5" /> Auto-apply to oldest invoices
                </Button>
              ) : null
            }
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Customer">
              <Select value={balCustomerId} onChange={(e) => setBalCustomerId(e.target.value)}>
                <option value="">Select customer</option>
                {(customersQ.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Apply against invoice">
              <Select value={applyInvoiceId} onChange={(e) => setApplyInvoiceId(e.target.value)}>
                <option value="">Select unpaid invoice</option>
                {unpaidInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoiceNo} — {fmtBirr(i.amountBirr)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount (optional — blank = all available)">
              <NumberInput value={applyAmount} onChange={(e) => setApplyAmount(e.target.value)} min={0} step="0.01" placeholder="All available" />
            </Field>
          </div>

          {balCustomerId ? (
            balanceQ.isLoading ? (
              <Spinner label="Loading balance..." />
            ) : bal ? (
              <div className="mt-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800 px-3 py-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Total received</p>
                    <p className="tnum text-lg font-extrabold text-ink dark:text-white">{fmtBirr(bal.total)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800 px-3 py-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Applied</p>
                    <p className="tnum text-lg font-extrabold text-ink dark:text-white">{fmtBirr(bal.applied)}</p>
                  </div>
                  <div className="rounded-xl bg-pass-bg px-3 py-3">
                    <p className="text-xs text-pass-text">Available</p>
                    <p className="tnum text-lg font-extrabold text-pass-text">{fmtBirr(bal.available)}</p>
                  </div>
                </div>

                <div className="mt-4">
                  <h4 className="mb-2 text-sm font-bold text-ink dark:text-white">Advances</h4>
                  <DataTable
                    columns={[
                      { key: 'paidAt', label: 'Date', render: (r) => fmtDate(r.paidAt) },
                      { key: 'amountBirr', label: 'Amount', mono: true, render: (r) => fmtBirr(r.amountBirr) },
                      {
                        key: 'applied',
                        label: 'Applied',
                        mono: true,
                        render: (r) => fmtBirr(Number(r.appliedAmountBirr ?? 0))
                      },
                      {
                        key: 'available',
                        label: 'Available',
                        mono: true,
                        render: (r) => fmtBirr(Number(r.amountBirr) - Number(r.appliedAmountBirr ?? 0))
                      },
                      {
                        key: 'status',
                        label: 'Status',
                        render: (r) => <Badge tone={ADV_TONE[r.status ?? 'OPEN'] ?? 'neutral'}>{r.status ?? 'OPEN'}</Badge>
                      },
                      {
                        key: 'actions',
                        label: '',
                        render: (r) =>
                          (r.status ?? 'OPEN') !== 'APPLIED' ? (
                            <Button
                              variant="ghost"
                              onClick={() => applyOne(r.id)}
                              loading={applyingId === r.id}
                              className="px-2 py-1 text-xs"
                            >
                              Apply
                            </Button>
                          ) : null
                      }
                    ]}
                    rows={balanceQ.data?.advances ?? []}
                    emptyTitle="No advances"
                    emptySub="Record an advance for this customer."
                  />
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No balance data.</p>
            )
          ) : (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Select a customer to see balances and applications.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
