/**
 * Metrics Explorer Widget
 *
 * Prometheus-style metrics explorer with:
 * - Auto-visualization based on metric type
 * - Label-based filtering
 * - Time range selection
 * - Aggregation options (gauges only)
 * - Instance scoping via global filter
 * - Searchable metric dropdown
 * - Latest/Range view toggle for gauges
 * - Multi-line graph (one line per label-set)
 */

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

import {
  AlertCircle,
  BarChart3,
  Check,
  ChevronsUpDown,
  HelpCircle,
  Info,
  Lock,
  RefreshCcw,
  Search,
  Server,
  TrendingUp,
} from 'lucide-react';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '@/lib/utils';

type Labels = Record<string, string>;

const LINE_COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#7c3aed',
  '#ea580c',
  '#0891b2',
  '#ca8a04',
  '#db2777',
  '#0f766e',
  '#4f46e5',
  '#65a30d',
  '#be123c',
];

type PresetKey = '5m' | '15m' | '1h' | '6h' | '24h' | '7d' | 'today';

const TIME_PRESETS: Array<{ key: PresetKey; label: string; ms?: number }> = [
  { key: '5m', label: 'Last 5m', ms: 5 * 60 * 1000 },
  { key: '15m', label: 'Last 15m', ms: 15 * 60 * 1000 },
  { key: '1h', label: 'Last 1h', ms: 60 * 60 * 1000 },
  { key: '6h', label: 'Last 6h', ms: 6 * 60 * 60 * 1000 },
  { key: '24h', label: 'Last 24h', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: 'Last 7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: 'today', label: 'Today' },
];

// Helper: Format large numbers compactly
function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(2);
}

