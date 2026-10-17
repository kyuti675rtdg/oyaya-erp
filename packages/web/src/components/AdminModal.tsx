import type { ReactNode } from 'react';

/**
 * Shared modal shell for Module 18 admin pages — mobile-first bottom sheet
 * on small screens, centered dialog on desktop. Matches existing page patterns.
 */
export function AdminModal({
  title,
  sub,
  onClose,
  children,
  wide
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'} rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-line pb-3">
          <div>
            <h3 className="text-base font-bold text-ink">{title}</h3>
            {sub ? <p className="mt-0.5 text-sm text-slate-500">{sub}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="touch rounded-lg px-3 py-1.5 text-xl font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Inline success/error notice used across admin forms. */
export function AdminNotice({ notice }: { notice: { ok: boolean; text: string } | null }) {
  if (!notice) return null;
  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
        notice.ok
          ? 'border-pass-text/30 bg-pass-bg text-pass-text'
          : 'border-critical-text/30 bg-critical-bg text-critical-text'
      }`}
    >
      {notice.text}
    </div>
  );
}

/** Extract a readable message from an API error. */
export function errText(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}
