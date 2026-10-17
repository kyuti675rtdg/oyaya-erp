import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import type { HrDepartment, HrPosition } from '../types';
import { CardHeader } from '../components/CardHeader';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Field, Select, Spinner, TextInput } from '../components/ui';
import { fmtBirr } from '../lib/format';
import {
  HrModal,
  HrNotice,
  hrPrimaryBtn,
  hrSecondaryBtn,
  hrShell,
  useHrPerms
} from './HrShared';

interface DeptForm {
  code: string;
  name: string;
  parentId: string;
  description: string;
}

interface PosForm {
  code: string;
  title: string;
  departmentId: string;
  grade: string;
  bandMin: string;
  bandMax: string;
}

export function Departments() {
  const { canManage } = useHrPerms();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [editingDept, setEditingDept] = useState<HrDepartment | null>(null);
  const [showDeptForm, setShowDeptForm] = useState(false);
  const [deptForm, setDeptForm] = useState<DeptForm>({ code: '', name: '', parentId: '', description: '' });
  const [editingPos, setEditingPos] = useState<HrPosition | null>(null);
  const [showPosForm, setShowPosForm] = useState(false);
  const [posForm, setPosForm] = useState<PosForm>({
    code: '',
    title: '',
    departmentId: '',
    grade: '',
    bandMin: '',
    bandMax: ''
  });

  const treeQ = useQuery({
    queryKey: ['hr-department-tree'],
    queryFn: async () => (await api.get<HrDepartment[]>(E.hrDepartmentTree)).data
  });
  const positionsQ = useQuery({
    queryKey: ['hr-positions'],
    queryFn: async () => (await api.get<HrPosition[]>(E.hrPositions)).data
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['hr-department-tree'] });
    queryClient.invalidateQueries({ queryKey: ['hr-positions'] });
    queryClient.invalidateQueries({ queryKey: ['hr-departments'] });
  };

  const deptM = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      editingDept
        ? (await api.put(E.hrDepartment(editingDept.id), payload)).data
        : (await api.post(E.hrDepartments, payload)).data,
    onSuccess: () => {
      setNotice({ ok: true, text: editingDept ? 'Department updated.' : 'Department created.' });
      setShowDeptForm(false);
      setEditingDept(null);
      refresh();
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' })
  });

  const posM = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      editingPos
        ? (await api.put(E.hrPosition(editingPos.id), payload)).data
        : (await api.post(E.hrPositions, payload)).data,
    onSuccess: () => {
      setNotice({ ok: true, text: editingPos ? 'Position updated.' : 'Position created.' });
      setShowPosForm(false);
      setEditingPos(null);
      refresh();
    },
    onError: (err) => setNotice({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' })
  });

  const openDeptCreate = (parent?: HrDepartment) => {
    setEditingDept(null);
    setDeptForm({ code: '', name: '', parentId: parent?.id ?? '', description: '' });
    setShowDeptForm(true);
  };
  const openDeptEdit = (d: HrDepartment) => {
    setEditingDept(d);
    setDeptForm({ code: d.code, name: d.name, parentId: d.parentId ?? '', description: d.description ?? '' });
    setShowDeptForm(true);
  };
  const submitDept = (e: FormEvent) => {
    e.preventDefault();
    deptM.mutate({
      code: deptForm.code.trim(),
      name: deptForm.name.trim(),
      parentId: deptForm.parentId || null,
      description: deptForm.description.trim() || null
    });
  };

  const openPosCreate = () => {
    setEditingPos(null);
    setPosForm({ code: '', title: '', departmentId: '', grade: '', bandMin: '', bandMax: '' });
    setShowPosForm(true);
  };
  const openPosEdit = (p: HrPosition) => {
    setEditingPos(p);
    setPosForm({
      code: p.code,
      title: p.title,
      departmentId: p.departmentId ?? '',
      grade: p.grade ?? '',
      bandMin: p.bandMin != null ? String(p.bandMin) : '',
      bandMax: p.bandMax != null ? String(p.bandMax) : ''
    });
    setShowPosForm(true);
  };
  const submitPos = (e: FormEvent) => {
    e.preventDefault();
    posM.mutate({
      code: posForm.code.trim(),
      title: posForm.title.trim(),
      departmentId: posForm.departmentId || null,
      grade: posForm.grade.trim() || null,
      bandMin: posForm.bandMin ? Number(posForm.bandMin) : null,
      bandMax: posForm.bandMax ? Number(posForm.bandMax) : null
    });
  };

  const tree = treeQ.data ?? [];
  const positions = positionsQ.data ?? [];

  function renderDept(d: HrDepartment, depth: number): React.ReactNode {
    return (
      <div key={d.id} className={depth > 0 ? 'ml-6 border-l-2 border-violet-100 pl-4' : ''}>
        <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
              <Building2 className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {d.name} <span className="tnum font-normal text-slate-400 dark:text-slate-500">· {d.code}</span>
              </p>
              {d.description ? <p className="text-xs text-slate-500 dark:text-slate-400">{d.description}</p> : null}
            </div>
          </div>
          {canManage ? (
            <div className="flex gap-2">
              <button className={hrSecondaryBtn + ' px-3 py-1.5 text-xs'} onClick={() => openDeptCreate(d)}>
                <Plus className="h-3.5 w-3.5" /> Sub
              </button>
              <button className={hrSecondaryBtn + ' px-3 py-1.5 text-xs'} onClick={() => openDeptEdit(d)}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
        <div className="mt-2 space-y-2">
          {(d.children ?? []).map((c) => renderDept(c, depth + 1))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white">
          <Building2 className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Departments & Positions</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Organization tree and position grades with salary bands</p>
        </div>
      </div>

      {notice ? <HrNotice ok={notice.ok} text={notice.text} /> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={hrShell}>
          <CardHeader
            icon={<Building2 className="h-4 w-4" />}
            title="Department tree"
            action={
              canManage ? (
                <button className={hrPrimaryBtn} onClick={() => openDeptCreate()}>
                  <Plus className="h-4 w-4" /> Department
                </button>
              ) : undefined
            }
          />
          {treeQ.isLoading ? (
            <Spinner label="Loading departments..." />
          ) : tree.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No departments yet — create the first one.</p>
          ) : (
            <div className="space-y-2">{tree.map((d) => renderDept(d, 0))}</div>
          )}
        </div>

        <div className={hrShell}>
          <CardHeader
            icon={<Building2 className="h-4 w-4" />}
            title={`Positions (${positions.length})`}
            subtitle="Grades and monthly salary bands in ETB"
            action={
              canManage ? (
                <button className={hrPrimaryBtn} onClick={openPosCreate}>
                  <Plus className="h-4 w-4" /> Position
                </button>
              ) : undefined
            }
          />
          {positionsQ.isLoading ? (
            <Spinner label="Loading positions..." />
          ) : (
            <DataTable<HrPosition>
              columns={[
                { key: 'title', label: 'Title', render: (r) => r.title },
                { key: 'code', label: 'Code', render: (r) => <span className="tnum">{r.code}</span> },
                { key: 'grade', label: 'Grade', render: (r) => r.grade ?? '—' },
                {
                  key: 'band',
                  label: 'Salary band',
                  mono: true,
                  render: (r) =>
                    r.bandMin != null || r.bandMax != null
                      ? `${r.bandMin != null ? fmtBirr(r.bandMin) : '—'} – ${r.bandMax != null ? fmtBirr(r.bandMax) : '—'}`
                      : '—'
                },
                {
                  key: 'dept',
                  label: 'Department',
                  render: (r) => r.department?.name ?? '—'
                },
                {
                  key: 'status',
                  label: '',
                  render: (r) => (
                    <Badge tone={r.isActive ? 'pass' : 'neutral'}>{r.isActive ? 'Active' : 'Off'}</Badge>
                  )
                },
                ...(canManage
                  ? [
                      {
                        key: 'edit',
                        label: '',
                        render: (r: HrPosition) => (
                          <button className={hrSecondaryBtn + ' px-3 py-1.5 text-xs'} onClick={() => openPosEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )
                      }
                    ]
                  : [])
              ]}
              rows={positions}
              emptyTitle="No positions yet"
            />
          )}
        </div>
      </div>

      {showDeptForm ? (
        <HrModal
          title={editingDept ? 'Edit department' : 'New department'}
          onClose={() => setShowDeptForm(false)}
        >
          <form onSubmit={submitDept} className="space-y-4">
            <Field label="Code" required>
              <TextInput value={deptForm.code} onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })} required />
            </Field>
            <Field label="Name" required>
              <TextInput value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} required />
            </Field>
            <Field label="Description">
              <TextInput value={deptForm.description} onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className={hrSecondaryBtn} onClick={() => setShowDeptForm(false)}>
                Cancel
              </button>
              <button type="submit" className={hrPrimaryBtn} disabled={deptM.isPending}>
                {deptM.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </HrModal>
      ) : null}

      {showPosForm ? (
        <HrModal
          title={editingPos ? 'Edit position' : 'New position'}
          subtitle="Grade and monthly salary band (ETB)"
          onClose={() => setShowPosForm(false)}
        >
          <form onSubmit={submitPos} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Code" required>
              <TextInput value={posForm.code} onChange={(e) => setPosForm({ ...posForm, code: e.target.value })} required />
            </Field>
            <Field label="Title" required>
              <TextInput value={posForm.title} onChange={(e) => setPosForm({ ...posForm, title: e.target.value })} required />
            </Field>
            <Field label="Department">
              <Select value={posForm.departmentId} onChange={(e) => setPosForm({ ...posForm, departmentId: e.target.value })}>
                <option value="">—</option>
                {(treeQ.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Grade">
              <TextInput value={posForm.grade} onChange={(e) => setPosForm({ ...posForm, grade: e.target.value })} placeholder="e.g. G7" />
            </Field>
            <Field label="Band min (ETB)">
              <TextInput type="number" min="0" value={posForm.bandMin} onChange={(e) => setPosForm({ ...posForm, bandMin: e.target.value })} />
            </Field>
            <Field label="Band max (ETB)">
              <TextInput type="number" min="0" value={posForm.bandMax} onChange={(e) => setPosForm({ ...posForm, bandMax: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 md:col-span-2">
              <button type="button" className={hrSecondaryBtn} onClick={() => setShowPosForm(false)}>
                Cancel
              </button>
              <button type="submit" className={hrPrimaryBtn} disabled={posM.isPending}>
                {posM.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </HrModal>
      ) : null}
    </div>
  );
}
