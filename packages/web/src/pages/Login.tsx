import { useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { Button, Field, TextInput } from '../components/ui';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Trim both fields: phone keyboards often add invisible trailing spaces.
      await login(username.trim(), password.trim());
      navigate(from, { replace: true });
    } catch {
      setError('Invalid username or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-harvest text-3xl font-extrabold text-white">
            O
          </div>
          <h1 className="text-2xl font-extrabold text-white">Oyaya Flour Factory</h1>
          <p className="mt-1 text-sm text-slate-400">Enterprise Resource Planning</p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-white/10 bg-white p-6 shadow-xl md:p-8"
        >
          <h2 className="mb-5 text-lg font-bold text-ink">Sign in</h2>

          <div className="space-y-4">
            <Field label="Username" required>
              <TextInput
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. operator1"
                autoComplete="username"
                required
              />
            </Field>
            <Field label="Password" required>
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                required
              />
            </Field>
          </div>

          {error ? (
            <p className="mt-4 rounded-lg bg-critical-bg px-4 py-3 text-sm font-medium text-critical-text">
              {error}
            </p>
          ) : null}

          <Button type="submit" loading={loading} className="mt-6 w-full text-lg">
            Sign in
          </Button>

          <p className="mt-4 text-center text-xs text-slate-500">
            Works offline — queued entries sync when connectivity returns.
          </p>
        </form>
      </div>
    </div>
  );
}
