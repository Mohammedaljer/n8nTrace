const crypto = require('crypto');
const {
  ALERTS_ENABLED,
  ALERTS_EVALUATOR_POLL_MS,
  ALERTS_DELIVERY_POLL_MS,
  ALERTS_MAINTENANCE_POLL_MS,
  ALERTS_RULE_BATCH_SIZE,
  ALERTS_DELIVERY_BATCH_SIZE,
  ALERTS_DELIVERY_MAX_ATTEMPTS,
  ALERTS_DELIVERY_BASE_RETRY_MS,
} = require('../config');
const {
  parseRuleConfig,
  ensureWorkflowAlertProfiles,
  resolveRuleTargets,
  enqueueIncidentNotifications,
  normalizeHeaders,
} = require('./alertsCore');
const { decryptSecret } = require('./alertsCrypto');

const state = {
  started: false,
  workerId: null,
  timers: [],
  evaluatorRunning: false,
  deliveryRunning: false,
  maintenanceRunning: false,
  lastEvaluatorRunAt: null,
  lastDeliveryRunAt: null,
  lastMaintenanceRunAt: null,
  lastAlertRetentionRunAt: null,
  lastAlertRetentionDeleted: { resolved: 0, unresolved: 0 },
  evaluatorErrors: 0,
  deliveryErrors: 0,
  maintenanceErrors: 0,
};

const ALERT_RETENTION_BATCH_SIZE = 500;

function nowIso() {
  return new Date().toISOString();
}

