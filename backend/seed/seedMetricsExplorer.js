/**
 * Seed script for Metrics Explorer
 * Inserts sample Prometheus-style metrics data with proper schema (UUID, labels_hash)
 */

const { Pool } = require('pg');
const { labelsHash } = require('../src/utils/labels');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function seedMetricsExplorer() {
  const client = await pool.connect();
  
  try {
    console.log('Seeding Metrics Explorer data...');

    // Instance ID
    const instanceId = 'prod';
    
    // Create sample metrics series
    const metrics = [
      {
        metric_name: 'http_requests_total',
        metric_type: 'counter',
        help: 'Total HTTP requests',
        label_sets: [
          { method: 'GET', status: '200' },
          { method: 'GET', status: '404' },
          { method: 'POST', status: '200' },
          { method: 'POST', status: '500' }
        ]
      },
      {
        metric_name: 'workflow_execution_duration_seconds_sum',
        metric_type: 'histogram',
        help: 'Workflow execution duration sum',
        label_sets: [
          { workflow: 'data_sync' },
          { workflow: 'notification_sender' }
        ]
      },
      {
        metric_name: 'workflow_execution_duration_seconds_count',
        metric_type: 'histogram',
        help: 'Workflow execution duration count',
        label_sets: [
          { workflow: 'data_sync' },
          { workflow: 'notification_sender' }
        ]
      },
      {
        metric_name: 'memory_usage_bytes',
        metric_type: 'gauge',
        help: 'Current memory usage in bytes',
        label_sets: [
          { type: 'heap' },
          { type: 'rss' }
        ]
      },
      {
        metric_name: 'api_response_time_seconds',
        metric_type: 'summary',
        help: 'API response time summary',
        label_sets: [
          { endpoint: '/api/workflows', quantile: '0.5' },
          { endpoint: '/api/workflows', quantile: '0.9' },
          { endpoint: '/api/workflows', quantile: '0.99' },
          { endpoint: '/api/executions', quantile: '0.5' },
          { endpoint: '/api/executions', quantile: '0.9' }
        ]
      }
    ];

    // Insert metrics series
    const seriesIds = [];
    
    for (const metric of metrics) {
      for (const labels of metric.label_sets) {
        const hash = labelsHash(labels);
        
        const result = await client.query(
          `INSERT INTO metrics_series (
            instance_id, metric_name, metric_type, labels, labels_hash, help
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (instance_id, metric_name, labels_hash) DO UPDATE
          SET created_at = metrics_series.created_at
          RETURNING id`,
          [
            instanceId,
            metric.metric_name,
            metric.metric_type,
            JSON.stringify(labels),
            hash,
            metric.help
          ]
        );
        seriesIds.push({
          id: result.rows[0].id,
          metric_name: metric.metric_name,
          metric_type: metric.metric_type,
          labels
        });
      }
    }

    console.log(`Created ${seriesIds.length} metrics series`);

    // Generate time-series samples (last 24 hours, every 5 minutes)
    const now = new Date();
    const hoursBack = 24;
    const intervalMinutes = 5;
    const totalPoints = (hoursBack * 60) / intervalMinutes;

    let totalSamples = 0;
    
    for (const series of seriesIds) {
      const samples = [];
      
      for (let i = 0; i < totalPoints; i++) {
        const ts = new Date(now.getTime() - (totalPoints - i) * intervalMinutes * 60 * 1000);
        let value;

        // Generate realistic values based on metric type
        switch (series.metric_type) {
          case 'counter':
            // Counter: monotonically increasing with occasional resets
            value = i * 10 + Math.random() * 50;
            if (Math.random() < 0.01) value = Math.random() * 20; // Reset
            break;
          
          case 'gauge':
            // Gauge: fluctuating values
            const base = series.labels.type === 'heap' ? 500_000_000 : 800_000_000;
            value = base + Math.sin(i / 10) * base * 0.2 + Math.random() * base * 0.1;
            break;
          
          case 'histogram':
            // Histogram sum/count: cumulative values
            if (series.metric_name.includes('_sum')) {
              value = i * 2.5 + Math.random() * 5;
            } else {
              value = i * 5 + Math.random() * 10;
            }
            break;
          
          case 'summary':
            // Summary quantiles: response times
            const quantile = parseFloat(series.labels.quantile);
            value = 0.1 + quantile * 0.5 + Math.random() * 0.1;
            break;
          
          default:
            value = Math.random() * 100;
        }

        samples.push([series.id, ts.toISOString(), value]);
      }

      // Batch insert samples (PostgreSQL-specific ON CONFLICT for composite PK)
      for (const sample of samples) {
        await client.query(
          `INSERT INTO metrics_samples (series_id, ts, value) 
           VALUES ($1, $2, $3)
           ON CONFLICT (series_id, ts) DO UPDATE SET value = EXCLUDED.value`,
          sample
        );
      }
      
      totalSamples += samples.length;
    }

    console.log(`Created ${totalSamples} sample data points`);
    console.log('✅ Metrics Explorer seeding complete!');
    
  } catch (err) {
    console.error('Error seeding metrics:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seedMetricsExplorer().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
