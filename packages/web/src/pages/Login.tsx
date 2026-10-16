import { useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { setAuthPersistence, useAuth } from '../store/auth';
import { isNetworkError } from '../lib/api';
import { Button, Field, TextInput } from '../components/ui';

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

/** Stylised wheat ear used as a low-opacity decorative pattern. */
function WheatPattern() {
  const stalk = (x: number, y: number, s: number, o: number) => (
    <g key={`${x}-${y}`} transform={`translate(${x} ${y}) scale(${s})`} opacity={o}>
      <line x1="0" y1="0" x2="0" y2="120" stroke="#D97706" strokeWidth="2.5" />
      {[-8, 8, 24, 40, 56, 72].map((gy, i) => (
        <g key={gy}>
          <ellipse cx={i % 2 === 0 ? -9 : 9} cy={gy} rx="8" ry="13" fill="#D97706" transform={`rotate(${i % 2 === 0 ? -32 : 32} ${i % 2 === 0 ? -9 : 9} ${gy})`} />
        </g>
      ))}
      <ellipse cx="0" cy="-14" rx="8" ry="14" fill="#D97706" />
    </g>
  );
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      {stalk(60, 40, 1.1, 0.10)}
      {stalk(300, 180, 1.5, 0.07)}
      {stalk(120, 420, 0.9, 0.09)}
      {stalk(420, 60, 1.2, 0.06)}
      {stalk(240, 560, 1.3, 0.08)}
      {stalk(480, 380, 0.8, 0.09)}
    </svg>
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

  const inputFocus =
    'focus:!border-amber-500 focus:!ring-amber-500/25';

  return (
    <div className="flex min-h-screen bg-stone-100">
      {/* ── Left branding panel (desktop) ─────────────────────────── */}
      <aside className="relative hidden w-[45%] flex-col justify-between overflow-hidden bg-gradient-to-br from-stone-950 via-stone-900 to-stone-800 p-10 text-white lg:flex xl:p-14">
        <WheatPattern />
        {/* soft amber glow */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-amber-600/15 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl" aria-hidden="true" />

        <div className="relative">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 text-3xl font-extrabold text-white shadow-lg shadow-amber-900/40">
              O
            </div>
            <div>
              <p className="text-xl font-extrabold leading-tight">Oyaya Flour Factory</p>
              <p className="text-sm font-medium tracking-wide text-amber-200/80">Enterprise Resource Planning</p>
            </div>
          </div>
        </div>

        <div className="relative" aria-hidden="true" />
      </aside>

      {/* ── Right form panel ──────────────────────────────────────── */}
      <main className="relative flex flex-1 items-center justify-center overflow-y-auto px-4 py-10 sm:px-8">
        {/* faint warm backdrop */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-amber-50/60 via-white to-stone-100" aria-hidden="true" />

        <div className="relative w-full max-w-md">
          {/* Compact brand banner (mobile / tablet) */}
          <div className="mb-6 flex items-center justify-center gap-3 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 text-2xl font-extrabold text-white shadow-md">
              O
            </div>
            <div>
              <p className="text-lg font-extrabold leading-tight text-stone-900">Oyaya Flour Factory</p>
              <p className="text-xs font-medium tracking-wide text-stone-500">Enterprise Resource Planning</p>
            </div>
          </div>

          <div className="animate-fade-in-up rounded-2xl border border-stone-200/70 bg-white p-6 shadow-xl shadow-stone-900/5 sm:p-8">
            <h2 className="text-2xl font-extrabold text-stone-900">Welcome back</h2>
            <p className="mt-1 text-sm text-stone-500">Sign in to your mill workspace</p>

            <form onSubmit={submit} className="mt-6">
              <div className="space-y-4">
                <Field label="Username" required>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-stone-400">
                      <UserIcon />
                    </span>
                    <TextInput
                      id="login-username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. operator1"
                      autoComplete="username"
                      required
                      className={`!pl-11 ${inputFocus}`}
                    />
                  </div>
                </Field>

                <Field label="Password" required>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-stone-400">
                      <LockIcon />
                    </span>
                    <TextInput
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      required
                      className={`!pl-11 !pr-12 ${inputFocus}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="focus-ring-violet absolute inset-y-0 right-0 flex items-center pr-3.5 text-stone-400 transition-colors hover:text-amber-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </Field>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-stone-600">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded accent-amber-600"
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  onClick={() => setShowForgotInfo((v) => !v)}
                  className="focus-ring-violet rounded text-sm font-semibold text-amber-700 hover:text-amber-800 hover:underline"
                  aria-expanded={showForgotInfo}
                >
                  Forgot password?
                </button>
              </div>

              {showForgotInfo ? (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
                  <InfoIcon />
                  <p>Contact your system administrator to reset your password.</p>
                </div>
              ) : null}

              {error ? (
                <div
                  className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
                  role="alert"
                  aria-live="assertive"
                >
                  <AlertIcon />
                  <p>{error}</p>
                </div>
              ) : null}

              <Button
                type="submit"
                loading={loading}
                className="mt-6 w-full !bg-gradient-to-r !from-amber-600 !to-amber-500 py-3.5 text-base font-bold shadow-lg shadow-amber-600/25 hover:!shadow-amber-600/40"
              >
                Sign in
              </Button>

              <p className="mt-5 border-t border-stone-100 pt-4 text-center text-xs leading-relaxed text-stone-500">
                Works offline — queued entries sync when connectivity returns.
              </p>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-stone-400">
            Oyaya Flour Production Company PLC · Secure sign-in
          </p>
        </div>
      </main>
    </div>
  );
}
