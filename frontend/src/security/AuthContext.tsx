import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as auth from "@/data/authApi";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: auth.MeResponse["user"]; permissions: string[] };

interface AuthContextValue {
  state: AuthState;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  state: { status: "loading" },
  refresh: async () => {},
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const queryClient = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const r = await auth.me();
      setState({ status: "authenticated", user: r.user, permissions: r.permissions });
    } catch {
      setState({ status: "anonymous" });
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    // Perform login
    await auth.login(email, password);
    
    // Immediately fetch user session
    const r = await auth.me();
    setState({ status: "authenticated", user: r.user, permissions: r.permissions });
    
    // Invalidate all queries to force fresh data fetch with new session
    // This ensures dashboard and other pages load data immediately after login
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const logout = useCallback(async () => {
    await auth.logout();
    setState({ status: "anonymous" });
    // Clear all cached queries on logout
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ state, refresh, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function hasPerm(state: AuthState, perm: string) {
  return state.status === "authenticated" && state.permissions.includes(perm);
}
