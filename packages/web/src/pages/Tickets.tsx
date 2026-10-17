import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ChevronLeft, Clock, Plus, Ticket as TicketIcon, User, X
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import { Badge } from '../components/Badge';
import type { BadgeTone } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { DataTable } from '../components/DataTable';
import type { Column } from '../components/DataTable';
import {
  Button, EmptyState, ErrorBox, Field, SectionTitle, Select, Spinner, TextArea, TextInput
} from '../components/ui';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

interface Ticket {
  id: string;
  ticketNo: string;
  title: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: string;
  reporter: { name: string };
  assignee: { name: string } | null;
  createdAt: string;
  _count: { comments: number };
}

interface TicketDetail extends Ticket {
  description: string;
  comments: { id: string; body: string; createdAt: string; author: { name: string } }[];
}

const PRIORITY_TONE: Record<string, BadgeTone> = { low: 'neutral', medium: 'advisory', high: 'critical', urgent: 'critical' };
const STATUS_TONE: Record<string, BadgeTone> = { open: 'critical', in_progress: 'advisory', resolved: 'pass', closed: 'neutral' };

// SLA targets in hours by priority
const SLA_HOURS: Record<string, number> = { low: 72, medium: 48, high: 24, urgent: 4 };

function slaStatus(ticket: Ticket): { label: string; tone: BadgeTone; breached: boolean } {
  const created = new Date(ticket.createdAt).getTime();
  const elapsed = (Date.now() - created) / 3600000;
  const target = SLA_HOURS[ticket.priority] ?? 48;
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    return { label: 'Met', tone: 'pass', breached: false };
  }
  const remaining = target - elapsed;
  if (remaining < 0) return { label: `Breached ${Math.round(-remaining)}h`, tone: 'critical', breached: true };
  return { label: `${Math.round(remaining)}h left`, tone: remaining < target * 0.25 ? 'advisory' : 'neutral', breached: false };
}

