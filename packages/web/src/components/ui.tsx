import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/* ---------- Buttons ---------- */
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-harvest hover:bg-amber-700 text-white font-semibold shadow-sm disabled:opacity-50',
  secondary:
    'bg-white hover:bg-slate-50 text-slate-800 border border-line font-semibold disabled:opacity-50',
  danger:
    'bg-critical-text hover:bg-red-800 text-white font-semibold disabled:opacity-50',
  ghost: 'text-navy hover:bg-blue-50 font-semibold disabled:opacity-50'
};

export function Button({ variant = 'primary', loading, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      className={`touch inline-flex items-center justify-center gap-2 rounded-lg px-5 text-base transition-colors ${buttonStyles[variant]} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? 'Please wait...' : children}
    </button>
  );
}

/* ---------- Cards & sections ---------- */
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl border border-line bg-white shadow-sm ${className}`}>{children}</div>
  );
}

export function SectionTitle({
  title,
  sub,
  action
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-ink">{title}</h2>
        {sub ? <p className="mt-0.5 text-sm text-slate-500">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* ---------- Form primitives ---------- */
export function Field({
  label,
  hint,
  children,
  required
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}
        {required ? <span className="ml-1 text-critical-text">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

const inputBase =
  'touch w-full rounded-lg border border-line bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/20';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ''}`} />;
}

export function NumberInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="number" inputMode="decimal" className={`${inputBase} tnum ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputBase} ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} rows={props.rows ?? 3} className={`${inputBase} py-3 ${props.className ?? ''}`} />;
}

/* ---------- Feedback ---------- */
export function Spinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-slate-500" role="status">
      <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-line border-t-navy" />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-alabaster px-6 py-10 text-center">
      <p className="font-semibold text-slate-700">{title}</p>
      {sub ? <p className="mt-1 text-sm text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-critical-text/30 bg-critical-bg px-4 py-4 text-sm text-critical-text">
      <p className="font-semibold">Could not load data</p>
      <p className="mt-1">{message}</p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-2 rounded-lg border border-critical-text/40 px-4 py-2 text-sm font-semibold hover:bg-white"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
