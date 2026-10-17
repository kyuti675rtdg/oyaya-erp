import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Plus, SearchCheck, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { HygieneInspection, HygieneInspectionResult } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../store/auth';
import { fmtDate, fmtDateTime, fmtPct } from '../lib/format';
import {
  EQUIPMENT_OPTIONS,
  FACTORY_AREAS,
  INSPECTION_TONE,
  cardShell,
  todayISO
} from './HygieneCommon';
import {
  Button,
  Card,
  EmptyState,
  Field,
  SectionTitle,
  Select,
  Spinner,
  TextArea,
  TextInput
} from '../components/ui';

interface CriterionDraft {
  criterion: string;
  result: HygieneInspectionResult;
  notes: string;
}

const emptyCriterion = (): CriterionDraft => ({ criterion: '', result: 'PASS', notes: '' });

const DEFAULT_CRITERIA = [
  'Floors and walls free of dust and residue',
  'Equipment surfaces clean and dry',
  'No pest signs or droppings',
  'Cleaning tools stored correctly',
  'Waste bins emptied and covered'
];

export function HygieneInspections() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('hygiene:manage');

  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<HygieneInspection | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Create form
  const [targetType, setTargetType] = useState<'AREA' | 'EQUIPMENT'>('AREA');
  const [targetArea, setTargetArea] = useState<string>(FACTORY_AREAS[0]);
  const [targetEquipment, setTargetEquipment] = useState<string>(EQUIPMENT_OPTIONS[0]);
  const [targetCustom, setTargetCustom] = useState('');
  const [inspector, setInspector] = useState('');
  const [score, setScore] = useState('');
  const [findings, setFindings] = useState('');
  const [photosNote, setPhotosNote] = useState('');
  const [criteria, setCriteria] = useState<CriterionDraft[]>(DEFAULT_CRITERIA.map((c) => ({ ...emptyCriterion(), criterion: c })));

  const listQ = useQuery({
    queryKey: ['hygiene', 'inspections', targetTypeFilter, resultFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (targetTypeFilter) params.set('targetType', targetTypeFilter);
      if (resultFilter) params.set('result', resultFilter);
      return (await api.get<HygieneInspection[]>(`${E.hygInspections}?${params}`)).data;
    }
  });

  const openDetail = async (row: HygieneInspection) => {
    try {
      const res = await api.get<HygieneInspection>(E.hygInspection(row.id));
      setDetail(res.data);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to load inspection.' });
    }
  };

  const targetName = () => {
    if (targetType === 'AREA') return targetArea;
    if (targetEquipment === 'Other') return targetCustom.trim();
    return targetEquipment;
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const cleanCriteria = criteria
      .map((c) => ({ criterion: c.criterion.trim(), result: c.result, notes: c.notes.trim() || null }))
      .filter((c) => c.criterion);
    const name = targetName();
    if (!name || !inspector.trim() || cleanCriteria.length === 0) {
      setNotice({ ok: false, text: 'Target, inspector and at least one criterion are required.' });
      return;
    }
    const parsedScore = score.trim() === '' ? null : Number(score);
    if (parsedScore !== null && (Number.isNaN(parsedScore) || parsedScore < 0 || parsedScore > 100)) {
      setNotice({ ok: false, text: 'Score must be between 0 and 100.' });
      return;
    }
    setSaving(true);
    try {
      await api.post(E.hygInspections, {
        targetType,
        target: name,
        inspector: inspector.trim(),
        score: parsedScore,
        findings: findings.trim() || null,
        photosNote: photosNote.trim() || null,
        criteria: cleanCriteria
      });
      setNotice({ ok: true, text: 'Inspection recorded.' });
      setInspector('');
      setScore('');
      setFindings('');
      setPhotosNote('');
      setTargetCustom('');
      setCriteria(DEFAULT_CRITERIA.map((c) => ({ ...emptyCriterion(), criterion: c })));
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['hygiene', 'inspections'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to record inspection.' });
    } finally {
      setSaving(false);
    }
  };

  const derivedOverall = (rows: Array<{ result: HygieneInspectionResult }>): HygieneInspectionResult =>
    rows.some((c) => c.result === 'FAIL') ? 'FAIL' : 'PASS';

  const columns = [
    { key: 'inspectedAt', label: 'Date', render: (r: HygieneInspection) => <span className="tabular-nums">{fmtDateTime(r.inspectedAt)}</span> },
    {
      key: 'target',
      label: 'Target',
      render: (r: HygieneInspection) => (
        <span>
          <span className="font-semibold text-slate-800 dark:text-slate-100">{r.target}</span>
          <span className="ml-2 text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">{r.targetType}</span>
        </span>
      )
    },
    { key: 'inspector', label: 'Inspector' },
    {
      key: 'score',
      label: 'Score',
      mono: true,
      render: (r: HygieneInspection) => <span className="tabular-nums">{r.score ?? '—'}</span>
    },
    {
      key: 'overallResult',
      label: 'Result',
      render: (r: HygieneInspection) =>
        r.overallResult ? <Badge tone={INSPECTION_TONE[r.overallResult]}>{r.overallResult}</Badge> : <span className="text-slate-400 dark:text-slate-500">—</span>
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r: HygieneInspection) => (
        <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => openDetail(r)}>Open</Button>
      )
    }
  ];

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Hygiene Inspection Records"
        sub="Inspections of areas and equipment with PASS/FAIL criteria, scores and findings"
        action={
          canManage ? (
            <Button onClick={() => setShowForm((v) => !v)}>
              <Plus size={16} /> New inspection
            </Button>
          ) : undefined
        }
      />

      {notice ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className={cardShell}>
        <CardHeader
          icon={<SearchCheck size={16} />}
          title="Inspection records"
          subtitle="Any failed criterion marks the whole inspection FAIL"
          action={
            <div className="flex gap-2">
              <Select value={targetTypeFilter} onChange={(e) => setTargetTypeFilter(e.target.value)} className="!w-auto !px-3 !py-1.5 !text-sm">
                <option value="">Areas + equipment</option>
                <option value="AREA">Areas</option>
                <option value="EQUIPMENT">Equipment</option>
              </Select>
              <Select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} className="!w-auto !px-3 !py-1.5 !text-sm">
                <option value="">All results</option>
                <option value="PASS">PASS</option>
                <option value="FAIL">FAIL</option>
              </Select>
            </div>
          }
        />
        {listQ.isLoading ? (
          <Spinner label="Loading inspections..." />
        ) : listQ.isError ? (
          <EmptyState title="Failed to load inspections" sub="Check your connection and try again." />
        ) : (listQ.data ?? []).length === 0 ? (
          <EmptyState title="No inspections recorded" sub="Record the first hygiene inspection above." />
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable columns={columns} rows={listQ.data ?? []} />
            </div>
            <div className="grid grid-cols-1 gap-3 md:hidden">
              {(listQ.data ?? []).map((r) => (
                <div key={r.id} className="rounded-xl border border-line bg-white dark:bg-slate-800 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-100">{r.target}</p>
                      <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{fmtDate(r.inspectedAt)} · {r.inspector}</p>
                    </div>
                    {r.overallResult ? <Badge tone={INSPECTION_TONE[r.overallResult]}>{r.overallResult}</Badge> : null}
                  </div>
                  <Button variant="secondary" className="mt-3 w-full py-1.5 text-sm" onClick={() => openDetail(r)}>Open</Button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showForm ? (
        <form onSubmit={create} className={cardShell}>
          <CardHeader icon={<Plus size={16} />} title="New inspection" subtitle={`Date defaults to ${todayISO()}`} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Target type" required>
              <Select value={targetType} onChange={(e) => setTargetType(e.target.value as 'AREA' | 'EQUIPMENT')}>
                <option value="AREA">Production area</option>
                <option value="EQUIPMENT">Equipment</option>
              </Select>
            </Field>
            {targetType === 'AREA' ? (
              <Field label="Area" required>
                <Select value={targetArea} onChange={(e) => setTargetArea(e.target.value)}>
                  {FACTORY_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="Equipment" required>
                <Select value={targetEquipment} onChange={(e) => setTargetEquipment(e.target.value)}>
                  {EQUIPMENT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              </Field>
            )}
            {targetType === 'EQUIPMENT' && targetEquipment === 'Other' ? (
              <Field label="Equipment name" required>
                <TextInput value={targetCustom} onChange={(e) => setTargetCustom(e.target.value)} placeholder="Equipment name" />
              </Field>
            ) : null}
            <Field label="Inspector" required>
              <TextInput value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="Inspector name" />
            </Field>
            <Field label="Hygiene score (0–100)" hint="Optional">
              <TextInput type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} placeholder="e.g. 92" />
            </Field>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Criteria <span className="font-normal text-slate-500 dark:text-slate-400">(overall: {derivedOverall(criteria.filter((c) => c.criterion.trim()))})</span>
            </p>
            <div className="space-y-2">
              {criteria.map((c, i) => (
                <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-line bg-alabaster p-3 md:grid-cols-[1fr_140px_auto]">
                  <TextInput value={c.criterion} onChange={(e) => setCriteria((p) => p.map((x, j) => (j === i ? { ...x, criterion: e.target.value } : x)))} placeholder="Criterion" />
                  <Select value={c.result} onChange={(e) => setCriteria((p) => p.map((x, j) => (j === i ? { ...x, result: e.target.value as HygieneInspectionResult } : x)))}>
                    <option value="PASS">PASS</option>
                    <option value="FAIL">FAIL</option>
                  </Select>
                  <Button type="button" variant="ghost" className="px-2 py-2" onClick={() => setCriteria((p) => p.filter((_, j) => j !== i))} aria-label="Remove criterion">
                    <Trash2 size={16} />
                  </Button>
                  <TextInput className="md:col-span-3" value={c.notes} onChange={(e) => setCriteria((p) => p.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} placeholder="Notes (optional)" />
                </div>
              ))}
            </div>
            <Button type="button" variant="secondary" className="mt-2 text-sm" onClick={() => setCriteria((p) => [...p, emptyCriterion()])}>
              <Plus size={14} /> Add criterion
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Findings">
              <TextArea value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="Observations and findings" />
            </Field>
            <Field label="Photos note" hint="Reference to stored inspection photos">
              <TextInput value={photosNote} onChange={(e) => setPhotosNote(e.target.value)} placeholder="e.g. photos/2026-10-17-milling.zip" />
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" loading={saving}>Save inspection</Button>
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <Card className="max-h-[90vh] w-full max-w-xl overflow-y-auto p-6">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink">{detail.target}</h3>
                <p className="text-sm tabular-nums text-slate-500 dark:text-slate-400">{fmtDateTime(detail.inspectedAt)} · {detail.inspector}</p>
              </div>
              <Button variant="ghost" className="px-2 py-1" onClick={() => setDetail(null)} aria-label="Close">
                <X size={18} />
              </Button>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {detail.overallResult ? <Badge tone={INSPECTION_TONE[detail.overallResult]}>{detail.overallResult}</Badge> : null}
              {detail.score !== null && detail.score !== undefined ? (
                <span className="text-sm tabular-nums text-slate-600 dark:text-slate-300">Score {fmtPct(detail.score, 0)}</span>
              ) : null}
              {detail.photosNote ? (
                <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><Camera size={13} /> {detail.photosNote}</span>
              ) : null}
            </div>
            <ul className="space-y-2">
              {(detail.criteria ?? []).map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-alabaster px-3 py-2.5">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{c.criterion}</p>
                    {c.notes ? <p className="text-xs text-slate-500 dark:text-slate-400">{c.notes}</p> : null}
                  </div>
                  <Badge tone={INSPECTION_TONE[c.result]}>{c.result}</Badge>
                </li>
              ))}
            </ul>
            {detail.findings ? (
              <div className="mt-3">
                <p className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Findings</p>
                <p className="text-sm text-slate-700 dark:text-slate-200">{detail.findings}</p>
              </div>
            ) : null}
            <div className="mt-4">
              <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
