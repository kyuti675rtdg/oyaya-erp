import { fmtElapsed, fmtQ } from '../lib/format';

/** Visual level gauge for wet conditioning Tanks A, B, C. */
export function TankGauge({
  code,
  name,
  capacityQ,
  currentQ,
  fillStartedAt,
  restGuidance
}: {
  code: string;
  name: string;
  capacityQ: number;
  currentQ: number;
  fillStartedAt: string | null;
  restGuidance: string;
}) {
  const pct = capacityQ > 0 ? Math.min(100, (currentQ / capacityQ) * 100) : 0;
  const elapsed = fillStartedAt ? fmtElapsed(Date.now() - new Date(fillStartedAt).getTime()) : '-';

  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-ink">
          Tank {code} <span className="ml-1 text-sm font-medium text-slate-500">{name}</span>
        </h3>
        <span className="tnum text-sm font-semibold text-slate-600">
          {fmtQ(currentQ)} / {fmtQ(capacityQ)} q
        </span>
      </div>

      <div
        className="mt-3 h-6 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Tank ${code} level`}
      >
        <div
          className="h-full rounded-full bg-harvest transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Level</p>
          <p className="tnum text-lg font-bold text-ink">{pct.toFixed(0)}%</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Elapsed rest</p>
          <p className="tnum text-lg font-bold text-ink">{elapsed}</p>
        </div>
      </div>

      <p className="mt-2 rounded-lg bg-advisory-bg px-3 py-2 text-xs font-medium text-advisory-text">
        Advisory: {restGuidance}
      </p>
    </div>
  );
}
