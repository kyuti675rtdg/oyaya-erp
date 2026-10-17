import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, SlidersHorizontal, FlaskConical, Warehouse, Coins, Save, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { DriverTripRate, PieceRateConfig, QcThreshold, StorageLocation } from '../types';
import { CardHeader } from '../components/CardHeader';
import { AdminNotice, errText } from '../components/AdminModal';
import { Button, Card, Field, NumberInput, SectionTitle, Select, Spinner, TextInput, TextArea } from '../components/ui';
import { useAuth } from '../store/auth';
import { useNetwork } from '../store/network';

type Notice = { ok: boolean; text: string } | null;

function useNotice() {
  return useState<Notice>(null);
}

// ─── Module 18: Company & organization settings ─────────────────────

interface CompanyProfile {
  id: string;
  name: string;
  address: string | null;
  taxId: string | null;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  fiscalYearStartMonth: number | null;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function CompanySettingsEditor() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('settings:create');
  const [notice, setNotice] = useNotice();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const q = useQuery({
    queryKey: ['settings-company'],
    queryFn: async () => (await api.get<CompanyProfile>(E.settingsCompany)).data,
  });

  useEffect(() => {
    if (q.data && !initialized) {
      setDraft({
        name: q.data.name ?? '',
        address: q.data.address ?? '',
        taxId: q.data.taxId ?? '',
        logoUrl: q.data.logoUrl ?? '',
        phone: q.data.phone ?? '',
        email: q.data.email ?? '',
        fiscalYearStartMonth: q.data.fiscalYearStartMonth != null ? String(q.data.fiscalYearStartMonth) : '',
      });
      setInitialized(true);
    }
  }, [q.data, initialized]);

