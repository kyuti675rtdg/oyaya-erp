import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import {
  Ban,
  Building2,
  Download,
  Eye,
  Landmark,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  Truck,
  User,
  Wheat,
  X
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDate, fmtInt, fmtQ } from '../lib/format';
import { useAuth } from '../store/auth';
import type { PurchaseOrder, Supplier, WheatIntake } from '../types';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import type { Column } from '../components/DataTable';
import {
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  SectionTitle,
  Select,
  TextArea,
  TextInput
} from '../components/ui';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const TYPE_LABEL: Record<Supplier['type'], string> = {
  INDIVIDUAL_FARMER: 'Farmer',
  ASSOCIATION: 'Cooperative',
  TRADER: 'Trader'
};

const TYPE_TONE: Record<Supplier['type'], BadgeTone> = {
  INDIVIDUAL_FARMER: 'pass',
  ASSOCIATION: 'advisory',
  TRADER: 'neutral'
};

const WHEAT_OPTIONS = ['SOFT', 'HARD', 'FOREIGN'] as const;
const WHEAT_LABEL: Record<string, string> = { SOFT: 'Soft', HARD: 'Hard', FOREIGN: 'Foreign' };

const INTAKE_STATUS_TONE: Record<string, BadgeTone> = {
  ACCEPTED: 'pass',
  PENDING_LAB: 'advisory',
  FLAGGED: 'critical',
  REJECTED: 'critical'
};

const PO_STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'advisory',
  APPROVED: 'pass',
  PARTIALLY_RECEIVED: 'advisory',
  COMPLETED: 'neutral',
  CANCELLED: 'critical'
};

const OPEN_PO_STATUSES = ['DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED'];

interface SupplierForm {
  name: string;
  type: Supplier['type'] | '';
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  region: string;
  tin: string;
  licenseNo: string;
  wheatTypes: string[];
  paymentTerms: string;
  bankName: string;
  bankAccountNo: string;
  rating: number | null;
  isActive: boolean;
}

const EMPTY_FORM: SupplierForm = {
  name: '',
  type: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  region: '',
  tin: '',
  licenseNo: '',
  wheatTypes: [],
  paymentTerms: '',
  bankName: '',
  bankAccountNo: '',
  rating: null,
  isActive: true
};

function formFromSupplier(s: Supplier): SupplierForm {
  return {
    name: s.name ?? '',
    type: s.type,
    contactPerson: s.contactPerson ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    address: s.address ?? '',
    region: s.region ?? '',
    tin: s.tin ?? '',
    licenseNo: s.licenseNo ?? '',
    wheatTypes: s.wheatTypes ?? [],
    paymentTerms: s.paymentTerms ?? '',
    bankName: s.bankName ?? '',
    bankAccountNo: s.bankAccountNo ?? '',
    rating: s.rating ?? null,
    isActive: s.isActive ?? true
  };
}

function errMsg(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data as { error?: string; message?: string } | undefined;
    if (d?.error) return d.error;
    if (d?.message) return d.message;
    if (err.response?.status === 403) return 'You do not have permission to perform this action.';
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

/** Star rating display (read-only). */
function Stars({ value, size = 14 }: { value: number | null | undefined; size?: number }) {
  if (!value || value < 1) return <span className="text-xs text-slate-400">Not rated</span>;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Rated ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          className={i <= value ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}
        />
      ))}
    </span>
  );
}

