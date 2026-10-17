import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { Dispatch } from '../types';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { Button, Card, Field, Spinner, TextInput } from '../components/ui';
import { fmtDateTime, fmtQ } from '../lib/format';

const GATE_TONE: Record<string, BadgeTone> = { PENDING: 'neutral', AT_GATE: 'advisory', EXITED: 'pass' };

/** Printable Dispatch / Exit Note (A4) with the gate-pass workflow for outgoing trucks. */
export function ExitNote() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [sealNo, setSealNo] = useState('');
  const [gateOfficer, setGateOfficer] = useState('');
  const [gateNotes, setGateNotes] = useState('');

  const dispatchQ = useQuery({
    queryKey: ['dispatch', id],
    queryFn: async () => (await api.get<Dispatch>(E.dispatch(id ?? ''))).data,
    enabled: !!id
  });

  const print = () => window.print();

  const refresh = () => qc.invalidateQueries({ queryKey: ['dispatch', id] });

  const markAtGate = async () => {
    setNotice(null);
    setSaving(true);
    try {
      await api.post(E.dispatchGateExit(id ?? ''), { atGate: true });
      setNotice({ ok: true, text: 'Truck marked at the gate.' });
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to update gate status.' });
    } finally {
      setSaving(false);
    }
  };

  const confirmExit = async () => {
    setNotice(null);
    setSaving(true);
    try {
      await api.post(E.dispatchGateExit(id ?? ''), {
        sealNo: sealNo.trim() || undefined,
        gateOfficer: gateOfficer.trim() || undefined,
        gateNotes: gateNotes.trim() || undefined
      });
      setNotice({ ok: true, text: 'Gate exit confirmed — truck released.' });
      setSealNo('');
      setGateOfficer('');
      setGateNotes('');
      refresh();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to confirm gate exit.' });
    } finally {
      setSaving(false);
    }
  };

  if (dispatchQ.isLoading) return <Spinner label="Loading exit note..." />;
  const d = dispatchQ.data;
  if (dispatchQ.isError)
    return (
      <div>
        <Link to="/sales" className="font-semibold text-navy hover:underline">
          Back to sales
        </Link>
        <p className="mt-4 text-red-600">Could not load exit note. Check your connection and try again.</p>
      </div>
    );
  if (!d)
    return (
      <div>
        <Link to="/sales" className="font-semibold text-navy hover:underline">
          Back to sales
        </Link>
        <p className="mt-4 text-slate-500 dark:text-slate-400">Dispatch not found.</p>
      </div>
    );

  const totalQ = d.lines.reduce((s, l) => s + Number(l.quintals), 0);
  const gateStatus = d.gateStatus ?? 'PENDING';

  return (
    <div>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link to="/sales" className="font-semibold text-navy hover:underline">
          Back to sales
        </Link>
        <Button onClick={print} className="px-6">
          Print exit note
        </Button>
      </div>

      {notice ? (
        <div
          className={`no-print mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
            notice.ok
              ? 'border-pass-text/30 bg-pass-bg text-pass-text'
              : 'border-critical-text/30 bg-critical-bg text-critical-text'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      {/* Gate-pass workflow */}
      <Card className="no-print mb-4 p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200/60 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Gate pass</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Security gate workflow for this outgoing truck</p>
          </div>
          <Badge tone={GATE_TONE[gateStatus] ?? 'neutral'}>{gateStatus.replace('_', ' ')}</Badge>
        </div>

        {gateStatus === 'EXITED' ? (
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            Exited {d.gateCheckedAt ? fmtDateTime(d.gateCheckedAt) : ''} — seal{' '}
            <span className="tnum font-bold">{d.sealNo ?? '—'}</span>, officer {d.gateOfficer ?? '—'}.
          </p>
        ) : (
          <div className="mt-4">
            {gateStatus === 'PENDING' ? (
              <Button onClick={markAtGate} loading={saving} variant="secondary">
                Truck arrived at gate
              </Button>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <Field label="Seal number">
                  <TextInput value={sealNo} onChange={(e) => setSealNo(e.target.value)} placeholder="e.g. SEAL-001" />
                </Field>
                <Field label="Gate officer">
                  <TextInput value={gateOfficer} onChange={(e) => setGateOfficer(e.target.value)} placeholder="Officer name" />
                </Field>
                <Field label="Notes">
                  <TextInput value={gateNotes} onChange={(e) => setGateNotes(e.target.value)} placeholder="Optional" />
                </Field>
                <div className="flex items-end">
                  <Button onClick={confirmExit} loading={saving} className="w-full">
                    Confirm gate exit
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="print-sheet mx-auto max-w-3xl rounded-xl border border-line bg-white dark:bg-slate-800 p-8 shadow-sm">
        <div className="border-b-2 border-ink pb-4 text-center">
          <h1 className="text-2xl font-extrabold text-ink dark:text-white">OYAYA FLOUR FACTORY</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">Dispatch / Exit Note</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <p>
            <span className="font-semibold">Exit Note No:</span>{' '}
            <span className="tnum font-bold">{d.exitNoteNo}</span>
          </p>
          <p>
            <span className="font-semibold">Dispatch date:</span> {fmtDateTime(d.dispatchedAt)}
          </p>
          <p>
            <span className="font-semibold">Vehicle plate:</span>{' '}
            <span className="tnum font-bold">{d.vehicle?.plateNo ?? d.vehicleId}</span>
          </p>
          <p>
            <span className="font-semibold">Destination area:</span> {d.area}
          </p>
          <p>
            <span className="font-semibold">Seal number:</span>{' '}
            <span className="tnum font-bold">{d.sealNo ?? '—'}</span>
          </p>
          <p>
            <span className="font-semibold">Gate exit:</span>{' '}
            {gateStatus === 'EXITED' ? fmtDateTime(d.gateCheckedAt) : 'Pending'}
          </p>
        </div>

        <table className="mt-6">
          <thead>
            <tr>
              <th>#</th>
              <th>Order No</th>
              <th>Product</th>
              <th>Bags</th>
              <th>Batch</th>
              <th>Quantity (q)</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={l.id ?? i}>
                <td className="tnum">{i + 1}</td>
                <td className="tnum">{l.order?.orderNo ?? '—'}</td>
                <td>{l.product?.name ?? l.productId}</td>
                <td className="tnum">{l.bags}</td>
                <td className="tnum">{l.batchNo ?? '—'}</td>
                <td className="tnum">{fmtQ(l.quintals)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} className="text-right font-bold">
                Total load
              </td>
              <td className="tnum font-bold">{fmtQ(totalQ)}</td>
            </tr>
          </tbody>
        </table>

        <p className="mt-4 text-xs text-slate-600 dark:text-slate-300">
          Trip rule: multiple stops within the same or nearby destination area on a single loaded
          departure count and pay as one trip. This departure counts as 1 trip.
        </p>

        <div className="mt-10 grid grid-cols-3 gap-4 text-center text-sm">
          <div>
            <div className="border-t border-slate-400 pt-2">Storekeeper</div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-2">Driver</div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-2">
              Gate / Security{d.gateOfficer ? ` — ${d.gateOfficer}` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
