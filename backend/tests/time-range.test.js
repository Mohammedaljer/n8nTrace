/**
 * Time range parsing and clamping tests.
 *
 * Pure unit tests for the shared parseAndClampTimeRange utility.
 */

// Set env before requiring the module
process.env.METRICS_MAX_TIME_RANGE_DAYS = '30';

// Clear module caches to pick up env
delete require.cache[require.resolve('../src/config/index')];
delete require.cache[require.resolve('../src/utils/timeRange')];

const { parseAndClampTimeRange } = require('../src/utils/timeRange');

describe('parseAndClampTimeRange', () => {
  // ── Default behaviour (no arguments) ──────────────────────────────────

  test('defaults to last 24h when both from/to are undefined', () => {
    const before = Date.now();
    const { fromDate, toDate } = parseAndClampTimeRange(undefined, undefined);
    const after = Date.now();

    expect(toDate.getTime()).toBeGreaterThanOrEqual(before);
    expect(toDate.getTime()).toBeLessThanOrEqual(after);

    const diffMs = toDate.getTime() - fromDate.getTime();
    const expectedMs = 24 * 60 * 60 * 1000;
    expect(Math.abs(diffMs - expectedMs)).toBeLessThan(1000); // within 1s tolerance
  });

  // ── Valid date strings ─────────────────────────────────────────────────

  test('parses valid ISO date strings', () => {
    const from = '2025-01-01T00:00:00.000Z';
    const to = '2025-01-02T00:00:00.000Z';
    const { fromDate, toDate } = parseAndClampTimeRange(from, to);

    expect(fromDate.toISOString()).toBe(from);
    expect(toDate.toISOString()).toBe(to);
  });

  // ── Invalid dates fall back to defaults ─────────────────────────────────

  test('handles invalid from date (falls back to 24h ago)', () => {
    const to = '2025-06-15T12:00:00.000Z';
    const { fromDate, toDate } = parseAndClampTimeRange('not-a-date', to);

    expect(toDate.toISOString()).toBe(to);
    // fromDate should be approximately now - 24h (since we can't mock Date)
    expect(fromDate instanceof Date).toBe(true);
    expect(isNaN(fromDate.getTime())).toBe(false);
  });

  test('handles invalid to date (falls back to now)', () => {
    // Use a recent from date so it won't be clamped by the 30-day max
    const now = new Date();
    const from = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    const before = Date.now();
    const { fromDate, toDate } = parseAndClampTimeRange(from.toISOString(), 'invalid');
    const after = Date.now();

    // from should remain as-is (within 30-day range)
    expect(Math.abs(fromDate.getTime() - from.getTime())).toBeLessThan(1000);
    // to should be approximately now
    expect(toDate.getTime()).toBeGreaterThanOrEqual(before);
    expect(toDate.getTime()).toBeLessThanOrEqual(after);
  });

  // ── Clamping to max range ──────────────────────────────────────────────

  test('clamps range exceeding METRICS_MAX_TIME_RANGE_DAYS', () => {
    const to = new Date('2025-06-15T00:00:00.000Z');
    // 60 days before — exceeds the 30-day max
    const from = new Date(to.getTime() - 60 * 24 * 60 * 60 * 1000);

    const { fromDate, toDate } = parseAndClampTimeRange(from.toISOString(), to.toISOString());

    expect(toDate.toISOString()).toBe(to.toISOString());
    const diffDays = (toDate - fromDate) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(30); // clamped to max
  });

  test('does not clamp range within the max', () => {
    const to = new Date('2025-06-15T00:00:00.000Z');
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days

    const { fromDate, toDate } = parseAndClampTimeRange(from.toISOString(), to.toISOString());

    const diffDays = (toDate - fromDate) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(7); // not clamped
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  test('handles Date objects as inputs', () => {
    const from = new Date('2025-06-01T00:00:00Z');
    const to = new Date('2025-06-02T00:00:00Z');
    const { fromDate, toDate } = parseAndClampTimeRange(from, to);

    expect(fromDate.toISOString()).toBe(from.toISOString());
    expect(toDate.toISOString()).toBe(to.toISOString());
  });

  test('handles null inputs (treated as undefined)', () => {
    const { fromDate, toDate } = parseAndClampTimeRange(null, null);
    expect(fromDate instanceof Date).toBe(true);
    expect(toDate instanceof Date).toBe(true);
    expect(isNaN(fromDate.getTime())).toBe(false);
    expect(isNaN(toDate.getTime())).toBe(false);
  });
});
