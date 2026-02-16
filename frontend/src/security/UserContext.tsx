/**
 * SECURITY NOTICE:
 * This React context provides DEMO-ONLY user session management.
 * It is NOT a real authentication system - the user is selected via UI dropdown.
 * All data is visible in browser dev tools and localStorage.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import type { User, Group, UserAccessContext, Permission } from "./types";
import { buildUserAccessContext, can as canCheck } from "./accessControl";
import {
  seedMockDataIfNeeded,
  loadUsers,
  loadGroups,
} from "@/lib/mockDataStorage";

const STORAGE_KEY = "n8n-demo-user";

interface UserContextValue {
  /** Current user (null if not logged in demo) */
  currentUser: User | null;
  /** Full access context with permissions and scope */
  accessContext: UserAccessContext | null;
  /** All available mock users for the selector */
  availableUsers: readonly User[];
  /** All available mock groups */
  availableGroups: readonly Group[];
  /** Select a different mock user */
  selectUser: (userId: string | null) => void;
  /** Check if current user has a permission */
  can: (permission: Permission) => boolean;
  /** Check if demo mode is active (a user is selected) */
  isDemoMode: boolean;
  /** Reload users and groups from localStorage */
  reloadMockData: () => void;
}

const UserContext = createContext<UserContextValue | null>(null);

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  // Seed mock data on first load
  useEffect(() => {
    seedMockDataIfNeeded();
  }, []);

  const [users, setUsers] = useState<User[]>(() => loadUsers());
  const [groups, setGroups] = useState<Group[]>(() => loadGroups());

  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    // Restore from localStorage on mount
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const loadedUsers = loadUsers();
      if (stored && loadedUsers.some((u) => u.id === stored)) {
        return stored;
      }
      // Default to first user (admin) for initial demo
      return loadedUsers[0]?.id ?? null;
    } catch {
      // Ignore storage errors
      return null;
    }
  });

  const currentUser = useMemo(
    () => users.find((u) => u.id === currentUserId) ?? null,
    [currentUserId, users]
  );

  const accessContext = useMemo(
    () => (currentUser ? buildUserAccessContext(currentUser, groups) : null),
    [currentUser, groups]
  );

  // Persist selection to localStorage
  useEffect(() => {
    try {
      if (currentUserId) {
        localStorage.setItem(STORAGE_KEY, currentUserId);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, [currentUserId]);

  const selectUser = useCallback((userId: string | null) => {
    setCurrentUserId(userId);
  }, []);

  const can = useCallback(
    (permission: Permission): boolean => {
      if (!accessContext) return false;
      return canCheck(accessContext, permission);
    },
    [accessContext]
  );

  const reloadMockData = useCallback(() => {
    setUsers(loadUsers());
    setGroups(loadGroups());
  }, []);

  // Listen for storage changes (for cross-tab sync)
  useEffect(() => {
    const handleStorageChange = () => {
      reloadMockData();
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [reloadMockData]);

  const value: UserContextValue = {
    currentUser,
    accessContext,
    availableUsers: users,
    availableGroups: groups,
    selectUser,
    can,
    isDemoMode: currentUser !== null,
    reloadMockData,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}

/**
 * Hook to get the current user's access context.
 * Returns null if no user is selected.
 */
export function useAccessContext(): UserAccessContext | null {
  const { accessContext } = useUser();
  return accessContext;
}

/**
 * Hook to check a permission for the current user.
 */
export function useCan(permission: Permission): boolean {
  const { can } = useUser();
  return can(permission);
}
