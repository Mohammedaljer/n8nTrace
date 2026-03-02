const { 
  METRICS_MAX_DATAPOINTS,
  METRICS_MAX_BREAKDOWN_ROWS,
  METRICS_MAX_CATALOG_SIZE,
  METRICS_MAX_LABEL_VALUES
} = require('../config');
const { labelsHash } = require('../utils/labels');
const { parseAndClampTimeRange } = require('../utils/timeRange');

/**
 * Metrics Explorer Service
 * 
 * Implements Prometheus-style metrics querying with proper semantics:
 * - Gauge: raw values
 * - Counter: delta per bucket (rate-like), handle resets
 * - Histogram: simple mode (average from _sum/_count)
 * - Summary: quantile values
 */

/**
 * Get metrics catalog for an instance
 * Returns list of available metrics with metadata
 * 
 * @param {object} pool - PostgreSQL pool
 * @param {string} instanceId - Instance ID to query
 * @param {number} limit - Maximum number of metrics to return (default METRICS_MAX_CATALOG_SIZE)
 * @returns {Promise<Array>} List of metrics with metadata
 */
async function getMetricsCatalog(pool, instanceId, limit = METRICS_MAX_CATALOG_SIZE) {
  // Enforce max catalog size
  const effectiveLimit = Math.min(limit, METRICS_MAX_CATALOG_SIZE);
  
  // Use LEFT JOIN LATERAL to handle metrics with empty labels (labels = '{}')
  // jsonb_object_keys() returns zero rows for empty objects, so we need LATERAL + LEFT JOIN
  // to ensure those metrics are still included in the catalog
  const query = `
    WITH all_series AS (
      SELECT DISTINCT metric_name, metric_type, help, labels
      FROM metrics_series
      WHERE instance_id = $1
    ),
    expanded AS (
      SELECT 
        s.metric_name,
        s.metric_type,
        s.help,
        k.label_key
      FROM all_series s
      LEFT JOIN LATERAL jsonb_object_keys(s.labels) AS k(label_key) ON true
    )
    SELECT 
      metric_name as "metricName",
      MAX(metric_type) as "metricType",
      MAX(help) as "help",
      COALESCE(array_agg(DISTINCT label_key) FILTER (WHERE label_key IS NOT NULL), '{}') as "labelKeys",
      COUNT(DISTINCT label_key) > 0 as "hasLabels"
    FROM expanded
    GROUP BY metric_name
    ORDER BY metric_name ASC
    LIMIT $2
  `;

  const result = await pool.query(query, [instanceId, effectiveLimit]);
  return result.rows;
}

/**
 * Query metric time-series data with Prometheus semantics
 * 
 * Recommendation C: Histogram suffix metrics (_sum, _count, _bucket) are treated as counters.
 * This means they use delta/rate semantics rather than raw avg/sum/max.
 * 
 * @param {object} pool - PostgreSQL pool
 * @param {object} options - Query options
 * @returns {Promise<object>} Query result with proper format
 */
