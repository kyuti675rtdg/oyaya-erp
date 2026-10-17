import type { ReactNode } from 'react';

/**
 * Unified card header (Dashboard spec 4.2): icon box + bold title + subtitle,
 * bottom hairline, optional right-side actions.
 */
export function CardHeader({
  icon,
  title,
  subtitle,
  action
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200/60 bg-slate-50 text-slate-600">
          {icon}
        </span>
        <div>
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
