import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { setAuthPersistence, useAuth } from '../store/auth';
import { isNetworkError } from '../lib/api';

/* ---------- Inline SVG icons (no libraries) ---------- */

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

/* ---------- Labelled input (reference style) ---------- */

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  icon: ReactNode;
  trailing?: ReactNode;
}

function Field({ id, label, type = 'text', value, onChange, placeholder, autoComplete, required, icon, trailing }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-stone-600">
        {label}
        {required ? <span className="ml-0.5 text-stone-400">*</span> : null}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-stone-400">
          {icon}
        </span>
        <input
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          className="h-12 w-full rounded-lg border border-stone-200 bg-white pl-11 pr-4 text-[15px] text-stone-900 shadow-sm transition-all duration-200 placeholder:text-stone-400 hover:border-stone-300 focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900/15"
        />
        {trailing}
      </div>
    </div>
  );
}

/* ---------- Page ---------- */

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [showForgotInfo, setShowForgotInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setShowForgotInfo(false);
    setLoading(true);
    try {
      // Trim both fields: phone keyboards often add invisible trailing spaces.
      await login(username.trim(), password.trim());
      // Persist the session according to the "Remember me" choice.
      setAuthPersistence(rememberMe);
      navigate(from, { replace: true });
    } catch (err) {
      if (isNetworkError(err)) {
        setError('Could not reach the server. Check your connection and try again.');
      } else {
        setError('Invalid username or password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 lg:justify-end lg:pr-[9vw]">
      {/* ── Full-bleed photographic background ────────────────────── */}
      <div
        aria-hidden="true"
        className="animate-bg-scale-in absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}login-bg.jpg)` }}
      />
      {/* Dark gradient overlay for legibility */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/30"
      />

      {/* ── White sign-in card ────────────────────────────────────── */}
      <div className="animate-fade-in-up relative z-10 w-full max-w-sm">
        <div className="rounded-2xl bg-white p-8 shadow-2xl">
          <h1 className="text-2xl font-extrabold tracking-tight text-stone-900">
            Hi there, welcome back
          </h1>
          <p className="mt-1 text-sm text-stone-500">Sign in to Oyaya Flour Factory ERP</p>

          <form onSubmit={submit} className="mt-6">
            <div className="space-y-4">
              <Field
                id="login-username"
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. operator1"
                autoComplete="username"
                required
                icon={<UserIcon />}
              />
              <Field
                id="login-password"
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                icon={<LockIcon />}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center rounded-r-lg pr-3.5 text-stone-400 transition-colors hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/30"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                }
              />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <label className="group flex cursor-pointer select-none items-center gap-2 text-sm text-stone-600">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`flex h-[18px] w-[18px] items-center justify-center rounded border transition-all duration-200 group-hover:border-stone-500 peer-focus-visible:ring-2 peer-focus-visible:ring-stone-900/30 peer-focus-visible:ring-offset-1 ${
                    rememberMe ? 'border-stone-900 bg-stone-900' : 'border-stone-300 bg-white'
                  }`}
                >
                  <span
                    className={`text-white transition-all duration-200 ${
                      rememberMe ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                    }`}
                  >
                    <CheckIcon />
                  </span>
                </span>
                Remember me
              </label>
              <button
                type="button"
                onClick={() => setShowForgotInfo((v) => !v)}
                className="rounded text-sm font-medium text-stone-600 transition-colors hover:text-stone-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/30"
                aria-expanded={showForgotInfo}
              >
                Forgot password?
              </button>
            </div>

            {/* Forgot-password info (collapsible) */}
            <div
              className={`grid transition-all duration-300 ease-out ${
                showForgotInfo ? 'mt-4 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                <div role="status" className="flex items-start gap-2.5 rounded-lg border border-stone-200 bg-stone-50 px-3.5 py-3 text-sm text-stone-700">
                  <span className="text-stone-500"><InfoIcon /></span>
                  <p>Contact your system administrator to reset your password.</p>
                </div>
              </div>
            </div>

            {/* Error (collapsible) */}
            <div
              className={`grid transition-all duration-300 ease-out ${
                error ? 'mt-4 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                <div role="alert" aria-live="assertive" className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm font-medium text-red-800">
                  <span className="text-red-500"><AlertIcon /></span>
                  <p>{error ?? ''}</p>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-6 h-12 w-full rounded-lg bg-stone-900 text-[15px] font-semibold text-white shadow-md transition-all duration-200 hover:bg-stone-800 hover:shadow-lg active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/40 focus-visible:ring-offset-2"
            >
              <span className="flex items-center justify-center gap-2.5">
                {loading ? (
                  <>
                    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </span>
            </button>

            <p className="mt-5 text-center text-xs leading-relaxed text-stone-400">
              Works offline — queued entries sync when connectivity returns.
            </p>
          </form>
        </div>
      </div>

      {/* ── Page footer ───────────────────────────────────────────── */}
      <p className="absolute inset-x-0 bottom-5 z-10 text-center text-xs font-medium tracking-wide text-white/60">
        Oyaya Flour Production Company PLC
      </p>
    </div>
  );
}