/** Interactive 1–5 star selector with clear option. */
function RatingInput({
  value,
  onChange
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="Supplier rating">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={`${i} star${i > 1 ? 's' : ''}`}
            onClick={() => onChange(i)}
            className="touch rounded p-1 transition-transform hover:scale-110"
          >
            <Star
              size={22}
              className={
                value !== null && i <= value
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-slate-200 text-slate-300 hover:fill-amber-200'
              }
            />
          </button>
        ))}
      </div>
      {value !== null ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs font-semibold text-slate-500 underline hover:text-slate-700"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-violet-600' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm font-medium text-slate-500">{label}</dt>
      <dd className="text-right text-sm font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function suppliersToCsv(rows: Supplier[]): string {
  const header = [
    'Name',
    'Type',
    'Contact person',
    'Phone',
    'Email',
    'Address',
    'Region',
    'TIN',
    'License no',
    'Wheat types',
    'Payment terms',
    'Bank name',
    'Bank account no',
    'Rating',
    'Status',
    'Intakes',
    'Purchase orders'
  ];
  const lines = rows.map((s) =>
    [
      s.name,
      TYPE_LABEL[s.type],
      s.contactPerson ?? '',
      s.phone ?? '',
      s.email ?? '',
      s.address ?? '',
      s.region ?? '',
      s.tin ?? '',
      s.licenseNo ?? '',
      (s.wheatTypes ?? []).map((w) => WHEAT_LABEL[w] ?? w).join('; '),
      s.paymentTerms ?? '',
      s.bankName ?? '',
      s.bankAccountNo ?? '',
      s.rating ?? '',
      s.isActive ? 'Active' : 'Inactive',
      s._count?.intakes ?? 0,
      s._count?.purchaseOrders ?? 0
    ]
      .map(csvEscape)
      .join(',')
  );
  return [header.map(csvEscape).join(','), ...lines].join('\r\n');
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function Suppliers() {
  const qc = useQueryClient();
  const hasClaim = useAuth((s) => s.hasClaim);
  const canManage = hasClaim('procurement:manage');

  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | Supplier['type']>('');
  const [regionFilter, setRegionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');

  // Create / edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);

  // Deactivate confirmation
  const [deactivateTarget, setDeactivateTarget] = useState<Supplier | null>(null);

  // Detail drawer
  const [selected, setSelected] = useState<Supplier | null>(null);

  const suppliersQ = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<Supplier[]>(E.suppliers)).data
  });

  const all = suppliersQ.data ?? [];

  const regions = useMemo(
    () =>
      [...new Set(all.map((s) => (s.region ?? '').trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [all]
  );

  const stats = useMemo(() => {
    const active = all.filter((s) => s.isActive !== false).length;
    const farmers = all.filter((s) => s.type === 'INDIVIDUAL_FARMER').length;
    const coops = all.filter((s) => s.type === 'ASSOCIATION').length;
    const traders = all.filter((s) => s.type === 'TRADER').length;
    return { total: all.length, active, inactive: all.length - active, farmers, coops, traders };
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((s) => {
      if (typeFilter && s.type !== typeFilter) return false;
      if (statusFilter === 'ACTIVE' && s.isActive === false) return false;
      if (statusFilter === 'INACTIVE' && s.isActive !== false) return false;
      if (regionFilter && (s.region ?? '').trim() !== regionFilter) return false;
      if (q) {
        const hay = [s.name, s.contactPerson ?? '', s.phone ?? ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, search, typeFilter, regionFilter, statusFilter]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['suppliers'] });

  const setField = <K extends keyof SupplierForm>(key: K, value: SupplierForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleWheatType = (code: string) =>
    setForm((f) => ({
      ...f,
      wheatTypes: f.wheatTypes.includes(code)
        ? f.wheatTypes.filter((w) => w !== code)
        : [...f.wheatTypes, code]
    }));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setNotice(null);
    setModalOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm(formFromSupplier(s));
    setNotice(null);
    setModalOpen(true);
  };

  const payload = (): Record<string, unknown> => {
    const clean = (v: string): string | undefined => (v.trim() === '' ? undefined : v.trim());
    return {
      name: form.name.trim(),
      type: form.type,
      contactPerson: clean(form.contactPerson),
      phone: clean(form.phone),
      email: clean(form.email),
      address: clean(form.address),
      region: clean(form.region),
      tin: clean(form.tin),
      licenseNo: clean(form.licenseNo),
      wheatTypes: form.wheatTypes,
      paymentTerms: clean(form.paymentTerms),
      bankName: clean(form.bankName),
      bankAccountNo: clean(form.bankAccountNo),
      rating: form.rating,
      ...(editing ? { isActive: form.isActive } : {})
    };
  };

  const saveM = useMutation({
    mutationFn: async () => {
      if (editing) {
        return (await api.put<Supplier>(`${E.suppliers}/${editing.id}`, payload())).data;
      }
      return (await api.post<Supplier>(E.suppliers, payload())).data;
    },
    onSuccess: (saved) => {
      refresh();
      if (selected && saved.id === selected.id) setSelected(saved);
      setModalOpen(false);
      setEditing(null);
      setNotice({
        ok: true,
        text: editing
          ? `Supplier "${saved.name}" updated.`
          : `Supplier "${saved.name}" registered.`
      });
    },
    onError: (err) => setNotice({ ok: false, text: errMsg(err) })
  });

  const deactivateM = useMutation({
    mutationFn: async (id: string) => (await api.delete(`${E.suppliers}/${id}`)).data,
    onSuccess: (_data, id) => {
      refresh();
      if (selected && selected.id === id) {
        setSelected((s) => (s ? { ...s, isActive: false } : s));
      }
      setDeactivateTarget(null);
      setNotice({ ok: true, text: 'Supplier deactivated. It will no longer be usable for new purchase orders or intakes.' });
    },
    onError: (err) => {
      setDeactivateTarget(null);
      setNotice({ ok: false, text: errMsg(err) });
    }
  });

  const submitForm = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.type) {
      setNotice({ ok: false, text: 'Supplier name and type are required.' });
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setNotice({ ok: false, text: 'Email address is not valid.' });
      return;
    }
    saveM.mutate();
  };

  const exportCsv = () => {
    if (filtered.length === 0) {
      setNotice({ ok: false, text: 'Nothing to export — the current filter returned no suppliers.' });
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`oyaya-suppliers-${stamp}.csv`, suppliersToCsv(filtered));
    setNotice({ ok: true, text: `Exported ${filtered.length} supplier${filtered.length === 1 ? '' : 's'} to CSV.` });
  };

  const columns: Column<Supplier>[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Supplier',
        render: (s) => (
          <button
            onClick={() => setSelected(s)}
            className="max-w-[220px] truncate text-left font-semibold text-violet-700 hover:underline"
            title="View details"
          >
            {s.name}
          </button>
        )
      },
      {
        key: 'type',
        label: 'Type',
        render: (s) => <Badge tone={TYPE_TONE[s.type]}>{TYPE_LABEL[s.type]}</Badge>
      },
      {
        key: 'phone',
        label: 'Phone',
        mono: true,
        render: (s) =>
          s.phone ? (
            <span className="inline-flex items-center gap-1.5 text-slate-700">
              <Phone size={13} className="shrink-0 text-slate-400" />
              {s.phone}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )
      },
      {
        key: 'region',
        label: 'Region',
        render: (s) =>
          s.region ? (
            <span className="inline-flex items-center gap-1.5 text-slate-700">
              <MapPin size={13} className="shrink-0 text-slate-400" />
              {s.region}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )
      },
      {
        key: 'wheatTypes',
        label: 'Wheat types',
        render: (s) =>
          s.wheatTypes && s.wheatTypes.length > 0 ? (
            <span className="inline-flex flex-wrap gap-1">
              {s.wheatTypes.map((w) => (
                <span
                  key={w}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800"
                >
                  <Wheat size={11} />
                  {WHEAT_LABEL[w] ?? w}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )
      },
      {
        key: 'rating',
        label: 'Rating',
        render: (s) => <Stars value={s.rating} />
      },
      {
        key: 'activity',
        label: 'Intakes / POs',
        mono: true,
        render: (s) => (
          <span className="text-slate-700">
            {s._count?.intakes ?? 0} <span className="text-slate-400">/</span> {s._count?.purchaseOrders ?? 0}
          </span>
        )
      },
      {
        key: 'isActive',
        label: 'Status',
        render: (s) =>
          s.isActive !== false ? <Badge tone="pass">Active</Badge> : <Badge tone="critical">Inactive</Badge>
      },
      {
        key: 'actions',
        label: 'Actions',
        className: 'whitespace-nowrap',
        render: (s) => (
          <span className="inline-flex items-center gap-1">
            <button
              onClick={() => setSelected(s)}
              className="touch rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              title="View details"
              aria-label={`View ${s.name}`}
            >
              <Eye size={17} />
            </button>
            {canManage ? (
              <>
                <button
                  onClick={() => openEdit(s)}
                  className="touch rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-violet-700"
                  title="Edit supplier"
                  aria-label={`Edit ${s.name}`}
                >
                  <Pencil size={17} />
                </button>
                {s.isActive !== false ? (
                  <button
                    onClick={() => setDeactivateTarget(s)}
                    className="touch rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-700"
                    title="Deactivate supplier"
                    aria-label={`Deactivate ${s.name}`}
                  >
                    <Ban size={17} />
                  </button>
                ) : null}
              </>
            ) : null}
          </span>
        )
      }
    ],
    [canManage]
  );

  const noResults = !suppliersQ.isLoading && !suppliersQ.isError && filtered.length === 0;
  const filtersActive = search.trim() !== '' || typeFilter !== '' || regionFilter !== '' || statusFilter !== '';

  return (
    <div>
      <SectionTitle
        title="Supplier Registration"
        sub="Register and manage wheat suppliers — individual farmers, cooperatives and traders"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={exportCsv} className="!px-4">
              <Download size={17} />
              Export CSV
            </Button>
            {canManage ? (
              <Button onClick={openCreate}>
                <Plus size={17} />
                Register supplier
              </Button>
            ) : null}
          </div>
        }
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

      {/* Summary strip */}
      {suppliersQ.isLoading ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={cardShell} aria-label="Loading statistic">
              <div className="skeleton-shimmer h-4 w-20 rounded" aria-hidden="true" />
              <div className="skeleton-shimmer mt-2 h-7 w-12 rounded" aria-hidden="true" />
            </div>
          ))}
        </div>
      ) : suppliersQ.isError ? null : (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className={cardShell}>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Truck size={14} /> Total suppliers
            </p>
            <p className="tnum mt-1 text-2xl font-bold text-ink">{stats.total}</p>
          </div>
          <div className={cardShell}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active</p>
            <p className="tnum mt-1 text-2xl font-bold text-pass-text">{stats.active}</p>
          </div>
          <div className={cardShell}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Farmers / Coops / Traders</p>
            <p className="tnum mt-1 text-2xl font-bold text-ink">
              {stats.farmers}<span className="text-slate-300"> / </span>{stats.coops}<span className="text-slate-300"> / </span>{stats.traders}
            </p>
          </div>
          <div className={cardShell}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inactive</p>
            <p className="tnum mt-1 text-2xl font-bold text-critical-text">{stats.inactive}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, contact, phone…"
              aria-label="Search suppliers"
              className="!pl-10"
            />
          </div>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as Supplier['type'] | '')} aria-label="Filter by type">
            <option value="">All types</option>
            <option value="INDIVIDUAL_FARMER">Farmer</option>
            <option value="ASSOCIATION">Cooperative</option>
            <option value="TRADER">Trader</option>
          </Select>
          <Select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} aria-label="Filter by region">
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as '' | 'ACTIVE' | 'INACTIVE')}
            aria-label="Filter by status"
          >
            <option value="">Active & inactive</option>
            <option value="ACTIVE">Active only</option>
            <option value="INACTIVE">Inactive only</option>
          </Select>
        </div>
      </Card>

      {/* List */}
      {suppliersQ.isLoading ? (
        <div className={cardShell} aria-label="Loading suppliers">
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="skeleton-shimmer h-10 w-10 !rounded-full" aria-hidden="true" />
                <div className="flex-1">
                  <div className="skeleton-shimmer h-4 w-1/3 rounded" aria-hidden="true" />
                  <div className="skeleton-shimmer mt-2 h-3 w-1/4 rounded" aria-hidden="true" />
                </div>
                <div className="skeleton-shimmer h-6 w-16 rounded-full" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>
      ) : suppliersQ.isError ? (
        <ErrorBox message={errMsg(suppliersQ.error)} onRetry={() => suppliersQ.refetch()} />
      ) : noResults ? (
        <EmptyState
          title="No suppliers registered"
          sub={
            filtersActive
              ? 'No suppliers match the current filters. Adjust the filters or register a new supplier.'
              : 'Register the first supplier to start recording wheat deliveries and purchase orders.'
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <DataTable columns={columns} rows={filtered} />
          </div>

          {/* Mobile cards */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {filtered.map((s) => (
              <div key={s.id} className={cardShell}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-ink">{s.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                      {s.type === 'INDIVIDUAL_FARMER' ? (
                        <User size={12} />
                      ) : s.type === 'ASSOCIATION' ? (
                        <Building2 size={12} />
                      ) : (
                        <Truck size={12} />
                      )}
                      {TYPE_LABEL[s.type]}
                      {s.region ? ` · ${s.region}` : ''}
                    </p>
                  </div>
                  {s.isActive !== false ? (
                    <Badge tone="pass">Active</Badge>
                  ) : (
                    <Badge tone="critical">Inactive</Badge>
                  )}
                </div>
                <div className="tnum mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Phone</p>
                    <p className="font-semibold text-slate-800">{s.phone ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Rating</p>
                    <Stars value={s.rating} />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Intakes</p>
                    <p className="font-semibold text-slate-800">{fmtInt(s._count?.intakes ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Purchase orders</p>
                    <p className="font-semibold text-slate-800">{fmtInt(s._count?.purchaseOrders ?? 0)}</p>
                  </div>
                </div>
                {s.wheatTypes && s.wheatTypes.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {s.wheatTypes.map((w) => (
                      <span
                        key={w}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800"
                      >
                        <Wheat size={11} />
                        {WHEAT_LABEL[w] ?? w}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                  <Button variant="secondary" className="!px-3 !py-2 !text-sm" onClick={() => setSelected(s)}>
                    <Eye size={15} /> Details
                  </Button>
                  {canManage ? (
                    <Button variant="secondary" className="!px-3 !py-2 !text-sm" onClick={() => openEdit(s)}>
                      <Pencil size={15} /> Edit
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <p className="tnum mt-3 text-xs text-slate-500">
            Showing {filtered.length} of {all.length} suppliers
          </p>
        </>
      )}

      {/* Create / edit modal */}
      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink">
                  {editing ? 'Edit supplier' : 'Register supplier'}
                </h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  {editing ? 'Update the supplier registration details.' : 'Add a new wheat supplier to the mill register.'}
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="touch rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submitForm} className="space-y-5">
              <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <legend className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
                  Basic information
                </legend>
                <div className="sm:col-span-2">
                  <Field label="Supplier name" required>
                    <TextInput
                      value={form.name}
                      onChange={(e) => setField('name', e.target.value)}
                      placeholder="e.g. Abebe Tadesse"
                      required
                    />
                  </Field>
                </div>
                <Field label="Supplier type" required>
                  <Select
                    value={form.type}
                    onChange={(e) => setField('type', e.target.value as Supplier['type'] | '')}
                    required
                  >
                    <option value="">Select type</option>
                    <option value="INDIVIDUAL_FARMER">Farmer</option>
                    <option value="ASSOCIATION">Cooperative</option>
                    <option value="TRADER">Trader</option>
                  </Select>
                </Field>
                <Field label="Contact person">
                  <TextInput
                    value={form.contactPerson}
                    onChange={(e) => setField('contactPerson', e.target.value)}
                    placeholder="Person to contact"
                  />
                </Field>
                <Field label="Phone">
                  <TextInput
                    value={form.phone}
                    onChange={(e) => setField('phone', e.target.value)}
                    placeholder="09…"
                    inputMode="tel"
                  />
                </Field>
                <Field label="Email">
                  <TextInput
                    value={form.email}
                    onChange={(e) => setField('email', e.target.value)}
                    placeholder="name@example.com"
                    inputMode="email"
                  />
                </Field>
                <Field label="Address">
                  <TextArea
                    value={form.address}
                    onChange={(e) => setField('address', e.target.value)}
                    rows={2}
                    placeholder="Woreda, kebele, landmarks…"
                  />
                </Field>
                <Field label="Region">
                  <TextInput
                    value={form.region}
                    onChange={(e) => setField('region', e.target.value)}
                    placeholder="e.g. Oromia"
                    list="supplier-regions"
                  />
                  <datalist id="supplier-regions">
                    {regions.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </Field>
              </fieldset>

              <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <legend className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
                  Registration
                </legend>
                <Field label="TIN" hint="Tax identification number">
                  <TextInput value={form.tin} onChange={(e) => setField('tin', e.target.value)} />
                </Field>
                <Field label="License number">
                  <TextInput
                    value={form.licenseNo}
                    onChange={(e) => setField('licenseNo', e.target.value)}
                  />
                </Field>
              </fieldset>

              <fieldset>
                <legend className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
                  Wheat supplied
                </legend>
                <div className="flex flex-wrap gap-2">
                  {WHEAT_OPTIONS.map((code) => {
                    const checked = form.wheatTypes.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => toggleWheatType(code)}
                        className={`touch inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                          checked
                            ? 'border-violet-600 bg-violet-50 text-violet-800'
                            : 'border-line bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        <Wheat size={15} />
                        {WHEAT_LABEL[code]} wheat
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <legend className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
                  Payment & banking
                </legend>
                <Field label="Payment terms" hint="e.g. Net 14 days, 50% advance">
                  <TextInput
                    value={form.paymentTerms}
                    onChange={(e) => setField('paymentTerms', e.target.value)}
                  />
                </Field>
                <Field label="Bank name">
                  <TextInput
                    value={form.bankName}
                    onChange={(e) => setField('bankName', e.target.value)}
                    placeholder="e.g. Commercial Bank of Ethiopia"
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Bank account number">
                    <TextInput
                      value={form.bankAccountNo}
                      onChange={(e) => setField('bankAccountNo', e.target.value)}
                      inputMode="numeric"
                      className="tnum"
                    />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="flex flex-wrap items-center gap-6">
                <legend className="mb-2 w-full text-sm font-bold uppercase tracking-wide text-slate-500">
                  Assessment & status
                </legend>
                <div>
                  <p className="mb-1.5 text-sm font-semibold text-slate-700">Rating</p>
                  <RatingInput value={form.rating} onChange={(v) => setField('rating', v)} />
                </div>
                <div>
                  <p className="mb-1.5 text-sm font-semibold text-slate-700">Active</p>
                  <div className="flex items-center gap-2">
                    <Toggle checked={form.isActive} onChange={(v) => setField('isActive', v)} label="Supplier active" />
                    <span className="text-sm font-medium text-slate-600">
                      {form.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              </fieldset>

              <div className="flex justify-end gap-2 border-t border-line pt-4">
                <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saveM.isPending}>
                  {editing ? 'Save changes' : 'Register supplier'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {/* Deactivate confirmation */}
      {deactivateTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-ink">Deactivate supplier?</h3>
            <p className="mt-2 text-sm text-slate-600">
              <span className="font-semibold text-slate-800">{deactivateTarget.name}</span> will be
              deactivated. It will remain in the records but can no longer be used for new purchase
              orders or wheat intakes. This can be reversed by editing the supplier.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeactivateTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deactivateM.isPending}
                onClick={() => deactivateM.mutate(deactivateTarget.id)}
              >
                <Ban size={16} />
                Deactivate
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {/* Detail drawer */}
      {selected ? <SupplierDrawer supplier={selected} onClose={() => setSelected(null)} onEdit={() => { setSelected(null); openEdit(selected); }} canManage={canManage} /> : null}
    </div>
  );
}

function SupplierDrawer({
  supplier,
  onClose,
  onEdit,
  canManage
}: {
  supplier: Supplier;
  onClose: () => void;
  onEdit: () => void;
  canManage: boolean;
}) {
  const intakesQ = useQuery({
    queryKey: ['supplier-intakes', supplier.id],
    queryFn: async () =>
      (await api.get<WheatIntake[]>(E.intakes, { params: { supplierId: supplier.id } })).data
  });
  const posQ = useQuery({
    queryKey: ['supplier-pos', supplier.id],
    queryFn: async () =>
      (await api.get<PurchaseOrder[]>(E.purchaseOrders, { params: { supplierId: supplier.id } })).data
  });

  const intakes = useMemo(() => (intakesQ.data ?? []).slice(0, 5), [intakesQ.data]);
  const openPos = useMemo(
    () => (posQ.data ?? []).filter((p) => OPEN_PO_STATUSES.includes(p.status)).slice(0, 5),
    [posQ.data]
  );
  const outstandingCount = useMemo(
    () => (posQ.data ?? []).filter((p) => OPEN_PO_STATUSES.includes(p.status)).length,
    [posQ.data]
  );

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label={`Supplier details for ${supplier.name}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-bold text-ink">{supplier.name}</h3>
              {supplier.isActive !== false ? (
                <Badge tone="pass">Active</Badge>
              ) : (
                <Badge tone="critical">Inactive</Badge>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <Badge tone={TYPE_TONE[supplier.type]}>{TYPE_LABEL[supplier.type]}</Badge>
              <Stars value={supplier.rating} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="touch shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Close details"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Activity summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="tnum text-xl font-bold text-ink">{fmtInt(supplier._count?.intakes ?? 0)}</p>
              <p className="text-xs font-medium text-slate-500">Intakes</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="tnum text-xl font-bold text-ink">{fmtInt(supplier._count?.purchaseOrders ?? 0)}</p>
              <p className="text-xs font-medium text-slate-500">Purchase orders</p>
            </div>
            <div className="rounded-xl bg-violet-50 p-3 text-center">
              <p className="tnum text-xl font-bold text-violet-700">
                {posQ.isLoading ? '…' : outstandingCount}
              </p>
              <p className="text-xs font-medium text-violet-600">Outstanding POs</p>
            </div>
          </div>

          <dl className="mt-5 divide-y divide-slate-100">
            {supplier.contactPerson ? (
              <DetailRow
                label="Contact person"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <User size={13} className="text-slate-400" />
                    {supplier.contactPerson}
                  </span>
                }
              />
            ) : null}
            {supplier.phone ? (
              <DetailRow
                label="Phone"
                value={
                  <span className="tnum inline-flex items-center gap-1.5">
                    <Phone size={13} className="text-slate-400" />
                    {supplier.phone}
                  </span>
                }
              />
            ) : null}
            {supplier.email ? <DetailRow label="Email" value={supplier.email} /> : null}
            {supplier.region ? (
              <DetailRow
                label="Region"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={13} className="text-slate-400" />
                    {supplier.region}
                  </span>
                }
              />
            ) : null}
            {supplier.address ? <DetailRow label="Address" value={supplier.address} /> : null}
            {supplier.tin ? (
              <DetailRow label="TIN" value={<span className="tnum">{supplier.tin}</span>} />
            ) : null}
            {supplier.licenseNo ? (
              <DetailRow label="License no" value={<span className="tnum">{supplier.licenseNo}</span>} />
            ) : null}
            {supplier.wheatTypes && supplier.wheatTypes.length > 0 ? (
              <DetailRow
                label="Wheat types"
                value={
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    {supplier.wheatTypes.map((w) => (
                      <span
                        key={w}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800"
                      >
                        <Wheat size={11} />
                        {WHEAT_LABEL[w] ?? w}
                      </span>
                    ))}
                  </span>
                }
              />
            ) : null}
            {supplier.paymentTerms ? <DetailRow label="Payment terms" value={supplier.paymentTerms} /> : null}
            {supplier.bankName ? (
              <DetailRow
                label="Bank"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <Landmark size={13} className="text-slate-400" />
                    {supplier.bankName}
                  </span>
                }
              />
            ) : null}
            {supplier.bankAccountNo ? (
              <DetailRow label="Account no" value={<span className="tnum">{supplier.bankAccountNo}</span>} />
            ) : null}
          </dl>

          {/* Outstanding purchase orders */}
          <h4 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">
            Outstanding purchase orders
          </h4>
          {posQ.isLoading ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="skeleton-shimmer h-14 rounded-xl" aria-hidden="true" />
              ))}
            </div>
          ) : posQ.isError ? (
            <p className="text-sm text-critical-text">Could not load purchase orders.</p>
          ) : openPos.length === 0 ? (
            <p className="text-sm text-slate-500">No outstanding purchase orders.</p>
          ) : (
            <ul className="space-y-2">
              {openPos.map((po) => (
                <li key={po.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="tnum text-sm font-bold text-ink">{po.poNo}</p>
                    <Badge tone={PO_STATUS_TONE[po.status] ?? 'neutral'}>{po.status.replace(/_/g, ' ')}</Badge>
                  </div>
                  <p className="tnum mt-1 text-xs text-slate-500">
                    {fmtQ(po.quantityQ)} q · {WHEAT_LABEL[po.wheatCategory] ?? po.wheatCategory} wheat
                    {po._count ? ` · ${po._count.intakes} intakes` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {/* Recent intakes */}
          <h4 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">
            Recent intakes
          </h4>
          {intakesQ.isLoading ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="skeleton-shimmer h-14 rounded-xl" aria-hidden="true" />
              ))}
            </div>
          ) : intakesQ.isError ? (
            <p className="text-sm text-critical-text">Could not load intakes.</p>
          ) : intakes.length === 0 ? (
            <p className="text-sm text-slate-500">No intakes recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {intakes.map((it) => (
                <li key={it.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="tnum text-sm font-bold text-ink">{it.intakeNo}</p>
                    <Badge tone={INTAKE_STATUS_TONE[it.status] ?? 'neutral'}>
                      {it.status.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <p className="tnum mt-1 text-xs text-slate-500">
                    {fmtDate(it.deliveryDate)} · {fmtQ(it.quintals)} q · {it.truckPlate}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canManage ? (
          <div className="border-t border-line p-4">
            <Button variant="secondary" className="w-full" onClick={onEdit}>
              <Pencil size={16} />
              Edit supplier
            </Button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
