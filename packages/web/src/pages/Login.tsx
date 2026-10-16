import { useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
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

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1">
      <line x1="5" y1="12" x2="19" y2="12" />
      <path d="M12 5l7 7-7 7" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10z" />
    </svg>
  );
}

/** Single wheat grain kernel, used for the floating particle field. */
function GrainIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#D97706" aria-hidden="true">
      <ellipse cx="12" cy="12" rx="6" ry="10" />
      <ellipse cx="12" cy="12" rx="2.4" ry="7" fill="#F59E0B" opacity="0.65" />
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

/** Slow-drifting grain particles for the branding panel. */
const PARTICLES: Array<{ left: string; size: number; duration: string; delay: string; opacity: number }> = [
  { left: '10%', size: 14, duration: '11s', delay: '0s', opacity: 0.22 },
  { left: '26%', size: 10, duration: '14s', delay: '3s', opacity: 0.16 },
  { left: '44%', size: 18, duration: '12s', delay: '6s', opacity: 0.2 },
  { left: '60%', size: 11, duration: '15s', delay: '1.5s', opacity: 0.18 },
  { left: '76%', size: 15, duration: '10s', delay: '4.5s', opacity: 0.22 },
  { left: '88%', size: 9, duration: '13s', delay: '8s', opacity: 0.15 },
];

/* ---------- Floating-label input ---------- */

interface FloatFieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  required?: boolean;
  icon: ReactNode;
  trailing?: ReactNode;
}

