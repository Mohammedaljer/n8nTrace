/**
 * Comprehensive seed script for n8n Pulse dashboard
 *
 * Populates every table the UI reads from with realistic mock data so the
 * dashboard charts, tables, cards and metrics explorer all look production-
 * grade in screenshots.
 *
 * Usage:
 *   cd backend
 *   npm run seed:all
 *
 * Re-runnable: truncates seeded tables before inserting (app_users / RBAC
 * tables are NOT touched).
 */

const { Pool } = require('pg');
const { labelsHash } = require('../src/utils/labels');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ═══════════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const INSTANCES = [
  { id: 'prod',    label: 'Production' },
  { id: 'staging', label: 'Staging' },
];

const WORKFLOWS = [
  { id: 'wf-001', name: 'Daily Sales Sync',               active: true,  tags: 'sales,sync',          nodes: 8,  nodeTypes: 'Schedule Trigger,Postgres,HTTP Request,IF,Set,Slack' },
  { id: 'wf-002', name: 'Stripe to Slack Alerts',         active: true,  tags: 'payments,alerts',     nodes: 5,  nodeTypes: 'Stripe Trigger,IF,Slack,Set' },
  { id: 'wf-003', name: 'Lead Enrichment Pipeline',       active: true,  tags: 'crm,enrichment',      nodes: 11, nodeTypes: 'Webhook,HTTP Request,Clearbit,IF,Merge,HubSpot,Set' },
  { id: 'wf-004', name: 'Database Backup (Nightly)',      active: true,  tags: 'ops,backup',          nodes: 6,  nodeTypes: 'Schedule Trigger,Execute Command,S3,Slack,IF' },
  { id: 'wf-005', name: 'Customer Onboarding Emails',     active: true,  tags: 'email,onboarding',    nodes: 9,  nodeTypes: 'Webhook,Postgres,SendGrid,Wait,IF,Set,Merge' },
  { id: 'wf-006', name: 'Inventory Low-Stock Alert',      active: true,  tags: 'inventory,alerts',    nodes: 7,  nodeTypes: 'Schedule Trigger,Postgres,IF,Slack,Email,Set' },
  { id: 'wf-007', name: 'GitHub PR Review Notifier',      active: true,  tags: 'devops,github',       nodes: 4,  nodeTypes: 'GitHub Trigger,IF,Slack' },
  { id: 'wf-008', name: 'Monthly Invoice Generator',      active: true,  tags: 'finance,invoices',    nodes: 12, nodeTypes: 'Schedule Trigger,Postgres,Code,HTTP Request,Google Sheets,SendGrid,IF,Set' },
  { id: 'wf-009', name: 'Zendesk Ticket Triage',          active: true,  tags: 'support,zendesk',     nodes: 6,  nodeTypes: 'Zendesk Trigger,IF,OpenAI,Zendesk,Slack' },
  { id: 'wf-010', name: 'ETL — Warehouse Load',           active: true,  tags: 'data,etl',            nodes: 14, nodeTypes: 'Schedule Trigger,Postgres,Code,BigQuery,IF,Merge,Set' },
  { id: 'wf-011', name: 'Slack Standup Bot',              active: true,  tags: 'team,slack',          nodes: 5,  nodeTypes: 'Schedule Trigger,Slack,Code,Slack' },
  { id: 'wf-012', name: 'Image Resize (S3 Trigger)',      active: false, tags: 'media,s3',            nodes: 6,  nodeTypes: 'S3 Trigger,HTTP Request,Code,S3,Slack' },
  { id: 'wf-013', name: 'Abandoned Cart Recovery',        active: false, tags: 'ecommerce,email',     nodes: 8,  nodeTypes: 'Schedule Trigger,Postgres,IF,Wait,SendGrid,Set' },
  { id: 'wf-014', name: 'Webhook → Google Sheets Log',    active: true,  tags: 'logging,sheets',      nodes: 3,  nodeTypes: 'Webhook,Google Sheets' },
];

const EXEC_MODES = ['webhook', 'trigger', 'manual', 'retry'];

