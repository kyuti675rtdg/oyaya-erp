import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Save } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { CardHeader } from '../components/CardHeader';
import { Button, Field, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { Badge } from '../components/Badge';
import type { NcRootCause, Nonconformity } from '../types';
import {
  NC_SEVERITY_LABEL,
  NC_SOURCE_LABEL,
  cardShell,
  ncStatusTone,
  severityTone
} from './NcShared';

const FISHBONE_CATEGORIES = [
  { key: 'man', label: 'Man (people / training)' },
  { key: 'machine', label: 'Machine (equipment)' },
  { key: 'material', label: 'Material (wheat / inputs)' },
  { key: 'method', label: 'Method (procedure)' },
  { key: 'environment', label: 'Environment' }
];

export function NcRootCause() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [ncId, setNcId] = useState('');

  const [whys, setWhys] = useState<string[]>(['', '', '', '', '']);
  const [fishbone, setFishbone] = useState<Record<string, string>>({
    man: '',
    machine: '',
    material: '',
    method: '',
    environment: ''
  });
  const [rootCause, setRootCause] = useState('');
  const [analyst, setAnalyst] = useState('');

  const listQ = useQuery({
    queryKey: ['nonconformities'],
    queryFn: async () => (await api.get<Nonconformity[]>(E.nonconformities)).data
  });
  const rcQ = useQuery({
    queryKey: ['nc-root-cause', ncId],
    enabled: !!ncId,
    queryFn: async () => (await api.get<NcRootCause | null>(E.ncRootCause(ncId))).data
  });

  const selected = useMemo(
    () => (listQ.data ?? []).find((n) => n.id === ncId) ?? null,
    [listQ.data, ncId]
  );

  const pick = (id: string) => {
    setNcId(id);
    setNotice(null);
    setWhys(['', '', '', '', '']);
    setFishbone({ man: '', machine: '', material: '', method: '', environment: '' });
    setRootCause('');
    setAnalyst('');
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!ncId) {
      setNotice({ ok: false, text: 'Select a nonconformity first.' });
      return;
    }
    const trimmedWhys = whys.map((w) => w.trim()).filter(Boolean);
    if (trimmedWhys.length === 0 && !rootCause.trim()) {
      setNotice({ ok: false, text: 'Record at least one Why or the identified root cause.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await api.put(E.ncRootCause(ncId), {
        fiveWhys: trimmedWhys,
        fishbone: Object.fromEntries(Object.entries(fishbone).map(([k, v]) => [k, v.trim()])),
        rootCause: rootCause.trim() || undefined,
        analyst: analyst.trim() || undefined
      });
      setNotice({ ok: true, text: 'Root cause analysis saved.' });
      qc.invalidateQueries({ queryKey: ['nc-root-cause', ncId] });
      qc.invalidateQueries({ queryKey: ['nonconformities'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save analysis.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Root Cause Analysis"
        sub="5-Why drill-down and fishbone (Ishikawa) analysis per nonconformity"
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

      <div className="mb-4">
        <div className={cardShell}>
          <CardHeader icon={<GitBranch size={16} />} title="Select nonconformity" subtitle="Open and under-review records" />
          {listQ.isLoading ? (
            <Spinner label="Loading nonconformities..." />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Select value={ncId} onChange={(e) => pick(e.target.value)} className="min-w-64">
                <option value="">Select…</option>
                {(listQ.data ?? [])
                  .filter((n) => n.status !== 'CLOSED')
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.ncNo} — {n.description.slice(0, 60)}
                    </option>
                  ))}
              </Select>
              {selected ? (
                <div className="flex items-center gap-2 text-sm">
                  <Badge tone={severityTone(selected.severity)}>{NC_SEVERITY_LABEL[selected.severity]}</Badge>
                  <Badge tone={ncStatusTone(selected.status)}>{selected.status.replace('_', ' ')}</Badge>
                  <span className="text-slate-500">{NC_SOURCE_LABEL[selected.source]}</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {!ncId ? (
        <div className="rounded-xl border border-dashed border-line bg-alabaster px-6 py-10 text-center">
          <p className="font-semibold text-slate-700">No nonconformity selected</p>
          <p className="mt-1 text-sm text-slate-500">Choose a record above to run the 5-Why and fishbone analysis.</p>
        </div>
      ) : rcQ.isLoading ? (
        <Spinner label="Loading analysis..." />
      ) : (
        <form onSubmit={save} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className={cardShell}>
            <CardHeader icon={<GitBranch size={16} />} title="5-Why analysis" subtitle="Ask why until the process cause appears" />
            <div className="space-y-3">
              {whys.map((w, i) => (
                <Field key={i} label={`Why ${i + 1}`}>
                  <TextInput
                    value={w}
                    placeholder={rcQ.data?.fiveWhys[i] ?? `Why ${i + 1}…`}
                    onChange={(e) =>
                      setWhys((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                    }
                  />
                </Field>
              ))}
            </div>
          </div>

          <div className={cardShell}>
            <CardHeader icon={<GitBranch size={16} />} title="Fishbone categories" subtitle="Contributing factors per Ishikawa branch" />
            <div className="space-y-3">
              {FISHBONE_CATEGORIES.map((c) => (
                <Field key={c.key} label={c.label}>
                  <TextInput
                    value={fishbone[c.key] ?? ''}
                    placeholder={(rcQ.data?.fishbone as Record<string, string> | undefined)?.[c.key] ?? '…'}
                    onChange={(e) => setFishbone((prev) => ({ ...prev, [c.key]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
          </div>

          <div className={cardShell}>
            <CardHeader icon={<Save size={16} />} title="Identified root cause" subtitle="The single cause actions will address" />
            <div className="space-y-4">
              <Field label="Root cause" required>
                <TextArea
                  value={rootCause}
                  placeholder={rcQ.data?.rootCause ?? 'e.g. Roller gap drifted after shift change — no re-check SOP step.'}
                  onChange={(e) => setRootCause(e.target.value)}
                />
              </Field>
              <Field label="Analyst">
                <TextInput
                  value={analyst}
                  placeholder={rcQ.data?.analyst ?? 'Name of the analyst'}
                  onChange={(e) => setAnalyst(e.target.value)}
                />
              </Field>
              {rcQ.data?.analysisDate ? (
                <p className="text-xs text-slate-500">Last analysed {fmtDateTime(rcQ.data.analysisDate)}</p>
              ) : null}
              <Button type="submit" loading={saving} className="w-full">
                Save analysis
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
