/// <reference types="vite/client" />

/** Build-time version string injected by Vite from package.json */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Data source mode: "csv" (default) or "api" */
  readonly VITE_DATA_MODE?: "csv" | "api";
  /** Base URL for API endpoints (used when VITE_DATA_MODE=api) */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