  const save = async () => {
    setNotice(null);
    if (!draft.name?.trim()) {
      setNotice({ ok: false, text: 'Company name is required.' });
      return;
    }
    if (draft.email && !/^\S+@\S+\.\S+$/.test(draft.email.trim())) {
      setNotice({ ok: false, text: 'Company email is not a valid email address.' });
      return;
    }
    const fy = draft.fiscalYearStartMonth ? Number(draft.fiscalYearStartMonth) : null;
    if (fy != null && (!Number.isInteger(fy) || fy < 1 || fy > 12)) {
      setNotice({ ok: false, text: 'Fiscal year start must be a month 1–12.' });
      return;
    }
    setSaving(true);
    try {
      await api.put(E.settingsCompany, {
        name: draft.name.trim(),
        address: draft.address?.trim() || null,
        taxId: draft.taxId?.trim() || null,
        logoUrl: draft.logoUrl?.trim() || null,
        phone: draft.phone?.trim() || null,
        email: draft.email?.trim() || null,
        fiscalYearStartMonth: fy,
      });
      setNotice({ ok: true, text: 'Company settings saved.' });
      qc.invalidateQueries({ queryKey: ['settings-company'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to save company settings.') });
    } finally {
      setSaving(false);
    }
  };

  const onLogoFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 300 * 1024) {
      setNotice({ ok: false, text: 'Logo file must be under 300 KB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDraft((d) => ({ ...d, logoUrl: String(reader.result) }));
      setNotice({ ok: true, text: 'Logo attached — save to apply.' });
    };
    reader.onerror = () => setNotice({ ok: false, text: 'Could not read the logo file.' });
    reader.readAsDataURL(file);
  };

  const logoPreview = draft.logoUrl?.startsWith('data:image') || draft.logoUrl?.startsWith('http') ? draft.logoUrl : null;

  return (
    <Card className="p-5">
      <CardHeader
        icon={<Building2 className="h-4 w-4" />}
        title="Company & organization"
        subtitle="Legal identity shown on invoices, reports and the login screen"
        action={
          canManage ? (
            <Button onClick={save} loading={saving} disabled={!initialized}>
              <Save className="h-4 w-4" /> Save
            </Button>
          ) : undefined
        }
      />
      <AdminNotice notice={notice} />
      {!initialized ? (
        <Spinner label="Loading company profile..." />
      ) : (
        <div className="space-y-6">
          {/* Brand identity section */}
          <div>
            <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Brand identity</h4>
            <div className="flex items-center gap-4 rounded-xl border border-slate-200/70 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white shadow-sm dark:border-slate-600 dark:bg-slate-700">
                {logoPreview ? (
                  <img src={logoPreview} alt="Company logo" className="h-full w-full object-contain" />
                ) : (
                  <Building2 className="h-8 w-8 text-slate-300 dark:text-slate-500" />
                )}
              </div>
              <div className="flex-1">
                <Field label="Logo" hint="PNG/JPG under 300 KB, or paste an image URL below.">
                  <div className="flex flex-wrap gap-2">
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onLogoFile(e.target.files?.[0])} />
                    <Button variant="secondary" type="button" onClick={() => fileRef.current?.click()} disabled={!canManage}>
                      <Upload className="h-4 w-4" /> Upload logo
                    </Button>
                    {logoPreview ? (
                      <Button variant="secondary" type="button" onClick={() => setDraft((d) => ({ ...d, logoUrl: '' }))} disabled={!canManage}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </Field>
              </div>
            </div>
            <div className="mt-3">
              <Field label="Logo URL" hint="Alternative to uploading — an https URL.">
                <TextInput value={draft.logoUrl} onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })} placeholder="https://…" disabled={!canManage} />
              </Field>
            </div>
          </div>

          {/* Legal identity section */}
          <div>
            <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Legal identity</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Company name" required>
                <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={!canManage} placeholder="Oyaya Flour Production Company PLC" />
              </Field>
              <Field label="TIN (tax identification number)" hint="Ethiopian tax ID for invoices.">
                <TextInput value={draft.taxId} onChange={(e) => setDraft({ ...draft, taxId: e.target.value })} disabled={!canManage} placeholder="0000000000" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Registered address">
                  <TextArea value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} disabled={!canManage} placeholder="Street, city, region" rows={2} />
                </Field>
              </div>
            </div>
          </div>

          {/* Contact & financial section */}
          <div>
            <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Contact & financial year</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Phone">
                <TextInput value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} disabled={!canManage} placeholder="+251 ..." />
              </Field>
              <Field label="Email">
                <TextInput type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} disabled={!canManage} placeholder="info@company.et" />
              </Field>
              <Field label="Fiscal year start" hint="Month the financial year begins.">
                <Select
                  value={draft.fiscalYearStartMonth}
                  onChange={(e) => setDraft({ ...draft, fiscalYearStartMonth: e.target.value })}
                  disabled={!canManage}
                >
                  <option value="">— Not set —</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Module 18: General system preferences ──────────────────────────

const PREF_KEYS = ['prefs.timezone', 'prefs.dateFormat', 'prefs.numberFormat', 'prefs.language', 'prefs.defaultPageSize'] as const;

function PreferencesEditor() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('settings:create');
  const [notice, setNotice] = useNotice();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  const q = useQuery({
    queryKey: ['settings-preferences'],
    queryFn: async () => (await api.get<Record<string, string>>(E.settingsPreferences)).data,
  });

  useEffect(() => {
    if (q.data && !initialized) {
      const d: Record<string, string> = {};
      for (const k of PREF_KEYS) d[k] = q.data[k] ?? '';
      setDraft(d);
      setInitialized(true);
    }
  }, [q.data, initialized]);

  const save = async () => {
    setNotice(null);
    const pageSize = Number(draft['prefs.defaultPageSize']);
    if (!Number.isInteger(pageSize) || pageSize < 5 || pageSize > 500) {
      setNotice({ ok: false, text: 'Default page size must be between 5 and 500.' });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      for (const k of PREF_KEYS) payload[k] = draft[k] ?? '';
      await api.put(E.settingsPreferences, payload);
      setNotice({ ok: true, text: 'Preferences saved.' });
      qc.invalidateQueries({ queryKey: ['settings-preferences'] });
    } catch (err) {
      setNotice({ ok: false, text: errText(err, 'Failed to save preferences.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <CardHeader
        icon={<SlidersHorizontal className="h-4 w-4" />}
        title="General preferences"
        subtitle="Timezone, formats and display defaults for the whole system"
        action={
          canManage ? (
            <Button onClick={save} loading={saving} disabled={!initialized}>
              <Save className="h-4 w-4" /> Save
            </Button>
          ) : undefined
        }
      />
      <AdminNotice notice={notice} />
      {!initialized ? (
        <Spinner label="Loading preferences..." />
      ) : (
        <div className="space-y-6">
          <div>
            <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Regional</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Timezone" hint="Used when rendering dates and scheduling.">
                <Select value={draft['prefs.timezone']} onChange={(e) => setDraft({ ...draft, 'prefs.timezone': e.target.value })} disabled={!canManage}>
                  <option value="Africa/Addis_Ababa">Africa/Addis_Ababa (EAT)</option>
                  <option value="UTC">UTC</option>
                  <option value="Africa/Nairobi">Africa/Nairobi</option>
                  <option value="Europe/London">Europe/London</option>
                </Select>
              </Field>
              <Field label="Language">
                <Select value={draft['prefs.language']} onChange={(e) => setDraft({ ...draft, 'prefs.language': e.target.value })} disabled={!canManage}>
                  <option value="en">English</option>
                  <option value="am">አማርኛ (Amharic)</option>
                </Select>
              </Field>
              <Field label="Date format">
                <Select value={draft['prefs.dateFormat']} onChange={(e) => setDraft({ ...draft, 'prefs.dateFormat': e.target.value })} disabled={!canManage}>
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </Select>
              </Field>
              <Field label="Number format">
                <Select value={draft['prefs.numberFormat']} onChange={(e) => setDraft({ ...draft, 'prefs.numberFormat': e.target.value })} disabled={!canManage}>
                  <option value="1,234.56">1,234.56</option>
                  <option value="1.234,56">1.234,56</option>
                  <option value="1 234.56">1 234.56</option>
                </Select>
              </Field>
            </div>
          </div>
          <div>
            <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Display</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Default page size" hint="Rows per table page (5–500).">
                <NumberInput
                  value={draft['prefs.defaultPageSize']}
                  onChange={(e) => setDraft({ ...draft, 'prefs.defaultPageSize': e.target.value })}
                  min={5} max={500}
                  disabled={!canManage}
                />
              </Field>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Existing editors below (unchanged) ─────────────────────────────

function Notice({ notice }: { notice: { ok: boolean; text: string } | null }) {
  if (!notice) return null;
  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
        notice.ok
          ? 'border-pass-text/30 bg-pass-bg text-pass-text'
          : 'border-critical-text/30 bg-critical-bg text-critical-text'
      }`}
    >
      {notice.text}
    </div>
  );
}

function ThresholdsEditor() {
  const qc = useQueryClient();
  const online = useNetwork((s) => s.online);
  const [notice, setNotice] = useNotice();
  const [drafts, setDrafts] = useState<Record<string, { min: string; max: string }>>({});
  const [savingId, setSavingId] = useState('');

  const q = useQuery({
    queryKey: ['qc-thresholds'],
    queryFn: async () => (await api.get<QcThreshold[]>(E.qcThresholds)).data
  });

  const save = async (t: QcThreshold) => {
    const d = drafts[t.id];
    setNotice(null);
    if (!online) {
      setNotice({ ok: false, text: 'Configuration changes require a live connection.' });
      return;
    }
    setSavingId(t.id);
    try {
      const min = d?.min === undefined || d.min === '' ? null : Number(d.min);
      const max = d?.max === undefined || d.max === '' ? null : Number(d.max);
      if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) {
        setNotice({ ok: false, text: `${t.param}: min and max must be numeric or empty.` });
        return;
      }
      await api.put(`${E.qcThresholds}/${t.id}`, { minValue: min, maxValue: max });
      setDrafts((p) => {
        const next = { ...p };
        delete next[t.id];
        return next;
      });
      setNotice({ ok: true, text: `Threshold ${t.param} saved.` });
      qc.invalidateQueries({ queryKey: ['qc-thresholds'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSavingId('');
    }
  };

  return (
    <Card className="p-5">
      <CardHeader
        icon={<FlaskConical className="h-4 w-4" />}
        title="Quality thresholds"
        subtitle="Intake acceptance limits and in-process standard ranges."
      />
      <Notice notice={notice} />
      {q.isLoading ? (
        <Spinner label="Loading thresholds..." />
      ) : (
        <div className="space-y-6">
          {(() => {
            const groups: Record<string, typeof q.data> = {};
            for (const t of q.data ?? []) {
              const cat = t.category || 'General';
              if (!groups[cat]) groups[cat] = [];
              groups[cat]!.push(t);
            }
            return Object.entries(groups).map(([cat, items]) => (
              <div key={cat}>
                <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <FlaskConical className="h-3.5 w-3.5" />
                  {cat}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {items!.length}
                  </span>
                </h4>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {items!.map((t) => {
                    const d = drafts[t.id] ?? { min: String(t.minValue ?? ''), max: String(t.maxValue ?? '') };
                    const isDirty = !!drafts[t.id];
                    return (
                      <div
                        key={t.id}
                        className={`rounded-xl border p-4 transition-colors ${
                          isDirty
                            ? 'border-amber-300 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-500/5'
                            : 'border-slate-200/70 bg-white dark:border-slate-700 dark:bg-slate-800/50'
                        }`}
                      >
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-ink dark:text-white">{t.param}</p>
                            {t.unit ? (
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Unit: {t.unit}</p>
                            ) : null}
                          </div>
                          {isDirty ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                              Unsaved
                            </span>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Min">
                            <NumberInput
                              value={d.min}
                              onChange={(e) => setDrafts((p) => ({ ...p, [t.id]: { ...d, min: e.target.value } }))}
                              step="0.01"
                              placeholder="—"
                            />
                          </Field>
                          <Field label="Max">
                            <NumberInput
                              value={d.max}
                              onChange={(e) => setDrafts((p) => ({ ...p, [t.id]: { ...d, max: e.target.value } }))}
                              step="0.01"
                              placeholder="—"
                            />
                          </Field>
                        </div>
                        <Button
                          onClick={() => save(t)}
                          loading={savingId === t.id}
                          variant={isDirty ? 'primary' : 'secondary'}
                          className="mt-3 w-full"
                          disabled={!isDirty && savingId !== t.id}
                        >
                          {isDirty ? 'Save changes' : 'Saved'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
          {(q.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No quality thresholds configured.</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function StorageEditor() {
  const qc = useQueryClient();
  const online = useNetwork((s) => s.online);
  const [notice, setNotice] = useNotice();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState('');

  const q = useQuery({
    queryKey: ['storage-locations'],
    queryFn: async () => (await api.get<StorageLocation[]>(E.storageLocations)).data
  });

  const save = async (loc: StorageLocation) => {
    const raw = drafts[loc.id] ?? String(loc.capacityQ);
    setNotice(null);
    if (!online) {
      setNotice({ ok: false, text: 'Configuration changes require a live connection.' });
      return;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) {
      setNotice({ ok: false, text: `${loc.name}: capacity must be a positive number.` });
      return;
    }
    setSavingId(loc.id);
    try {
      await api.put(`${E.storageLocations}/${loc.id}`, { capacityQ: v });
      setDrafts((p) => {
        const next = { ...p };
        delete next[loc.id];
        return next;
      });
      setNotice({ ok: true, text: `${loc.name} capacity saved.` });
      qc.invalidateQueries({ queryKey: ['storage-locations'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSavingId('');
    }
  };

  return (
    <Card className="p-5">
      <CardHeader
        icon={<Warehouse className="h-4 w-4" />}
        title="Storage capacities"
        subtitle="Dry-storage pool and conditioning tank capacities (quintals)."
      />
      <Notice notice={notice} />
      {q.isLoading ? (
        <Spinner label="Loading storage..." />
      ) : (
        <div className="space-y-4">
          {(q.data ?? []).map((loc) => (
            <div key={loc.id} className="rounded-lg border border-line p-3">
              <Field label={`${loc.name} (${loc.code})`} hint="Quintals">
                <NumberInput
                  value={drafts[loc.id] ?? String(loc.capacityQ)}
                  onChange={(e) => setDrafts((p) => ({ ...p, [loc.id]: e.target.value }))}
                  step="0.1"
                  min={0}
                />
              </Field>
              <Button onClick={() => save(loc)} loading={savingId === loc.id} variant="secondary" className="mt-2 w-full">
                Save
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RatesEditor() {
  const qc = useQueryClient();
  const online = useNetwork((s) => s.online);
  const [notice, setNotice] = useNotice();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState('');

  const ratesQ = useQuery({
    queryKey: ['piece-rates'],
    queryFn: async () => (await api.get<PieceRateConfig[]>(E.pieceRates)).data
  });
  const tripQ = useQuery({
    queryKey: ['driver-trip-rate'],
    queryFn: async () => (await api.get<DriverTripRate | null>(E.driverTripRate)).data
  });

  const rateByStage = new Map((ratesQ.data ?? []).map((r) => [r.stage, r]));

  const saveStage = async (stage: PieceRateConfig['stage']) => {
    const key = `stage:${stage}`;
    const raw = drafts[key] ?? String(rateByStage.get(stage)?.rateBirrPerQ ?? '');
    setNotice(null);
    if (!online) {
      setNotice({ ok: false, text: 'Configuration changes require a live connection.' });
      return;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) {
      setNotice({ ok: false, text: 'Rate must be a positive number.' });
      return;
    }
    setSavingKey(key);
    try {
      await api.post(E.pieceRates, { stage, rateBirrPerQ: v });
      setNotice({ ok: true, text: `Piece rate for ${stage.replace('_', ' ')} saved.` });
      qc.invalidateQueries({ queryKey: ['piece-rates'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSavingKey('');
    }
  };

  const saveTrip = async () => {
    const key = 'trip';
    const raw = drafts[key] ?? String(tripQ.data?.rateBirrPerTrip ?? '');
    setNotice(null);
    if (!online) {
      setNotice({ ok: false, text: 'Configuration changes require a live connection.' });
      return;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) {
      setNotice({ ok: false, text: 'Trip rate must be a positive number.' });
      return;
    }
    setSavingKey(key);
    try {
      await api.post(E.driverTripRate, { rateBirrPerTrip: v });
      setNotice({ ok: true, text: 'Driver trip rate saved.' });
      qc.invalidateQueries({ queryKey: ['driver-trip-rate'] });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSavingKey('');
    }
  };

  const stages: Array<PieceRateConfig['stage']> = ['UNLOADING', 'GRANARY_DUMPING', 'STORE_MOVEMENT', 'TRUCK_LOADING'];

  return (
    <Card className="p-5">
      <CardHeader
        icon={<Coins className="h-4 w-4" />}
        title="Piece & trip rates"
        subtitle="Birr per quintal for the four labor stages, and the driver trip rate."
      />
      <Notice notice={notice} />
      {ratesQ.isLoading || tripQ.isLoading ? (
        <Spinner label="Loading rates..." />
      ) : (
        <div className="space-y-4">
          {stages.map((stage) => {
            const key = `stage:${stage}`;
            return (
              <div key={stage} className="rounded-lg border border-line p-3">
                <Field label={stage.replace(/_/g, ' ')} hint="ETB per quintal">
                  <NumberInput
                    value={drafts[key] ?? String(rateByStage.get(stage)?.rateBirrPerQ ?? '')}
                    onChange={(e) => setDrafts((p) => ({ ...p, [key]: e.target.value }))}
                    step="0.01"
                    min={0}
                  />
                </Field>
                <Button onClick={() => saveStage(stage)} loading={savingKey === key} variant="secondary" className="mt-2 w-full">
                  Save
                </Button>
              </div>
            );
          })}
          <div className="rounded-lg border border-line p-3">
            <Field label="Driver trip rate" hint="ETB per trip (fixed destination-area rule)">
              <NumberInput
                value={drafts['trip'] ?? String(tripQ.data?.rateBirrPerTrip ?? '')}
                onChange={(e) => setDrafts((p) => ({ ...p, trip: e.target.value }))}
                step="0.01"
                min={0}
              />
            </Field>
            <Button onClick={saveTrip} loading={savingKey === 'trip'} variant="secondary" className="mt-2 w-full">
              Save
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const TABS = [
  { id: 'company', label: 'Company profile', desc: 'Name, address, tax ID, logo & fiscal year', icon: Building2 },
  { id: 'preferences', label: 'System preferences', desc: 'Language, units, notifications & defaults', icon: SlidersHorizontal },
  { id: 'quality', label: 'Quality thresholds', desc: 'Intake QC limits & flour specifications', icon: FlaskConical },
  { id: 'storage', label: 'Storage capacities', desc: 'Dry pool, conditioning tanks & locations', icon: Warehouse },
  { id: 'rates', label: 'Payroll rates', desc: 'Piece rates, driver trip rates & allowances', icon: Coins },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function Settings() {
  const [tab, setTab] = useState<TabId>('company');
  const active = TABS.find((t) => t.id === tab)!;
  return (
    <div>
      <SectionTitle
        title="Settings"
        sub="Company profile, system preferences, quality thresholds, storage capacities and payroll rates"
      />
      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        {/* Professional sidebar navigation */}
        <nav
          className="rounded-2xl border border-slate-200/70 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-800 lg:sticky lg:top-4 lg:self-start"
          aria-label="Settings sections"
        >
          {TABS.map((t) => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`touch flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                  isActive
                    ? 'bg-violet-50 dark:bg-violet-500/10'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    isActive
                      ? 'bg-violet-600 text-white dark:bg-violet-500'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                  }`}
                >
                  <t.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-semibold ${
                      isActive ? 'text-violet-700 dark:text-violet-300' : 'text-slate-800 dark:text-slate-100'
                    }`}
                  >
                    {t.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-slate-500 dark:text-slate-400">
                    {t.desc}
                  </span>
                </span>
                {isActive ? (
                  <span className="ml-auto mt-2 h-2 w-2 shrink-0 rounded-full bg-violet-600 dark:bg-violet-400" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Content area */}
        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white dark:bg-violet-500">
              <active.icon className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-ink dark:text-white">{active.label}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{active.desc}</p>
            </div>
          </div>
          {tab === 'company' && <CompanySettingsEditor />}
          {tab === 'preferences' && <PreferencesEditor />}
          {tab === 'quality' && <ThresholdsEditor />}
          {tab === 'storage' && <StorageEditor />}
          {tab === 'rates' && <RatesEditor />}
        </div>
      </div>
    </div>
  );
}
