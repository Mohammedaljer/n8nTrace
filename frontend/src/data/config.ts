/** Data source configuration */

export type DataMode = "csv" | "api";

export interface DataConfig {
  mode: DataMode;
  apiBaseUrl: string;
}

export function getDataConfig(): DataConfig {
  const mode = (import.meta.env.VITE_DATA_MODE || "csv") as DataMode;
  // Empty string = relative URLs (works with Emergent proxy routing /api to backend)
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  
  return { mode, apiBaseUrl };
}

export function isApiMode(): boolean {
  return getDataConfig().mode === "api";
}
