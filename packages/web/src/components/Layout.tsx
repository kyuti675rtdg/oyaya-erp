import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useNetwork } from '../store/network';
import { OfflineBanner } from './OfflineBanner';

interface NavItem {
  to: string;
  label: string;
  claim?: string | string[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ to: '/', label: 'Dashboard' }]
  },
  {
    title: 'Mill Operations',
    items: [
      { to: '/intake', label: 'Wheat Intake', claim: ['intake:create', 'intake:read'] },
      { to: '/tanks', label: 'Conditioning Tanks', claim: ['tanks:read'] },
      { to: '/batches', label: 'Batches & Blending', claim: ['batches:read'] },
      { to: '/shifts', label: 'Shift Milling', claim: ['shifts:read'] }
    ]
  },
  {
    title: 'Quality',
    items: [
      { to: '/qc', label: 'Lab Checks', claim: ['qc:read'] },
      { to: '/capa', label: 'CAPA', claim: ['capa:read'] }
    ]
  },
  {
    title: 'Commercial',
    items: [
      { to: '/sales', label: 'Sales & Dispatch', claim: ['sales:read'] },
      { to: '/finance', label: 'Finance', claim: ['finance:read'] }
    ]
  },
  {
    title: 'People',
    items: [{ to: '/payroll', label: 'Payroll', claim: ['payroll:read'] }]
  },
  {
    title: 'System',
    items: [
      { to: '/settings', label: 'Settings', claim: ['settings:read'] },
      { to: '/module-manager', label: 'Module Manager', claim: ['settings:read'] },
      { to: '/api-monitor', label: 'API Monitor', claim: ['settings:read'] },
      { to: '/support', label: 'Support & Docs', claim: ['support:read'] },
    ]
  }
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { hasAnyClaim } = useAuth();
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4">
      {NAV.map((section) => {
        const visible = section.items.filter(
          (i) => !i.claim || hasAnyClaim(Array.isArray(i.claim) ? i.claim : [i.claim])
        );
        if (visible.length === 0) return null;
        return (
          <div key={section.title} className="mb-5">
            <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">
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
                      `touch flex items-center rounded-lg px-3 text-[15px] font-medium transition-colors ${
                        isActive
                          ? 'bg-navy text-white'
                          : 'text-slate-300 hover:bg-white/10 hover:text-white'
                      }`
                    }
                  >
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

export function Layout() {
  const { user, logout } = useAuth();
  const { online, queued } = useNetwork();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-alabaster">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-ink md:flex">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-harvest text-lg font-extrabold text-white">
            O
          </div>
          <div>
            <p className="text-base font-bold leading-tight text-white">Oyaya ERP</p>
            <p className="text-xs text-slate-400">Flour Factory</p>
          </div>
        </div>
        <SidebarContent />
        <div className="border-t border-white/10 p-4">
          <p className="truncate text-sm font-semibold text-white">{user?.name ?? user?.email}</p>
          <p className="text-xs uppercase tracking-wide text-slate-400">{user?.role}</p>
        </div>
      </aside>

      {/* Mobile drawer */}
      {menuOpen ? (
        <div className="no-print fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-ink">
            <div className="flex items-center justify-between px-5 pb-4 pt-5">
              <p className="text-base font-bold text-white">Oyaya ERP</p>
              <button
                onClick={() => setMenuOpen(false)}
                className="touch rounded-lg px-3 text-slate-300 hover:bg-white/10"
                aria-label="Close menu"
              >
                Close
              </button>
            </div>
            <SidebarContent onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-ink px-4 py-2.5">
          <button
            onClick={() => setMenuOpen(true)}
            className="touch rounded-lg px-3 text-sm font-semibold text-slate-200 hover:bg-white/10 md:hidden"
            aria-label="Open menu"
          >
            Menu
          </button>
          <div className="flex items-center gap-2 md:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-harvest text-sm font-extrabold text-white">
              O
            </div>
            <span className="text-sm font-bold text-white">Oyaya ERP</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                online ? 'bg-pass-bg text-pass-text' : 'bg-critical-bg text-critical-text'
              }`}
              role="status"
            >
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${online ? 'bg-pass-text' : 'bg-critical-text'}`}
              />
              {online ? (queued > 0 ? `Online — ${queued} queued` : 'Online') : 'Offline'}
            </span>
            <span className="hidden text-sm text-slate-300 sm:inline">
              {user?.name ?? user?.email}
            </span>
            <button
              onClick={handleLogout}
              className="touch rounded-lg border border-white/20 px-4 text-sm font-semibold text-slate-200 hover:bg-white/10"
            >
              Log out
            </button>
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
