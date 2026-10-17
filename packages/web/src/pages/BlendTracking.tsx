import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, FlaskConical, Wheat } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { TankBlend } from '../types';
import { CardHeader } from '../components/CardHeader';
import { EmptyState, Spinner } from '../components/ui';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

// Guidance target blend for Duket flour
const TARGET = { hard: 50, soft: 30, foreign: 20 };

const segColors = {
  soft: 'bg-amber-400',
  hard: 'bg-orange-600',
  foreign: 'bg-blue-500'
};

const segLabels = {
  soft: 'Soft',
  hard: 'Hard',
  foreign: 'Foreign'
};

type BlendKey = 'soft' | 'hard' | 'foreign';

function toBlendParts(blend: TankBlend['blend']): Record<BlendKey, number> {
  return {
    soft: Number(blend?.soft ?? 0),
    hard: Number(blend?.hard ?? 0),
    foreign: Number(blend?.foreign ?? 0)
  };
}

function historyParts(ratio: Record<string, number> | null): Record<BlendKey, number> {
  const get = (key: string) => Number(ratio?.[key] ?? ratio?.[key.toUpperCase()] ?? 0);
  return { soft: get('soft'), hard: get('hard'), foreign: get('foreign') };
}

function BlendBar({ parts }: { parts: Record<BlendKey, number> }) {
  const keys = (['soft', 'hard', 'foreign'] as BlendKey[]).filter((k) => parts[k] > 0);
  const total = keys.reduce((s, k) => s + parts[k], 0) || 1;
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        {keys.map((k) => (
          <div
            key={k}
            className={`${segColors[k]} flex items-center justify-center`}
            style={{ width: `${(parts[k] / total) * 100}%` }}
          >
            <span className="text-[10px] font-bold tabular-nums text-white">
              {Math.round((parts[k] / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {(['soft', 'hard', 'foreign'] as BlendKey[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <span className={`h-2.5 w-2.5 rounded-sm ${segColors[k]}`} />
            {segLabels[k]} <span className="font-semibold tabular-nums">{parts[k]}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function TankCard({ blend }: { blend: TankBlend }) {
  const [open, setOpen] = useState(false);
  const parts = toBlendParts(blend.blend);
  const hasBlend = blend.blend !== null;
  const lowHard = hasBlend && parts.hard < 40;

  return (
    <div className={cardShell}>
      <CardHeader
        icon={<Wheat size={18} />}
        title={`Tank ${blend.tankCode.replace('TANK_', '')} — Blend`}
        subtitle={blend.batchNo ? `Active batch ${blend.batchNo}` : 'No active batch'}
        action={
          <div className="flex items-center gap-2">
            {blend.batchNo ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800 tabular-nums">
                {blend.batchNo}
              </span>
            ) : null}
            <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
              {Number(blend.levelQ).toFixed(1)} q
            </span>
          </div>
        }
      />

      {hasBlend ? (
        <BlendBar parts={parts} />
      ) : (
        <EmptyState title="No blend recorded" sub="Record a tank fill to start tracking this tank's blend." />
      )}

      {lowHard ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">Low hard wheat</span> — Duket needs body; consider topping up hard wheat.
          </span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-4 flex w-full items-center justify-between rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        <span>
          Blend history{' '}
          <span className="font-normal tabular-nums text-slate-500 dark:text-slate-400">({blend.history.length})</span>
        </span>
        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        blend.history.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  <th className="px-2 py-2 font-semibold">Date</th>
                  <th className="px-2 py-2 text-right font-semibold">Qt</th>
                  <th className="px-2 py-2 font-semibold">Soft/Hard/Foreign</th>
                </tr>
              </thead>
              <tbody>
                {blend.history.map((h) => {
                  const hp = historyParts(h.blendRatio);
                  return (
                    <tr key={h.id} className="border-t border-slate-100 dark:border-slate-700 align-top">
                      <td className="whitespace-nowrap px-2 py-2 text-slate-600 dark:text-slate-300">{fmtDate(h.filledAt)}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                        {Number(h.quintals).toFixed(1)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="min-w-[180px]">
                          <BlendBar parts={hp} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No fills recorded for this tank yet.</p>
        )
      ) : null}
    </div>
  );
}

export function BlendTracking() {
  const blendsQ = useQuery({
    queryKey: ['blends'],
    queryFn: async () => (await api.get<TankBlend[]>(E.blends)).data
  });

  const blends = blendsQ.data ?? [];

  return (
    <div>
      <div className={cardShell}>
        <CardHeader
          icon={<FlaskConical size={18} />}
          title="Blend recipe — Target Duket blend"
          subtitle="Guidance for millers when building a tank blend"
        />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-orange-600" />
            <span className="font-semibold tabular-nums">{TARGET.hard}% Hard</span> — body &amp; strength
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-amber-400" />
            <span className="font-semibold tabular-nums">{TARGET.soft}% Soft</span> — softness
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-blue-500" />
            <span className="font-semibold tabular-nums">{TARGET.foreign}% Foreign</span> — balance
          </span>
        </div>
      </div>

      {blendsQ.isLoading ? (
        <div className="mt-4">
          <Spinner label="Loading blends..." />
        </div>
      ) : blends.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No tanks to show"
            sub="Tanks will appear here once storage data is available."
          />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {blends.map((b) => (
            <TankCard key={b.tankCode} blend={b} />
          ))}
        </div>
      )}
    </div>
  );
}