async function queryMetricTimeseries(pool, options) {
  const {
    instanceId,
    metricName,
    from,
    to,
    view = 'auto',
    groupByLabel = null,
    filters = {},
    aggregation = 'avg'  // Default to avg for backwards compatibility
  } = options;

  // Validate aggregation parameter
  const validAggregations = ['none', 'sum', 'avg', 'max'];
  const effectiveAggregation = validAggregations.includes(aggregation) ? aggregation : 'avg';
  // 'none' behaves like 'avg' to maintain datapoint limits
  const sqlAggregation = effectiveAggregation === 'none' ? 'avg' : effectiveAggregation;

  // Parse and clamp time range
  const { fromDate, toDate } = parseAndClampTimeRange(from, to);

  // Build label filter WHERE clause
  const labelConditions = [];
  const labelParams = [];
  let paramIndex = 3; // Start after instanceId, metricName

  for (const [key, value] of Object.entries(filters)) {
    const filterLabels = { [key]: value };
    // Use labels @> for containment check
    labelConditions.push(`labels @> $${paramIndex}::jsonb`);
    labelParams.push(JSON.stringify(filterLabels));
    paramIndex++;
  }

  const labelWhere = labelConditions.length > 0 
    ? `AND ${labelConditions.join(' AND ')}` 
    : '';

  // Query 1: Get matching series
  const seriesQuery = `
    SELECT 
      id,
      metric_name,
      metric_type,
      labels,
      help
    FROM metrics_series
    WHERE instance_id = $1
      AND metric_name = $2
      ${labelWhere}
    ORDER BY id ASC
  `;

  const seriesParams = [instanceId, metricName, ...labelParams];
  const seriesResult = await pool.query(seriesQuery, seriesParams);

  if (seriesResult.rows.length === 0) {
    return {
      meta: {
        metricType: null,
        help: null,
        computedAs: null
      },
      result: determineViewKind(view, null, false, groupByLabel) === 'card'
        ? { kind: 'card', value: null, ts: null }
        : { kind: 'line', series: [] }
    };
  }

  const series = seriesResult.rows;
  const seriesIds = series.map(s => s.id);
  let metricType = series[0].metric_type;
  const help = series[0].help;

  // Recommendation C: Treat histogram suffix metrics as counters
  // _sum, _count, _bucket are all cumulative counters in Prometheus
  const isHistogramSuffix = metricName.endsWith('_sum') || 
                            metricName.endsWith('_count') || 
                            metricName.endsWith('_bucket');
  
  if (isHistogramSuffix && metricType !== 'counter') {
    metricType = 'counter';  // Force counter semantics for histogram suffixes
  }

  // Determine actual view kind
  const viewKind = determineViewKind(view, metricType, series.length > 1, groupByLabel);

  // Query samples based on view kind
  if (viewKind === 'card') {
    return await queryCardView(pool, seriesIds, fromDate, toDate, metricType, help, sqlAggregation);
  } else if (viewKind === 'breakdown') {
    return await queryBreakdownView(pool, instanceId, metricName, groupByLabel, fromDate, toDate, filters, metricType, help, sqlAggregation);
  } else {
    // line view
    return await queryLineView(pool, seriesIds, series, fromDate, toDate, metricType, help, sqlAggregation);
  }
}

/**
 * Determine the actual view kind based on request and data
 */
function determineViewKind(requestedView, metricType, hasMultipleSeries, groupByLabel) {
  if (requestedView === 'card') return 'card';
  if (requestedView === 'breakdown') return 'breakdown';
  if (requestedView === 'line') return 'line';
  
  // Auto mode
  if (groupByLabel) return 'breakdown';
  if (!hasMultipleSeries && metricType === 'gauge') return 'card';
  return 'line';
}

/**
 * Query card view - single latest value
 * 
 * For gauges: Returns last value (default) or aggregated value based on mode
 * For counters: Returns rate (increase per second over time range)
 * 
 * @param {string} aggregation - For gauges: 'last', 'avg', 'max', 'min'. Ignored for counters.
 */
async function queryCardView(pool, seriesIds, fromDate, toDate, metricType, help, aggregation = 'avg') {
  // For counters, compute rate instead of raw value
  const isCounter = metricType === 'counter';
  
  if (isCounter) {
    // Get first and last samples for rate calculation
    const query = `
      WITH first_last AS (
        SELECT 
          (SELECT value FROM metrics_samples 
           WHERE series_id = ANY($1::uuid[]) AND ts >= $2 AND ts <= $3 
           ORDER BY ts ASC LIMIT 1) as first_value,
          (SELECT value FROM metrics_samples 
           WHERE series_id = ANY($1::uuid[]) AND ts >= $2 AND ts <= $3 
           ORDER BY ts DESC LIMIT 1) as last_value,
          (SELECT ts FROM metrics_samples 
           WHERE series_id = ANY($1::uuid[]) AND ts >= $2 AND ts <= $3 
           ORDER BY ts ASC LIMIT 1) as first_ts,
          (SELECT ts FROM metrics_samples 
           WHERE series_id = ANY($1::uuid[]) AND ts >= $2 AND ts <= $3 
           ORDER BY ts DESC LIMIT 1) as last_ts
      )
      SELECT * FROM first_last
    `;
    
    const result = await pool.query(query, [seriesIds, fromDate.toISOString(), toDate.toISOString()]);
    
    if (result.rows.length === 0 || result.rows[0].first_value === null) {
      return {
        meta: { metricType, help, computedAs: 'rate' },
        result: { kind: 'card', value: null, ts: null }
      };
    }
    
    const { first_value, last_value, first_ts, last_ts } = result.rows[0];
    const durationSec = (new Date(last_ts) - new Date(first_ts)) / 1000;
    
    // Handle counter reset (if last < first, use last as the increase)
    const increase = last_value >= first_value 
      ? last_value - first_value 
      : last_value;
    
    const rate = durationSec > 0 ? increase / durationSec : 0;
    
    return {
      meta: { metricType, help, computedAs: 'rate' },
      result: {
        kind: 'card',
        value: rate,
        ts: last_ts
      }
    };
  }
  
  // For gauges: use last value (most intuitive for card view)
  const query = `
    SELECT value, ts
    FROM metrics_samples
    WHERE series_id = ANY($1::uuid[])
      AND ts >= $2
      AND ts <= $3
    ORDER BY ts DESC
    LIMIT 1
  `;

  const result = await pool.query(query, [seriesIds, fromDate.toISOString(), toDate.toISOString()]);
  
  return {
    meta: { metricType, help, computedAs: 'last' },
    result: {
      kind: 'card',
      value: result.rows.length > 0 ? result.rows[0].value : null,
      ts: result.rows.length > 0 ? result.rows[0].ts : null
    }
  };
}

