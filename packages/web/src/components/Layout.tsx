import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useNetwork } from '../store/network';
import { OfflineBanner } from './OfflineBanner';

interface NavItem {
  to: string;
  label: string;
  claim?: string | string[];
  icon: string;
}

interface NavGroup {
  title: string;
  icon: string;
  items: NavItem[];
}

// Inner SVG paths (stroke style, 20x20 viewBox); sized via the svgIcon helper
const PATHS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="11" y="3" width="6" height="4" rx="1.5" />
      <rect x="11" y="9" width="6" height="8" rx="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" />
    </>
  ),
  intake: (
    <>
      <path d="M10 3v10m0 0l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v1.5A1.5 1.5 0 005.5 18h9a1.5 1.5 0 001.5-1.5V15" strokeLinecap="round" />
    </>
  ),
  tanks: (
    <>
      <path d="M6 3h8l1 4H5l1-4z" strokeLinejoin="round" />
      <path d="M5 7v9a2 2 0 002 2h6a2 2 0 002-2V7" strokeLinecap="round" />
      <path d="M5 11h10" strokeLinecap="round" />
    </>
  ),
  batches: (
    <>
      <circle cx="7" cy="7" r="3.5" />
      <circle cx="13.5" cy="13" r="3.5" />
      <path d="M10.5 7H14a2 2 0 012 2v1.5" strokeLinecap="round" />
    </>
  ),
  shifts: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  qc: (
    <>
      <path d="M8 3h4M9 3v5l-4.2 8.4A1.5 1.5 0 006.1 18.5h7.8a1.5 1.5 0 001.3-2.1L11 8V3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 13h5" strokeLinecap="round" />
    </>
  ),
  capa: (
    <>
      <path d="M10 2.5l6.5 3v5c0 4-2.8 6.8-6.5 8-3.7-1.2-6.5-4-6.5-8v-5l6.5-3z" strokeLinejoin="round" />
      <path d="M7.5 10l1.8 1.8L12.8 8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  sales: (
    <>
      <path d="M3 6h14l-1.2 9.2a1.5 1.5 0 01-1.5 1.3H5.7a1.5 1.5 0 01-1.5-1.3L3 6z" strokeLinejoin="round" />
      <path d="M7.5 9.5h5M7.5 12.5h3" strokeLinecap="round" />
      <path d="M8 6V5a2 2 0 012-2h0a2 2 0 012 2v1" strokeLinecap="round" />
    </>
  ),
  finance: (
    <>
      <rect x="3" y="6" width="14" height="10" rx="2" />
      <path d="M3 10h14M7 15h4" strokeLinecap="round" />
      <path d="M6 6V4.5A1.5 1.5 0 017.5 3h5A1.5 1.5 0 0114 4.5V6" strokeLinecap="round" />
    </>
  ),
  payroll: (
    <>
      <circle cx="7" cy="6.5" r="2.5" />
      <path d="M2.5 16a4.5 4.5 0 019 0" strokeLinecap="round" />
      <path d="M14 4.5A2.5 2.5 0 0116.5 7M14.5 11.5a4.5 4.5 0 013 4.5" strokeLinecap="round" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4" strokeLinecap="round" />
    </>
  ),
  modules: (
    <>
      <rect x="3" y="3" width="5.5" height="5.5" rx="1.5" />
      <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.5" />
      <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.5" />
      <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.5" />
    </>
  ),
  monitor: (
    <>
      <path d="M2.5 12.5l3.5-6 3 4 2.5-3 3 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 17h14" strokeLinecap="round" />
    </>
  ),
  support: (
    <>
      <path d="M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
      <path d="M7.8 7.8A2.5 2.5 0 0110 6.5c1.4 0 2.5 1 2.5 2.2 0 1.7-2.2 2-2.5 3.3" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.6" fill="currentColor" />
    </>
  ),
  truck: (
    <>
      <path d="M2 4.5h10V13H2z" strokeLinejoin="round" />
      <path d="M12 7.5h3.2l2.3 3v2.5H12" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="15" r="1.6" />
      <circle cx="14.8" cy="15" r="1.6" />
    </>
  ),
  package: (
    <>
      <path d="M10 2.8L17 6.5v7L10 17.2L3 13.5v-7L10 2.8z" strokeLinejoin="round" />
      <path d="M3 6.5l7 3.7 7-3.7M10 10.2v7" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  factory: (
    <>
      <path d="M4 17V9.5l5-3.5v3.5l5-3.5V17" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 17h15" strokeLinecap="round" />
    </>
  )
};

function svgIcon(name: string, className: string): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