function buildWorkerId() {
  return `worker-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
}

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function claimDueRules(pool, workerId, batchSize) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `WITH due AS (
         SELECT id
         FROM alert_rules
         WHERE enabled = true
           AND next_eval_at <= now()
           AND (lease_expires_at IS NULL OR lease_expires_at < now())
         ORDER BY next_eval_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE alert_rules r
       SET lease_owner = $1,
           lease_expires_at = now() + interval '45 seconds'
       FROM due
       WHERE r.id = due.id
       RETURNING r.*`,
      [workerId, batchSize]
    );
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function upsertEvalState(client, ruleId, target, nextState) {
  await client.query(
    `INSERT INTO alert_evaluation_state
      (rule_id, target_fingerprint, instance_id, workflow_id, consecutive_breach, consecutive_ok, last_value, last_message, last_eval_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
     ON CONFLICT (rule_id, target_fingerprint)
     DO UPDATE SET
      consecutive_breach = EXCLUDED.consecutive_breach,
      consecutive_ok = EXCLUDED.consecutive_ok,
      last_value = EXCLUDED.last_value,
      last_message = EXCLUDED.last_message,
      last_eval_at = EXCLUDED.last_eval_at,
      updated_at = now()`,
    [
      ruleId,
      target.target_fingerprint,
      target.instance_id,
      target.workflow_id,
      nextState.consecutive_breach,
      nextState.consecutive_ok,
      nextState.last_value,
      nextState.last_message,
    ]
  );
}

async function getEvalState(client, ruleId, targetFingerprint) {
  const { rows } = await client.query(
    `SELECT * FROM alert_evaluation_state WHERE rule_id = $1 AND target_fingerprint = $2`,
    [ruleId, targetFingerprint]
  );
  return rows[0] || null;
}

async function getActiveIncident(client, ruleId, targetFingerprint) {
  const { rows } = await client.query(
    `SELECT *
     FROM alert_incidents
     WHERE rule_id = $1
       AND fingerprint = $2
       AND status IN ('open', 'acknowledged', 'suppressed')
     ORDER BY started_at DESC
     LIMIT 1`,
    [ruleId, targetFingerprint]
  );
  return rows[0] || null;
}

async function insertIncidentEvent(client, incidentId, eventType, eventData = {}, actorUserId = null, note = null) {
  await client.query(
    `INSERT INTO alert_incident_events (incident_id, event_type, actor_user_id, note, event_data)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [incidentId, eventType, actorUserId, note, JSON.stringify(eventData || {})]
  );
}

function evaluateInactivity(lastExecutionAt, thresholdHours) {
  const thresholdMs = thresholdHours * 60 * 60 * 1000;
  if (!lastExecutionAt) {
    return {
      breach: true,
      value: null,
      title: 'Workflow inactivity detected',
      summary: `No execution found in the last ${thresholdHours}h window`,
    };
  }

  const ageMs = Date.now() - new Date(lastExecutionAt).getTime();
  const ageHours = ageMs / (60 * 60 * 1000);
  const breach = ageMs > thresholdMs;

  return {
    breach,
    value: Number(ageHours.toFixed(2)),
    title: 'Workflow inactivity detected',
    summary: breach
      ? `No execution for ${ageHours.toFixed(2)}h (threshold ${thresholdHours}h)`
      : `Workflow is active (${ageHours.toFixed(2)}h since last run)`,
  };
}

function evaluateStuck(oldestRunningAt, thresholdMinutes) {
  if (!oldestRunningAt) {
    return {
      breach: false,
      value: 0,
      title: 'Stuck execution detected',
      summary: 'No running or waiting executions past threshold',
    };
  }

  const ageMs = Date.now() - new Date(oldestRunningAt).getTime();
  const ageMinutes = ageMs / (60 * 1000);
  const breach = ageMinutes > thresholdMinutes;

  return {
    breach,
    value: Number(ageMinutes.toFixed(2)),
    title: 'Stuck execution detected',
    summary: breach
      ? `Execution running/waiting for ${ageMinutes.toFixed(2)}m (threshold ${thresholdMinutes}m)`
      : `Running execution age ${ageMinutes.toFixed(2)}m`,
  };
}

function evaluateFreshness(lastSnapshotAt, thresholdMinutes) {
  if (!lastSnapshotAt) {
    return {
      breach: true,
      value: null,
      title: 'Metrics freshness alert',
      summary: `No metrics snapshot found in the last ${thresholdMinutes}m window`,
    };
  }

  const ageMs = Date.now() - new Date(lastSnapshotAt).getTime();
  const ageMinutes = ageMs / (60 * 1000);
  const breach = ageMinutes > thresholdMinutes;

  return {
    breach,
    value: Number(ageMinutes.toFixed(2)),
    title: 'Metrics freshness alert',
    summary: breach
      ? `Metrics are stale (${ageMinutes.toFixed(2)}m old, threshold ${thresholdMinutes}m)`
      : `Metrics are fresh (${ageMinutes.toFixed(2)}m old)`,
  };
}

async function evaluateRuleTarget(client, rule, target) {
  const config = parseRuleConfig(rule);

  if (rule.rule_type === 'workflow_inactivity') {
    const thresholdHours = parseNumber(config.thresholdHours ?? config.threshold_hours, 24);
    const { rows } = await client.query(
      `SELECT MAX(started_at) AS last_execution_at
       FROM executions
       WHERE workflow_id = $1`,
      [target.workflow_id]
    );
    return evaluateInactivity(rows[0]?.last_execution_at || null, thresholdHours);
  }

  if (rule.rule_type === 'stuck_execution') {
    const thresholdMinutes = parseNumber(config.thresholdMinutes ?? config.threshold_minutes, 60);
    const { rows } = await client.query(
      `SELECT MIN(started_at) AS oldest_running_at
       FROM executions
       WHERE workflow_id = $1
         AND finished = false
         AND status IN ('running', 'waiting')`,
      [target.workflow_id]
    );
    return evaluateStuck(rows[0]?.oldest_running_at || null, thresholdMinutes);
  }

  if (rule.rule_type === 'metrics_freshness') {
    const thresholdMinutes = parseNumber(config.thresholdMinutes ?? config.threshold_minutes, 15);
    const { rows } = await client.query(
      `SELECT MAX(ts) AS last_snapshot_at
       FROM n8n_metrics_snapshot
       WHERE instance_id = $1`,
      [target.instance_id]
    );
    return evaluateFreshness(rows[0]?.last_snapshot_at || null, thresholdMinutes);
  }

  return {
    breach: false,
    value: null,
    title: 'Unsupported rule type',
    summary: `Unsupported rule type: ${rule.rule_type}`,
  };
}

async function openIncident(client, rule, target, evaluation) {
  const { rows } = await client.query(
    `INSERT INTO alert_incidents
      (rule_id, fingerprint, instance_id, workflow_id, status, severity, title, summary, started_at, last_seen_at, details)
     VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, now(), now(), $8::jsonb)
     RETURNING *`,
    [
      rule.id,
      target.target_fingerprint,
      target.instance_id,
      target.workflow_id,
      rule.severity,
      evaluation.title,
      evaluation.summary,
      JSON.stringify({
        lastValue: evaluation.value,
        label: target.label,
      }),
    ]
  );

  const incident = rows[0];
  await insertIncidentEvent(client, incident.id, 'open', {
    summary: evaluation.summary,
    value: evaluation.value,
  });
  await enqueueIncidentNotifications(client, incident, rule.id, 'open');
  return incident;
}

async function touchActiveIncident(client, incidentId, evaluation) {
  await client.query(
    `UPDATE alert_incidents
     SET last_seen_at = now(),
         summary = $2,
         details = COALESCE(details, '{}'::jsonb) || $3::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      incidentId,
      evaluation.summary,
      JSON.stringify({
        lastValue: evaluation.value,
      }),
    ]
  );
}

async function resolveIncident(client, incident, evaluation, ruleId) {
  const { rows } = await client.query(
    `UPDATE alert_incidents
     SET status = 'resolved',
         resolved_at = now(),
         summary = $2,
         details = COALESCE(details, '{}'::jsonb) || $3::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      incident.id,
      evaluation.summary,
      JSON.stringify({
        resolvedValue: evaluation.value,
      }),
    ]
  );

  const resolved = rows[0];
  await insertIncidentEvent(client, resolved.id, 'resolved', {
    summary: evaluation.summary,
    value: evaluation.value,
  });
  await enqueueIncidentNotifications(client, resolved, ruleId, 'resolved');
}