/**
 * Query breakdown view - aggregate by label
 * Applies METRICS_MAX_BREAKDOWN_ROWS to limit high-cardinality results
 * @param {string} aggregation - 'sum', 'avg', or 'max' for aggregation across series with same label value
 */
async function queryBreakdownView(pool, instanceId, metricName, groupByLabel, fromDate, toDate, filters, metricType, help, aggregation = 'avg') {
  // Get all series for this metric with the group-by label
  const labelConditions = [];
  const labelParams = [instanceId, metricName];
  let paramIndex = 3;

  for (const [key, value] of Object.entries(filters)) {
    const filterLabels = { [key]: value };
    labelConditions.push(`labels @> $${paramIndex}::jsonb`);
    labelParams.push(JSON.stringify(filterLabels));
    paramIndex++;
  }

  const labelWhere = labelConditions.length > 0 
    ? `AND ${labelConditions.join(' AND ')}` 
    : '';

  const seriesQuery = `
    SELECT 
      id,
      labels->$${paramIndex} as label_value,
      metric_type
    FROM metrics_series
    WHERE instance_id = $1
      AND metric_name = $2
      AND labels ? $${paramIndex}
      ${labelWhere}
  `;

  labelParams.push(groupByLabel);
  const seriesResult = await pool.query(seriesQuery, labelParams);

  if (seriesResult.rows.length === 0) {
    return {
      meta: { metricType, help },
      result: { kind: 'breakdown', rows: [], truncated: false }
    };
  }

  // For breakdown, get latest value for each series and group by label value
  const seriesIds = seriesResult.rows.map(r => r.id);
  
  // Map aggregation to SQL function
  const aggFunctions = {
    sum: 'SUM(lv.value)',
    avg: 'AVG(lv.value)',
    max: 'MAX(lv.value)'
  };
  const aggSql = aggFunctions[aggregation] || 'AVG(lv.value)';
  
  // Apply breakdown row limit to prevent high-cardinality blowups
  const samplesQuery = `
    WITH latest_values AS (
      SELECT DISTINCT ON (series_id) 
        series_id,
        value
      FROM metrics_samples
      WHERE series_id = ANY($1::uuid[])
        AND ts >= $2
        AND ts <= $3
      ORDER BY series_id, ts DESC
    )
    SELECT 
      ms.labels->$4 as label_value,
      ${aggSql} as agg_value
    FROM latest_values lv
    JOIN metrics_series ms ON ms.id = lv.series_id
    GROUP BY ms.labels->$4
    ORDER BY agg_value DESC
    LIMIT $5
  `;

  const samplesResult = await pool.query(samplesQuery, [
    seriesIds,
    fromDate.toISOString(),
    toDate.toISOString(),
    groupByLabel,
    METRICS_MAX_BREAKDOWN_ROWS + 1 // +1 to detect truncation
  ]);

  const truncated = samplesResult.rows.length > METRICS_MAX_BREAKDOWN_ROWS;
  const rows = samplesResult.rows.slice(0, METRICS_MAX_BREAKDOWN_ROWS);

  return {
    meta: { metricType, help, computedAs: aggregation },
    result: {
      kind: 'breakdown',
      rows: rows.map(r => ({
        key: r.label_value || 'unknown',
        value: parseFloat(r.agg_value)
      })),
      truncated
    }
  };
}

/**
 * Query line view - time series data with proper Prometheus semantics
 * @param {string} aggregation - 'sum', 'avg', or 'max' for bucket aggregation
 */
