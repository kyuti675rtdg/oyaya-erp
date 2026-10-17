import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, Bell, BookOpen, ClipboardList, LifeBuoy,
  Megaphone, Ticket as TicketIcon, Wifi, WifiOff, Wrench
} from 'lucide-react';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Announcement, AppNotification } from '../types';
import { Badge } from '../components/Badge';
import { CardHeader } from '../components/CardHeader';
import { SectionTitle, Spinner } from '../components/ui';

const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

const MODULES = [
  { to: '/support/manuals', label: 'User Manuals', desc: 'Module-by-module operating manuals', icon: BookOpen, tint: 'bg-violet-50 text-violet-600' },
  { to: '/support/sops', label: 'SOPs', desc: 'Approved procedures & versions', icon: ClipboardList, tint: 'bg-blue-50 text-blue-600' },
  { to: '/support/knowledge-base', label: 'Knowledge Base', desc: 'FAQs & troubleshooting', icon: LifeBuoy, tint: 'bg-emerald-50 text-emerald-600' },
  { to: '/support/tickets', label: 'Support Tickets', desc: 'Queue with SLA tracking', icon: TicketIcon, tint: 'bg-amber-50 text-amber-600' },
  { to: '/support/tech-support', label: 'Tech Support Records', desc: 'Sessions & known issues', icon: Wrench, tint: 'bg-slate-100 text-slate-600' },
  { to: '/support/announcements', label: 'Announcements', desc: 'System-wide notices', icon: Megaphone, tint: 'bg-red-50 text-red-600' },
  { to: '/support/notifications', label: 'Notifications & SMS', desc: 'Alerts center & AfroMessage', icon: Bell, tint: 'bg-indigo-50 text-indigo-600' }
];

export function Support() {
  const { hasClaim } = useAuth();

  const ticketsQ = useQuery({
    queryKey: ['tickets'],
    queryFn: async () => (await api.get<any[]>(E.tickets)).data,
    enabled: hasClaim('support:view')
  });

  const annQ = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => (await api.get<Announcement[]>(E.announcements)).data
  });

  const notifQ = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get<AppNotification[]>(E.notifications)).data
  });

  const openTickets = (ticketsQ.data ?? []).filter((t) => t.status === 'open' || t.status === 'in_progress').length;
  const urgentAnn = (annQ.data ?? []).filter((a) => a.urgent);
  const unreadNotif = (notifQ.data ?? []).filter((n) => !n.read).length;
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  return (
    <div className="space-y-5">
      <SectionTitle title="Support & Documentation Center" sub="Help, procedures, tickets and system communication." />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link to="/support/tickets" className={`${cardShell} transition-all hover:shadow-md`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Open Tickets</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{ticketsQ.isLoading ? '…' : openTickets}</p>
        </Link>
        <Link to="/support/announcements" className={`${cardShell} transition-all hover:shadow-md`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Urgent Notices</p>
          <p className="mt-1 flex items-center gap-2 text-2xl font-extrabold tabular-nums text-red-600">
            {urgentAnn.length > 0 && <AlertTriangle size={20} />}
            {urgentAnn.length}
          </p>
        </Link>
        <Link to="/support/notifications" className={`${cardShell} transition-all hover:shadow-md`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Unread Notifications</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-violet-700">{unreadNotif}</p>
        </Link>
        <div className={cardShell}>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Offline Docs</p>
          <p className="mt-1 flex items-center gap-2 text-lg font-extrabold text-slate-900 dark:text-slate-100">
            {isOnline ? <Wifi size={20} className="text-emerald-500" /> : <WifiOff size={20} className="text-amber-500" />}
            {isOnline ? 'Online' : 'Offline'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Docs cached via PWA</p>
        </div>
      </div>

      {/* Urgent banner */}
      {urgentAnn.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-500" />
            <div className="min-w-0 flex-1">
              {urgentAnn.slice(0, 2).map((a) => (
                <div key={a.id} className="mb-2 last:mb-0">
                  <p className="font-bold text-red-900">{a.title}</p>
                  <p className="line-clamp-2 text-sm text-red-800">{a.body}</p>
                </div>
              ))}
              <Link to="/support/announcements" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-red-700 hover:underline">
                View all <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Module tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {MODULES.map((m) => (
          <Link
            key={m.to}
            to={m.to}
            className={`${cardShell} group transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500`}
          >
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${m.tint}`}>
              <m.icon size={20} />
            </span>
            <p className="mt-3 font-bold text-slate-800 dark:text-slate-100 group-hover:text-violet-700">{m.label}</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{m.desc}</p>
          </Link>
        ))}
      </div>

      {/* Latest announcements preview */}
      <div className={cardShell}>
        <CardHeader
          icon={<Megaphone size={16} />}
          title="Latest Announcements"
          action={
            <Link to="/support/announcements" className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline">
              View all <ArrowRight size={13} />
            </Link>
          }
        />
        {(annQ.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No announcements published.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {(annQ.data ?? []).slice(0, 3).map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate font-semibold text-slate-800 dark:text-slate-100">
                    {a.urgent && <Badge tone="critical">URGENT</Badge>}
                    {a.title}
                  </p>
                  <p className="text-xs tabular-nums text-slate-400 dark:text-slate-500">{a.publishedAt ? fmtDateTime(a.publishedAt) : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Offline access note */}
      <div className={`${cardShell} border-dashed`}>
        <CardHeader icon={<Wifi size={16} />} title="Offline Documentation Access" subtitle="PWA service worker caching" />
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Manuals, SOPs and knowledge-base articles are cached by the app service worker. When the device
          goes offline, previously opened documents remain readable. The indicator above shows the current
          connection state.
        </p>
      </div>
    </div>
  );
}