async function processRule(pool, rule) {
  const client = await pool.connect();
  try {
    const targets = await resolveRuleTargets(client, rule);

    for (const target of targets) {
      const evaluation = await evaluateRuleTarget(client, rule, target);
      const existingState = await getEvalState(client, rule.id, target.target_fingerprint);

      const nextState = {
        consecutive_breach: evaluation.breach
          ? Number(existingState?.consecutive_breach || 0) + 1
          : 0,
        consecutive_ok: evaluation.breach
          ? 0
          : Number(existingState?.consecutive_ok || 0) + 1,
        last_value: evaluation.value,
        last_message: evaluation.summary,
      };

      await upsertEvalState(client, rule.id, target, nextState);

      const activeIncident = await getActiveIncident(client, rule.id, target.target_fingerprint);

      if (evaluation.breach) {
        if (activeIncident) {
          await touchActiveIncident(client, activeIncident.id, evaluation);
        } else if (nextState.consecutive_breach >= Number(rule.open_after_n || 1)) {
          await openIncident(client, rule, target, evaluation);
        }
      } else if (activeIncident && nextState.consecutive_ok >= Number(rule.resolve_after_n || 1)) {
        await resolveIncident(client, activeIncident, evaluation, rule.id);
      }
    }

    await client.query(
      `UPDATE alert_rules
       SET last_eval_at = now(),
           next_eval_at = now() + make_interval(secs => $2::int),
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
       WHERE id = $1`,
      [rule.id, Number(rule.evaluation_interval_sec || 300)]
    );
  } catch (err) {
    await client.query(
      `UPDATE alert_rules
       SET next_eval_at = now() + interval '60 seconds',
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
       WHERE id = $1`,
      [rule.id]
    );
    throw err;
  } finally {
    client.release();
  }
}

async function runEvaluatorOnce(pool, workerId) {
  await ensureWorkflowAlertProfiles(pool);
  const rules = await claimDueRules(pool, workerId, ALERTS_RULE_BATCH_SIZE);
  for (const rule of rules) {
    try {
      await processRule(pool, rule);
    } catch (err) {
      console.error(`Alerts evaluator error for rule ${rule.id}:`, err.message);
      state.evaluatorErrors += 1;
    }
  }
  state.lastEvaluatorRunAt = nowIso();
}

async function runRuleNow(pool, ruleId) {
  await ensureWorkflowAlertProfiles(pool);
  const { rows } = await pool.query(`SELECT * FROM alert_rules WHERE id = $1`, [ruleId]);
  if (!rows.length) {
    const err = new Error('Rule not found');
    err.code = 'RULE_NOT_FOUND';
    throw err;
  }

  const rule = rows[0];
  if (!rule.enabled) {
    const err = new Error('Rule is disabled');
    err.code = 'RULE_DISABLED';
    throw err;
  }

  await processRule(pool, rule);
  return { ok: true, ruleId };
}

