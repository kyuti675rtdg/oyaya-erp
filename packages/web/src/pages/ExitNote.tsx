import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { Dispatch } from '../types';
import { Button, Spinner } from '../components/ui';
import { fmtDateTime, fmtQ } from '../lib/format';

/** Printable Dispatch / Exit Note (A4). */
export function ExitNote() {
  const { id } = useParams<{ id: string }>();

  const dispatchQ = useQuery({
    queryKey: ['dispatch', id],
    queryFn: async () => (await api.get<Dispatch>(E.dispatch(id ?? ''))).data,
    enabled: !!id
  });

  const print = () => window.print();

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
        <p className="mt-4 text-slate-500">Dispatch not found.</p>
      </div>
    );

  const totalQ = d.lines.reduce((s, l) => s + Number(l.quintals), 0);

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

      <div className="print-sheet mx-auto max-w-3xl rounded-xl border border-line bg-white p-8 shadow-sm">
        <div className="border-b-2 border-ink pb-4 text-center">
          <h1 className="text-2xl font-extrabold text-ink">OYAYA FLOUR FACTORY</h1>
          <p className="text-sm text-slate-600">Dispatch / Exit Note</p>
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
        </div>

        <table className="mt-6">
          <thead>
            <tr>
              <th>#</th>
              <th>Order No</th>
              <th>Product</th>
              <th>Quantity (q)</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={l.id ?? i}>
                <td className="tnum">{i + 1}</td>
                <td className="tnum">{l.order?.orderNo ?? '—'}</td>
                <td>{l.product?.name ?? l.productId}</td>
                <td className="tnum">{fmtQ(l.quintals)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} className="text-right font-bold">
                Total load
              </td>
              <td className="tnum font-bold">{fmtQ(totalQ)}</td>
            </tr>
          </tbody>
        </table>

        <p className="mt-4 text-xs text-slate-600">
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
            <div className="border-t border-slate-400 pt-2">Gate / Security</div>
          </div>
        </div>
      </div>
    </div>
  );
}
