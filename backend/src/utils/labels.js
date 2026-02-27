const crypto = require('crypto');

/**
 * Canonical Labels Utility
 * 
 * Provides consistent label canonicalization and hashing for Prometheus-style metrics.
 * Guarantees: same label set in different key orders → same hash.
 * 
 * Used for metrics_series.labels_hash to ensure uniqueness.
 */

/**
 * Canonicalize labels object
 * Returns labels with keys sorted alphabetically (ASC)
 * 
 * @param {Object} labels - Plain object with string keys and string values
 * @returns {Object} Labels with keys sorted
 */
function canonicalLabels(labels) {
  if (!labels || typeof labels !== 'object') {
    return {};
  }

  const sortedKeys = Object.keys(labels).sort();
  const canonical = {};
  
  for (const key of sortedKeys) {
    canonical[key] = String(labels[key]); // Ensure string values
  }
  
  return canonical;
}

/**
 * Generate stable JSON string from labels
 * Keys are sorted, ensuring deterministic output
 * 
 * @param {Object} labels - Plain object with string keys and string values
 * @returns {string} Stable JSON representation
 */
function stableJson(labels) {
  const canonical = canonicalLabels(labels);
  return JSON.stringify(canonical);
}

/**
 * Generate SHA256 hash of canonical labels
 * 
 * @param {Object} labels - Plain object with string keys and string values
 * @returns {string} SHA256 hash (hex encoded)
 */
function labelsHash(labels) {
  const json = stableJson(labels);
  return crypto.createHash('sha256').update(json).digest('hex');
}

/**
 * All-in-one function: returns canonical labels, stable JSON, and hash
 * 
 * @param {Object} labels - Plain object with string keys and string values
 * @returns {Object} { canonicalLabels, stableJson, labelsHash }
 */
function processLabels(labels) {
  const canonical = canonicalLabels(labels);
  const json = JSON.stringify(canonical);
  const hash = crypto.createHash('sha256').update(json).digest('hex');
  
  return {
    canonicalLabels: canonical,
    stableJson: json,
    labelsHash: hash
  };
}

module.exports = {
  canonicalLabels,
  stableJson,
  labelsHash,
  processLabels
};
