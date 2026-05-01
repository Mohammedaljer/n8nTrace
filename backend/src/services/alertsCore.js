const { ALERTS_DELIVERY_MAX_ATTEMPTS } = require('../config');

const SEVERITY_ORDER = {
  info: 1,
  warning: 2,
  critical: 3,
};

function severityRank(severity) {
  return SEVERITY_ORDER[String(severity || 'info').toLowerCase()] || 1;
}

function parseRuleConfig(rule) {
  const raw = rule?.config;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).toLowerCase());

  const text = String(value).trim();
  if (!text) return [];

  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).toLowerCase());
    } catch {
      return [];
    }
  }

  return text
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function patternMatches(name, pattern) {
  const source = String(pattern || '').trim();
  if (!source) return false;
  const escaped = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try {
    const re = new RegExp(`^${escaped}$`, 'i');
    return re.test(String(name || ''));
  } catch {
    return false;
  }
}

function selectorMatchesWorkflow(row, selector) {
  const kind = selector.selector_kind;
  const value = String(selector.selector_value || '');
  if (kind === 'workflow_id') return row.workflow_id === value;
  if (kind === 'instance_id') return row.instance_id === value;
  if (kind === 'tag') return parseTags(row.tags).includes(value.toLowerCase());
  if (kind === 'name_pattern') return patternMatches(row.name, value);
  return false;
}

function selectorMatchesInstance(instanceId, selector, workflows) {
  const kind = selector.selector_kind;
  const value = String(selector.selector_value || '');

  if (kind === 'instance_id') return instanceId === value;
  if (kind === 'workflow_id') return workflows.some((w) => w.instance_id === instanceId && w.workflow_id === value);
  if (kind === 'tag') {
    const check = value.toLowerCase();
    return workflows.some((w) => w.instance_id === instanceId && parseTags(w.tags).includes(check));
  }
  if (kind === 'name_pattern') {
    return workflows.some((w) => w.instance_id === instanceId && patternMatches(w.name, value));
  }

  return false;
}

function shouldApplySelectorMode(config, includes) {
  const targetMode = String(config.targetMode || 'all');
  if (targetMode !== 'selected') return true;
  return includes.length > 0;
}

function groupSelectorsByKind(selectors) {
  const grouped = new Map();
  for (const selector of selectors) {
    const kind = String(selector.selector_kind || '');
    if (!grouped.has(kind)) grouped.set(kind, []);
    grouped.get(kind).push(selector);
  }
  return grouped;
}

function matchesAllIncludeKindsForWorkflow(row, includes) {
  if (!includes.length) return true;
  const grouped = groupSelectorsByKind(includes);
  for (const selectorsOfKind of grouped.values()) {
    if (!selectorsOfKind.some((selector) => selectorMatchesWorkflow(row, selector))) {
      return false;
    }
  }
  return true;
}

function matchesAllIncludeKindsForInstance(instanceId, includes, workflows) {
  if (!includes.length) return true;
  const grouped = groupSelectorsByKind(includes);
  for (const selectorsOfKind of grouped.values()) {
    if (!selectorsOfKind.some((selector) => selectorMatchesInstance(instanceId, selector, workflows))) {
      return false;
    }
  }
  return true;
}

async function ensureWorkflowAlertProfiles(pool) {
  await pool.query(
    `INSERT INTO workflow_alert_profile
      (workflow_id, instance_id, is_template, is_test, inactivity_exempt, source)
     SELECT
      w.workflow_id,
      w.instance_id,
      (LOWER(w.name) LIKE '%template%' OR LOWER(COALESCE(w.tags, '')) LIKE '%template%') AS is_template,
      (LOWER(w.name) LIKE '%test%' OR LOWER(COALESCE(w.tags, '')) LIKE '%test%') AS is_test,
      (LOWER(w.name) LIKE '%template%' OR LOWER(COALESCE(w.tags, '')) LIKE '%template%' OR LOWER(w.name) LIKE '%test%' OR LOWER(COALESCE(w.tags, '')) LIKE '%test%') AS inactivity_exempt,
      'auto'
     FROM workflows_index w
     LEFT JOIN workflow_alert_profile p ON p.workflow_id = w.workflow_id
     WHERE p.workflow_id IS NULL`
  );
}