const NAV: NavGroup[] = [
  {
    title: 'Dashboard',
    icon: 'dashboard',
    items: [{ to: '/', label: 'Executive Dashboard', icon: 'dashboard' }]
  },
  {
    title: 'Procurement & Vendor Management',
    icon: 'truck',
    items: [
      { to: '/intake', label: 'Wheat Intake', claim: ['intake:create', 'intake:read'], icon: 'intake' }
    ]
  },
  {
    title: 'Storage & Conditioning',
    icon: 'package',
    items: [
      { to: '/tanks', label: 'Conditioning Tanks', claim: ['tanks:read'], icon: 'tanks' }
    ]
  },
  {
    title: 'Production & Blending',
    icon: 'factory',
    items: [
      { to: '/batches', label: 'Batches & Blending', claim: ['batches:read'], icon: 'batches' },
      { to: '/shifts', label: 'Shift Milling', claim: ['shifts:read'], icon: 'shifts' }
    ]
  },
  {
    title: 'Quality Control',
    icon: 'qc',
    items: [
      { to: '/qc', label: 'Lab Checks', claim: ['qc:read'], icon: 'qc' },
      { to: '/capa', label: 'CAPA', claim: ['capa:read'], icon: 'capa' }
    ]
  },
  {
    title: 'Sales & Distribution',
    icon: 'sales',
    items: [{ to: '/sales', label: 'Sales & Dispatch', claim: ['sales:read'], icon: 'sales' }]
  },
  {
    title: 'Finance & Accounting',
    icon: 'finance',
    items: [
      { to: '/finance', label: 'Finance', claim: ['finance:read'], icon: 'finance' },
      { to: '/payroll', label: 'Payroll', claim: ['payroll:read'], icon: 'payroll' }
    ]
  },
  {
    title: 'Administration & Governance',
    icon: 'settings',
    items: [
      { to: '/settings', label: 'Settings', claim: ['settings:read'], icon: 'settings' },
      { to: '/module-manager', label: 'Module Manager', claim: ['settings:read'], icon: 'modules' },
      { to: '/api-monitor', label: 'API Monitoring', claim: ['settings:read'], icon: 'monitor' },
      { to: '/support', label: 'Support & Helpdesk', claim: ['support:read'], icon: 'support' }
    ]
  }
];

function itemMatches(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/';
  return pathname === item.to || pathname.startsWith(item.to + '/');
}

function Logo() {
  return (
    <div className="flex items-center gap-3 px-5 pb-5 pt-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5B35D5] text-white">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 21V7" />
          <path d="M12 10C9 10 6.5 7.5 6.5 4.5 9.5 4.5 12 7 12 10z" />
          <path d="M12 10c3 0 5.5-2.5 5.5-5.5C14.5 4.5 12 7 12 10z" />
          <path d="M12 15c-2.5 0-4.5-2-4.5-4.5 2.5 0 4.5 2 4.5 4.5z" />
          <path d="M12 15c2.5 0 4.5-2 4.5-4.5-2.5 0-4.5 2-4.5 4.5z" />
          <path d="M12 20c-2 0-3.5-1.5-3.5-3.5 2 0 3.5 1.5 3.5 3.5z" />
          <path d="M12 20c2 0 3.5-1.5 3.5-3.5-2 0-3.5 1.5-3.5 3.5z" />
        </svg>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold leading-tight text-white">Oyaya Flour Mill ERP</p>
        <p className="truncate text-[11px] text-white/50">Quality Flour · Better Lives</p>
      </div>
    </div>
  );
}

