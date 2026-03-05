/**
 * Utility functions for formatting metrics values
 */

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatCpuRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "—";
  // CPU rate is typically 0-N where 1 = 100% of one core
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatLatency(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 0.001) return "<1ms";
  if (seconds < 1) return `${(seconds * 1000).toFixed(1)}ms`;
  return `${seconds.toFixed(2)}s`;
}

export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return "—";
  return num.toLocaleString();
}

export function formatUptime(startTimeSeconds: number | null | undefined): string {
  if (startTimeSeconds === null || startTimeSeconds === undefined) return "—";
  
  const nowSeconds = Math.floor(Date.now() / 1000);
  const uptimeSeconds = nowSeconds - startTimeSeconds;
  
  if (uptimeSeconds < 60) return `${uptimeSeconds}s`;
  if (uptimeSeconds < 3600) return `${Math.floor(uptimeSeconds / 60)}m`;
  if (uptimeSeconds < 86400) {
    const hours = Math.floor(uptimeSeconds / 3600);
    const mins = Math.floor((uptimeSeconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

export function formatTimeAgo(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 60) return "just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  } catch {
    return "—";
  }
}
