import { getDataConfig } from "./config";

const baseUrl = getDataConfig().apiBaseUrl;

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      credentials: "include",
    });
  } catch {
    throw new Error("Unable to reach the server. Please try again.");
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    // If the response is HTML (e.g. 502 from a reverse proxy), show a friendly message
    if (txt.includes("<html") || txt.includes("<!DOCTYPE")) {
      throw new Error("Server is starting up. Please wait a moment and try again.");
    }
    // Try to parse as JSON error
    try {
      const parsed = JSON.parse(txt);
      throw new Error(parsed.error || `${res.status} ${res.statusText}`);
    } catch (e) {
      if (e instanceof Error && e.message !== txt) throw e;
      throw new Error(txt || `${res.status} ${res.statusText}`);
    }
  }
  return res.json();
}

export type MeResponse = {
  user: { id: string; email: string };
  permissions: string[];
};

export function login(email: string, password: string) {
  return fetchJson<{ ok: boolean }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function logout() {
  return fetchJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export function revokeAllSessions() {
  return fetchJson<{ ok: boolean; message: string }>("/api/auth/revoke-all-sessions", { method: "POST" });
}

export function me() {
  return fetchJson<MeResponse>("/api/auth/me");
}
