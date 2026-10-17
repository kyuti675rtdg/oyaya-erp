import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardCheck, FileWarning, FlaskConical, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime, fmtQ } from '../lib/format';
import { CardHeader } from '../components/CardHeader';
import { EmptyState, SectionTitle, Select, Spinner } from '../components/ui';
import {
  asNum, cardShell, ChainTimeline, StatusBadge,
  type BatchRec, type ChainStep
} from './TraceShared';

interface QualityPayload {
  type: string;
  lot: { id: string; batchNo: string; product?: { name: string } | null } | null;
  quality: Array<{
    batch: { id: string; batchNo: string; productType: string; status: string } | null;
    labChecks: Array<{
      id: string; sampleTime: string; impurityPct?: string | number | null;
      wheatMoistureBefore?: string | number | null; wheatMoistureAfter?: string | number | null;
      flourMoisturePct?: string | number | null; wetGlutenPct?: string | number | null;
      dryGlutenPct?: string | number | null; ashPct?: string | number | null;
      colorScore?: string | number | null; granulationPct?: string | number | null;
      outOfRange: string[];
    }>;
    flourTests: Array<{
      id: string; productLabel: string; sampleTime: string; verdict: string;
      flourMoisturePct?: string | number | null; wetGlutenPct?: string | number | null;
      ashPct?: string | number | null; outOfRange: string[];
    }>;
    nonconformities: Array<{
      id: string; ncNo: string; description: string; severity: string; status: string;
      dateDetected: string; disposition?: { decision: string } | null;
    }>;
    capas: Array<{
      id: string; capaNo: string; issueDescription: string; status: string;
      dateIdentified: string; disposition?: string | null;
    }>;
  }>;
}

export function TraceQuality() {
  const [batchId, setBatchId] = useState('');

  const batchesQ = useQuery({
    queryKey: ['trace-batches'],
    queryFn: async () => (await api.get<BatchRec[]>(E.traceBatches)).data
  });

  const qQ = useQuery({
    queryKey: ['trace-quality', batchId],
    queryFn: async () => (await api.get<QualityPayload>(E.traceQuality('batch', batchId))).data,
    enabled: !!batchId
  });

  const payload = qQ.data;
  const sections: Array<{ key: string; node: React.ReactNode }> = [];
  if (payload) {
    payload.quality.forEach((q, qi) => {
      const steps: ChainStep[] = [];
      q.labChecks.forEach((lc) => {
        const params = [
          ['Impurity', lc.impurityPct], ['Wheat moist.', lc.wheatMoistureBefore],
          ['Flour moist.', lc.flourMoisturePct], ['Wet gluten', lc.wetGlutenPct],
          ['Dry gluten', lc.dryGlutenPct], ['Ash', lc.ashPct],
          ['Color', lc.colorScore], ['Granulation', lc.granulationPct]
        ];
        steps.push({
          icon: <FlaskConical className="h-4 w-4" />,
          title: `In-process lab check — ${fmtDateTime(lc.sampleTime)}`,
          sub: (
            <span className="tnum">
              {params.map(([k, v]) => `${k} ${v == null ? '—' : asNum(v).toFixed(2)}`).join(' · ')}
            </span>
          ),
          badge: lc.outOfRange.length > 0
            ? <StatusBadge value="FLAGGED" />
            : <StatusBadge value="PASS" />,
          accent: lc.outOfRange.length > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
        });
        if (lc.outOfRange.length > 0) {
          steps.push({
            icon: <AlertTriangle className="h-4 w-4" />,
            title: 'Out-of-range parameters',
            sub: <span>{lc.outOfRange.join(' · ')}</span>,
            accent: 'bg-red-100 text-red-700'
          });
        }
      });
      q.flourTests.forEach((ft) => {
        steps.push({
          icon: <ClipboardCheck className="h-4 w-4" />,
          title: `Flour test — ${ft.productLabel}`,
          sub: (
            <span className="tnum">
              Moisture {ft.flourMoisturePct == null ? '—' : asNum(ft.flourMoisturePct).toFixed(2)} · Wet gluten{' '}
              {ft.wetGlutenPct == null ? '—' : asNum(ft.wetGlutenPct).toFixed(2)} · Ash{' '}
              {ft.ashPct == null ? '—' : asNum(ft.ashPct).toFixed(2)}
              {ft.outOfRange.length > 0 ? ` · out-of-range: ${ft.outOfRange.join(', ')}` : ''}
            </span>
          ),
          date: fmtDateTime(ft.sampleTime),
          badge: <StatusBadge value={ft.verdict} />,
          accent: 'bg-blue-100 text-blue-700'
        });
      });
      q.nonconformities.forEach((nc) => {
        steps.push({
          icon: <FileWarning className="h-4 w-4" />,
          title: `NC ${nc.ncNo} — ${nc.severity.toLowerCase()}`,
          sub: (
            <span>
              {nc.description}
              {nc.disposition ? ` · disposition: ${nc.disposition.decision}` : ''}
            </span>
          ),
          date: `Detected ${fmtDateTime(nc.dateDetected)}`,
          badge: <StatusBadge value={nc.status} />,
          accent: 'bg-orange-100 text-orange-700'
        });
      });
      q.capas.forEach((cp) => {
        steps.push({
          icon: <ShieldCheck className="h-4 w-4" />,
          title: `CAPA ${cp.capaNo}`,
          sub: (
            <span>
              {cp.issueDescription}
              {cp.disposition ? ` · disposition: ${cp.disposition}` : ''}
            </span>
          ),
          date: `Identified ${fmtDateTime(cp.dateIdentified)}`,
          badge: <StatusBadge value={cp.status} />,
          accent: 'bg-violet-100 text-violet-700'
        });
      });
      sections.push({
        key: String(qi),
        node: (
          <div key={qi} className="mb-6 last:mb-0">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Batch {q.batch?.batchNo ?? '—'}{' '}
                <span className="font-normal text-slate-500 dark:text-slate-400">
                  · {q.labChecks.length} lab checks · {q.flourTests.length} flour tests · {q.nonconformities.length} NCs · {q.capas.length} CAPAs
                </span>
              </p>
              <StatusBadge value={q.batch?.status ?? '—'} />
            </div>
            {steps.length === 0 ? (
              <EmptyState title="No quality records" sub="No lab checks, flour tests, NCs or CAPAs linked to this batch yet." />
            ) : (
              <ChainTimeline steps={steps} />
            )}
          </div>
        )
      });
    });
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Quality & CAPA History"
        sub="Every QC check, nonconformity and CAPA linked to a batch — complete evidence trail"
      />
      <div className={cardShell}>
        <CardHeader
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Select production batch"
          action={
            <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} className="!w-72 !py-2 !text-sm">
              <option value="">Select a batch…</option>
              {(batchesQ.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.batchNo}</option>
              ))}
            </Select>
          }
        />
        {!batchId ? (
          <EmptyState title="No batch selected" sub="Choose a production batch to see its full quality history." />
        ) : qQ.isLoading ? (
          <Spinner label="Loading quality history…" />
        ) : (
          sections.map((s) => s.node)
        )}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Duket extraction below 78% on a batch auto-raises a yield flag — see Yield Alerts under Production & Blending. Values in quintals: {fmtQ(0)}.
      </p>
    </div>
  );
}
