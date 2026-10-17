import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** Granular claims in module:action:scope form, e.g. 'procurement:view:all'. */
  permissions: string[];
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasClaim: (claim: string) => boolean;
  hasAnyClaim: (claims: string[]) => boolean;
}

/**
 * The UI guards routes with page-level claim names while the backend stores
 * module-level claims (e.g. UI 'intake:read' == backend 'procurement:view:all').
 */
const MODULE_ALIASES: Record<string, string> = {
  intake: 'procurement',
  tanks: 'storage',
  batches: 'production',
  shifts: 'production',
  settings: 'master'
};

const ACTION_ALIASES: Record<string, string> = {
  read: 'view',
  create: 'manage'
};

const AUTH_KEY = 'oyaya-auth';

/**
 * Hybrid storage for the "Remember me" option.
 * - Remember me ON  → persists in localStorage (survives browser restarts).
 * - Remember me OFF → sessionStorage only (cleared when the tab closes).
 * Reads check sessionStorage first so a session-scoped login survives reloads.
 */
const hybridStorage = {
  getItem: (key: string): string | null =>
    sessionStorage.getItem(key) ?? localStorage.getItem(key),
  setItem: (key: string, value: string): void => {
    if (sessionStorage.getItem(key) !== null) {
      sessionStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, value);
    }
  },
  removeItem: (key: string): void => {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  }
};

/**
 * Move the persisted auth state between localStorage and sessionStorage
 * according to the user's "Remember me" choice. Call after a successful login.
 */
export function setAuthPersistence(remember: boolean): void {
  const sessionVal = sessionStorage.getItem(AUTH_KEY);
  const localVal = localStorage.getItem(AUTH_KEY);
  if (remember) {
    if (sessionVal !== null) {
      localStorage.setItem(AUTH_KEY, sessionVal);
      sessionStorage.removeItem(AUTH_KEY);
    }
  } else if (localVal !== null) {
    sessionStorage.setItem(AUTH_KEY, localVal);
    localStorage.removeItem(AUTH_KEY);
  }
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      login: async (username: string, password: string) => {
        // Backend expects { email, password }; the login field accepts the user's email.
        const res = await api.post<{ token: string }>(E.login, {
          email: username,
          password
        });
        const token = res.data.token;
        // The login response carries no claims — fetch the full profile explicitly.
        const me = await api.get<{
          id: string;
          email: string;
          name: string;
          role: { id: string; name: string };
          permissions: string[];
        }>(E.me, { headers: { Authorization: `Bearer ${token}` } });
        set({
          token,
          user: {
            id: me.data.id,
            email: me.data.email,
            name: me.data.name,
            role: me.data.role.name,
            permissions: me.data.permissions ?? []
          }
        });
      },
      logout: () => set({ token: null, user: null }),
      hasClaim: (claim: string) => {
        const perms = get().user?.permissions ?? [];
        if (perms.includes('*')) return true;
        // Page-level claim names used by the UI map onto the backend's module
        // vocabulary, and stored codes carry a ':scope' suffix — match by prefix.
        const [mod, action] = claim.split(':');
        const backendMod = MODULE_ALIASES[mod] ?? mod;
        const backendAction = ACTION_ALIASES[action] ?? action;
        const want = `${backendMod}:${backendAction}`;
        return perms.some((p) => p === want || p.startsWith(`${want}:`));
      },
      hasAnyClaim: (claims: string[]) => claims.some((c) => get().hasClaim(c))
    }),
    { name: AUTH_KEY, storage: createJSONStorage(() => hybridStorage) }
  )
);
