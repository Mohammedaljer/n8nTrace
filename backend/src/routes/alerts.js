const express = require('express');
const { encryptSecret, maskSecret, decryptSecret } = require('../services/alertsCrypto');
const { parseRuleConfig, parseTags, resolveRuleTargets, enqueueIncidentNotifications, normalizeHeaders } = require('../services/alertsCore');
const { getAlertsEngineStatus, runRuleNow } = require('../services/alertsWorkers');

function createAlertsRouter(deps) {
  const {
    pool,
    requireAuth,
    requirePermission,
    attachAuthz,
    getUserPermissions,
    alertsLimiter,
    alertsTestLimiter,
    logAudit,
    getAuditContext,
  } = deps;

  const router = express.Router();

  function isAdminPerm(permissions) {
    return permissions.includes('admin:users') || permissions.includes('admin:roles');
  }

  async function getPermissions(req) {
    if (Array.isArray(req.permissions)) return req.permissions;
    const permissions = await getUserPermissions(req.user.sub);
    req.permissions = permissions;
    return permissions;
  }

  async function requireAnyPermission(req, res, permissionKeys) {
    const permissions = await getPermissions(req);
    if (permissionKeys.some((key) => permissions.includes(key))) return permissions;
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  function buildIncidentScopeFilter(authz, startIndex = 1) {
    if (authz?.isAdmin) return { where: '', params: [], nextIndex: startIndex };
    if (!authz?.hasAnyScopeRows) return { where: 'WHERE 1=0', params: [], nextIndex: startIndex };

    const parts = [];
    const params = [];
    let idx = startIndex;

    if (Array.isArray(authz.allowedWorkflowIds) && authz.allowedWorkflowIds.length > 0) {
      parts.push(`i.workflow_id = ANY($${idx}::text[])`);
      params.push(authz.allowedWorkflowIds);
      idx += 1;
    }

    const canViewInstanceOnlyIncidents = authz.hasGlobalInstanceScope || (authz.scopedInstanceIds && authz.scopedInstanceIds.length > 0);
    if (canViewInstanceOnlyIncidents) {
      if (authz.hasGlobalInstanceScope) {
        parts.push('i.workflow_id IS NULL');
      } else {
        parts.push(`(i.workflow_id IS NULL AND i.instance_id = ANY($${idx}::text[]))`);
        params.push(authz.scopedInstanceIds || []);
        idx += 1;
      }
    }

    if (parts.length === 0) {
      return { where: 'WHERE 1=0', params: [], nextIndex: idx };
    }

    return {
      where: `WHERE (${parts.join(' OR ')})`,
      params,
      nextIndex: idx,
    };
  }

  async function getScopedIncident(req, incidentId) {
    const authz = req.authz;
    const scoped = buildIncidentScopeFilter(authz, 2);
    const where = scoped.where ? `${scoped.where} AND i.id = $1` : 'WHERE i.id = $1';
    const { rows } = await pool.query(
      `SELECT i.*
       FROM alert_incidents i
       ${where}
       LIMIT 1`,
      [incidentId, ...scoped.params]
    );
    return rows[0] || null;
  }

  function sanitizeRuleInput(body = {}) {
    const config = typeof body.config === 'object' && body.config !== null ? body.config : {};
    const resolvedRetentionRaw = body.retentionResolvedDays;
    const unresolvedRetentionRaw = body.retentionUnresolvedDays;
    const retentionResolvedDays = resolvedRetentionRaw === null || resolvedRetentionRaw === undefined || resolvedRetentionRaw === ''
      ? null
      : Math.max(1, Number(resolvedRetentionRaw));
    const retentionUnresolvedDays = unresolvedRetentionRaw === null || unresolvedRetentionRaw === undefined || unresolvedRetentionRaw === ''
      ? null
      : Math.max(1, Number(unresolvedRetentionRaw));

    return {
      name: String(body.name || '').trim(),
      description: body.description ? String(body.description).trim() : null,
      ruleType: String(body.ruleType || '').trim(),
      severity: String(body.severity || 'warning').toLowerCase(),
      enabled: body.enabled !== false,
      evaluationIntervalSec: Math.max(15, Number(body.evaluationIntervalSec || 300)),
      cooldownSec: Math.max(0, Number(body.cooldownSec || 600)),
      openAfterN: Math.max(1, Number(body.openAfterN || 1)),
      resolveAfterN: Math.max(1, Number(body.resolveAfterN || 1)),
      applyDefaultExclusions: body.applyDefaultExclusions !== false,
      config,
      selectors: Array.isArray(body.selectors) ? body.selectors : [],
      destinationIds: Array.isArray(body.destinationIds) ? body.destinationIds : [],
      retentionResolvedDays,
      retentionUnresolvedDays,
      destinationSettings: typeof body.destinationSettings === 'object' && body.destinationSettings !== null
        ? body.destinationSettings
        : {},
    };
  }

  function validateRuleInput(input) {
    const allowedTypes = ['workflow_inactivity', 'stuck_execution', 'metrics_freshness'];
    const allowedSeverity = ['info', 'warning', 'critical'];
    if (!input.name) return 'Rule name is required';
    if (!allowedTypes.includes(input.ruleType)) return 'Invalid rule type';
    if (!allowedSeverity.includes(input.severity)) return 'Invalid severity';
    if (input.retentionResolvedDays !== null && !Number.isFinite(input.retentionResolvedDays)) return 'Invalid resolved retention days';
    if (input.retentionUnresolvedDays !== null && !Number.isFinite(input.retentionUnresolvedDays)) return 'Invalid unresolved retention days';
    return null;
  }

  async function getOrCreateAlertRetentionSettings(updatedBy = null) {
    await pool.query(
      `INSERT INTO alert_retention_settings (id, resolved_days_default, unresolved_days_default, updated_by)
       VALUES (true, 30, 180, $1)
       ON CONFLICT (id) DO NOTHING`,
      [updatedBy]
    );

    const { rows } = await pool.query(
      `SELECT resolved_days_default, unresolved_days_default, updated_at
       FROM alert_retention_settings
       WHERE id = true
       LIMIT 1`
    );

    return rows[0] || {
      resolved_days_default: 30,
      unresolved_days_default: 180,
      updated_at: null,
    };
  }

  function sanitizeDestinationInput(body = {}) {
    return {
      name: String(body.name || '').trim(),
      enabled: body.enabled !== false,
      webhookUrl: String(body.webhookUrl || '').trim(),
      secret: body.secret ? String(body.secret) : null,
      headers: typeof body.headers === 'object' && body.headers !== null ? body.headers : {},
      timeoutMs: Math.max(1000, Number(body.timeoutMs || 5000)),
      retryMaxAttempts: Math.max(1, Number(body.retryMaxAttempts || 6)),
    };
  }

  async function sendDestinationWebhook(destination, payload) {
    const timeoutMs = Number(destination.timeout_ms || destination.timeoutMs || 5000);
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
      const response = await fetch(destination.webhook_url || destination.webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await response.text().catch(() => '');
      return {
        ok: response.ok,
        status: response.status,
        body: body.slice(0, 1000),
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

  router.get('/api/alerts/overview', requireAuth, alertsLimiter, attachAuthz, async (req, res) => {
    const permissions = await requireAnyPermission(req, res, ['alerts.read']);
    if (!permissions) return;

    const scoped = buildIncidentScopeFilter(req.authz);

    const { rows: activeRows } = await pool.query(
      `SELECT
         COUNT(*)::int AS active_count,
         COUNT(*) FILTER (WHERE i.severity = 'info')::int AS info_count,
         COUNT(*) FILTER (WHERE i.severity = 'warning')::int AS warning_count,
         COUNT(*) FILTER (WHERE i.severity = 'critical')::int AS critical_count
       FROM alert_incidents i
       ${scoped.where || ''}
       ${scoped.where ? " AND i.status IN ('open', 'acknowledged', 'suppressed')" : "WHERE i.status IN ('open', 'acknowledged', 'suppressed')"}`,
      scoped.params
    );

    const { rows: recentRows } = await pool.query(
      `SELECT i.id, i.rule_id, i.instance_id, i.workflow_id, w.name AS workflow_name, i.status, i.severity, i.title, i.summary, i.started_at, i.last_seen_at, i.resolved_at
       FROM alert_incidents i
       LEFT JOIN workflows_index w ON w.workflow_id = i.workflow_id
       ${scoped.where || ''}
       ORDER BY i.last_seen_at DESC
       LIMIT 20`,
      scoped.params
    );

    const { rows: deliveryRows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE o.status = 'sent')::int AS sent_count,
         COUNT(*) FILTER (WHERE o.status IN ('pending', 'retry', 'sending'))::int AS pending_count,
         COUNT(*) FILTER (WHERE o.status = 'dead')::int AS dead_count,
         COUNT(*) FILTER (WHERE o.status = 'retry')::int AS retry_count
       FROM alert_notification_outbox o
       JOIN alert_incidents i ON i.id = o.incident_id
       ${scoped.where || ''}`,
      scoped.params
    );

    res.json({
      active: activeRows[0] || {
        active_count: 0,
        info_count: 0,
        warning_count: 0,
        critical_count: 0,
      },
      recentIncidents: recentRows,
      deliveryHealth: deliveryRows[0] || {
        sent_count: 0,
        pending_count: 0,
        dead_count: 0,
        retry_count: 0,
      },
    });
  });

  router.get('/api/alerts/selector-options', requireAuth, alertsLimiter, attachAuthz, async (req, res) => {
    const permissions = await requireAnyPermission(req, res, ['alerts.read']);
    if (!permissions) return;

    const limit = Math.min(10000, Math.max(100, Number(req.query.limit || 5000)));

    const [workflowResult, instanceResult] = await Promise.all([
      pool.query(
        `SELECT instance_id, workflow_id, name, tags
         FROM workflows_index
         ORDER BY updated_at DESC NULLS LAST
         LIMIT $1`,
        [limit]
      ),
      pool.query(
        `SELECT DISTINCT instance_id
         FROM (
           SELECT instance_id FROM workflows_index
           UNION
           SELECT instance_id FROM n8n_metrics_snapshot
         ) x
         WHERE instance_id IS NOT NULL
         ORDER BY instance_id ASC`
      ),
    ]);

    const authz = req.authz;
    let workflows = workflowResult.rows;

    if (!authz.isAdmin) {
      if (!authz.hasAnyScopeRows) {
        workflows = [];
      } else if (!authz.hasGlobalInstanceScope) {
        const allowedWorkflowSet = new Set(Array.isArray(authz.allowedWorkflowIds) ? authz.allowedWorkflowIds : []);
        workflows = workflows.filter((workflow) => allowedWorkflowSet.has(workflow.workflow_id));
      }
    }

    const workflowInstanceSet = new Set(workflows.map((workflow) => workflow.instance_id).filter(Boolean));
    let instances = instanceResult.rows.map((row) => row.instance_id);

    if (!authz.isAdmin) {
      if (!authz.hasAnyScopeRows) {
        instances = [];
      } else if (!authz.hasGlobalInstanceScope) {
        const scopedInstanceSet = new Set(Array.isArray(authz.scopedInstanceIds) ? authz.scopedInstanceIds : []);
        instances = instances.filter((instanceId) => scopedInstanceSet.has(instanceId) || workflowInstanceSet.has(instanceId));
      }
    }

    const tags = [...new Set(workflows.flatMap((workflow) => parseTags(workflow.tags)))].sort((a, b) => a.localeCompare(b));

    res.json({
      instances,
      tags,
      workflows,
    });
  });

  router.get('/api/alerts/incidents', requireAuth, alertsLimiter, attachAuthz, async (req, res) => {
    const permissions = await requireAnyPermission(req, res, ['alerts.read']);
    if (!permissions) return;

    const status = req.query.status ? String(req.query.status) : null;
    const severity = req.query.severity ? String(req.query.severity) : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));

    const scoped = buildIncidentScopeFilter(req.authz, 1);
    const whereParts = [];
    const params = [...scoped.params];
    let idx = scoped.nextIndex;

    if (scoped.where) {
      whereParts.push(scoped.where.replace('WHERE ', ''));
    }

    if (status) {
      whereParts.push(`i.status = $${idx++}`);
      params.push(status);
    }

    if (severity) {
      whereParts.push(`i.severity = $${idx++}`);
      params.push(severity);
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT i.*, r.name AS rule_name, r.rule_type, w.name AS workflow_name
       FROM alert_incidents i
       JOIN alert_rules r ON r.id = i.rule_id
       LEFT JOIN workflows_index w ON w.workflow_id = i.workflow_id
       ${whereClause}
       ORDER BY i.last_seen_at DESC
       LIMIT $${idx}`,
      params
    );

    res.json(rows);
  });

  router.get('/api/alerts/incidents/:incidentId/events', requireAuth, alertsLimiter, attachAuthz, async (req, res) => {
    const permissions = await requireAnyPermission(req, res, ['alerts.read', 'alerts.history.read']);
    if (!permissions) return;

    const incident = await getScopedIncident(req, req.params.incidentId);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    const { rows } = await pool.query(
      `SELECT e.id, e.incident_id, e.event_type, e.actor_user_id, e.note, e.event_data, e.created_at, u.email AS actor_email
       FROM alert_incident_events e
       LEFT JOIN app_users u ON u.id = e.actor_user_id
       WHERE e.incident_id = $1
       ORDER BY e.created_at DESC
       LIMIT 200`,
      [incident.id]
    );

    res.json(rows);
  });

  router.post('/api/alerts/incidents/:incidentId/ack', requireAuth, alertsLimiter, attachAuthz, requirePermission('alerts.incidents.ack'), async (req, res) => {
    const incident = await getScopedIncident(req, req.params.incidentId);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    if (!['open', 'acknowledged'].includes(incident.status)) {
      return res.status(409).json({ error: 'Only open incidents can be acknowledged' });
    }

    const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
    const { rows } = await pool.query(
      `UPDATE alert_incidents
       SET status = 'acknowledged',
           acknowledged_at = now(),
           acknowledged_by = $2,
           acknowledge_note = $3,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [incident.id, req.user.sub, note]
    );

    const updated = rows[0];
    await pool.query(
      `INSERT INTO alert_incident_events (incident_id, event_type, actor_user_id, note, event_data)
       VALUES ($1, 'acknowledged', $2, $3, $4::jsonb)`,
      [updated.id, req.user.sub, note, JSON.stringify({ status: 'acknowledged' })]
    );

    await enqueueIncidentNotifications(pool, updated, updated.rule_id, 'acknowledged');

    await logAudit('alert_incident_acknowledged', {
      ...getAuditContext(req),
      targetType: 'alert_incident',
      targetId: updated.id,
      metadata: { ruleId: updated.rule_id },
    });

    res.json(updated);
  });

  router.post('/api/alerts/incidents/:incidentId/suppress', requireAuth, alertsLimiter, attachAuthz, requirePermission('alerts.incidents.ack'), async (req, res) => {
    const incident = await getScopedIncident(req, req.params.incidentId);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    const minutes = Math.max(1, Number(req.body?.minutes || 60));
    const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;

    const { rows } = await pool.query(
      `UPDATE alert_incidents
       SET status = 'suppressed',
           suppressed_until = now() + ($2::text || ' minutes')::interval,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [incident.id, String(minutes)]
    );

    const updated = rows[0];
    await pool.query(
      `INSERT INTO alert_incident_events (incident_id, event_type, actor_user_id, note, event_data)
       VALUES ($1, 'suppressed', $2, $3, $4::jsonb)`,
      [updated.id, req.user.sub, note, JSON.stringify({ minutes })]
    );

    res.json(updated);
  });

  router.post('/api/alerts/incidents/:incidentId/resolve', requireAuth, alertsLimiter, attachAuthz, requirePermission('alerts.incidents.ack'), async (req, res) => {
    const incident = await getScopedIncident(req, req.params.incidentId);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    if (!['open', 'acknowledged', 'suppressed'].includes(incident.status)) {
      return res.status(409).json({ error: 'Only active incidents can be resolved' });
    }

    const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
    const { rows } = await pool.query(
      `UPDATE alert_incidents
       SET status = 'resolved',
           resolved_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [incident.id]
    );

    const updated = rows[0];
    await pool.query(
      `INSERT INTO alert_incident_events (incident_id, event_type, actor_user_id, note, event_data)
       VALUES ($1, 'resolved', $2, $3, $4::jsonb)`,
      [updated.id, req.user.sub, note, JSON.stringify({ manual: true })]
    );

    await enqueueIncidentNotifications(pool, updated, updated.rule_id, 'resolved');

    await logAudit('alert_incident_resolved', {
      ...getAuditContext(req),
      targetType: 'alert_incident',
      targetId: updated.id,
      metadata: { ruleId: updated.rule_id, manual: true },
    });

    res.json(updated);
  });

  router.get('/api/alerts/retention-settings', requireAuth, alertsLimiter, async (req, res) => {
    const permissions = await requireAnyPermission(req, res, ['alerts.read']);
    if (!permissions) return;

    const settings = await getOrCreateAlertRetentionSettings();
    res.json({
      resolvedDaysDefault: Number(settings.resolved_days_default || 30),
      unresolvedDaysDefault: Number(settings.unresolved_days_default || 180),
      updatedAt: settings.updated_at,
    });
  });

  router.put('/api/alerts/retention-settings', requireAuth, alertsLimiter, requirePermission('admin:users'), async (req, res) => {
    const resolvedDaysDefault = Math.max(1, Number(req.body?.resolvedDaysDefault || 0));
    const unresolvedDaysDefault = Math.max(1, Number(req.body?.unresolvedDaysDefault || 0));

    if (!Number.isFinite(resolvedDaysDefault) || !Number.isFinite(unresolvedDaysDefault)) {
      return res.status(400).json({ error: 'Invalid retention days values' });
    }

    const { rows } = await pool.query(
      `INSERT INTO alert_retention_settings (id, resolved_days_default, unresolved_days_default, updated_by, updated_at)
       VALUES (true, $1, $2, $3, now())
       ON CONFLICT (id)
       DO UPDATE SET
        resolved_days_default = EXCLUDED.resolved_days_default,
        unresolved_days_default = EXCLUDED.unresolved_days_default,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
       RETURNING resolved_days_default, unresolved_days_default, updated_at`,
      [resolvedDaysDefault, unresolvedDaysDefault, req.user.sub]
    );

    await logAudit('alert_retention_settings_updated', {
      ...getAuditContext(req),
      targetType: 'alert_retention_settings',
      targetId: 'global',
      metadata: { resolvedDaysDefault, unresolvedDaysDefault },
    });

    res.json({
      resolvedDaysDefault: Number(rows[0].resolved_days_default),
      unresolvedDaysDefault: Number(rows[0].unresolved_days_default),
      updatedAt: rows[0].updated_at,
    });
  });

  router.get('/api/alerts/rules', requireAuth, alertsLimiter, async (req, res) => {
    const permissions = await requireAnyPermission(req, res, ['alerts.read']);
    if (!permissions) return;

    const { rows } = await pool.query(
      `SELECT
         r.*,
         COALESCE(dest.destinations_count, 0)::int AS destinations_count,
         COALESCE(sel.selectors, '[]'::json) AS selectors,
         COALESCE(dest.destinations, '[]'::json) AS destinations
       FROM alert_rules r
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS destinations_count,
           json_agg(
             json_build_object(
               'destination_id', rd.destination_id,
               'notify_on_open', rd.notify_on_open,
               'notify_on_resolve', rd.notify_on_resolve,
               'notify_on_ack', rd.notify_on_ack,
               'min_severity', rd.min_severity
             )
             ORDER BY rd.destination_id
           ) AS destinations
         FROM alert_rule_destinations rd
         WHERE rd.rule_id = r.id
       ) dest ON true
       LEFT JOIN LATERAL (
         SELECT
           json_agg(
             json_build_object(
               'mode', s.selector_mode,
               'kind', s.selector_kind,
               'value', s.selector_value
             )
             ORDER BY s.selector_mode, s.selector_kind, s.selector_value
           ) AS selectors
         FROM alert_rule_selectors s
         WHERE s.rule_id = r.id
       ) sel ON true
       ORDER BY r.created_at DESC`
    );

    const rules = rows.map((r) => ({
      ...r,
      config: parseRuleConfig(r),
    }));

    res.json(rules);
  });

  router.post('/api/alerts/rules', requireAuth, alertsLimiter, requirePermission('alerts.rules.manage'), async (req, res) => {
    const input = sanitizeRuleInput(req.body);
    const validationError = validateRuleInput(input);
    if (validationError) return res.status(400).json({ error: validationError });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO alert_rules
          (name, description, rule_type, severity, enabled, evaluation_interval_sec, cooldown_sec, open_after_n, resolve_after_n, apply_default_exclusions, config, retention_resolved_days, retention_unresolved_days, next_eval_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, now(), $14, $14)
         RETURNING *`,
        [
          input.name,
          input.description,
          input.ruleType,
          input.severity,
          input.enabled,
          input.evaluationIntervalSec,
          input.cooldownSec,
          input.openAfterN,
          input.resolveAfterN,
          input.applyDefaultExclusions,
          JSON.stringify(input.config),
          input.retentionResolvedDays,
          input.retentionUnresolvedDays,
          req.user.sub,
        ]
      );

      const rule = rows[0];

      for (const selector of input.selectors) {
        await client.query(
          `INSERT INTO alert_rule_selectors (rule_id, selector_mode, selector_kind, selector_value)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [
            rule.id,
            String(selector.mode || 'include'),
            String(selector.kind || ''),
            String(selector.value || ''),
          ]
        );
      }

      for (const destinationId of input.destinationIds) {
        const cfg = input.destinationSettings[destinationId] || {};
        await client.query(
          `INSERT INTO alert_rule_destinations
            (rule_id, destination_id, notify_on_open, notify_on_resolve, notify_on_ack, min_severity)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (rule_id, destination_id)
           DO UPDATE SET
            notify_on_open = EXCLUDED.notify_on_open,
            notify_on_resolve = EXCLUDED.notify_on_resolve,
            notify_on_ack = EXCLUDED.notify_on_ack,
            min_severity = EXCLUDED.min_severity`,
          [
            rule.id,
            destinationId,
            cfg.notifyOnOpen !== false,
            cfg.notifyOnResolve !== false,
            cfg.notifyOnAck === true,
            String(cfg.minSeverity || 'info'),
          ]
        );
      }

      await client.query('COMMIT');

      await logAudit('alert_rule_created', {
        ...getAuditContext(req),
        targetType: 'alert_rule',
        targetId: rule.id,
        metadata: { ruleType: rule.rule_type, severity: rule.severity },
      });

      res.status(201).json({ ...rule, config: parseRuleConfig(rule) });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message || 'Failed to create rule' });
    } finally {
      client.release();
    }
  });

  router.put('/api/alerts/rules/:ruleId', requireAuth, alertsLimiter, requirePermission('alerts.rules.manage'), async (req, res) => {
    const input = sanitizeRuleInput(req.body);
    const validationError = validateRuleInput(input);
    if (validationError) return res.status(400).json({ error: validationError });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows, rowCount } = await client.query(
        `UPDATE alert_rules
         SET name = $2,
             description = $3,
             rule_type = $4,
             severity = $5,
             enabled = $6,
             evaluation_interval_sec = $7,
             cooldown_sec = $8,
             open_after_n = $9,
             resolve_after_n = $10,
             apply_default_exclusions = $11,
             config = $12::jsonb,
             retention_resolved_days = $13,
             retention_unresolved_days = $14,
             next_eval_at = now(),
             version = version + 1,
             updated_by = $15,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          req.params.ruleId,
          input.name,
          input.description,
          input.ruleType,
          input.severity,
          input.enabled,
          input.evaluationIntervalSec,
          input.cooldownSec,
          input.openAfterN,
          input.resolveAfterN,
          input.applyDefaultExclusions,
          JSON.stringify(input.config),
          input.retentionResolvedDays,
          input.retentionUnresolvedDays,
          req.user.sub,
        ]
      );

      if (!rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Rule not found' });
      }

      await client.query(`DELETE FROM alert_rule_selectors WHERE rule_id = $1`, [req.params.ruleId]);
      await client.query(`DELETE FROM alert_rule_destinations WHERE rule_id = $1`, [req.params.ruleId]);

      for (const selector of input.selectors) {
        await client.query(
          `INSERT INTO alert_rule_selectors (rule_id, selector_mode, selector_kind, selector_value)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [
            req.params.ruleId,
            String(selector.mode || 'include'),
            String(selector.kind || ''),
            String(selector.value || ''),
          ]
        );
      }

      for (const destinationId of input.destinationIds) {
        const cfg = input.destinationSettings[destinationId] || {};
        await client.query(
          `INSERT INTO alert_rule_destinations
            (rule_id, destination_id, notify_on_open, notify_on_resolve, notify_on_ack, min_severity)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            req.params.ruleId,
            destinationId,
            cfg.notifyOnOpen !== false,
            cfg.notifyOnResolve !== false,
            cfg.notifyOnAck === true,
            String(cfg.minSeverity || 'info'),
          ]
        );
      }

      await client.query('COMMIT');

      await logAudit('alert_rule_updated', {
        ...getAuditContext(req),
        targetType: 'alert_rule',
        targetId: req.params.ruleId,
        metadata: { ruleType: rows[0].rule_type, severity: rows[0].severity },
      });

      res.json({ ...rows[0], config: parseRuleConfig(rows[0]) });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message || 'Failed to update rule' });
    } finally {
      client.release();
    }
  });

  router.delete('/api/alerts/rules/:ruleId', requireAuth, alertsLimiter, requirePermission('alerts.rules.manage'), async (req, res) => {
    const { rowCount } = await pool.query(`DELETE FROM alert_rules WHERE id = $1`, [req.params.ruleId]);
    if (!rowCount) return res.status(404).json({ error: 'Rule not found' });

    await logAudit('alert_rule_deleted', {
      ...getAuditContext(req),
      targetType: 'alert_rule',
      targetId: req.params.ruleId,
    });

    res.json({ ok: true });
  });

  router.post('/api/alerts/rules/:ruleId/toggle', requireAuth, alertsLimiter, requirePermission('alerts.rules.manage'), async (req, res) => {
    const enabled = req.body?.enabled !== false;
    const { rows, rowCount } = await pool.query(
      `UPDATE alert_rules
       SET enabled = $2,
           next_eval_at = now(),
           updated_by = $3,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [req.params.ruleId, enabled, req.user.sub]
    );

    if (!rowCount) return res.status(404).json({ error: 'Rule not found' });

    await logAudit('alert_rule_toggled', {
      ...getAuditContext(req),
      targetType: 'alert_rule',
      targetId: req.params.ruleId,
      metadata: { enabled },
    });

    res.json({ ...rows[0], config: parseRuleConfig(rows[0]) });
  });

  router.get('/api/alerts/rules/:ruleId/preview-targets', requireAuth, alertsLimiter, attachAuthz, async (req, res) => {
    const permissions = await requireAnyPermission(req, res, ['alerts.read']);
    if (!permissions) return;

    const { rows } = await pool.query(`SELECT * FROM alert_rules WHERE id = $1`, [req.params.ruleId]);
    if (!rows.length) return res.status(404).json({ error: 'Rule not found' });

    const targets = await resolveRuleTargets(pool, rows[0]);

    const authz = req.authz;
    let filteredTargets = targets;

    if (!authz.isAdmin) {
      filteredTargets = targets.filter((target) => {
        if (target.workflow_id && authz.allowedWorkflowIds?.includes(target.workflow_id)) return true;
        if (!target.workflow_id && authz.hasGlobalInstanceScope) return true;
        if (!target.workflow_id && authz.scopedInstanceIds?.includes(target.instance_id)) return true;
        return false;
      });
    }

    res.json({
      count: filteredTargets.length,
      targets: filteredTargets.slice(0, 500),
    });
  });

  router.post('/api/alerts/rules/preview-targets', requireAuth, alertsLimiter, attachAuthz, async (req, res) => {
    const permissions = await requireAnyPermission(req, res, ['alerts.read']);
    if (!permissions) return;

    const input = sanitizeRuleInput(req.body || {});
    const validationError = validateRuleInput(input);
    if (validationError) return res.status(400).json({ error: validationError });

    const rule = {
      id: req.body?.ruleId || 'preview',
      rule_type: input.ruleType,
      severity: input.severity,
      apply_default_exclusions: input.applyDefaultExclusions,
      config: input.config,
      selectorsOverride: input.selectors,
    };

    const targets = await resolveRuleTargets(pool, rule);

    const authz = req.authz;
    let filteredTargets = targets;

    if (!authz.isAdmin) {
      filteredTargets = targets.filter((target) => {
        if (target.workflow_id && authz.allowedWorkflowIds?.includes(target.workflow_id)) return true;
        if (!target.workflow_id && authz.hasGlobalInstanceScope) return true;
        if (!target.workflow_id && authz.scopedInstanceIds?.includes(target.instance_id)) return true;
        return false;
      });
    }

    res.json({
      count: filteredTargets.length,
      targets: filteredTargets.slice(0, 500),
    });
  });

  router.post('/api/alerts/rules/:ruleId/run-now', requireAuth, alertsLimiter, requirePermission('alerts.rules.manage'), async (req, res) => {
    try {
      await runRuleNow(pool, req.params.ruleId);
      await logAudit('alert_rule_run_now', {
        ...getAuditContext(req),
        targetType: 'alert_rule',
        targetId: req.params.ruleId,
      });
      res.json({ ok: true, ruleId: req.params.ruleId });
    } catch (err) {
      if (err?.code === 'RULE_NOT_FOUND') return res.status(404).json({ error: 'Rule not found' });
      if (err?.code === 'RULE_DISABLED') return res.status(409).json({ error: 'Rule is disabled' });
      return res.status(500).json({ error: err?.message || 'Failed to run rule' });
    }
  });

  router.get('/api/alerts/destinations', requireAuth, alertsLimiter, async (req, res) => {
    const permissions = await requireAnyPermission(req, res, ['alerts.read']);
    if (!permissions) return;

    const { rows } = await pool.query(
      `SELECT id, name, type, enabled, webhook_url, headers, timeout_ms, retry_max_attempts, secret_encrypted, created_at, updated_at
       FROM alert_destinations
       ORDER BY created_at DESC`
    );

    res.json(rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled,
      webhookUrl: row.webhook_url,
      headers: normalizeHeaders(row.headers),
      timeoutMs: row.timeout_ms,
      retryMaxAttempts: row.retry_max_attempts,
      hasSecret: Boolean(row.secret_encrypted),
      maskedSecret: row.secret_encrypted ? maskSecret('**************') : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })));
  });

  router.post('/api/alerts/destinations', requireAuth, alertsLimiter, requirePermission('alerts.destinations.manage'), async (req, res) => {
    const input = sanitizeDestinationInput(req.body);
    if (!input.name) return res.status(400).json({ error: 'Destination name is required' });
    if (!input.webhookUrl) return res.status(400).json({ error: 'Webhook URL is required' });

    let encrypted = null;
    if (input.secret) encrypted = encryptSecret(input.secret);

    const { rows } = await pool.query(
      `INSERT INTO alert_destinations
        (name, type, enabled, webhook_url, secret_encrypted, headers, timeout_ms, retry_max_attempts, created_by, updated_by)
       VALUES ($1, 'webhook', $2, $3, $4, $5::jsonb, $6, $7, $8, $8)
       RETURNING *`,
      [
        input.name,
        input.enabled,
        input.webhookUrl,
        encrypted,
        JSON.stringify(input.headers),
        input.timeoutMs,
        input.retryMaxAttempts,
        req.user.sub,
      ]
    );

    await logAudit('alert_destination_created', {
      ...getAuditContext(req),
      targetType: 'alert_destination',
      targetId: rows[0].id,
      metadata: { name: input.name },
    });

    res.status(201).json({
      id: rows[0].id,
      name: rows[0].name,
      type: rows[0].type,
      enabled: rows[0].enabled,
      webhookUrl: rows[0].webhook_url,
      headers: normalizeHeaders(rows[0].headers),
      timeoutMs: rows[0].timeout_ms,
      retryMaxAttempts: rows[0].retry_max_attempts,
      hasSecret: Boolean(rows[0].secret_encrypted),
      maskedSecret: rows[0].secret_encrypted ? maskSecret('**************') : null,
      createdAt: rows[0].created_at,
      updatedAt: rows[0].updated_at,
    });
  });

  router.put('/api/alerts/destinations/:destinationId', requireAuth, alertsLimiter, requirePermission('alerts.destinations.manage'), async (req, res) => {
    const input = sanitizeDestinationInput(req.body);
    if (!input.name) return res.status(400).json({ error: 'Destination name is required' });
    if (!input.webhookUrl) return res.status(400).json({ error: 'Webhook URL is required' });

    let secretClause = 'secret_encrypted = secret_encrypted';
    const params = [
      req.params.destinationId,
      input.name,
      input.enabled,
      input.webhookUrl,
      JSON.stringify(input.headers),
      input.timeoutMs,
      input.retryMaxAttempts,
      req.user.sub,
    ];

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'secret')) {
      secretClause = 'secret_encrypted = $9';
      params.push(input.secret ? encryptSecret(input.secret) : null);
    }

    const { rows, rowCount } = await pool.query(
      `UPDATE alert_destinations
       SET name = $2,
           enabled = $3,
           webhook_url = $4,
           headers = $5::jsonb,
           timeout_ms = $6,
           retry_max_attempts = $7,
           ${secretClause},
           updated_by = $8,
           updated_at = now(),
           version = version + 1
       WHERE id = $1
       RETURNING *`,
      params
    );

    if (!rowCount) return res.status(404).json({ error: 'Destination not found' });

    await logAudit('alert_destination_updated', {
      ...getAuditContext(req),
      targetType: 'alert_destination',
      targetId: rows[0].id,
      metadata: { name: rows[0].name },
    });

    res.json({
      id: rows[0].id,
      name: rows[0].name,
      type: rows[0].type,
      enabled: rows[0].enabled,
      webhookUrl: rows[0].webhook_url,
      headers: normalizeHeaders(rows[0].headers),
      timeoutMs: rows[0].timeout_ms,
      retryMaxAttempts: rows[0].retry_max_attempts,
      hasSecret: Boolean(rows[0].secret_encrypted),
      maskedSecret: rows[0].secret_encrypted ? maskSecret('**************') : null,
      createdAt: rows[0].created_at,
      updatedAt: rows[0].updated_at,
    });
  });

  router.delete('/api/alerts/destinations/:destinationId', requireAuth, alertsLimiter, requirePermission('alerts.destinations.manage'), async (req, res) => {
    const { rowCount } = await pool.query(`DELETE FROM alert_destinations WHERE id = $1`, [req.params.destinationId]);
    if (!rowCount) return res.status(404).json({ error: 'Destination not found' });

    await logAudit('alert_destination_deleted', {
      ...getAuditContext(req),
      targetType: 'alert_destination',
      targetId: req.params.destinationId,
    });

    res.json({ ok: true });
  });

  router.post('/api/alerts/destinations/:destinationId/test', requireAuth, alertsTestLimiter, requirePermission('alerts.destinations.test'), async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM alert_destinations WHERE id = $1`, [req.params.destinationId]);
    if (!rows.length) return res.status(404).json({ error: 'Destination not found' });

    const destination = rows[0];
    const payload = {
      eventType: 'test',
      sentAt: new Date().toISOString(),
      actorUserId: req.user.sub,
      message: 'n8n-trace alert destination test payload',
      sampleIncident: {
        status: 'open',
        severity: 'warning',
        title: 'Test alert',
        summary: 'This is a test notification from Alerts tools',
      },
      customPayload: req.body?.payload || null,
    };

    const result = await sendDestinationWebhook(destination, payload);

    await logAudit('alert_destination_tested', {
      ...getAuditContext(req),
      targetType: 'alert_destination',
      targetId: destination.id,
      metadata: { success: result.ok, status: result.status },
    });

    res.json(result);
  });

  router.get('/api/alerts/delivery-log', requireAuth, alertsLimiter, attachAuthz, async (req, res) => {
    const permissions = await requireAnyPermission(req, res, ['alerts.history.read', 'alerts.read']);
    if (!permissions) return;

    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
    const status = req.query.status ? String(req.query.status) : null;

    const scoped = buildIncidentScopeFilter(req.authz, 1);
    const whereParts = [];
    const params = [...scoped.params];
    let idx = scoped.nextIndex;

    if (scoped.where) whereParts.push(scoped.where.replace('WHERE ', ''));

    if (status) {
      whereParts.push(`o.status = $${idx++}`);
      params.push(status);
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT
         o.id,
         o.incident_id,
         o.rule_id,
         o.destination_id,
         o.event_type,
         o.status,
         o.attempt_count,
         o.max_attempts,
         o.next_attempt_at,
         o.last_error,
         o.last_response_status,
         o.created_at,
         o.updated_at,
         i.title AS incident_title,
         i.severity,
         i.instance_id,
         i.workflow_id,
         d.name AS destination_name
       FROM alert_notification_outbox o
       JOIN alert_incidents i ON i.id = o.incident_id
       LEFT JOIN alert_destinations d ON d.id = o.destination_id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${idx}`,
      params
    );

    res.json(rows);
  });

  router.get('/api/alerts/tools/engine-status', requireAuth, alertsLimiter, async (req, res) => {
    const permissions = await getPermissions(req);
    if (!isAdminPerm(permissions) && !permissions.includes('alerts.history.read')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(getAlertsEngineStatus());
  });

  router.get('/api/alerts/tools/attempts/:outboxId', requireAuth, alertsLimiter, async (req, res) => {
    const permissions = await requireAnyPermission(req, res, ['alerts.history.read']);
    if (!permissions) return;

    const { rows } = await pool.query(
      `SELECT id, outbox_id, attempt_no, attempted_at, success, response_status, error, latency_ms
       FROM alert_notification_attempts
       WHERE outbox_id = $1
       ORDER BY attempt_no DESC
       LIMIT 100`,
      [req.params.outboxId]
    );

    res.json(rows);
  });

  return router;
}

module.exports = { createAlertsRouter };