async function queryLineView(pool, seriesIds, series, fromDate, toDate, metricType, help, aggregation = 'avg') {
  const timeRangeMs = toDate.getTime() - fromDate.getTime();
  const bucketSizeSec = Math.max(1, Math.ceil(timeRangeMs / (METRICS_MAX_DATAPOINTS * 1000)));

  // Map aggregation to SQL function
  const aggFunctions = {
    sum: 'SUM(value)',
    avg: 'AVG(value)',
    max: 'MAX(value)'
  };
  const aggSql = aggFunctions[aggregation] || 'AVG(value)';

  // Query samples with time bucketing and dynamic aggregation
  // Bucket formula: to_timestamp(floor(epoch / bucket_size) * bucket_size)
  // This groups all timestamps within the same bucket_size-second window.
  const samplesQuery = `
    WITH bucketed_samples AS (
      SELECT 
        series_id,
        to_timestamp(floor(EXTRACT(EPOCH FROM ts) / $4) * $4) as bucket_ts,
        ${aggSql} as agg_value,
        MIN(value) as min_value,
        MAX(value) as max_value,
        COUNT(*) as count
      FROM metrics_samples
      WHERE series_id = ANY($1::uuid[])
        AND ts >= $2
        AND ts <= $3
      GROUP BY series_id, bucket_ts
      ORDER BY series_id ASC, bucket_ts ASC
    )
    SELECT 
      series_id,
      bucket_ts as ts,
      agg_value as value,
      min_value,
      max_value,
      count
    FROM bucketed_samples
    LIMIT $5
  `;

  const samplesResult = await pool.query(samplesQuery, [
    seriesIds,
    fromDate.toISOString(),
    toDate.toISOString(),
    bucketSizeSec,
    METRICS_MAX_DATAPOINTS * seriesIds.length
  ]);

  // Group samples by series_id
  const samplesBySeriesId = {};
  for (const row of samplesResult.rows) {
    if (!samplesBySeriesId[row.series_id]) {
      samplesBySeriesId[row.series_id] = [];
    }
    samplesBySeriesId[row.series_id].push(row);
  }

  // Process each series with proper metric type semantics
  const isCounter = metricType === 'counter';
  const computedAs = isCounter ? 'delta' : aggregation;
  
  const resultSeries = series.map(s => {
    const samples = samplesBySeriesId[s.id] || [];
    let points;

    if (isCounter) {
      // Counter: compute delta per bucket (rate-like), handle resets
      // Aggregation is applied to raw values before delta computation
      points = computeCounterDeltas(samples);
    } else {
      // Gauge: use aggregated values (avg/sum/max based on selection)
      points = samples.map(sample => ({
        ts: sample.ts,
        value: parseFloat(sample.value)
      }));
    }

    return {
      labels: s.labels,
      points
    };
  });

  return {
    meta: { metricType, help, computedAs },
    result: {
      kind: 'line',
      series: resultSeries
    }
  };
}

/**
 * Compute counter deltas with reset handling
 * Counter values are monotonically increasing, but can reset to 0.
 * We compute delta = current - previous, but if delta < 0, treat as reset.
 */
function computeCounterDeltas(samples) {
  if (samples.length === 0) return [];

  const deltas = [];
  
  for (let i = 0; i < samples.length; i++) {
    if (i === 0) {
      // First point: delta = 0 or the value itself (depending on semantics)
      // Prometheus convention: first point has unknown rate, so we'll use 0
      deltas.push({
        ts: samples[i].ts,
        value: 0
      });
    } else {
      const current = parseFloat(samples[i].value);
      const previous = parseFloat(samples[i - 1].value);
      const delta = current - previous;
      
      // Handle reset: if delta < 0, assume counter reset
      const actualDelta = delta >= 0 ? delta : current;
      
      deltas.push({
        ts: samples[i].ts,
        value: actualDelta
      });
    }
  }

  return deltas;
}

/**
 * Get available values for a specific label key
 * Applies METRICS_MAX_LABEL_VALUES to prevent high-cardinality blowups
 * 
 * @param {object} pool - PostgreSQL pool
 * @param {string} instanceId - Instance ID
 * @param {string} metricName - Metric name
 * @param {string} labelKey - Label key to get values for
 * @returns {Promise<Array<string>>} List of distinct label values
 */
async function getLabelValues(pool, instanceId, metricName, labelKey) {
  const query = `
    SELECT DISTINCT labels->>$3 as label_value
    FROM metrics_series
    WHERE instance_id = $1
      AND metric_name = $2
      AND labels ? $3
      AND labels->>$3 IS NOT NULL
    ORDER BY label_value ASC
    LIMIT $4
  `;

  const result = await pool.query(query, [
    instanceId,
    metricName,
    labelKey,
    METRICS_MAX_LABEL_VALUES
  ]);

  return result.rows.map(r => r.label_value);
}

module.exports = {
  getMetricsCatalog,
  queryMetricTimeseries,
  getLabelValues,
  parseAndClampTimeRange,
  labelsHash
};
