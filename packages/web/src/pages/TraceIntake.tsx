import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Factory, FlaskConical, Package, Truck, Wheat, XCircle
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate, fmtDateTime, fmtQ } from '../lib/format';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { EmptyState, SectionTitle, Spinner, TextInput } from '../components/ui';
import {
  asNum, cardShell, fmtPct, ChainTimeline, StatusBadge,
  type ChainStep, type IntakeRec
} from './TraceShared';

interface IntakeChain {
  intake: IntakeRec;
  tankFills: Array<{ id: string; tankCode: string; quintals: string | number; filledAt: string }>;
  batches: Array<{ batchId: string; intakeId: string; quintals: string | number; batch: { id: string; batchNo: string; productType: string; status: string } }>;
  downstream: Array<{
    batch: { id: string; batchNo: string };
    packRuns: Array<{ id: string; product?: { name: string } | null; bags: number; quintals: string | number }>;
    fgLots: Array<{ id: string; batchNo: string; product?: { name: string } | null; bags: number; quintals: string | number }>;
    customers: Array<{ name: string; quintals: number; bags: number }>;
  }>;
}

export function TraceIntake() {
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const intakesQ = useQuery({
    queryKey: ['trace-intakes'],
    queryFn: async () => (await api.get<IntakeRec[]>(E.traceIntakes)).data
  });

  const chainQ = useQuery({
    queryKey: ['trace-intake-chain', selectedId],
    queryFn: async () => (await api.get<IntakeChain>(E.traceChain('intake', selectedId!))).data,
    enabled: !!selectedId
  });

  const rows = (intakesQ.data ?? []).filter((i) =>
    !filter ||
    i.intakeNo.toLowerCase().includes(filter.toLowerCase()) ||
    (i.supplier?.name ?? '').toLowerCase().includes(filter.toLowerCase()) ||
    i.truckPlate.toLowerCase().includes(filter.toLowerCase())
  );

  const steps: ChainStep[] = [];
  const c = chainQ.data;
  if (c) {
    const in_ = c.intake;
    steps.push({
      icon: <Truck className="h-4 w-4" />,
      title: `Supplier — ${in_.supplier?.name ?? 'Unknown'}`,
      sub: (
        <span>
          Intake <strong className="tnum">{in_.intakeNo}</strong> · Truck{' '}
          <strong className="tnum">{in_.truckPlate}</strong> · {in_.wheatCategory.toLowerCase()}
          {in_.wheatOrigin ? ` (${in_.wheatOrigin})` : ''} ·{' '}
          <strong className="tnum">{fmtQ(in_.quintals)} Q</strong> ({in_.bagCount} bags)
        </span>
      ),
      date: fmtDateTime(in_.deliveryDate),
      accent: 'bg-blue-100 text-blue-700'
    });
    steps.push({
      icon: <Wheat className="h-4 w-4" />,
      title: 'Weighbridge & unloading',
      sub: (
        <span className="tnum">
          Gross {fmtQ(in_.grossKg)} kg · Tare {fmtQ(in_.tareKg)} kg · Net{' '}
          <strong>{fmtQ(in_.netKg)} kg</strong>
          {in_.moistureQuick != null ? ` · Gate moisture ${asNum(in_.moistureQuick).toFixed(1)}%` : ''}
        </span>
      ),
      accent: 'bg-amber-100 text-amber-700'
    });
    const labParams = [
      ['Gluten', in_.glutenPct], ['Moisture', in_.moisturePct], ['Impurity', in_.impurityPct],
      ['Hectoliter', in_.hectoliterPct], ['Germination', in_.germinationPct]
    ] as const;
    steps.push({
      icon: <FlaskConical className="h-4 w-4" />,
      title: 'Lab gate — five parameters',
      sub: (
        <span className="tnum">
          {labParams.map(([k, v]) => `${k} ${v == null ? '—' : asNum(v).toFixed(2)}`).join(' · ')}
          {in_.labTestedAt ? ` · tested ${fmtDateTime(in_.labTestedAt)}` : ' · not yet tested'}
        </span>
      ),
      badge: <StatusBadge value={in_.labTestedAt ? in_.status : 'PENDING_LAB'} />,
      accent: 'bg-violet-100 text-violet-700'
    });
    steps.push({
      icon: in_.decision === 'REJECT' ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />,
      title: 'Executive decision',
      sub: in_.decisionNote ? <span>{in_.decisionNote}</span> : <span>No decision recorded</span>,
      badge: <StatusBadge value={in_.decision ?? 'PENDING'} />
    });
    if (c.tankFills.length > 0) {
      steps.push({
        icon: <Factory className="h-4 w-4" />,
        title: 'Conditioning tank fills',
        sub: (
          <ul className="mt-1 space-y-1">
            {c.tankFills.map((f) => (
              <li key={f.id} className="tnum">
                {f.tankCode.replace('TANK_', 'Tank ')} — {fmtQ(f.quintals)} Q · {fmtDateTime(f.filledAt)}
              </li>
            ))}
          </ul>
        ),
        accent: 'bg-cyan-100 text-cyan-700'
      });
    }
    if (in_.flaggedReasons && in_.flaggedReasons.length > 0) {
      steps.push({
        icon: <AlertTriangle className="h-4 w-4" />,
        title: 'Flags',
        sub: <span>{in_.flaggedReasons.join(' · ')}</span>,
        badge: <StatusBadge value="FLAGGED" />,
        accent: 'bg-red-100 text-red-700'
      });
    }
    c.downstream.forEach((d) => {
      const lotQ = d.fgLots.reduce((s, l) => s + asNum(l.quintals), 0);
      steps.push({
        icon: <Package className="h-4 w-4" />,
        title: `Batch ${d.batch.batchNo}`,
        sub: (
          <span>
            <span className="tnum">
              {d.packRuns.length} packaging run(s) · {d.fgLots.length} finished lot(s) · {fmtQ(lotQ)} Q
            </span>
            {d.customers.length > 0 && (
              <span> · Customers: {d.customers.map((cu) => `${cu.name} (${fmtQ(cu.quintals)} Q)`).join(', ')}</span>
            )}
          </span>
        ),
        badge: <StatusBadge value="APPROVED" />,
        accent: 'bg-emerald-100 text-emerald-700'
      });
    });
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Wheat Intake Batch Traceability"
        sub="Full genealogy of every intake batch — supplier to final product"
      />
      <div className={cardShell}>
        <CardHeader
          icon={<Wheat className="h-4 w-4" />}
          title="Intake batches"
          subtitle={`${rows.length} batches`}
          action={
            <TextInput
              placeholder="Filter by no, supplier, truck…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="!w-64 !py-2 !text-sm"
            />
          }
        />
        {intakesQ.isLoading ? (
          <Spinner label="Loading intake batches…" />
        ) : (
          <DataTable<IntakeRec>
            rows={rows}
            columns={[
              { key: 'intakeNo', label: 'Intake No', mono: true },
              { key: 'deliveryDate', label: 'Delivered', render: (r) => fmtDate(r.deliveryDate), mono: true },
              { key: 'supplier', label: 'Supplier', render: (r) => r.supplier?.name ?? '—' },
              { key: 'truckPlate', label: 'Truck', mono: true },
              { key: 'wheatCategory', label: 'Type', render: (r) => r.wheatCategory.toLowerCase() },
              { key: 'quintals', label: 'Q', render: (r) => fmtQ(r.quintals), mono: true },
              {
                key: 'status', label: 'Decision',
                render: (r) => <StatusBadge value={r.decision ?? r.status} />
              },
              {
                key: 'chain', label: '',
                render: (r) => (
                  <button
                    onClick={() => setSelectedId(r.id)}
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"
                  >
                    Trace
                  </button>
                )
              }
            ]}
          />
        )}
      </div>

      {selectedId && (
        <div className={cardShell}>
          <CardHeader
            icon={<Wheat className="h-4 w-4" />}
            title={`Genealogy — ${c?.intake.intakeNo ?? '…'}`}
            subtitle="Upstream and downstream timeline"
            action={
              <button
                onClick={() => setSelectedId(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            }
          />
          {chainQ.isLoading ? (
            <Spinner label="Building genealogy…" />
          ) : chainQ.data ? (
            <ChainTimeline steps={steps} />
          ) : (
            <EmptyState title="Could not load chain" />
          )}
          {c && (
            <p className="mt-4 text-xs text-slate-400">
              Duket extraction on downstream batches is flagged automatically when below {fmtPct(78)}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
