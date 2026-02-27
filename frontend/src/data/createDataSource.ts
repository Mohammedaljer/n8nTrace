import type { DataSource } from "./DataSource";
import { CsvDataSource } from "./CsvDataSource";
import { ApiDataSource } from "./ApiDataSource";
import { getDataConfig } from "./config";

/**
 * Factory function to create the appropriate DataSource based on configuration.
 */
export function createDataSource(): DataSource {
  const config = getDataConfig();
  
  if (config.mode === "api") {
    console.log(`[DataSource] Using API mode with base URL: ${config.apiBaseUrl}`);
    return new ApiDataSource(config.apiBaseUrl);
  }
  
  console.log("[DataSource] Using CSV mode");
  return new CsvDataSource();
}