function FloatField({ id, label, type = 'text', value, onChange, autoComplete, required, icon, trailing }: FloatFieldProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-stone-400">
        {icon}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        required={required}
        placeholder=" "
        className="peer h-14 w-full rounded-xl border border-stone-200 bg-stone-100 pl-11 pr-4 pt-6 text-[15px] font-medium text-stone-900 shadow-[inset_0_2px_4px_rgba(0,0,0,0.04)] transition-all duration-200 placeholder:text-transparent hover:border-stone-300 focus:border-amber-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-amber-500/20"
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 text-[15px] text-stone-400 transition-all duration-200 peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-[11px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-wider peer-focus:text-amber-700 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-bold peer-[:not(:placeholder-shown)]:uppercase peer-[:not(:placeholder-shown)]:tracking-wider peer-[:not(:placeholder-shown)]:text-stone-500"
      >
        {label}
        {required ? <span className="ml-0.5 text-amber-600">*</span> : null}
      </label>
      {trailing}
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
    <div className="flex min-h-dvh bg-stone-100">
      {/* ── Left branding panel (desktop) ─────────────────────────── */}
      <aside className="relative hidden overflow-hidden bg-stone-950 lg:block lg:w-[45%]">
        {/* multi-stop deep gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-stone-950 via-amber-950/40 to-stone-900" aria-hidden="true" />
        {/* large radial amber glow behind the logo */}
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_42%,rgba(217,119,6,0.30),transparent_70%)]" aria-hidden="true" />
        {/* wheat pattern: crisp layer + blurred depth layer for parallax feel */}
        <WheatPattern />
        <div className="absolute inset-0 scale-125 opacity-50 blur-[2px]" aria-hidden="true">
          <WheatPattern />
        </div>
        {/* drifting grain particles */}
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className="wheat-particle pointer-events-none absolute -bottom-8"
              style={
                {
                  left: p.left,
                  animationDuration: p.duration,
                  animationDelay: p.delay,
                  '--wp-o': p.opacity,
                } as CSSProperties
              }
            >
              <GrainIcon size={p.size} />
            </span>
          ))}
        </div>
        {/* vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(0,0,0,0.5)_100%)]" aria-hidden="true" />

        {/* centered logo lockup (text-free per request: logo + name only) */}
        <div className="animate-fade-in-up relative flex h-full flex-col items-center justify-center p-10 text-center">
          <div className="relative">
            <svg className="spin-slow absolute -inset-4 h-32 w-32 text-amber-500/50" viewBox="0 0 128 128" fill="none" aria-hidden="true">
              <circle cx="64" cy="64" r="60" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 10" strokeLinecap="round" />
            </svg>
            <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700 text-5xl font-extrabold text-white ring-4 ring-amber-400/25 shadow-[0_0_60px_rgba(217,119,6,0.55)]">
              O
            </div>
          </div>
          <p className="mt-8 text-2xl font-extrabold tracking-tight text-white">Oyaya Flour Factory</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/70">
            Enterprise Resource Planning
          </p>
        </div>

        {/* bottom amber accent line */}
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r from-transparent via-amber-500 to-transparent" aria-hidden="true" />
      </aside>

      {/* ── Right form panel ──────────────────────────────────────── */}
      <main className="relative flex flex-1 items-center justify-center overflow-y-auto px-4 py-10 sm:px-8">
        {/* rich warm backdrop */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-amber-50/70 via-white to-stone-100" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_40%_at_80%_0%,rgba(217,119,6,0.09),transparent_70%)]" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_35%_at_10%_100%,rgba(217,119,6,0.06),transparent_70%)]" aria-hidden="true" />

        <div className="relative w-full max-w-md">
          {/* Compact brand banner (mobile / tablet) */}
          <div className="mb-6 flex items-center justify-center gap-3 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 text-2xl font-extrabold text-white shadow-md shadow-amber-600/30">
              O
            </div>
            <div>
              <p className="text-lg font-extrabold leading-tight text-stone-900">Oyaya Flour Factory</p>
              <p className="text-xs font-medium tracking-wide text-stone-500">Enterprise Resource Planning</p>
            </div>
          </div>

          {/* Glassmorphism form card */}
          <div className="animate-fade-in-up rounded-3xl border border-white/60 bg-white/95 p-6 shadow-[0_24px_70px_-16px_rgba(120,53,15,0.28)] backdrop-blur-xl sm:p-9">
            <h2 className="text-3xl font-extrabold tracking-tight text-stone-900">Welcome back</h2>
            <p className="mt-1.5 text-[15px] text-stone-500">Sign in to your mill workspace</p>

            <form onSubmit={submit} className="mt-7">
              <div className="space-y-4">
                <FloatField
                  id="login-username"
                  label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                  icon={<UserIcon />}
                />
                <FloatField
                  id="login-password"
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  icon={<LockIcon />}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="focus-ring-violet absolute inset-y-0 right-0 flex items-center rounded-r-xl pr-4 text-stone-400 transition-colors hover:text-amber-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  }
                />
              </div>

              <div className="mt-5 flex items-center justify-between">
                <label className="group flex cursor-pointer select-none items-center gap-2.5 text-sm font-medium text-stone-600">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={`flex h-5 w-5 items-center justify-center rounded-md border-2 shadow-sm transition-all duration-200 group-hover:border-amber-400 peer-focus-visible:ring-4 peer-focus-visible:ring-amber-500/30 ${
                      rememberMe
                        ? 'border-amber-600 bg-amber-600 shadow-md shadow-amber-600/30'
                        : 'border-stone-300 bg-white'
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
                  className="focus-ring-violet rounded text-sm font-semibold text-amber-700 transition-colors hover:text-amber-800 hover:underline"
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
                  <div role="status" className="relative flex items-start gap-3 overflow-hidden rounded-xl border border-amber-200/80 bg-amber-50 py-3 pl-4 pr-4 text-sm text-amber-900 shadow-sm">
                    <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-amber-400 to-amber-600" />
                    <span className="pl-1.5 text-amber-600"><InfoIcon /></span>
                    <p className="pl-1">Contact your system administrator to reset your password.</p>
                  </div>
                </div>
              </div>

              {/* Error (collapsible, accent bar) */}
              <div
                className={`grid transition-all duration-300 ease-out ${
                  error ? 'mt-4 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="overflow-hidden">
                  <div role="alert" aria-live="assertive" className="relative flex items-start gap-3 overflow-hidden rounded-xl border border-red-200/80 bg-red-50 py-3 pl-4 pr-4 text-sm font-medium text-red-800 shadow-sm">
                    <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-red-500 to-red-600" />
                    <span className="pl-1.5 text-red-500"><AlertIcon /></span>
                    <p className="pl-1">{error ?? ''}</p>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="focus-ring-violet group relative mt-6 h-14 w-full overflow-hidden rounded-xl bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 bg-[length:200%_100%] bg-left text-[16px] font-semibold text-white shadow-lg shadow-amber-600/30 transition-all duration-300 hover:bg-right hover:shadow-xl hover:shadow-amber-600/40 active:scale-[0.99] disabled:cursor-wait disabled:opacity-80"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -translate-x-[150%] -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[450%]"
                />
                <span className="relative flex items-center justify-center gap-2.5">
                  {loading ? (
                    <>
                      <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowIcon />
                    </>
                  )}
                </span>
              </button>

              {/* Secure sign-in divider */}
              <div className="mt-6 flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-gradient-to-r from-transparent to-stone-200" />
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-stone-400">
                  <ShieldIcon />
                  Secure sign-in
                </span>
                <span className="h-px flex-1 bg-gradient-to-l from-transparent to-stone-200" />
              </div>

              <p className="mt-4 text-center text-xs leading-relaxed text-stone-500">
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
