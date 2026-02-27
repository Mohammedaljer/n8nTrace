import { getDataConfig } from "./config";

const baseUrl = getDataConfig().apiBaseUrl;

export type SetupStatusResponse = { setupRequired: boolean };

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  const res = await fetch(`${baseUrl}/api/setup/status`, { credentials: "include" });
  if (res.status === 503) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Service initializing");
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function createInitialAdmin(body: {
  email: string;
  password: string;
  name?: string;
}): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`${baseUrl}/api/setup/initial-admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }
  return data;
}