async function claimDueOutbox(pool, workerId, batchSize) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `WITH due AS (
         SELECT id
         FROM alert_notification_outbox
         WHERE status IN ('pending', 'retry')
           AND next_attempt_at <= now()
           AND (lease_expires_at IS NULL OR lease_expires_at < now())
         ORDER BY next_attempt_at ASC, created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE alert_notification_outbox o
       SET status = 'sending',
           lease_owner = $1,
           lease_expires_at = now() + interval '45 seconds',
           updated_at = now()
       FROM due
       WHERE o.id = due.id
       RETURNING o.*`,
      [workerId, batchSize]
    );
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function computeRetryDelayMs(nextAttemptNo) {
  const base = Math.max(1000, ALERTS_DELIVERY_BASE_RETRY_MS);
  const exp = Math.min(10, Math.max(1, nextAttemptNo));
  const raw = base * (2 ** (exp - 1));
  const capped = Math.min(raw, 10 * 60 * 1000);
  return capped + Math.floor(Math.random() * 1000);
}

async function sendWebhook(destination, payload) {
  const timeoutMs = Number(destination.timeout_ms || 5000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    'Content-Type': 'application/json',
    ...normalizeHeaders(destination.headers),
  };

  if (destination.secret_encrypted) {
    const secret = decryptSecret(destination.secret_encrypted);
    if (secret) headers['X-Alert-Secret'] = secret;
  }

  const started = Date.now();
  try {
    const response = await fetch(destination.webhook_url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text().catch(() => '');

    return {
      ok: response.ok,
      status: response.status,
      body: text.slice(0, 2000),
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      body: '',
      latencyMs: Date.now() - started,
      error: err?.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function recordAttempt(client, outboxId, attemptNo, result) {
  await client.query(
    `INSERT INTO alert_notification_attempts
      (outbox_id, attempt_no, success, response_status, response_body, error, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      outboxId,
      attemptNo,
      result.ok,
      result.status,
      result.body || null,
      result.error || null,
      result.latencyMs || null,
    ]
  );
}

async function processOutboxItem(pool, outboxItem) {
  const client = await pool.connect();
  try {
    const { rows: destRows } = await client.query(
      `SELECT * FROM alert_destinations WHERE id = $1`,
      [outboxItem.destination_id]
    );

    const destination = destRows[0];
    if (!destination || !destination.enabled) {
      await client.query(
        `UPDATE alert_notification_outbox
         SET status = 'dead',
             last_error = 'Destination is missing or disabled',
             lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = now()
         WHERE id = $1`,
        [outboxItem.id]
      );
      return;
    }

    const nextAttemptNo = Number(outboxItem.attempt_count || 0) + 1;
    const result = await sendWebhook(destination, outboxItem.payload);

    await recordAttempt(client, outboxItem.id, nextAttemptNo, result);

    if (result.ok) {
      await client.query(
        `UPDATE alert_notification_outbox
         SET status = 'sent',
             attempt_count = $2,
             last_response_status = $3,
             last_error = NULL,
             lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = now()
         WHERE id = $1`,
        [outboxItem.id, nextAttemptNo, result.status]
      );
      return;
    }

    const maxAttempts = Number(outboxItem.max_attempts || ALERTS_DELIVERY_MAX_ATTEMPTS);
    if (nextAttemptNo >= maxAttempts) {
      await client.query(
        `UPDATE alert_notification_outbox
         SET status = 'dead',
             attempt_count = $2,
             last_response_status = $3,
             last_error = $4,
             lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = now()
         WHERE id = $1`,
        [outboxItem.id, nextAttemptNo, result.status, result.error || result.body || 'Delivery failed']
      );
      return;
    }

    const retryDelayMs = computeRetryDelayMs(nextAttemptNo);
    await client.query(
      `UPDATE alert_notification_outbox
       SET status = 'retry',
           attempt_count = $2,
           last_response_status = $3,
           last_error = $4,
           next_attempt_at = now() + ($5::text || ' milliseconds')::interval,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
       WHERE id = $1`,
      [
        outboxItem.id,
        nextAttemptNo,
        result.status,
        result.error || result.body || 'Delivery failed',
        String(retryDelayMs),
      ]
    );
  } finally {
    client.release();
  }
}

async function runDeliveryOnce(pool, workerId) {
  const jobs = await claimDueOutbox(pool, workerId, ALERTS_DELIVERY_BATCH_SIZE);
  for (const job of jobs) {
    try {
      await processOutboxItem(pool, job);
    } catch (err) {
      console.error(`Alerts delivery error for outbox ${job.id}:`, err.message);
      state.deliveryErrors += 1;
      await pool.query(
        `UPDATE alert_notification_outbox
         SET status = 'retry',
             last_error = $2,
             lease_owner = NULL,
             lease_expires_at = NULL,
             next_attempt_at = now() + interval '30 seconds',
             updated_at = now()
         WHERE id = $1`,
        [job.id, err.message]
      );
    }
  }
  state.lastDeliveryRunAt = nowIso();
}

async function runMaintenanceOnce(pool) {
  await ensureWorkflowAlertProfiles(pool);

  await pool.query(
    `UPDATE alert_rules
     SET lease_owner = NULL, lease_expires_at = NULL
     WHERE lease_expires_at IS NOT NULL
       AND lease_expires_at < now()`
  );

  await pool.query(
    `UPDATE alert_notification_outbox
     SET status = CASE
       WHEN attempt_count >= max_attempts THEN 'dead'
       ELSE 'retry'
     END,
     lease_owner = NULL,
     lease_expires_at = NULL,
     next_attempt_at = CASE
       WHEN attempt_count >= max_attempts THEN next_attempt_at
       ELSE now()
     END,
     updated_at = now()
     WHERE status = 'sending'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < now()`
  );

  const retentionResult = await runAlertRetentionCleanup(pool);
  state.lastAlertRetentionRunAt = nowIso();
  state.lastAlertRetentionDeleted = {
    resolved: retentionResult.deletedResolved,
    unresolved: retentionResult.deletedUnresolved,
  };

  state.lastMaintenanceRunAt = nowIso();
}

async function getAlertRetentionDefaults(pool) {
  await pool.query(
    `INSERT INTO alert_retention_settings (id, resolved_days_default, unresolved_days_default)
     VALUES (true, 30, 180)
     ON CONFLICT (id) DO NOTHING`
  );

  const { rows } = await pool.query(
    `SELECT resolved_days_default, unresolved_days_default
     FROM alert_retention_settings
     WHERE id = true
     LIMIT 1`
  );

  return {
    resolvedDaysDefault: Math.max(1, Number(rows[0]?.resolved_days_default || 30)),
    unresolvedDaysDefault: Math.max(1, Number(rows[0]?.unresolved_days_default || 180)),
  };
}

async function runAlertRetentionCleanup(pool) {
  const defaults = await getAlertRetentionDefaults(pool);
  let deletedResolved = 0;
  let deletedUnresolved = 0;

  while (true) {
    const result = await pool.query(
      `WITH doomed AS (
         SELECT i.id
         FROM alert_incidents i
         JOIN alert_rules r ON r.id = i.rule_id
         WHERE i.status = 'resolved'
           AND COALESCE(i.resolved_at, i.last_seen_at, i.created_at)
             < now() - make_interval(days => COALESCE(r.retention_resolved_days, $1)::int)
         ORDER BY COALESCE(i.resolved_at, i.last_seen_at, i.created_at) ASC
         LIMIT $2
       )
       DELETE FROM alert_incidents i
       WHERE i.id IN (SELECT id FROM doomed)
       RETURNING 1`,
      [defaults.resolvedDaysDefault, ALERT_RETENTION_BATCH_SIZE]
    );

    deletedResolved += result.rowCount;
    if (result.rowCount < ALERT_RETENTION_BATCH_SIZE) break;
  }

  while (true) {
    const result = await pool.query(
      `WITH doomed AS (
         SELECT i.id
         FROM alert_incidents i
         JOIN alert_rules r ON r.id = i.rule_id
         WHERE i.status IN ('open', 'acknowledged', 'suppressed')
           AND COALESCE(i.last_seen_at, i.started_at, i.created_at)
             < now() - make_interval(days => COALESCE(r.retention_unresolved_days, $1)::int)
         ORDER BY COALESCE(i.last_seen_at, i.started_at, i.created_at) ASC
         LIMIT $2
       )
       DELETE FROM alert_incidents i
       WHERE i.id IN (SELECT id FROM doomed)
       RETURNING 1`,
      [defaults.unresolvedDaysDefault, ALERT_RETENTION_BATCH_SIZE]
    );

    deletedUnresolved += result.rowCount;
    if (result.rowCount < ALERT_RETENTION_BATCH_SIZE) break;
  }

  return {
    deletedResolved,
    deletedUnresolved,
    ...defaults,
  };
}

function registerLoop(name, intervalMs, handler) {
  const timer = setInterval(async () => {
    try {
      await handler();
    } catch (err) {
      console.error(`Alerts ${name} loop error:`, err.message);
    }
  }, intervalMs);
  state.timers.push(timer);
}

function startAlertWorkers(pool) {
  if (!ALERTS_ENABLED) {
    console.log('Alerts: disabled');
    return;
  }

  if (state.started) return;

  state.started = true;
  state.workerId = buildWorkerId();

  registerLoop('evaluator', ALERTS_EVALUATOR_POLL_MS, async () => {
    if (state.evaluatorRunning) return;
    state.evaluatorRunning = true;
    try {
      await runEvaluatorOnce(pool, state.workerId);
    } catch (err) {
      state.evaluatorErrors += 1;
      console.error('Alerts evaluator run failed:', err.message);
    } finally {
      state.evaluatorRunning = false;
    }
  });

  registerLoop('delivery', ALERTS_DELIVERY_POLL_MS, async () => {
    if (state.deliveryRunning) return;
    state.deliveryRunning = true;
    try {
      await runDeliveryOnce(pool, state.workerId);
    } catch (err) {
      state.deliveryErrors += 1;
      console.error('Alerts delivery run failed:', err.message);
    } finally {
      state.deliveryRunning = false;
    }
  });

  registerLoop('maintenance', ALERTS_MAINTENANCE_POLL_MS, async () => {
    if (state.maintenanceRunning) return;
    state.maintenanceRunning = true;
    try {
      await runMaintenanceOnce(pool);
    } catch (err) {
      state.maintenanceErrors += 1;
      console.error('Alerts maintenance run failed:', err.message);
    } finally {
      state.maintenanceRunning = false;
    }
  });

  // Trigger once quickly after startup.
  setTimeout(() => {
    runEvaluatorOnce(pool, state.workerId).catch((err) => console.error('Alerts startup evaluator failed:', err.message));
    runDeliveryOnce(pool, state.workerId).catch((err) => console.error('Alerts startup delivery failed:', err.message));
    runMaintenanceOnce(pool).catch((err) => console.error('Alerts startup maintenance failed:', err.message));
  }, 2000);

  console.log(`Alerts: workers started (${state.workerId})`);
}

function stopAlertWorkers() {
  for (const timer of state.timers) clearInterval(timer);
  state.timers = [];
  state.started = false;
  state.workerId = null;
  state.evaluatorRunning = false;
  state.deliveryRunning = false;
  state.maintenanceRunning = false;
}

function getAlertsEngineStatus() {
  return {
    enabled: ALERTS_ENABLED,
    started: state.started,
    workerId: state.workerId,
    evaluator: {
      pollMs: ALERTS_EVALUATOR_POLL_MS,
      running: state.evaluatorRunning,
      lastRunAt: state.lastEvaluatorRunAt,
      errors: state.evaluatorErrors,
    },
    delivery: {
      pollMs: ALERTS_DELIVERY_POLL_MS,
      running: state.deliveryRunning,
      lastRunAt: state.lastDeliveryRunAt,
      errors: state.deliveryErrors,
    },
    maintenance: {
      pollMs: ALERTS_MAINTENANCE_POLL_MS,
      running: state.maintenanceRunning,
      lastRunAt: state.lastMaintenanceRunAt,
      errors: state.maintenanceErrors,
    },
    retention: {
      lastRunAt: state.lastAlertRetentionRunAt,
      lastDeletedResolved: state.lastAlertRetentionDeleted.resolved,
      lastDeletedUnresolved: state.lastAlertRetentionDeleted.unresolved,
    },
  };
}

module.exports = {
  startAlertWorkers,
  stopAlertWorkers,
  getAlertsEngineStatus,
  runEvaluatorOnce,
  runRuleNow,
  runDeliveryOnce,
  runMaintenanceOnce,
};
