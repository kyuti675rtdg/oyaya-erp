import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { ErrorBox, Spinner } from '../../components/ui';
import { CardHeader } from '../../components/CardHeader';

export const cardShell =
  'bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

/** Palette matching the Executive Dashboard charts. */
export const CHART_COLORS = {
  violet: '#7C3AED',
  sky: '#0EA5E9',
  amber: '#F59E0B',
  amberDark: '#D97706',
  emerald: '#10B981',
  emeraldDark: '#059669',
  slate: '#94A3B8',
  rose: '#F43F5E'
};

export const PIE_COLORS = ['#7C3AED', '#0EA5E9', '#10B981', '#F59E0B', '#F43F5E', '#94A3B8'];

/** Page shell: title row + content spacing, matching the Executive Dashboard rhythm. */
export function BiShell({
  icon,
  title,
  subtitle,
  actions,
  children
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
            {icon}
          </span>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">{title}</h1>
            <p className="text-sm text-slate-500">{subtitle}</p>
          </div>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** Graceful empty state when the user's role lacks the domain permission. */
export function NoAccessState({ domain }: { domain: string }) {
  return (
    <div className="space-y-5">
      <div className={`${cardShell} flex flex-col items-center py-16 text-center`}>
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <ShieldAlert className="h-7 w-7" />
        </span>
        <h2 className="mt-4 text-lg font-bold text-slate-800">No access to {domain} insights</h2>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          Your role does not include permission to view this Business Intelligence dashboard.
          Contact your administrator if you need access.
        </p>
      </div>
    </div>
  );
}

export function ChartCard({
  icon,
  title,
  subtitle,
  action,
  children,
  className = ''
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${cardShell} ${className}`}>
      <CardHeader icon={icon} title={title} subtitle={subtitle} action={action} />
      {children}
    </div>
  );
}

/**
 * Role-aware BI page wrapper: shows a graceful "no access" state when the
 * domain claim is missing, otherwise loads the aggregated BI payload.
 */
export function useBiQuery<T>(key: string, endpoint: string, claims: string[]): UseQueryResult<T> & {
  allowed: boolean;
} {
  const { hasAnyClaim } = useAuth();
  const allowed = hasAnyClaim(claims);
  const q = useQuery({
    queryKey: [key],
    queryFn: async () => (await api.get<T>(endpoint)).data,
    enabled: allowed
  });
  return { ...q, allowed };
}

export function BiLoading({ label = 'Loading insights...' }: { label?: string }) {
  return (
    <div className="space-y-5">
      <div className={`${cardShell} flex justify-center py-20`}>
        <Spinner label={label} />
      </div>
    </div>
  );
}

export function BiError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-5">
      <ErrorBox message="Failed to load BI data. Check your connection and try again." onRetry={onRetry} />
    </div>
  );
}

export function fmtPct1(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

export function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
