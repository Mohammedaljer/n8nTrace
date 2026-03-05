const { METRICS_MAX_TIME_RANGE_DAYS } = require('../config');

/**
 * Parse and clamp a time range to respect METRICS_MAX_TIME_RANGE_DAYS.
 * Defaults to the last 24 hours if dates are missing or invalid.
 *
 * @param {string|Date|undefined} from - Start of the range
 * @param {string|Date|undefined} to   - End of the range
 * @returns {{ fromDate: Date, toDate: Date }}
 */
function parseAndClampTimeRange(from, to) {
  const now = new Date();
  let fromDate = from ? new Date(from) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  let toDate = to ? new Date(to) : now;

  if (isNaN(fromDate.getTime())) fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (isNaN(toDate.getTime())) toDate = now;

  const maxMs = METRICS_MAX_TIME_RANGE_DAYS * 24 * 60 * 60 * 1000;
  if (toDate - fromDate > maxMs) {
    fromDate = new Date(toDate.getTime() - maxMs);
  }

  return { fromDate, toDate };
}

module.exports = { parseAndClampTimeRange };
