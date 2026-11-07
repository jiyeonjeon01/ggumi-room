import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, type Me } from '../api/client';

type AuthState =
  | { status: 'loading' }
  | { status: 'guest'; apiDown: boolean }
  | { status: 'user'; me: Me };

export interface SignupForm {
  nickname: string;
  login_id: string;
  password: string;
  password_confirm: string;
  /** Hidden from people (see SignupPage); scripts that fill every field are turned away. */
  website?: string;
  /** 14 or older and agrees to the privacy policy (required). */
  agree: boolean;
}

interface AuthApi {
  state: AuthState;
  me: Me | null;
  login(loginId: string, password: string): Promise<Me>;
  signup(form: SignupForm): Promise<Me>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

/** Session state for the whole app; the session itself is an HttpOnly cookie. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api<{ user: Me | null }>('GET', '/api/auth/session')
      .then((r) => !cancelled && setState(r.user ? { status: 'user', me: r.user } : { status: 'guest', apiDown: false }))
      // Backend unreachable: keep the game playable as a guest demo.
      .catch(() => !cancelled && setState({ status: 'guest', apiDown: true }));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (loginId: string, password: string) => {
    const me = await api<Me>('POST', '/api/auth/login', { login_id: loginId, password });
    setState({ status: 'user', me });
    return me;
  }, []);

  const signup = useCallback(async (form: SignupForm) => {
    const me = await api<Me>('POST', '/api/auth/signup', form);
    setState({ status: 'user', me });
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('POST', '/api/auth/logout');
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500) throw e;
    }
    setState({ status: 'guest', apiDown: false });
  }, []);

  const value = useMemo<AuthApi>(
    () => ({ state, me: state.status === 'user' ? state.me : null, login, signup, logout }),
    [state, login, signup, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