function UserCard({ onLogout }: { onLogout: () => void }) {
  const { user } = useAuth();
  const initial = (user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase();
  return (
    <div className="border-t border-white/10 p-4">
      <div className="flex items-center gap-3 rounded-xl bg-white/10 p-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#5B35D5] text-sm font-bold text-white">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{user?.name ?? user?.email}</p>
          <p className="truncate text-xs text-white/50">{user?.role}</p>
        </div>
        <button
          onClick={onLogout}
          className="touch shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          aria-label="Log out"
        >
          Log out
        </button>
      </div>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { hasAnyClaim } = useAuth();
  const { pathname } = useLocation();

  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((i) => !i.claim || hasAnyClaim(Array.isArray(i.claim) ? i.claim : [i.claim]))
  })).filter((group) => group.items.length > 0);

  const [openGroup, setOpenGroup] = useState<string | null>(() => {
    const active = visibleGroups.find((g) => g.items.some((i) => itemMatches(i, pathname)));
    return active ? active.title : 'Dashboard';
  });

  return (
    <nav className="flex-1 overflow-y-auto px-4 py-2" aria-label="Primary">
      {visibleGroups.map((group) => {
        const isOpen = openGroup === group.title;
        return (
          <div key={group.title} className="mb-1">
            <button
              type="button"
              onClick={() => setOpenGroup(isOpen ? null : group.title)}
              aria-expanded={isOpen}
              className="touch flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B35D5]"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#8F7BF0]" aria-hidden="true" />
              <span className="shrink-0 text-[#8F7BF0]">{svgIcon(group.icon, 'h-4 w-4')}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-white/80">
                {group.title}
              </span>
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className={`h-4 w-4 shrink-0 text-white/40 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              >
                <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {isOpen ? (
              <ul className="mb-2 mt-1 space-y-0.5 pl-7">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        `touch focus-ring-violet flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
                          isActive
                            ? 'bg-[#5B35D5] text-white'
                            : 'text-white/60 hover:bg-white/5 hover:text-white'
                        }`
                      }
                    >
                      <span className="shrink-0">{svgIcon(item.icon, 'h-5 w-5')}</span>
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function Layout() {
  const { user, logout } = useAuth();
  const { online, queued } = useNetwork();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const now = useNow();

  const handleLogout = () => {
    setUserMenuOpen(false);
    logout();
    navigate('/login');
  };

  const initial = (user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="flex min-h-screen bg-[#F4F6FA] text-[#172033]">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-[#171A3B] md:flex">
        <Logo />
        <SidebarContent />
        <UserCard onLogout={handleLogout} />
      </aside>

      {/* Mobile drawer */}
      {menuOpen ? (
        <div className="no-print fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-[#171A3B]">
            <div className="flex items-center justify-between pr-4">
              <Logo />
              <button
                onClick={() => setMenuOpen(false)}
                className="touch rounded-lg px-3 py-2 text-sm font-semibold text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <SidebarContent onNavigate={() => setMenuOpen(false)} />
            <UserCard onLogout={handleLogout} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-[#E2E7F0] bg-white px-4 py-3 md:px-6">
          <button
            onClick={() => setMenuOpen(true)}
            className="touch rounded-lg p-2.5 text-[#172033] transition-colors hover:bg-[#F4F6FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B35D5]"
            aria-label="Open menu"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true">
              <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
            </svg>
          </button>

          {/* Search */}
          <div className="relative hidden w-full max-w-md sm:block">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]" aria-hidden="true">
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13.5 13.5L17 17" strokeLinecap="round" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search anything…"
              className="w-full rounded-lg bg-[#F4F6FA] py-2.5 pl-10 pr-4 text-sm text-[#172033] outline-none transition-shadow placeholder:text-[#667085]/70 focus-visible:ring-2 focus-visible:ring-[#5B35D5]/50"
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
              className="touch relative rounded-lg bg-[#F4F6FA] p-2.5 text-[#667085] transition-colors hover:text-[#5B35D5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B35D5]"
              aria-label="Notifications"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true">
                <path d="M10 3a4.5 4.5 0 00-4.5 4.5c0 3-1 4-1.5 4.5h12C15.5 11.5 14.5 10.5 14.5 7.5A4.5 4.5 0 0010 3z" strokeLinejoin="round" />
                <path d="M8 15a2 2 0 004 0" strokeLinecap="round" />
              </svg>
              <span className="pulse-dot absolute right-2 top-2 h-2 w-2 rounded-full bg-critical-text ring-2 ring-white" />
            </button>

            {/* Date / time */}
            <div className="hidden text-right xl:block" aria-label="Current date and time">
              <p className="text-sm font-semibold leading-tight text-[#172033]">{dateStr}</p>
              <p className="tnum text-xs leading-tight text-[#667085]">{timeStr}</p>
            </div>

            {/* Avatar + account menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="touch flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-[#F4F6FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B35D5]"
                aria-label="Account menu"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#5B35D5] text-sm font-bold text-white">
                  {initial}
                </div>
                <div className="hidden text-left md:block">
                  <p className="max-w-32 truncate text-sm font-semibold leading-tight text-[#172033]">
                    {user?.name ?? user?.email}
                  </p>
                  <p className="max-w-32 truncate text-xs leading-tight text-[#667085]">{user?.role}</p>
                </div>
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className={`hidden h-4 w-4 text-[#667085] transition-transform duration-200 md:block ${userMenuOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                >
                  <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {userMenuOpen ? (
                <>
                  <button
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setUserMenuOpen(false)}
                    aria-label="Close account menu"
                    tabIndex={-1}
                  />
                  <div
                    className="absolute right-0 z-50 mt-2 w-48 rounded-xl border border-[#E2E7F0] bg-white py-1 shadow-lg"
                    role="menu"
                    aria-label="Account"
                  >
                    <button
                      onClick={handleLogout}
                      role="menuitem"
                      className="touch flex w-full items-center px-4 py-2 text-left text-sm font-semibold text-[#172033] transition-colors hover:bg-[#F4F6FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5B35D5]"
                      aria-label="Log out"
                    >
                      Log out
                    </button>
                  </div>
                </>
              ) : null}
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
