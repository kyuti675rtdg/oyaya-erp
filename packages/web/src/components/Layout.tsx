import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useNetwork } from '../store/network';
import { OfflineBanner } from './OfflineBanner';

interface NavItem {
  to: string;
  label: string;
  claim?: string | string[];
  icon: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// Simple inline SVG icons (stroke style, 20x20)
const ICONS: Record<string, ReactNode> = {
  dashboard: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="11" y="3" width="6" height="4" rx="1.5" />
      <rect x="11" y="9" width="6" height="8" rx="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" />
    </svg>
  ),
  intake: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path d="M10 3v10m0 0l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v1.5A1.5 1.5 0 005.5 18h9a1.5 1.5 0 001.5-1.5V15" strokeLinecap="round" />
    </svg>
  ),
  tanks: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path d="M6 3h8l1 4H5l1-4z" strokeLinejoin="round" />
      <path d="M5 7v9a2 2 0 002 2h6a2 2 0 002-2V7" strokeLinecap="round" />
      <path d="M5 11h10" strokeLinecap="round" />
    </svg>
  ),
  batches: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <circle cx="7" cy="7" r="3.5" />
      <circle cx="13.5" cy="13" r="3.5" />
      <path d="M10.5 7H14a2 2 0 012 2v1.5" strokeLinecap="round" />
    </svg>
  ),
  shifts: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  qc: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path d="M8 3h4M9 3v5l-4.2 8.4A1.5 1.5 0 006.1 18.5h7.8a1.5 1.5 0 001.3-2.1L11 8V3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 13h5" strokeLinecap="round" />
    </svg>
  ),
  capa: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path d="M10 2.5l6.5 3v5c0 4-2.8 6.8-6.5 8-3.7-1.2-6.5-4-6.5-8v-5l6.5-3z" strokeLinejoin="round" />
      <path d="M7.5 10l1.8 1.8L12.8 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  sales: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path d="M3 6h14l-1.2 9.2a1.5 1.5 0 01-1.5 1.3H5.7a1.5 1.5 0 01-1.5-1.3L3 6z" strokeLinejoin="round" />
      <path d="M7.5 9.5h5M7.5 12.5h3" strokeLinecap="round" />
      <path d="M8 6V5a2 2 0 012-2h0a2 2 0 012 2v1" strokeLinecap="round" />
    </svg>
  ),
  finance: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <rect x="3" y="6" width="14" height="10" rx="2" />
      <path d="M3 10h14M7 15h4" strokeLinecap="round" />
      <path d="M6 6V4.5A1.5 1.5 0 017.5 3h5A1.5 1.5 0 0114 4.5V6" strokeLinecap="round" />
    </svg>
  ),
  payroll: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <circle cx="7" cy="6.5" r="2.5" />
      <path d="M2.5 16a4.5 4.5 0 019 0" strokeLinecap="round" />
      <path d="M14 4.5A2.5 2.5 0 0116.5 7M14.5 11.5a4.5 4.5 0 013 4.5" strokeLinecap="round" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4" strokeLinecap="round" />
    </svg>
  ),
  modules: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <rect x="3" y="3" width="5.5" height="5.5" rx="1.5" />
      <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.5" />
      <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.5" />
      <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.5" />
    </svg>
  ),
  monitor: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path d="M2.5 12.5l3.5-6 3 4 2.5-3 3 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 17h14" strokeLinecap="round" />
    </svg>
  ),
  support: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path d="M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
      <path d="M7.8 7.8A2.5 2.5 0 0110 6.5c1.4 0 2.5 1 2.5 2.2 0 1.7-2.2 2-2.5 3.3" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.6" fill="currentColor" />
    </svg>
  )
};

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: 'dashboard' }]
  },
  {
    title: 'Mill Operations',
    items: [
      { to: '/intake', label: 'Wheat Intake', claim: ['intake:create', 'intake:read'], icon: 'intake' },
      { to: '/tanks', label: 'Conditioning Tanks', claim: ['tanks:read'], icon: 'tanks' },
      { to: '/batches', label: 'Batches & Blending', claim: ['batches:read'], icon: 'batches' },
      { to: '/shifts', label: 'Shift Milling', claim: ['shifts:read'], icon: 'shifts' }
    ]
  },
  {
    title: 'Quality',
    items: [
      { to: '/qc', label: 'Lab Checks', claim: ['qc:read'], icon: 'qc' },
      { to: '/capa', label: 'CAPA', claim: ['capa:read'], icon: 'capa' }
    ]
  },
  {
    title: 'Commercial',
    items: [
      { to: '/sales', label: 'Sales & Dispatch', claim: ['sales:read'], icon: 'sales' },
      { to: '/finance', label: 'Finance', claim: ['finance:read'], icon: 'finance' }
    ]
  },
  {
    title: 'People',
    items: [{ to: '/payroll', label: 'Payroll', claim: ['payroll:read'], icon: 'payroll' }]
  },
  {
    title: 'System',
    items: [
      { to: '/settings', label: 'Settings', claim: ['settings:read'], icon: 'settings' },
      { to: '/module-manager', label: 'Module Manager', claim: ['settings:read'], icon: 'modules' },
      { to: '/api-monitor', label: 'API Monitor', claim: ['settings:read'], icon: 'monitor' },
      { to: '/support', label: 'Support & Docs', claim: ['support:read'], icon: 'support' }
    ]
  }
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { hasAnyClaim } = useAuth();
  return (
    <nav className="flex-1 overflow-y-auto px-4 py-4">
      {NAV.map((section) => {
        const visible = section.items.filter(
          (i) => !i.claim || hasAnyClaim(Array.isArray(i.claim) ? i.claim : [i.claim])
        );
        if (visible.length === 0) return null;
        return (
          <div key={section.title} className="mb-6">
            <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              {section.title}
            </p>
            <ul className="space-y-1">
              {visible.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `touch focus-ring-violet flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-all duration-200 ease-out ${
                        isActive
                          ? 'bg-violet-primary text-white shadow-[0_4px_12px_rgba(124,58,237,0.35)]'
                          : 'text-slate-600 hover:translate-x-0.5 hover:bg-violet-pale/60 hover:text-violet-dark'
                      }`
                    }
                  >
                    <span className="shrink-0">{ICONS[item.icon]}</span>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3 px-5 pb-4 pt-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-primary text-lg font-extrabold text-white shadow-[0_4px_12px_rgba(124,58,237,0.35)]">
        O
      </div>
      <div>
        <p className="text-base font-bold leading-tight text-ink">Oyaya ERP</p>
        <p className="text-xs text-slate-500">Flour Factory</p>
      </div>
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const { online, queued } = useNetwork();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initial = (user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-lavender-bg">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-white md:flex">
        <Logo />
        <SidebarContent />
        <div className="border-t border-lavender-sidebar p-4">
          <div className="flex items-center gap-3 rounded-xl bg-lavender-bg p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-primary text-sm font-bold text-white">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{user?.name ?? user?.email}</p>
              <p className="truncate text-xs text-slate-500">{user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="touch shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 hover:bg-white hover:text-critical-text"
              aria-label="Log out"
            >
              Log out
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {menuOpen ? (
        <div className="no-print fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white">
            <div className="flex items-center justify-between pr-4">
              <Logo />
              <button
                onClick={() => setMenuOpen(false)}
                className="touch rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-lavender-bg"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <SidebarContent onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="no-print sticky top-0 z-30 flex items-center gap-3 bg-lavender-bg/90 px-4 py-3 backdrop-blur md:px-6">
          <button
            onClick={() => setMenuOpen(true)}
            className="touch focus-ring-violet rounded-xl bg-white p-2.5 text-slate-600 shadow-sm transition-all duration-200 hover:text-violet-primary hover:shadow-md md:hidden"
            aria-label="Open menu"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
              <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
            </svg>
          </button>

          {/* Search */}
          <div className="relative hidden w-full max-w-md sm:block">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13.5 13.5L17 17" strokeLinecap="round" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search anything…"
              className="w-full rounded-xl border-0 bg-white py-2.5 pl-10 pr-4 text-sm text-ink shadow-sm outline-none transition-all duration-200 ring-violet-primary/30 placeholder:text-slate-400 hover:shadow-md focus:shadow-md focus:ring-2"
              aria-label="Search"
            />
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {/* Online status */}
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                online ? 'bg-pass-bg text-pass-text' : 'bg-critical-bg text-critical-text'
              }`}
              role="status"
            >
              <span className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-pass-text' : 'bg-critical-text'}`} />
              <span className="hidden sm:inline">{online ? (queued > 0 ? `Online · ${queued} queued` : 'Online') : 'Offline'}</span>
            </span>

            {/* Notification bell */}
            <button
              className="touch focus-ring-violet relative rounded-xl bg-white p-2.5 text-slate-500 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-violet-primary hover:shadow-md active:translate-y-0"
              aria-label="Notifications"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
                <path d="M10 3a4.5 4.5 0 00-4.5 4.5c0 3-1 4-1.5 4.5h12C15.5 11.5 14.5 10.5 14.5 7.5A4.5 4.5 0 0010 3z" strokeLinejoin="round" />
                <path d="M8 15a2 2 0 004 0" strokeLinecap="round" />
              </svg>
              <span className="pulse-dot absolute right-2 top-2 h-2 w-2 rounded-full bg-critical-text ring-2 ring-white" />
            </button>

            {/* Avatar */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-primary text-sm font-bold text-white shadow-sm">
              {initial}
            </div>
          </div>
        </header>

        <OfflineBanner />

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