export function Tickets() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('support:manage');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('technical');
  const [priority, setPriority] = useState('medium');
  const [comment, setComment] = useState('');

  const ticketsQ = useQuery({
    queryKey: ['tickets', statusFilter, priorityFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      const qs = params.toString();
      return (await api.get<Ticket[]>(E.tickets + (qs ? `?${qs}` : ''))).data;
    }
  });

  const detailQ = useQuery({
    queryKey: ['ticket', detailId],
    queryFn: async () => (await api.get<TicketDetail>(E.ticket(detailId!))).data,
    enabled: !!detailId
  });

  const stats = useMemo(() => {
    const rows = ticketsQ.data ?? [];
    return {
      total: rows.length,
      open: rows.filter((t) => t.status === 'open').length,
      breached: rows.filter((t) => slaStatus(t).breached).length,
      urgent: rows.filter((t) => t.priority === 'urgent' && t.status !== 'closed' && t.status !== 'resolved').length
    };
  }, [ticketsQ.data]);

  const createMut = useMutation({
    mutationFn: async () => (await api.post(E.tickets, { title, description, category, priority })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      setShowForm(false);
      setTitle('');
      setDescription('');
    }
  });

  const statusMut = useMutation({
    mutationFn: async (status: string) => (await api.patch(E.ticket(detailId!), { status })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['ticket', detailId] });
    }
  });

  const commentMut = useMutation({
    mutationFn: async () => (await api.post(E.ticketComments(detailId!), { body: comment.trim() })).data,
    onSuccess: () => {
      setComment('');
      qc.invalidateQueries({ queryKey: ['ticket', detailId] });
    }
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    createMut.mutate();
  };

  const columns: Column<Ticket>[] = [
    { key: 'ticketNo', label: 'Ticket', render: (r) => <span className="font-mono text-sm font-semibold text-slate-700 dark:text-slate-200">{r.ticketNo}</span> },
    {
      key: 'title', label: 'Title',
      render: (r) => (
        <button className="font-medium text-violet-700 hover:underline" onClick={() => setDetailId(r.id)}>
          {r.title}
        </button>
      )
    },
    { key: 'priority', label: 'Priority', render: (r) => <Badge tone={PRIORITY_TONE[r.priority] ?? 'neutral'}>{r.priority}</Badge> },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge> },
    {
      key: 'sla', label: 'SLA',
      render: (r) => {
        const s = slaStatus(r);
        return (
          <Badge tone={s.tone}>
            <Clock size={12} className="mr-1" />{s.label}
          </Badge>
        );
      }
    },
    { key: 'createdAt', label: 'Created', render: (r) => <span className="text-sm tabular-nums text-slate-500 dark:text-slate-400">{fmtDateTime(r.createdAt)}</span> }
  ];

  const detail = detailQ.data;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Support Tickets"
        sub="Ticket queue with priority matrix and SLA tracking."
        action={
          <Button onClick={() => setShowForm(true)}>
            <Plus size={16} /> New Ticket
          </Button>
        }
      />

      {detail ? (
        <div className={cardShell}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setDetailId(null)}>
              <ChevronLeft size={16} /> Back
            </Button>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                {['open', 'in_progress', 'resolved', 'closed'].map((s) => (
                  <Button
                    key={s}
                    variant={detail.status === s ? 'primary' : 'secondary'}
                    onClick={() => statusMut.mutate(s)}
                  >
                    {s.replace('_', ' ')}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <CardHeader
            icon={<TicketIcon size={16} />}
            title={`${detail.ticketNo} — ${detail.title}`}
            subtitle={`Reported by ${detail.reporter.name} · ${fmtDateTime(detail.createdAt)}`}
            action={
              <div className="flex gap-2">
                <Badge tone={PRIORITY_TONE[detail.priority] ?? 'neutral'}>{detail.priority}</Badge>
                <Badge tone={STATUS_TONE[detail.status] ?? 'neutral'}>{detail.status.replace('_', ' ')}</Badge>
              </div>
            }
          />
          <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{detail.description}</p>
          <div className="mt-5 space-y-3 border-t border-slate-100 dark:border-slate-700 pt-4">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">Activity Timeline</h4>
            {detail.comments.map((c) => (
              <div key={c.id} className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <User size={12} /> {c.author.name} · {fmtDateTime(c.createdAt)}
                </div>
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{c.body}</p>
              </div>
            ))}
            {detail.comments.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No comments yet.</p>}
          </div>
          <div className="mt-4 flex gap-2">
            <TextInput
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment…"
              className="flex-1"
            />
            <Button onClick={() => commentMut.mutate()} disabled={!comment.trim() || commentMut.isPending}>Send</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: 'Total Tickets', value: stats.total, tone: 'text-slate-800' },
              { label: 'Open', value: stats.open, tone: 'text-red-600' },
              { label: 'SLA Breached', value: stats.breached, tone: 'text-amber-600' },
              { label: 'Urgent Active', value: stats.urgent, tone: 'text-violet-700' }
            ].map((s) => (
              <div key={s.label} className={cardShell}>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{s.label}</p>
                <p className={`mt-1 text-2xl font-extrabold tabular-nums ${s.tone}`}>{s.value}</p>
              </div>
            ))}
          </div>

          <div className={`${cardShell} flex flex-col gap-3 sm:flex-row`}>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-48">
              <option value="">All statuses</option>
              {['open', 'in_progress', 'resolved', 'closed'].map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </Select>
            <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="sm:w-48">
              <option value="">All priorities</option>
              {['low', 'medium', 'high', 'urgent'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
            {stats.breached > 0 && (
              <span className="inline-flex items-center gap-1.5 self-center text-sm font-semibold text-red-600">
                <AlertTriangle size={15} /> {stats.breached} ticket{stats.breached > 1 ? 's' : ''} past SLA — escalate
              </span>
            )}
          </div>

          <div className={cardShell}>
            {ticketsQ.isLoading ? (
              <Spinner />
            ) : ticketsQ.isError ? (
              <ErrorBox message="Failed to load tickets." />
            ) : (
              <DataTable<Ticket> columns={columns} rows={ticketsQ.data ?? []} emptyTitle="No tickets." />
            )}
          </div>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className={`${cardShell} w-full max-w-lg`}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 dark:text-slate-100">New Support Ticket</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Title" required>
                <TextInput value={title} onChange={(e) => setTitle(e.target.value)} required />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Category">
                  <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="technical">Technical</option>
                    <option value="hardware">Hardware</option>
                    <option value="operational">Operational</option>
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </Select>
                </Field>
              </div>
              <Field label="Description" required>
                <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} required />
              </Field>
              {createMut.isError && <ErrorBox message="Failed to create ticket." />}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={createMut.isPending}>
                  {createMut.isPending ? 'Submitting…' : 'Submit Ticket'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
