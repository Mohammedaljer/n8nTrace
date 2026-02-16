/**
 * SECURITY NOTICE:
 * This module provides localStorage persistence for DEMO-ONLY mock users and groups.
 * All data is visible in browser dev tools. This is NOT a security boundary.
 */

import type { User, Group } from "@/security/types";
import { MOCK_USERS, MOCK_GROUPS } from "@/security/mockUsers";

const STORAGE_KEYS = {
  users: "n8n-demo-mock-users",
  groups: "n8n-demo-mock-groups",
  initialized: "n8n-demo-data-initialized",
} as const;

// ===== Initialization =====

/**
 * Seeds localStorage with default mock data if not already initialized.
 * Returns true if seeding occurred.
 */
export function seedMockDataIfNeeded(): boolean {
  try {
    const initialized = localStorage.getItem(STORAGE_KEYS.initialized);
    if (initialized === "true") {
      return false;
    }

    // Seed with default data
    localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(MOCK_USERS));
    localStorage.setItem(STORAGE_KEYS.groups, JSON.stringify(MOCK_GROUPS));
    localStorage.setItem(STORAGE_KEYS.initialized, "true");
    return true;
  } catch {
    console.warn("Failed to seed mock data to localStorage");
    return false;
  }
}

/**
 * Resets all mock data to defaults.
 */
export function resetMockData(): void {
  try {
    localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(MOCK_USERS));
    localStorage.setItem(STORAGE_KEYS.groups, JSON.stringify(MOCK_GROUPS));
    localStorage.setItem(STORAGE_KEYS.initialized, "true");
  } catch {
    console.warn("Failed to reset mock data");
  }
}

// ===== Users CRUD =====

export function loadUsers(): User[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.users);
    if (stored) {
      return JSON.parse(stored) as User[];
    }
  } catch {
    console.warn("Failed to load users from localStorage");
  }
  return [...MOCK_USERS];
}

export function saveUsers(users: User[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(users));
  } catch {
    console.warn("Failed to save users to localStorage");
  }
}

export function addUser(user: User): User[] {
  const users = loadUsers();
  const updated = [...users, user];
  saveUsers(updated);
  return updated;
}

export function updateUser(userId: string, updates: Partial<User>): User[] {
  const users = loadUsers();
  const updated = users.map((u) =>
    u.id === userId ? { ...u, ...updates } : u
  );
  saveUsers(updated);
  return updated;
}

export function deleteUser(userId: string): User[] {
  const users = loadUsers();
  const updated = users.filter((u) => u.id !== userId);
  saveUsers(updated);
  return updated;
}

// ===== Groups CRUD =====

export function loadGroups(): Group[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.groups);
    if (stored) {
      return JSON.parse(stored) as Group[];
    }
  } catch {
    console.warn("Failed to load groups from localStorage");
  }
  return [...MOCK_GROUPS];
}

export function saveGroups(groups: Group[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.groups, JSON.stringify(groups));
  } catch {
    console.warn("Failed to save groups to localStorage");
  }
}

export function addGroup(group: Group): Group[] {
  const groups = loadGroups();
  const updated = [...groups, group];
  saveGroups(updated);
  return updated;
}

export function updateGroup(groupId: string, updates: Partial<Group>): Group[] {
  const groups = loadGroups();
  const updated = groups.map((g) =>
    g.id === groupId ? { ...g, ...updates } : g
  );
  saveGroups(updated);
  return updated;
}

export function deleteGroup(groupId: string): Group[] {
  const groups = loadGroups();
  const updated = groups.filter((g) => g.id !== groupId);
  saveGroups(updated);
  return updated;
}

// ===== Helpers =====

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
