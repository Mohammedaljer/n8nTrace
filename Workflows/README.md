

<p align="center">
  <img src="../docs/images/n8n-pulse-logo.svg" alt="n8n Pulse" width="100" height="100">
</p>
<h1 align="center">n8n Pulse Workflows</h1>

<p align="center">
  <em>This document describes the core workflows used by n8n Pulse</em>
</p>

---

## Metrics — Collect & Store Instance Snapshot

**Workflow file:**


[Metrics Workflow JSON](./metrics-snapshot.json)


**Screenshot:**
![Metrics Workflow](../docs/images/Metrics—Collect_&_Store_Instance_Snapshot.png)

### Purpose

Collects runtime metrics from an n8n instance via the Prometheus `/metrics` endpoint and stores periodic snapshots in the Pulse database.

This workflow provides visibility into instance health and performance over time.

### Flow Summary

1. Triggered manually or on schedule.
2. Sets instance context (e.g. `prod`).
3. Calls the `/metrics` endpoint.
4. Parses Prometheus metrics.
5. Extracts key runtime indicators.
6. Inserts a snapshot into the metrics table.

### Captured Metrics

* n8n version
* Node.js version
* CPU usage
* Memory usage
* Event loop lag
* Open file descriptors
* Active workflows
* Leader status
* Process start time

### Why it matters

Used to power:

* Performance dashboards
* Capacity monitoring
* Health checks
* Historical analysis

---

## Pulse Execution Collector

**Workflow file:**

[Pulse Execution Collector JSON](./Pulse-Execution-Collector.json)

**Screenshot:**
![Execution Collector Workflow](../docs/images/Pulse_Execution_Collector.png)

### Purpose

Synchronizes executions and workflow metadata from n8n into the Pulse database using incremental ingestion.

Designed for near real-time observability with minimal database load.

### Flow Summary

#### Execution Sync

* Reads last checkpoint
* Detects new executions
* Refreshes running executions
* Fetches execution headers

#### Size Guard

Execution payloads are evaluated:

* Small → full parsing (runData + nodes)
* Large → summary only

#### Deep Parsing

For eligible executions:

* Decode runData
* Extract node runs
* Compute durations
* Count items
* Track last executed node

#### Database Writes

* Upsert execution summaries
* Upsert node details
* Maintain idempotency

#### Workflow Index Sync

Updates metadata including:

* Workflow name
* Tags
* Active status
* Archive state
* Node types
* Node count

### Design Goals

* Incremental processing
* Safe retries
* No duplicates
* Efficient database usage
* Continuous operation

### Why it matters

Enables:

* Execution timelines
* Failure investigation
* Node performance insights
* Workflow inventory
* Operational dashboards

---

## Notes

* Both workflows support manual runs for testing.
* Instance ID allows multi-environment monitoring (prod/dev/test).
* Designed to run continuously in production.
