import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, SectionTitle, Select, Spinner, TextArea, TextInput } from '../components/ui';
import { fmtDateTime } from '../lib/format';

interface Ticket {
  id: string;
  ticketNo: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  reporter: { name: string };
  createdAt: string;
}

interface TicketDetail extends Ticket {
  description: string;
  assignee: { name: string } | null;
  comments: { id: string; body: string; createdAt: string; author: { name: string } }[];
}

interface DocArticle {
  id: string;
  slug: string;
  title: string;
  module: string | null;
}

const PRIORITY_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  low: 'neutral',
  medium: 'advisory',
  high: 'critical',
  urgent: 'critical',
};

const STATUS_TONE: Record<string, 'pass' | 'advisory' | 'critical' | 'neutral'> = {
  open: 'critical',
  in_progress: 'advisory',
  resolved: 'pass',
  closed: 'neutral',
};

export function Support() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'tickets' | 'docs'>('tickets');
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [docSlug, setDocSlug] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('technical');
  const [priority, setPriority] = useState('medium');
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');

  const { data: tickets, isLoading: ticketsLoading } = useQuery({
    queryKey: ['tickets'],
    queryFn: async () => (await api.get<Ticket[]>(E.tickets)).data,
    enabled: tab === 'tickets',
  });

  const { data: docs } = useQuery({
    queryKey: ['docs', search],
    queryFn: async () =>
      (await api.get<DocArticle[]>(E.docs + (search ? `?search=${encodeURIComponent(search)}` : ''))).data,
    enabled: tab === 'docs',
  });

  const { data: docDetail } = useQuery({
    queryKey: ['doc', docSlug],
    queryFn: async () => (await api.get(E.doc(docSlug!))).data as { title: string; content: string },
    enabled: !!docSlug,
  });

  const openTicket = async (id: string) => {
    const d = await api.get<TicketDetail>(E.ticket(id));
    setDetail(d.data);
  };

  const createTicket = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(E.tickets, { title, description, category, priority });
      setTitle('');
      setDescription('');
      qc.invalidateQueries({ queryKey: ['tickets'] });
    } finally {
      setSaving(false);
    }
  };

  const addComment = async () => {
    if (!detail || !comment.trim()) return;
    await api.post(E.ticketComments(detail.id), { body: comment.trim() });
    setComment('');
    const d = await api.get<TicketDetail>(E.ticket(detail.id));
    setDetail(d.data);
  };

  const setStatus = async (status: string) => {
    if (!detail) return;
    await api.patch(E.ticket(detail.id), { status });
    const d = await api.get<TicketDetail>(E.ticket(detail.id));
    setDetail(d.data);
    qc.invalidateQueries({ queryKey: ['tickets'] });
  };

  return (
    <div className="space-y-6">
      <SectionTitle title="Support & Documentation" sub="Helpdesk tickets and SOP library." />

      <div className="flex gap-2">
        <Button variant={tab === 'tickets' ? 'primary' : 'secondary'} onClick={() => setTab('tickets')}>
          Tickets
        </Button>
        <Button variant={tab === 'docs' ? 'primary' : 'secondary'} onClick={() => setTab('docs')}>
          Documentation
        </Button>
      </div>

      {tab === 'tickets' && (
        <>
          {!detail ? (
            <>
              <Card>
                <h3 className="mb-4 font-bold">New Support Ticket</h3>
                <form onSubmit={createTicket} className="space-y-4">
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
                    <TextArea value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} />
                  </Field>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Submitting…' : 'Submit Ticket'}
                  </Button>
                </form>
              </Card>

              <Card>
                {ticketsLoading ? (
                  <Spinner />
                ) : (
                  <DataTable<Ticket>
                    columns={[
                      { key: 'ticketNo', label: 'Ticket', render: (r) => <span className="tnum font-mono text-sm">{r.ticketNo}</span> },
                      {
                        key: 'title', label: 'Title',
                        render: (r) => (
                          <button className="font-medium text-harvest hover:underline" onClick={() => openTicket(r.id)}>
                            {r.title}
                          </button>
                        ),
                      },
                      { key: 'priority', label: 'Priority', render: (r) => <Badge tone={PRIORITY_TONE[r.priority] ?? 'neutral'}>{r.priority}</Badge> },
                      { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge> },
                      { key: 'createdAt', label: 'Created', render: (r) => <span className="text-sm text-slate-500">{fmtDateTime(r.createdAt)}</span> },
                    ]}
                    rows={tickets ?? []}
                    emptyTitle="No tickets yet."
                  />
                )}
              </Card>
            </>
          ) : (
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <Button variant="secondary" onClick={() => setDetail(null)}>
                  ← Back
                </Button>
                <div className="flex gap-2">
                  {['open', 'in_progress', 'resolved', 'closed'].map((s) => (
                    <Button
                      key={s}
                      variant={detail.status === s ? 'primary' : 'secondary'}
                      onClick={() => setStatus(s)}
                    >
                      {s.replace('_', ' ')}
                    </Button>
                  ))}
                </div>
              </div>
              <h3 className="text-lg font-bold">
                {detail.ticketNo} — {detail.title}
              </h3>
              <p className="mt-2 text-sm text-slate-600">{detail.description}</p>
              <div className="mt-4 space-y-3 border-t pt-4">
                {detail.comments.map((c) => (
                  <div key={c.id} className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs font-medium text-slate-500">
                      {c.author.name} · {fmtDateTime(c.createdAt)}
                    </div>
                    <p className="mt-1 text-sm">{c.body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <TextInput
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a comment…"
                  className="flex-1"
                />
                <Button onClick={addComment}>Send</Button>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === 'docs' && (
        <Card>
          {!docSlug ? (
            <>
              <div className="mb-4">
                <TextInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search documentation…"
                />
              </div>
              <div className="space-y-2">
                {(docs ?? []).map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDocSlug(d.slug)}
                    className="block w-full rounded-lg border p-4 text-left hover:border-harvest"
                  >
                    <div className="font-medium">{d.title}</div>
                    {d.module && <div className="text-xs text-slate-500">Module: {d.module}</div>}
                  </button>
                ))}
                {(docs ?? []).length === 0 && (
                  <p className="text-sm text-slate-500">No documents found.</p>
                )}
              </div>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setDocSlug(null)} className="mb-4">
                ← Back
              </Button>
              <h3 className="mb-4 text-xl font-bold">{docDetail?.title}</h3>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap">{docDetail?.content}</div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