async function resolveRuleTargets(pool, rule) {
  const config = parseRuleConfig(rule);
  let selectors;
  if (Array.isArray(rule?.selectorsOverride)) {
    selectors = rule.selectorsOverride
      .map((s) => ({
        selector_mode: s?.mode === 'exclude' ? 'exclude' : 'include',
        selector_kind: String(s?.kind || '').trim(),
        selector_value: String(s?.value || '').trim(),
      }))
      .filter((s) => s.selector_kind && s.selector_value);
  } else {
    const { rows } = await pool.query(
      `SELECT selector_mode, selector_kind, selector_value
       FROM alert_rule_selectors
       WHERE rule_id = $1`,
      [rule.id]
    );
    selectors = rows;
  }

  const includes = selectors.filter((s) => s.selector_mode === 'include');
  const excludes = selectors.filter((s) => s.selector_mode === 'exclude');

  if (rule.rule_type === 'metrics_freshness') {
    const [instanceRows, workflowRows] = await Promise.all([
      pool.query(
        `SELECT DISTINCT instance_id
         FROM (
          SELECT instance_id FROM n8n_metrics_snapshot
          UNION
          SELECT instance_id FROM workflows_index
         ) x
         WHERE instance_id IS NOT NULL`
      ),
      pool.query(`SELECT instance_id, workflow_id, name, tags FROM workflows_index`),
    ]);

    let candidates = instanceRows.rows.map((r) => r.instance_id);

    if (!shouldApplySelectorMode(config, includes)) {
      candidates = [];
    } else if (includes.length > 0) {
      candidates = candidates.filter((instanceId) =>
        matchesAllIncludeKindsForInstance(instanceId, includes, workflowRows.rows)
      );
    }

    if (excludes.length > 0) {
      candidates = candidates.filter((instanceId) =>
        !excludes.some((sel) => selectorMatchesInstance(instanceId, sel, workflowRows.rows))
      );
    }

    return candidates.map((instanceId) => ({
      target_fingerprint: `instance:${instanceId}`,
      instance_id: instanceId,
      workflow_id: null,
      label: instanceId,
    }));
  }

  const { rows: workflowRows } = await pool.query(
    `SELECT
       w.instance_id,
       w.workflow_id,
       w.name,
       w.tags,
       COALESCE(
         p.is_template,
         (LOWER(w.name) LIKE '%template%' OR LOWER(COALESCE(w.tags, '')) LIKE '%template%')
       ) AS is_template_eff,
       COALESCE(
         p.is_test,
         (LOWER(w.name) LIKE '%test%' OR LOWER(COALESCE(w.tags, '')) LIKE '%test%')
       ) AS is_test_eff,
       COALESCE(p.inactivity_exempt, false) AS inactivity_exempt
     FROM workflows_index w
     LEFT JOIN workflow_alert_profile p ON p.workflow_id = w.workflow_id`
  );

  let candidates = workflowRows;

  if (!shouldApplySelectorMode(config, includes)) {
    candidates = [];
  } else if (includes.length > 0) {
    candidates = candidates.filter((row) => matchesAllIncludeKindsForWorkflow(row, includes));
  }

  if (excludes.length > 0) {
    candidates = candidates.filter((row) => !excludes.some((sel) => selectorMatchesWorkflow(row, sel)));
  }

  if (rule.rule_type === 'workflow_inactivity' && rule.apply_default_exclusions) {
    candidates = candidates.filter((row) => !row.is_template_eff && !row.is_test_eff && !row.inactivity_exempt);
  }

  return candidates.map((row) => ({
    target_fingerprint: `workflow:${row.workflow_id}`,
    instance_id: row.instance_id,
    workflow_id: row.workflow_id,
    label: row.name || row.workflow_id,
  }));
}

function normalizeHeaders(headers) {
  if (!headers) return {};
  if (typeof headers === 'object') return headers;
  try {
    const parsed = JSON.parse(headers);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function enqueueIncidentNotifications(client, incident, ruleId, eventType) {
  const { rows: routingRows } = await client.query(
    `SELECT
       rd.destination_id,
       rd.notify_on_open,
       rd.notify_on_resolve,
       rd.notify_on_ack,
       rd.min_severity,
       d.retry_max_attempts,
       d.enabled
     FROM alert_rule_destinations rd
     JOIN alert_destinations d ON d.id = rd.destination_id
     WHERE rd.rule_id = $1`,
    [ruleId]
  );

  for (const route of routingRows) {
    if (!route.enabled) continue;

    if (eventType === 'open' && !route.notify_on_open) continue;
    if (eventType === 'resolved' && !route.notify_on_resolve) continue;
    if (eventType === 'acknowledged' && !route.notify_on_ack) continue;

    if (severityRank(incident.severity) < severityRank(route.min_severity)) continue;

    const dedupeKey = `${incident.id}:${eventType}:${route.destination_id}`;
    const payload = {
      eventType,
      incident: {
        id: incident.id,
        status: incident.status,
        severity: incident.severity,
        title: incident.title,
        summary: incident.summary,
        instanceId: incident.instance_id,
        workflowId: incident.workflow_id,
        startedAt: incident.started_at,
        lastSeenAt: incident.last_seen_at,
        resolvedAt: incident.resolved_at,
      },
      metadata: {
        dedupeKey,
        emittedAt: new Date().toISOString(),
      },
    };

    await client.query(
      `INSERT INTO alert_notification_outbox
        (incident_id, rule_id, destination_id, event_type, dedupe_key, payload, status, attempt_count, max_attempts, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending', 0, $7, now())
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        incident.id,
        ruleId,
        route.destination_id,
        eventType,
        dedupeKey,
        JSON.stringify(payload),
        Number(route.retry_max_attempts || ALERTS_DELIVERY_MAX_ATTEMPTS),
      ]
    );
  }
}

module.exports = {
  SEVERITY_ORDER,
  severityRank,
  parseRuleConfig,
  parseTags,
  ensureWorkflowAlertProfiles,
  resolveRuleTargets,
  normalizeHeaders,
  enqueueIncidentNotifications,
};