const ERROR_MESSAGES = [
  'NodeApiError: Request failed with status code 401 — Unauthorized',
  'NodeApiError: Request failed with status code 429 — Too Many Requests',
  'NodeApiError: Request failed with status code 500 — Internal Server Error',
  'NodeApiError: ECONNREFUSED 10.0.3.12:5432 — PostgreSQL connection refused',
  'NodeApiError: connect ETIMEDOUT 52.45.120.33:443',
  'NodeOperationError: The resource "contact" was not found',
  'NodeOperationError: Webhook payload missing required field "email"',
  'NodeOperationError: Rate limit exceeded, retry after 60s',
  'NodeOperationError: Invalid JSON in response body',
  'Error: ENOMEM — not enough memory to complete the operation',
  'TypeError: Cannot read properties of undefined (reading "id")',
  'Error: Query read timeout — Postgres query exceeded 30 000 ms',
];

const NODE_NAMES_BY_WORKFLOW = {
  'wf-001': ['Schedule Trigger','Fetch Orders','Filter New','Transform','Upsert Postgres','Notify Slack','Error Handler','Set Timestamp'],
  'wf-002': ['Stripe Trigger','Check Amount','Format Message','Send to Slack','Log Event'],
  'wf-003': ['Webhook','Validate Input','Clearbit Lookup','Check Company','Merge Data','HubSpot Create','HubSpot Update','Assign Owner','Notify Sales','Error Handler','Set Fields'],
  'wf-004': ['Schedule Trigger','Dump DB','Compress','Upload S3','Notify Slack','Check Size'],
  'wf-005': ['Webhook','Get User','Send Welcome','Wait 1d','Send Tips','Check Opened','Send Reminder','Merge','Update Status'],
  'wf-006': ['Schedule Trigger','Query Stock','Filter Low','Build Alert','Send Slack','Send Email','Update Flag'],
  'wf-007': ['GitHub Trigger','Filter Drafts','Format PR','Send to Slack'],
  'wf-008': ['Schedule Trigger','Get Customers','Calc Totals','Generate PDF','Upload Drive','Sheet Row','Email Invoice','Check Paid','Reminder','Set Status','Error Handler','Log Result'],
  'wf-009': ['Zendesk Trigger','Classify','AI Categorize','Update Ticket','Route Agent','Notify Slack'],
  'wf-010': ['Schedule Trigger','Extract CRM','Extract Orders','Extract Events','Join Keys','Deduplicate','Clean Nulls','Calc Metrics','Stage Table','Load BQ','Verify Count','Archive Raw','Notify','Set Metadata'],
  'wf-011': ['Schedule Trigger','Post Prompt','Collect Replies','Format Summary','Post Summary'],
  'wf-012': ['S3 Trigger','Download','Resize','Upload Resized','Update DB','Notify'],
  'wf-013': ['Schedule Trigger','Find Carts','Filter Age','Build Email','Wait 2h','Send Reminder','Check Recovered','Update Status'],
  'wf-014': ['Webhook','Append Row','Done'],
};

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Random integer in [min, max] */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Random float in [min, max) */
const randFloat = (min, max) => Math.random() * (max - min) + min;

/** Pick a random element from an array */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Weighted random status */
function randomStatus() {
  const r = Math.random();
  if (r < 0.85) return 'success';
  if (r < 0.95) return 'error';
  if (r < 0.97) return 'running';
  return 'waiting';
}

/** Realistic execution duration in ms — bimodal: most fast, some slow */
function randomDuration() {
  if (Math.random() < 0.6)  return randInt(120, 2000);      // fast  < 2 s
  if (Math.random() < 0.85) return randInt(2000, 8000);      // medium
  if (Math.random() < 0.95) return randInt(8000, 30000);     // slow
  return randInt(30000, 120000);                               // very slow
}