function CustomTooltip(props: TooltipProps<number, string>) {
  const { active, payload, label } = props;
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-popover border rounded-lg shadow-lg p-2 text-sm">
      <p className="text-muted-foreground mb-1">{String(label ?? '')}</p>

      <div className="space-y-1">
        {payload.map((entry, index) => {
          const name = String(entry.name ?? entry.dataKey ?? 'value');
          const value = entry.value;

          return (
            <div key={`${name}-${index}`} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-xs font-mono">{name}</span>
              </div>
              <span className="text-xs tabular-nums">
                {typeof value === 'number' ? formatCompactNumber(value) : String(value ?? '')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Helper: Get metric type badge color and hint
function getMetricTypeInfo(type: string | null) {
  switch (type) {
    case 'counter':
      return {
        variant: 'default' as const,
        hint: 'Cumulative value that only increases (or resets)',
        recommendation: 'Use rate/increase for per-interval values',
      };
    case 'gauge':
      return {
        variant: 'secondary' as const,
        hint: 'Current value that can go up or down',
        recommendation: 'Shows instantaneous measurements',
      };
    case 'histogram':
      return {
        variant: 'outline' as const,
        hint: 'Distribution of values across buckets',
        recommendation: 'Shows quantiles and distributions',
      };
    case 'summary':
      return {
        variant: 'outline' as const,
        hint: 'Pre-calculated quantiles',
        recommendation: 'Shows percentiles (p50, p95, p99)',
      };
    default:
      return {
        variant: 'secondary' as const,
        hint: 'Unknown metric type',
        recommendation: '',
      };
  }
}

interface MetricsExplorerProps {
  instanceId?: string;
  className?: string;
}

interface MetricsCatalogItem {
  metricName: string;
  metricType: 'counter' | 'gauge' | 'histogram' | 'summary';
  helpText?: string;
  unit?: string;
  seriesCount: number;
  lastSeen: string;
  availableLabels: Record<string, string[]>;
}

// ----- Normalized API response types (no any) -----

interface LinePoint {
  ts: string;
  value: number | null;
}

interface LineSeries {
  labels: Labels;
  points: LinePoint[];
}

type NormalizedResult =
  | { kind: 'empty' }
  | { kind: 'card'; value: number | string | null; ts: string | null }
  | { kind: 'breakdown'; rows: Array<{ key: string; value: number | string | null }> }
  | { kind: 'line'; series: LineSeries[] };

interface NormalizedQueryResult {
  metricName: string;
  meta: { metricType: string | null; help: string | null };
  result: NormalizedResult;
  stats: { seriesMatched: number; samplesReturned: number; maxDatapoints: number };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function getNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function getLabels(v: unknown): Labels {
  if (!isRecord(v)) return {};
  const out: Labels = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

function normalizeLineSeries(seriesUnknown: unknown): LineSeries[] {
  if (!Array.isArray(seriesUnknown)) return [];

  const series: LineSeries[] = [];
  for (const s of seriesUnknown) {
    if (!isRecord(s)) continue;

    const labels = getLabels(s.labels);
    const pointsRaw = s.points;

    const points: LinePoint[] = [];
    if (Array.isArray(pointsRaw)) {
      for (const p of pointsRaw) {
        if (!isRecord(p)) continue;
        const ts = getString(p.ts);
        if (!ts) continue;

        const valNum = getNumber(p.value);
        points.push({ ts, value: valNum });
      }
    }

    series.push({ labels, points });
  }

  return series;
}

function normalizeQueryResponse(data: unknown, selectedMetric: string): NormalizedQueryResult {
  if (!isRecord(data)) {
    return {
      metricName: selectedMetric,
      meta: { metricType: null, help: null },
      result: { kind: 'empty' },
      stats: { seriesMatched: 0, samplesReturned: 0, maxDatapoints: 1000 },
    };
  }

  const metaObj = isRecord(data.meta) ? data.meta : null;
  const meta = {
    metricType: getString(metaObj?.metricType) ?? getString(data.metricType),
    help: getString(metaObj?.help) ?? getString(data.helpText),
  };

  const statsObj = isRecord(data.stats) ? data.stats : null;
  const stats = {
    seriesMatched: getNumber(statsObj?.seriesMatched) ?? 0,
    samplesReturned: getNumber(statsObj?.samplesReturned) ?? 0,
    maxDatapoints: getNumber(statsObj?.maxDatapoints) ?? 1000,
  };

  const metricName = getString(data.metricName) ?? selectedMetric;

  // "result" may be nested or the object itself may represent the result
  const rawResult: unknown = data.result ?? data;

  // Guard: rawResult must be an object to read "kind"
  const rr = isRecord(rawResult) ? rawResult : null;
  const kind = getString(rr?.kind);

  if (kind === 'card') {
    const value = getNumber(rr?.value) ?? getString(rr?.value) ?? null;
    const ts = getString(rr?.ts);
    return { metricName, meta, result: { kind: 'card', value, ts }, stats };
  }

  if (kind === 'breakdown') {
    const rowsRaw = rr?.rows;
    const rows: Array<{ key: string; value: number | string | null }> = [];

    if (Array.isArray(rowsRaw)) {
      for (const r of rowsRaw) {
        if (!isRecord(r)) continue;
        const key = getString(r.key) ?? 'unknown';
        const val = getNumber(r.value) ?? getString(r.value) ?? null;
        rows.push({ key, value: val });
      }
    }

    return { metricName, meta, result: { kind: 'breakdown', rows }, stats };
  }

  if (kind === 'line') {
    const series = normalizeLineSeries(rr?.series);
    return { metricName, meta, result: { kind: 'line', series }, stats };
  }

  return { metricName, meta, result: { kind: 'empty' }, stats };
}

export function MetricsExplorer({ instanceId, className }: MetricsExplorerProps) {
  const [catalog, setCatalog] = useState<MetricsCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [selectedMetric, setSelectedMetric] = useState<string>('');
  const [labelFilters, setLabelFilters] = useState<Record<string, string>>({});
  const [aggregation, setAggregation] = useState<'none' | 'sum' | 'avg' | 'max'>('avg');
  const [groupByLabel, setGroupByLabel] = useState<string>('');

  // Gauge view mode: 'latest' (card) or 'range' (line/timeseries)
  const [gaugeViewMode, setGaugeViewMode] = useState<'latest' | 'range'>('range');

  const [queryResult, setQueryResult] = useState<NormalizedQueryResult | null>(null);
  const [querying, setQuerying] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  const [activePreset, setActivePreset] = useState<PresetKey | null>('24h');

  // Time range (default: last 24 hours)
  const [timeRange, setTimeRange] = useState(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    return {
      from: format(from, "yyyy-MM-dd'T'HH:mm"),
      to: format(to, "yyyy-MM-dd'T'HH:mm"),
    };
  });

  const applyPreset = (key: PresetKey) => {
    const now = new Date();

    if (key === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      setTimeRange({
        from: format(start, "yyyy-MM-dd'T'HH:mm"),
        to: format(now, "yyyy-MM-dd'T'HH:mm"),
      });
    } else {
      const preset = TIME_PRESETS.find((p) => p.key === key);
      const ms = preset?.ms ?? 24 * 60 * 60 * 1000;
      const from = new Date(now.getTime() - ms);
      setTimeRange({
        from: format(from, "yyyy-MM-dd'T'HH:mm"),
        to: format(now, "yyyy-MM-dd'T'HH:mm"),
      });
    }

    setActivePreset(key);
  };

  // Determine if selected metric is a gauge
  const selectedMetricData = useMemo(() => {
    return catalog.find((m) => m.metricName === selectedMetric);
  }, [catalog, selectedMetric]);

  const isGauge = useMemo(() => {
    if (!selectedMetricData) return false;
    const type = selectedMetricData.metricType;
    // Histogram suffixes are treated as counters
    if (
      selectedMetric.endsWith('_sum') ||
      selectedMetric.endsWith('_count') ||
      selectedMetric.endsWith('_bucket')
    ) {
      return false;
    }
    return type === 'gauge';
  }, [selectedMetricData, selectedMetric]);

  // Load catalog when instance changes
  useEffect(() => {
    // Reset state when instance changes
    setSelectedMetric('');
    setLabelFilters({});
    setQueryResult(null);
    setQueryError(null);
    setCatalogError(null);

    if (!instanceId || instanceId === 'all') {
      setCatalog([]);
      return;
    }

    const fetchCatalog = async () => {
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const response = await fetch(`/api/metrics/catalog?instanceId=${encodeURIComponent(instanceId)}`, {
          credentials: 'include',
        });

        if (!response.ok) {
          if (response.status === 403) throw new Error('No permission to access metrics');
          throw new Error(`HTTP ${response.status}`);
        }

        const data: unknown = await response.json();

        if (Array.isArray(data)) {
          // best-effort runtime shape check
          setCatalog(data as MetricsCatalogItem[]);
        } else {
          setCatalog([]);
        }
      } catch (err) {
        console.error('Catalog fetch error:', err);
        setCatalogError(err instanceof Error ? err.message : 'Failed to load catalog');
        setCatalog([]);
      } finally {
        setCatalogLoading(false);
      }
    };

    fetchCatalog();
  }, [instanceId]);

  // Get selected metric metadata
  const selectedMetricMetadata = useMemo(() => {
    return catalog.find((m) => m.metricName === selectedMetric);
  }, [catalog, selectedMetric]);

  // Handle label filter change
  const handleLabelFilterChange = (labelKey: string, value: string) => {
    setLabelFilters((prev) => {
      const next = { ...prev };
      if (value) next[labelKey] = value;
      else delete next[labelKey];
      return next;
    });
  };

  // Query metrics
  const handleQuery = async () => {
    if (!instanceId || !selectedMetric) return;

    setQuerying(true);
    setQueryError(null);

    try {
      let viewMode: 'line' | 'card' = 'line';
      if (isGauge) viewMode = gaugeViewMode === 'latest' ? 'card' : 'line';

      const body: Record<string, unknown> = {
        instanceId,
        metricName: selectedMetric,
        filters: labelFilters,
        from: new Date(timeRange.from).toISOString(),
        to: new Date(timeRange.to).toISOString(),
        view: viewMode,
        groupByLabel: groupByLabel || null,
      };

      // Only include aggregation for gauges in range mode
      if (isGauge && gaugeViewMode === 'range') {
        body.aggregation = aggregation;
      }

      const response = await fetch('/api/metrics/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        if (response.status === 403) throw new Error('No permission to query metrics');
        throw new Error(`HTTP ${response.status}`);
      }

      const rawData: unknown = await response.json();

      if (import.meta.env.DEV) {

        console.log('[MetricsExplorer] Raw API response:', rawData);
      }

      const normalized = normalizeQueryResponse(rawData, selectedMetric);

      if (import.meta.env.DEV) {

        console.log('[MetricsExplorer] Normalized response:', normalized);
      }

      setQueryResult(normalized);
    } catch (err) {

      console.error('Query error:', err);
      setQueryError(err instanceof Error ? err.message : 'Query failed');
      setQueryResult(null);
    } finally {
      setQuerying(false);
    }
  };

  // Render visualization based on result kind
  const renderVisualization = () => {
    if (!queryResult) return null;

    const { meta, result, metricName } = queryResult;
    const kind = result.kind;

    // Empty result
    if (kind === 'empty') {
      return (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No data available for the selected time range</p>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Card view - single value
    if (kind === 'card' || (isGauge && gaugeViewMode === 'latest' && kind === 'line')) {
      let value: number | string | null = null;
      let ts: string | null = null;

      if (kind === 'card') {
        value = result.value ?? null;
        ts = result.ts ?? null;
      } else {

        type Point = { ts: string; value: number | null };
        const points: Point[] = result.series.flatMap((s) => s.points);

        if (points.length > 0) {
          const latest = points.reduce<Point | null>((best, p) => {
            if (!p.ts) return best;
            if (!best) return p;
            return new Date(p.ts).getTime() > new Date(best.ts).getTime() ? p : best;
          }, null);

          value = latest?.value ?? null;
          ts = latest?.ts ?? null;
        }
      }

      const formattedValue =
        value !== null && value !== undefined
          ? typeof value === 'number'
            ? formatCompactNumber(value)
            : String(value)
          : 'N/A';

      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{metricName || 'Metric'}</CardTitle>
            {meta.help && <CardDescription>{meta.help}</CardDescription>}
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-3xl font-bold">{formattedValue}</div>
              {ts && (
                <div className="text-xs text-muted-foreground">
                  Last updated: {format(new Date(ts), 'MMM dd, HH:mm:ss')}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      );
    }

    // Breakdown view - label aggregation
    if (kind === 'breakdown') {
      const rows = result.rows ?? [];
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Breakdown: {metricName || 'Metric'}</CardTitle>
            {meta.help && <CardDescription>{meta.help}</CardDescription>}
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <p>No data available</p>
              </div>
            ) : (
              <div className="space-y-2">
                {rows.map((row, idx) => (
                  <div
                    key={`${row.key}-${idx}`}
                    className="flex justify-between items-center py-2 border-b last:border-b-0"
                  >
                    <span className="font-mono text-sm truncate max-w-[60%]">{row.key ?? 'unknown'}</span>
                    <span className="font-semibold tabular-nums">
                      {typeof row.value === 'number'
                        ? formatCompactNumber(row.value)
                        : String(row.value ?? 'N/A')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      );
    }

    // Line view - multi-series time series
    if (kind === 'line') {
      const series = result.series || [];

      const hasData = series.some((s) => Array.isArray(s.points) && s.points.length > 0);
      if (!hasData) {
        return (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center text-muted-foreground">
                <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No data available for the selected time range</p>
              </div>
            </CardContent>
          </Card>
        );
      }

      // 1) Stable keys for each series
      const seriesList = series.map((s) => {
        const labels = s.labels || {};
        const key =
          Object.keys(labels).length === 0
            ? 'value'
            : Object.entries(labels)
                .map(([k, v]) => `${k}=${v}`)
                .join(',');
        return { key, labels, points: s.points };
      });

      // 2) Pivot points by timestamp => one row per timestamp containing values for each series key
        type ChartRow = {
          rawTs: number;
          timestamp: string;
          [key: string]: number | null | string;
        };

const byTs = new Map<number, ChartRow>();

      for (const s of seriesList) {
        for (const p of s.points) {
          const t = new Date(p.ts).getTime();
          if (Number.isNaN(t)) continue;

          if (!byTs.has(t)) {
            byTs.set(t, {
              rawTs: t,
              timestamp: format(new Date(t), 'MMM dd HH:mm'),
            });
          }

          const row = byTs.get(t);
          if (!row) continue;
          row[s.key] = p.value;
        }
      }

      const chartData = Array.from(byTs.values()).sort((a, b) => a.rawTs - b.rawTs);

      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{metricName || 'Metric'}</CardTitle>
            {meta.help && <CardDescription>{meta.help}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                <XAxis
                  dataKey="timestamp"
                  tick={{ fontSize: 11 }}
                  tickMargin={8}
                  interval="preserveStartEnd"
                  minTickGap={50}
                  angle={-15}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => (typeof value === 'number' ? formatCompactNumber(value) : String(value))}
                  width={60}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                {seriesList.map((s, idx) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stroke={LINE_COLORS[idx % LINE_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    name={s.key}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      );
    }

    // Fallback (should not happen)
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center text-muted-foreground">
            <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Unsupported visualization type</p>
          </div>
        </CardContent>
      </Card>
    );
  };

  // If no instance selected or "all instances"
  if (!instanceId || instanceId === 'all') {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Metrics Explorer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <Info className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium">Select a single instance to view metrics</p>
              <p className="text-sm text-muted-foreground">Use the Instance dropdown above to choose an instance</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Permission error
  if (catalogError === 'No permission to access metrics') {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Metrics Explorer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <Lock className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium">No metrics permission</p>
              <p className="text-sm text-muted-foreground">Contact an administrator to request access</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            <CardTitle>Metrics Explorer</CardTitle>
          </div>
          {instanceId && instanceId !== 'all' && (
            <Badge variant="outline" className="flex items-center gap-1">
              <Server className="h-3 w-3" />
              Instance: {instanceId}
            </Badge>
          )}
        </div>
        <CardDescription>Query Prometheus-style metrics with labels and time ranges</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Loading catalog */}
        {catalogLoading && (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {/* Catalog error */}
        {catalogError && catalogError !== 'No permission to access metrics' && (
          <div className="flex items-center gap-3 text-destructive bg-destructive/10 p-3 rounded-lg">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">Failed to load metrics: {catalogError}</p>
          </div>
        )}

        {/* Metric selection */}
        {!catalogLoading && catalog.length > 0 && (
          <div className="space-y-4">
            {/* Metric selector - Searchable Combobox */}
            <div className="space-y-2">
              <Label>Select Metric</Label>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-mono text-sm"
                    data-testid="metric-selector-trigger"
                  >
                    {selectedMetric
                      ? catalog.find((m) => m.metricName === selectedMetric)?.metricName
                      : 'Search metrics...'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>

                <PopoverContent className="w-[400px] p-0 overflow-visible" align="start">
                  <Command>
                    <CommandInput placeholder="Type to search metrics..." data-testid="metric-search-input" aria-label="Search metrics" />
                    <CommandList>
                      <CommandEmpty>No metric found.</CommandEmpty>
                      <CommandGroup>
                        {catalog.map((metric) => (
                          <CommandItem
                            key={metric.metricName}
                            value={metric.metricName}
                            onSelect={(value) => setSelectedMetric(value)}
                            data-testid={`metric-item-${metric.metricName}`}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                selectedMetric === metric.metricName ? 'opacity-100' : 'opacity-0',
                              )}
                            />
                            <div className="flex items-center justify-between w-full gap-2">
                              <span className="font-mono text-sm truncate">{metric.metricName}</span>
                              <span className="text-xs text-muted-foreground shrink-0">
                                ({metric.metricType})
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {/* Show metric type badge and hint */}
              {selectedMetricMetadata && (
                <div className="flex items-start gap-2 p-2 bg-muted/30 rounded-md">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={getMetricTypeInfo(selectedMetricMetadata.metricType).variant}>
                      Type: {selectedMetricMetadata.metricType || 'unknown'}
                    </Badge>

                    <TooltipProvider>
                      <UITooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="font-semibold mb-1">
                            {getMetricTypeInfo(selectedMetricMetadata.metricType).hint}
                          </p>
                          {getMetricTypeInfo(selectedMetricMetadata.metricType).recommendation && (
                            <p className="text-xs text-muted-foreground">
                              💡 {getMetricTypeInfo(selectedMetricMetadata.metricType).recommendation}
                            </p>
                          )}
                        </TooltipContent>
                      </UITooltip>
                    </TooltipProvider>
                  </div>
                </div>
              )}

              {selectedMetricMetadata?.helpText && (
                <p className="text-xs text-muted-foreground">{selectedMetricMetadata.helpText}</p>
              )}
            </div>

            {/* Gauge View Mode Toggle - Only for Gauge metrics */}
            {isGauge && (
              <div className="space-y-2">
                <Label>Gauge View</Label>
                <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
                  <Button
                    variant={gaugeViewMode === 'latest' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setGaugeViewMode('latest')}
                    className="px-4"
                    data-testid="gauge-view-latest"
                  >
                    Latest
                  </Button>
                  <Button
                    variant={gaugeViewMode === 'range' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setGaugeViewMode('range')}
                    className="px-4"
                    data-testid="gauge-view-range"
                  >
                    Range
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {gaugeViewMode === 'latest' ? 'Shows current value as a card' : 'Shows time series chart'}
                </p>
              </div>
            )}

            {/* Label filters */}
            {selectedMetricMetadata && Object.keys(selectedMetricMetadata.availableLabels ?? {}).length > 0 && (
              <div className="space-y-3">
                <Label>Label Filters (optional)</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(selectedMetricMetadata.availableLabels ?? {}).map(([labelKey, values]) => (
                    <div key={labelKey} className="space-y-1">
                      <Label className="text-xs font-mono">{labelKey}</Label>
                      <Select
                        value={labelFilters[labelKey] || ''}
                        onValueChange={(val) => handleLabelFilterChange(labelKey, val)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Any" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[200px]">
                          <SelectItem value="">Any</SelectItem>
                          {(Array.isArray(values) ? values : []).map((val) => (
                            <SelectItem key={val} value={val}>
                              {val}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Aggregation - Only for Gauge in Range mode */}
            {isGauge && gaugeViewMode === 'range' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Aggregation</Label>
                  <Select value={aggregation} onValueChange={(val) => setAggregation(val as typeof aggregation)}>
                    <SelectTrigger data-testid="aggregation-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="avg">Average</SelectItem>
                      <SelectItem value="max">Maximum</SelectItem>
                      <SelectItem value="sum">Sum</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {selectedMetricMetadata && Object.keys(selectedMetricMetadata.availableLabels ?? {}).length > 0 && (
                  <div className="space-y-2">
                    <Label>Group By Label (optional)</Label>
                    <Select value={groupByLabel} onValueChange={setGroupByLabel}>
                      <SelectTrigger>
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {Object.keys(selectedMetricMetadata.availableLabels ?? {}).map((key) => (
                          <SelectItem key={key} value={key}>
                            {key}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {/* Time range - Hide for Gauge + Latest mode */}
            {!(isGauge && gaugeViewMode === 'latest') && (
              <div className="space-y-3">
                <Label>Time Range</Label>

                {/* Quick time buttons */}
                <div className="flex flex-wrap gap-2">
                  {TIME_PRESETS.map((p) => (
                    <Button
                      key={p.key}
                      variant={activePreset === p.key ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => applyPreset(p.key)}
                    >
                      {p.label}
                    </Button>
                  ))}

                  {/* Now button - updates To time to current moment */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const now = new Date();
                      setTimeRange((prev) => ({
                        ...prev,
                        to: format(now, "yyyy-MM-dd'T'HH:mm"),
                      }));
                      setActivePreset(null);
                    }}
                    data-testid="now-button"
                  >
                    <RefreshCcw className="mr-1 h-3 w-3" />
                    Now
                  </Button>
                </div>

                {/* Manual datetime inputs */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input
                      type="datetime-local"
                      value={timeRange.from}
                      onChange={(e) => {
                        setActivePreset(null);
                        setTimeRange((prev) => ({ ...prev, from: e.target.value }));
                      }}
                      className="dark:[color-scheme:dark]"
                      data-testid="time-from-input"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input
                      type="datetime-local"
                      value={timeRange.to}
                      onChange={(e) => {
                        setActivePreset(null);

                        const next = e.target.value; // yyyy-MM-ddTHH:mm

                        setTimeRange((prev) => {
                          const prevVal = prev.to || '';
                          const [prevDate = '', prevTime = ''] = prevVal.split('T');
                          const [nextDate = '', nextTime = ''] = next.split('T');

                          const now = new Date();
                          const hh = String(now.getHours()).padStart(2, '0');
                          const mm = String(now.getMinutes()).padStart(2, '0');
                          const nowTime = `${hh}:${mm}`;

                          const dateChanged = prevDate && nextDate && prevDate !== nextDate;
                          const timeUnchanged = prevTime && nextTime && prevTime === nextTime;

                          // If picker set midnight OR date changed but time stayed the same -> treat as "date-only" selection
                          if (nextTime === '00:00' || (dateChanged && timeUnchanged)) {
                            return { ...prev, to: `${nextDate}T${nowTime}` };
                          }

                          return { ...prev, to: next };
                        });
                      }}
                      className="dark:[color-scheme:dark]"
                      data-testid="time-to-input"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Query button */}
            <Button
              onClick={handleQuery}
              disabled={!selectedMetric || querying}
              className="w-full"
              data-testid="query-metrics-button"
            >
              <Search className="mr-2 h-4 w-4" />
              {querying ? 'Querying...' : 'Query Metrics'}
            </Button>
          </div>
        )}

        {/* No metrics available */}
        {!catalogLoading && catalog.length === 0 && !catalogError && (
          <div className="text-center text-muted-foreground py-8">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No metrics available for this instance</p>
          </div>
        )}

        {/* Query error */}
        {queryError && (
          <div className="flex items-center gap-3 text-destructive bg-destructive/10 p-3 rounded-lg">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">{queryError}</p>
          </div>
        )}

        {/* Results visualization */}
        {queryResult && !querying && (
          <div className="space-y-4">
            {renderVisualization()}

            {/* Stats - computed from actual result data, hidden for card view */}
            {queryResult.result.kind !== 'card' && (
              <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
                <div className="grid grid-cols-2 gap-2">
                  <div data-testid="stats-series">
                    <span className="font-medium">Series:</span>{' '}
                    {(() => {
                      const r = queryResult.result;
                      if (r.kind === 'line') return r.series.length;
                      if (r.kind === 'breakdown') return r.rows.length;
                      return 0;
                    })()}
                  </div>

                  <div data-testid="stats-samples">
                    <span className="font-medium">Samples:</span>{' '}
                    {(() => {
                      const r = queryResult.result;
                      if (r.kind === 'line') {
                        return r.series.reduce((acc, s) => acc + s.points.length, 0);
                      }
                      if (r.kind === 'breakdown') return r.rows.length;
                      return 0;
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}