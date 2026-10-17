import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate, fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { PestEvidenceRecord, PestSeverity, PestType, TreatmentType } from '../types';
import { Button, ErrorBox, Field, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { DataTable } from '../components/DataTable';
import {
  cardShell,
  EvidenceStatusBadge,
  PEST_AREAS,
  PEST_SEVERITIES,
  PEST_TYPES,
  PestCardHeader,
  PestKpi,
  pretty,
  SeverityBadge,
  TREATMENT_TYPES
} from './PestCommon';

export function PestTreatments() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('pest:manage');

  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<PestEvidenceRecord | null>(null);

  // Evidence form
  const [pestType, setPestType] = useState<PestType>('RODENT');
  const [location, setLocation] = useState<string>(PEST_AREAS[1]);
  const [severity, setSeverity] = useState<PestSeverity>('MEDIUM');
  const [description, setDescription] = useState('');
  // Treatment form
  const [treatment, setTreatment] = useState<TreatmentType | ''>('');
  const [chemical, setChemical] = useState('');
  const [dosage, setDosage] = useState('');
  const [treatedAt, setTreatedAt] = useState('');
  const [applicator, setApplicator] = useState('');

  const evidenceQ = useQuery({
    queryKey: ['pest-evidence', statusFilter || undefined, typeFilter || undefined],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.pestType = typeFilter;
      return (await api.get<PestEvidenceRecord[]>(E.pestEvidence, { params })).data;
    }
  });

  const kpis = useMemo(() => {
    const all = evidenceQ.data ?? [];
    const open = all.filter((x) => x.status === 'OPEN');
    const critical = open.filter((x) => x.severity === 'CRITICAL' || x.severity === 'HIGH');
    const treated = all.filter((x) => x.treatment).length;
    const cleared = all.filter((x) => x.status === 'CLEARED').length;
    return { open: open.length, critical: critical.length, treated, cleared };
  }, [evidenceQ.data]);

  const resetForm = () => {
    setPestType('RODENT');
    setLocation(PEST_AREAS[1]);
    setSeverity('MEDIUM');
    setDescription('');
    setTreatment('');
    setChemical('');
    setDosage('');
    setTreatedAt('');
    setApplicator('');
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      await api.post(E.pestEvidence, {
        pestType,
        location,
        severity,
        description: description.trim() || undefined,
        treatment: treatment || undefined,
        chemical: chemical.trim() || undefined,
        dosage: dosage.trim() || undefined,
        treatedAt: treatedAt || undefined,
        applicator: applicator.trim() || undefined
      });
      setNotice({ ok: true, text: `Evidence logged for ${pretty(pestType)} at ${location}.` });
      resetForm();
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['pest-evidence'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to log evidence.' });
    } finally {
      setSaving(false);
    }
  };

  const markCleared = async (id: string) => {
    setSaving(true);
    try {
      await api.post(E.pestEvidenceClear(id), {});
      setDetail((d) => (d && d.id === id ? { ...d, status: 'CLEARED' as const } : d));
      qc.invalidateQueries({ queryKey: ['pest-evidence'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to mark cleared.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Pest Evidence & Treatment Records"
        sub="Log pest evidence and record every treatment: traps, baits, sprays and fumigation"
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

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <PestKpi label="Open evidence" value={kpis.open} tone="rose" sub="Awaiting clearance" />
        <PestKpi label="High severity" value={kpis.critical} tone="amber" sub="High / critical open" />
        <PestKpi label="Treated" value={kpis.treated} tone="violet" sub="Treatment applied" />
        <PestKpi label="Cleared" value={kpis.cleared} tone="emerald" sub="Infestation cleared" />
      </div>

      <div className={`${cardShell} mb-4`}>
        <PestCardHeader
          icon={<Bug size={16} />}
          title="Evidence log"
          subtitle="Pest sightings and treatment records"
          action={
            canManage ? (
              <Button onClick={() => setShowForm((v) => !v)} className="px-4 py-2 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Plus size={14} /> Log evidence
                </span>
              </Button>
            ) : null
          }
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="OPEN">Open</option>
              <option value="CLEARED">Cleared</option>
            </Select>
          </Field>
          <Field label="Pest type">
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {PEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {pretty(t)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {showForm && canManage ? (
          <form onSubmit={create} className="mt-4 space-y-4 border-t border-slate-100 dark:border-slate-700 pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Pest type" required>
                <Select value={pestType} onChange={(e) => setPestType(e.target.value as PestType)} required>
                  {PEST_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {pretty(t)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Location" required>
                <Select value={location} onChange={(e) => setLocation(e.target.value)} required>
                  {PEST_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Severity" required>
                <Select value={severity} onChange={(e) => setSeverity(e.target.value as PestSeverity)} required>
                  {PEST_SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {pretty(s)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Description of evidence">
              <TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Droppings, gnaw marks, live insects, termite tunnels…" />
            </Field>
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Treatment applied</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Method">
                  <Select value={treatment} onChange={(e) => setTreatment(e.target.value as TreatmentType | '')}>
                    <option value="">No treatment yet</option>
                    {TREATMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {pretty(t)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Chemical used">
                  <TextInput value={chemical} onChange={(e) => setChemical(e.target.value)} placeholder="e.g. phosphine, pyrethrin" />
                </Field>
                <Field label="Dosage">
                  <TextInput value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="e.g. 2 g/m³ for 5 days" />
                </Field>
                <Field label="Treatment date">
                  <TextInput type="date" value={treatedAt} onChange={(e) => setTreatedAt(e.target.value)} />
                </Field>
                <Field label="Applicator">
                  <TextInput value={applicator} onChange={(e) => setApplicator(e.target.value)} placeholder="Name of applicator" />
                </Field>
              </div>
            </div>
            <Button type="submit" loading={saving} className="px-6 py-2.5">
              Log evidence
            </Button>
          </form>
        ) : null}
      </div>

      {evidenceQ.isLoading ? (
        <Spinner label="Loading evidence log..." />
      ) : evidenceQ.isError ? (
        <ErrorBox message="Could not load the evidence log." onRetry={() => evidenceQ.refetch()} />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable<PestEvidenceRecord>
              columns={[
                { key: 'pestType', label: 'Pest', render: (r) => <span className="font-semibold">{pretty(r.pestType)}</span> },
                { key: 'location', label: 'Location', render: (r) => <span className="capitalize">{r.location}</span> },
                { key: 'severity', label: 'Severity', render: (r) => <SeverityBadge severity={r.severity} /> },
                { key: 'observedAt', label: 'Observed', render: (r) => <span className="tnum">{fmtDate(r.observedAt)}</span>, mono: true },
                {
                  key: 'treatment',
                  label: 'Treatment',
                  render: (r) => (
                    <span className="text-sm">
                      {r.treatment ? pretty(r.treatment) : '—'}
                      {r.chemical ? <span className="block text-xs text-slate-500 dark:text-slate-400">{r.chemical}{r.dosage ? ` · ${r.dosage}` : ''}</span> : null}
                    </span>
                  )
                },
                { key: 'status', label: 'Status', render: (r) => <EvidenceStatusBadge status={r.status} /> },
                {
                  key: 'open',
                  label: '',
                  render: (r) => (
                    <Button variant="secondary" className="px-4 py-1.5 text-xs" onClick={() => setDetail(r)}>
                      Details
                    </Button>
                  )
                }
              ]}
              rows={evidenceQ.data ?? []}
              emptyTitle="No evidence logged"
              emptySub="Log the first pest sighting to open an evidence record."
            />
          </div>
          <div className="space-y-3 md:hidden">
            {(evidenceQ.data ?? []).length === 0 ? (
              <div className={`${cardShell} text-center text-sm text-slate-500`}>No evidence logged.</div>
            ) : (
              (evidenceQ.data ?? []).map((r) => (
                <div key={r.id} className={cardShell}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-100">
                        {pretty(r.pestType)} <span className="font-normal text-slate-500 dark:text-slate-400">· <span className="capitalize">{r.location}</span></span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">{fmtDate(r.observedAt)}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        Treatment: {r.treatment ? pretty(r.treatment) : '—'}
                        {r.chemical ? ` · ${r.chemical}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <SeverityBadge severity={r.severity} />
                      <EvidenceStatusBadge status={r.status} />
                    </div>
                  </div>
                  <Button variant="secondary" className="mt-3 w-full py-2 text-xs" onClick={() => setDetail(r)}>
                    Details
                  </Button>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className={`${cardShell} max-h-[90vh] w-full max-w-lg overflow-y-auto !p-6`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  {pretty(detail.pestType)} <span className="font-normal text-slate-500 dark:text-slate-400">· <span className="capitalize">{detail.location}</span></span>
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">Observed {fmtDateTime(detail.observedAt)}</p>
              </div>
              <EvidenceStatusBadge status={detail.status} />
            </div>
            {detail.description ? <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">{detail.description}</p> : null}
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Severity</dt>
                <dd><SeverityBadge severity={detail.severity} /></dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Treatment</dt>
                <dd className="font-medium">{detail.treatment ? pretty(detail.treatment) : '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Chemical / dosage</dt>
                <dd className="text-right font-medium">{detail.chemical ?? '—'}{detail.dosage ? ` · ${detail.dosage}` : ''}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Applicator</dt>
                <dd className="font-medium">{detail.applicator ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Treated at</dt>
                <dd className="font-medium tabular-nums">{detail.treatedAt ? fmtDate(detail.treatedAt) : '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Follow-ups</dt>
                <dd className="font-medium tabular-nums">{detail.followUps?.length ?? 0}</dd>
              </div>
            </dl>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={() => setDetail(null)} className="flex-1">
                Close
              </Button>
              {canManage && detail.status === 'OPEN' ? (
                <Button onClick={() => markCleared(detail.id)} loading={saving} className="flex-1">
                  Mark cleared
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
