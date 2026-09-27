import type { MeResponse } from "@puente/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, onUnauthorized } from "./api/client";

interface AuthState {
  me: MeResponse | null;
  checking: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch((err: unknown) => {
        if (!(err instanceof ApiError) || err.status !== 401) console.error(err);
      })
      .finally(() => setChecking(false));
    return onUnauthorized(() => setMe(null));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setMe(await api.login({ email, password }));
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setMe(null);
  }, []);

  const value = useMemo(() => ({ me, checking, login, logout }), [me, checking, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export function useIsAdmin(): boolean {
  return useAuth().me?.user.role === "ADMIN";
}