/** Generate a diurnal traffic multiplier for a given hour (0-23) */
function diurnalMultiplier(hour) {
  // Low traffic 0-6, ramp 6-9, peak 9-17, ramp-down 17-22, low 22-24
  if (hour < 6)  return 0.15 + Math.random() * 0.1;
  if (hour < 9)  return 0.4  + (hour - 6) * 0.2 + Math.random() * 0.1;
  if (hour < 17) return 0.85 + Math.random() * 0.15;
  if (hour < 22) return 0.6  - (hour - 17) * 0.08 + Math.random() * 0.1;
  return 0.2 + Math.random() * 0.1;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SEED FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function cleanSeedTables(client) {
  console.log('🗑️  Cleaning existing seed data …');
  // Order matters (FKs): nodes → executions → workflows → metrics
  await client.query('DELETE FROM execution_nodes WHERE instance_id IN ($1,$2)', [INSTANCES[0].id, INSTANCES[1].id]);
  await client.query('DELETE FROM executions       WHERE instance_id IN ($1,$2)', [INSTANCES[0].id, INSTANCES[1].id]);
  await client.query('DELETE FROM workflows_index   WHERE instance_id IN ($1,$2)', [INSTANCES[0].id, INSTANCES[1].id]);
  await client.query('DELETE FROM n8n_metrics_snapshot WHERE instance_id IN ($1,$2)', [INSTANCES[0].id, INSTANCES[1].id]);
  await client.query('DELETE FROM metrics_samples USING metrics_series WHERE metrics_samples.series_id = metrics_series.id AND metrics_series.instance_id IN ($1,$2)', [INSTANCES[0].id, INSTANCES[1].id]);
  await client.query('DELETE FROM metrics_series WHERE instance_id IN ($1,$2)', [INSTANCES[0].id, INSTANCES[1].id]);
  console.log('   done.\n');
}

// ───────────────────────────────────────────────────────────────────────────
//  1. WORKFLOWS
// ───────────────────────────────────────────────────────────────────────────
async function seedWorkflows(client) {
  console.log('📋  Seeding workflows_index …');
  const now = new Date();

  for (const inst of INSTANCES) {
    for (const wf of WORKFLOWS) {
      const createdAt = new Date(now.getTime() - randInt(30, 180) * 86400000);
      const updatedAt = new Date(createdAt.getTime() + randInt(0, 30) * 86400000);
      await client.query(
        `INSERT INTO workflows_index
           (instance_id, workflow_id, name, active, is_archived, created_at, updated_at, tags, nodes_count, node_types)
         VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8,$9)
         ON CONFLICT (workflow_id) DO NOTHING`,
        [inst.id, `${inst.id}-${wf.id}`, wf.name, wf.active, createdAt, updatedAt, wf.tags, wf.nodes, wf.nodeTypes],
      );
    }
  }

  const count = INSTANCES.length * WORKFLOWS.length;
  console.log(`   ✅ ${count} workflows inserted.\n`);
}

// ───────────────────────────────────────────────────────────────────────────
//  2. EXECUTIONS  +  3. EXECUTION NODES (Error data lives in node rows)
// ───────────────────────────────────────────────────────────────────────────
async function seedExecutions(client) {
  console.log('⚡  Seeding executions & execution_nodes …');
  const now = Date.now();
  const DAYS_BACK = 30;

  let execCount = 0;
  let nodeCount = 0;
  let execBatch = [];
  let nodeBatch = [];

  for (const inst of INSTANCES) {
    // Walk hour-by-hour over the last DAYS_BACK days
    for (let d = DAYS_BACK; d >= 0; d--) {
      for (let h = 0; h < 24; h++) {
        const hourStart = now - d * 86400000 - (23 - h) * 3600000;
        const baseCount = inst.id === 'prod' ? 12 : 4; // prod gets ~3× traffic
        const count = Math.round(baseCount * diurnalMultiplier(h));

        for (let i = 0; i < count; i++) {
          const wf = pick(WORKFLOWS);
          const wfId = `${inst.id}-${wf.id}`;
          const status = randomStatus();
          const durationMs = (status === 'running' || status === 'waiting') ? 0 : randomDuration();
          const startedAt = new Date(hourStart + randInt(0, 3599) * 1000);
          const stoppedAt = new Date(startedAt.getTime() + durationMs);
          const finished = status === 'success' || status === 'error';
          const execId = `exec-${inst.id}-${Date.now()}-${execCount}`;
          const mode = pick(EXEC_MODES);

          const nodes = NODE_NAMES_BY_WORKFLOW[wf.id] || ['Start', 'End'];
          // Pick the "last node" — for errors, pick a random middle node
          const lastNode = status === 'error'
            ? nodes[randInt(1, nodes.length - 1)]
            : nodes[nodes.length - 1];

          execBatch.push([
            inst.id, execId, wfId, status, finished, mode,
            startedAt.toISOString(), stoppedAt.toISOString(),
            durationMs, lastNode, nodes.join(','), nodes.length,
          ]);
          execCount++;

          // ── execution_nodes rows ──
          let elapsed = 0;
          for (let ni = 0; ni < nodes.length; ni++) {
            const nodeName = nodes[ni];
            const isLast = nodeName === lastNode;
            let nodeStatus;
            if (status === 'error' && isLast) {
              nodeStatus = 'error';
            } else if (status === 'error' && ni > nodes.indexOf(lastNode)) {
              continue; // nodes after the failed node don't execute
            } else {
              nodeStatus = 'success';
            }

            const nodeTime = isLast && status !== 'error'
              ? Math.max(0, durationMs - elapsed)
              : randInt(5, Math.max(10, Math.floor(durationMs / nodes.length)));
            elapsed += nodeTime;

            const nodeStartTime = new Date(startedAt.getTime() + Math.max(0, elapsed - nodeTime));

            nodeBatch.push([
              inst.id, execId, wfId, nodeName,
              wf.nodeTypes.split(',')[Math.min(ni, wf.nodeTypes.split(',').length - 1)]?.trim() || 'n8n-nodes-base.set',
              0, 1, isLast, nodeStatus, nodeTime,
              nodeStartTime.getTime(), nodeStartTime.toISOString(),
              nodeStatus === 'success' ? randInt(1, 200) : 0,
              nodeStatus === 'success' ? randInt(1, 200) : 0,
            ]);
            nodeCount++;

            if (isLast && status === 'error') break;
          }

          // Flush in batches — always flush executions before their nodes
          if (execBatch.length >= 500) {
            await flushExecutions(client, execBatch);
            execBatch = [];
            if (nodeBatch.length) {
              await flushNodes(client, nodeBatch);
              nodeBatch = [];
            }
          }
        }
      }
    }
  }

  // Flush remaining
  if (execBatch.length)  await flushExecutions(client, execBatch);
  if (nodeBatch.length)  await flushNodes(client, nodeBatch);

  console.log(`   ✅ ${execCount} executions inserted.`);
  console.log(`   ✅ ${nodeCount} execution_nodes inserted.\n`);
}

async function flushExecutions(client, rows) {
  // Build multi-row INSERT
  const cols = 12;
  const placeholders = rows.map((_, i) => {
    const base = i * cols;
    return `(${Array.from({ length: cols }, (_, j) => `$${base + j + 1}`).join(',')})`;
  }).join(',');

  const flat = rows.flat();

  await client.query(
    `INSERT INTO executions
       (instance_id, execution_id, workflow_id, status, finished, mode,
        started_at, stopped_at, duration_ms, last_node_executed, node_names_executed, nodes_count)
     VALUES ${placeholders}
     ON CONFLICT (instance_id, execution_id) DO NOTHING`,
    flat,
  );
}

async function flushNodes(client, rows) {
  const cols = 14;
  const placeholders = rows.map((_, i) => {
    const base = i * cols;
    return `(${Array.from({ length: cols }, (_, j) => `$${base + j + 1}`).join(',')})`;
  }).join(',');

  const flat = rows.flat();

  await client.query(
    `INSERT INTO execution_nodes
       (instance_id, execution_id, workflow_id, node_name, node_type,
        run_index, runs_count, is_last_run, execution_status, execution_time_ms,
        start_time_ms, start_time, items_out_count, items_out_total_all_runs)
     VALUES ${placeholders}
     ON CONFLICT (instance_id, execution_id, node_name, run_index) DO NOTHING`,
    flat,
  );
}

// ───────────────────────────────────────────────────────────────────────────
//  4. n8n_metrics_snapshot  (Instance health / heartbeat)
// ───────────────────────────────────────────────────────────────────────────
async function seedMetricsSnapshot(client) {
  console.log('💓  Seeding n8n_metrics_snapshot (heartbeats & health) …');
  const now = Date.now();
  const DAYS_BACK = 7;
  const INTERVAL_MIN = 5; // snapshot every 5 min
  const totalPoints = (DAYS_BACK * 24 * 60) / INTERVAL_MIN;

  let count = 0;
  let batch = [];

  for (const inst of INSTANCES) {
    // Simulate an uptime start time (process_start_time)
    const processStartSec = Math.floor((now - 15 * 86400000) / 1000); // started 15 days ago
    let cpuTotal = randFloat(200, 400); // cumulative CPU seconds

    for (let i = 0; i < totalPoints; i++) {
      const ts = new Date(now - (totalPoints - i) * INTERVAL_MIN * 60000);
      const hour = ts.getUTCHours();
      const load = diurnalMultiplier(hour);

      cpuTotal += randFloat(0.5, 3.0) * load;

      const rssBase  = inst.id === 'prod' ? 450_000_000 : 280_000_000;
      const heapBase = inst.id === 'prod' ? 220_000_000 : 130_000_000;

      batch.push([
        ts.toISOString(),
        inst.id,
        '1.76.1',
        '22.12.0',
        processStartSec,
        inst.id === 'prod',
        Math.round(8 + load * 6),                                          // active_workflows
        cpuTotal,
        Math.round(rssBase  + rssBase  * 0.15 * Math.sin(i / 40) + rssBase  * 0.08 * (Math.random() - 0.5)), // rss
        Math.round(heapBase + heapBase * 0.20 * Math.sin(i / 30) + heapBase * 0.10 * (Math.random() - 0.5)), // heap
        Math.round(1_500_000 + Math.random() * 500_000),                   // external_memory
        0.002 + Math.random() * 0.008 * load,                              // eventloop lag p99
        Math.round(25 + load * 15 + Math.random() * 5),                    // open_fds
      ]);
      count++;

      if (batch.length >= 500) {
        await flushSnapshots(client, batch);
        batch = [];
      }
    }
  }

  if (batch.length) await flushSnapshots(client, batch);
  console.log(`   ✅ ${count} metric snapshots inserted.\n`);
}

async function flushSnapshots(client, rows) {
  const cols = 13;
  const placeholders = rows.map((_, i) => {
    const base = i * cols;
    return `(${Array.from({ length: cols }, (_, j) => `$${base + j + 1}`).join(',')})`;
  }).join(',');

  await client.query(
    `INSERT INTO n8n_metrics_snapshot
       (ts, instance_id, n8n_version, node_version, process_start_time_seconds,
        is_leader, active_workflows, cpu_total_seconds, memory_rss_bytes,
        heap_used_bytes, external_memory_bytes, eventloop_lag_p99_s, open_fds)
     VALUES ${placeholders}`,
    rows.flat(),
  );
}

// ───────────────────────────────────────────────────────────────────────────
//  5. Metrics Explorer  (Prometheus-style metrics_series + metrics_samples)
// ───────────────────────────────────────────────────────────────────────────
async function seedMetricsExplorer(client) {
  console.log('📈  Seeding metrics_series & metrics_samples (Prometheus) …');

  const metrics = [
    {
      name: 'n8n_http_requests_total', type: 'counter',
      help: 'Total HTTP requests received by n8n',
      labelSets: [
        { method: 'GET', status: '200' }, { method: 'GET', status: '404' },
        { method: 'POST', status: '200' }, { method: 'POST', status: '500' },
      ],
    },
    {
      name: 'n8n_workflow_execution_duration_seconds_sum', type: 'histogram',
      help: 'Total execution duration (histogram sum)',
      labelSets: [{ workflow: 'data_sync' }, { workflow: 'notification_sender' }, { workflow: 'lead_enrichment' }],
    },
    {
      name: 'n8n_workflow_execution_duration_seconds_count', type: 'histogram',
      help: 'Number of executions (histogram count)',
      labelSets: [{ workflow: 'data_sync' }, { workflow: 'notification_sender' }, { workflow: 'lead_enrichment' }],
    },
    {
      name: 'n8n_memory_usage_bytes', type: 'gauge',
      help: 'Current memory usage in bytes',
      labelSets: [{ type: 'heap_used' }, { type: 'rss' }, { type: 'external' }],
    },
    {
      name: 'n8n_api_response_time_seconds', type: 'summary',
      help: 'API response time quantiles',
      labelSets: [
        { endpoint: '/api/workflows', quantile: '0.5' },
        { endpoint: '/api/workflows', quantile: '0.9' },
        { endpoint: '/api/workflows', quantile: '0.99' },
        { endpoint: '/api/executions', quantile: '0.5' },
        { endpoint: '/api/executions', quantile: '0.9' },
      ],
    },
    {
      name: 'n8n_active_workflows', type: 'gauge',
      help: 'Number of currently active workflows',
      labelSets: [{}],
    },
    {
      name: 'n8n_event_loop_lag_seconds', type: 'gauge',
      help: 'Node.js event loop lag in seconds',
      labelSets: [{ quantile: '0.99' }, { quantile: '0.5' }],
    },
    {
      name: 'n8n_open_file_descriptors', type: 'gauge',
      help: 'Number of open file descriptors',
      labelSets: [{}],
    },
  ];

  const HOURS_BACK = 48;
  const INTERVAL_MIN = 1;   // 1-min scrape → ~3 samples per bucket → avg/max/sum differ
  const totalPoints = (HOURS_BACK * 60) / INTERVAL_MIN;
  const now = Date.now();
  let seriesCount = 0;
  let sampleCount = 0;

  for (const inst of INSTANCES) {
    for (const m of metrics) {
      for (const labels of m.labelSets) {
        const hash = labelsHash(labels);

        const { rows } = await client.query(
          `INSERT INTO metrics_series
             (instance_id, metric_name, metric_type, labels, labels_hash, help)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (instance_id, metric_name, labels_hash)
           DO UPDATE SET created_at = metrics_series.created_at
           RETURNING id`,
          [inst.id, m.name, m.type, JSON.stringify(labels), hash, m.help],
        );
        const seriesId = rows[0].id;
        seriesCount++;

        // Generate samples
        let sampleBatch = [];
        for (let i = 0; i < totalPoints; i++) {
          const ts = new Date(now - (totalPoints - i) * INTERVAL_MIN * 60000);
          const hour = ts.getUTCHours();
          const load = diurnalMultiplier(hour);
          let value;

          switch (m.type) {
            case 'counter':
              value = i * 8 * load + randFloat(0, 30);
              if (Math.random() < 0.005) value = randFloat(0, 15); // counter reset
              break;
            case 'gauge': {
              const bases = { heap_used: 220e6, rss: 450e6, external: 1.5e6 };
              const base = bases[labels.type] || (m.name.includes('active') ? 10 : 0.003);
              if (m.name.includes('active')) {
                value = base + load * 5 + randFloat(-1, 1);
              } else if (m.name.includes('lag')) {
                value = 0.001 + load * 0.006 + randFloat(0, 0.003);
              } else if (m.name.includes('file')) {
                value = 25 + load * 15 + randFloat(0, 5);
              } else {
                // Smooth base + random noise + occasional spikes so MAX differs from AVG
              value = base + base * 0.2 * Math.sin(i / 35) + base * 0.08 * (Math.random() - 0.5);
              if (Math.random() < 0.04) value *= 1.3 + Math.random() * 0.4; // ~4% spike
              }
              break;
            }
            case 'histogram':
              value = m.name.includes('_sum')
                ? i * 2.2 * load + randFloat(0, 4)
                : i * 4 * load + randFloat(0, 8);
              break;
            case 'summary': {
              const q = parseFloat(labels.quantile || '0.5');
              value = 0.05 + q * 0.35 * load + randFloat(0, 0.05);
              break;
            }
            default:
              value = Math.random() * 100;
          }

          sampleBatch.push([seriesId, ts.toISOString(), value]);
          sampleCount++;

          if (sampleBatch.length >= 500) {
            await flushSamples(client, sampleBatch);
            sampleBatch = [];
          }
        }

        if (sampleBatch.length) await flushSamples(client, sampleBatch);
      }
    }
  }

  console.log(`   ✅ ${seriesCount} metrics series.`);
  console.log(`   ✅ ${sampleCount} metrics samples.\n`);
}

async function flushSamples(client, rows) {
  const cols = 3;
  const placeholders = rows.map((_, i) => {
    const base = i * cols;
    return `($${base + 1},$${base + 2},$${base + 3})`;
  }).join(',');

  await client.query(
    `INSERT INTO metrics_samples (series_id, ts, value)
     VALUES ${placeholders}
     ON CONFLICT (series_id, ts) DO UPDATE SET value = EXCLUDED.value`,
    rows.flat(),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const t0 = Date.now();
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  n8n Pulse — Full Dashboard Seed');
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await cleanSeedTables(client);
    await seedWorkflows(client);
    await seedExecutions(client);
    await seedMetricsSnapshot(client);
    await seedMetricsExplorer(client);

    await client.query('COMMIT');

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('═══════════════════════════════════════════════════');
    console.log(`  ✅  All done in ${elapsed}s`);
    console.log('═══════════════════════════════════════════════════');
    console.log('');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌  Seed failed — transaction rolled back.\n', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
