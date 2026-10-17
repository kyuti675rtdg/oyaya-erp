import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Droplets, Factory, FlaskConical, Package } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime, fmtQ } from '../lib/format';
import { CardHeader } from '../components/CardHeader';
import { EmptyState, SectionTitle, Spinner } from '../components/ui';
import {
  asNum, cardShell, fmtPct, ChainTimeline, StatusBadge,
  type ChainStep, type CycleRec
} from './TraceShared';

interface TankSummary {
  tankCode: string;
  cycles: CycleRec[];
  fills: Array<{ id: string; tankCode: string; quintals: string | number; filledAt: string; intakeId?: string | null }>;
}

const TANK_CAPACITY: Record<string, string> = {
  TANK_A: '180 Q wet tank',
  TANK_B: '120 Q wet tank',
  TANK_C: '160 Q wet tank'
};

export function TraceTank() {
  const [active, setActive] = useState<string | null>(null);

  const tanksQ = useQuery({
    queryKey: ['trace-tanks'],
    queryFn: async () => (await api.get<{ tanks: TankSummary[] }>(E.traceTanks)).data
  });

  const tanks = tanksQ.data?.tanks ?? [];
  const shown = active ? tanks.filter((t) => t.tankCode === active) : tanks;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Conditioning Tank & Lot Tracking"
        sub="Every conditioning cycle keeps its lot identity — trace what was milled from each cycle"
      />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActive(null)}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${active === null ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
        >
          All tanks
        </button>
        {tanks.map((t) => (
          <button
            key={t.tankCode}
            onClick={() => setActive(t.tankCode)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${active === t.tankCode ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
          >
            {t.tankCode.replace('TANK_', 'Tank ')}
          </button>
        ))}
      </div>

      {tanksQ.isLoading ? (
        <Spinner label="Loading tanks…" />
      ) : tanks.length === 0 ? (
        <EmptyState title="No conditioning activity recorded" sub="Tank fills and cycles will appear here." />
      ) : (
        shown.map((tank) => {
          const totalFillQ = tank.fills.reduce((s, f) => s + asNum(f.quintals), 0);
          return (
            <div key={tank.tankCode} className={cardShell}>
              <CardHeader
                icon={<Factory className="h-4 w-4" />}
                title={tank.tankCode.replace('TANK_', 'Conditioning Tank ')}
                subtitle={`${TANK_CAPACITY[tank.tankCode] ?? ''} · ${tank.cycles.length} cycles · ${fmtQ(totalFillQ)} Q filled`}
              />
              {tank.cycles.length === 0 ? (
                <EmptyState title="No conditioning cycles" sub="Cycles started for this tank will appear here." />
              ) : (
                <div className="space-y-6">
                  {tank.cycles.map((cycle) => {
                    const ratio = cycle.blendRatio ?? {};
                    const ratioParts = ['soft', 'hard', 'foreign']
                      .map((k) => `${k}: ${asNum(ratio[k] ?? ratio[k.toUpperCase()]).toFixed(0)}%`)
                      .join(' · ');
                    const steps: ChainStep[] = [
                      {
                        icon: <Clock className="h-4 w-4" />,
                        title: `Conditioning lot ${cycle.batchNo}`,
                        sub: (
                          <span>
                            Blend <span className="tnum">{ratioParts}</span>
                            {cycle.notes ? ` · ${cycle.notes}` : ''}
                          </span>
                        ),
                        date: `Started ${fmtDateTime(cycle.startedAt)} · required ${asNum(cycle.requiredHrs).toFixed(1)} h`,
                        badge: <StatusBadge value={cycle.releasedAt ? 'RELEASED' : cycle.completedAt ? 'COMPLETED' : 'CONDITIONING'} />,
                        accent: 'bg-cyan-100 text-cyan-700'
                      }
                    ];
                    if (cycle.waterAddedQ != null || cycle.moistureBefore != null) {
                      steps.push({
                        icon: <Droplets className="h-4 w-4" />,
                        title: 'Water & moisture',
                        sub: (
                          <span className="tnum">
                            Water {fmtQ(cycle.waterAddedQ)} Q · Moisture{' '}
                            {cycle.moistureBefore != null ? asNum(cycle.moistureBefore).toFixed(1) : '—'}% →{' '}
                            {cycle.moistureAfter != null ? asNum(cycle.moistureAfter).toFixed(1) : '—'}%{' '}
                            (target 15.0–16.5%)
                          </span>
                        ),
                        accent: 'bg-blue-100 text-blue-700'
                      });
                    }
                    if (cycle.batch) {
                      steps.push({
                        icon: <Package className="h-4 w-4" />,
                        title: `Milled as batch ${cycle.batch.batchNo}`,
                        sub: (
                          <span className="tnum">
                            {fmtQ(cycle.batch.wheatWeighedQ)} Q weighed · status {cycle.batch.status.toLowerCase()}
                          </span>
                        ),
                        badge: <StatusBadge value={cycle.batch.status} />,
                        accent: 'bg-emerald-100 text-emerald-700'
                      });
                    } else {
                      steps.push({
                        icon: <FlaskConical className="h-4 w-4" />,
                        title: 'No production batch linked yet',
                        sub: <span>Lot identity {cycle.batchNo} is reserved for this cycle.</span>,
                        accent: 'bg-slate-100 text-slate-500'
                      });
                    }
                    return (
                      <div key={cycle.id} className="rounded-xl border border-slate-100 p-4">
                        <ChainTimeline steps={steps} />
                      </div>
                    );
                  })}
                </div>
              )}
              {tank.fills.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Recent fills ({tank.fills.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {tank.fills.slice(0, 12).map((f) => (
                      <span key={f.id} className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600 tnum border border-slate-100">
                        {fmtQ(f.quintals)} Q · {fmtDateTime(f.filledAt)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <p className="mt-3 text-xs text-slate-400">
                Duket extraction below {fmtPct(78)} on batches milled from a cycle auto-raises a yield flag.
              </p>
            </div>
          );
        })
      )}
    </div>
  );
}
