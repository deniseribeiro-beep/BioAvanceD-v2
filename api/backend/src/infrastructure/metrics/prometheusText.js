// RNF015 C7 (#1468): the monitoring metrics in the Prometheus text exposition
// format 0.0.4, so an equivalent tool can scrape GET /api/monitoring/metrics.
// No npm package: the format is written by hand from the JSON snapshots.

const { LATENCY_BUCKETS_MS } = require('./httpMetrics');

const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

function escapeLabel(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '0';
}

function labels(pairs) {
  const entries = Object.entries(pairs);
  if (!entries.length) return '';
  return `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',')}}`;
}

function family(lines, name, type, help, samples) {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} ${type}`);
  for (const sample of samples) lines.push(sample);
}

function httpFamilies(lines, http) {
  const routes = (http && Array.isArray(http.routes)) ? http.routes : [];
  family(lines, 'bioavanced_http_requests_total', 'counter', 'HTTP requests per method and route template.',
    routes.map((r) => `bioavanced_http_requests_total${labels({ method: r.method, route: r.route })} ${num(r.requests)}`));
  family(lines, 'bioavanced_http_errors_total', 'counter', 'HTTP responses with a 5xx status per method and route template.',
    routes.map((r) => `bioavanced_http_errors_total${labels({ method: r.method, route: r.route })} ${num(r.errors)}`));

  const name = 'bioavanced_http_request_duration_milliseconds';
  const samples = [];
  for (const r of routes) {
    const latency = r.latency || {};
    const buckets = latency.buckets || {};
    const base = { method: r.method, route: r.route };
    let cumulative = 0;
    for (const bound of LATENCY_BUCKETS_MS) {
      cumulative += Number(buckets[bound]) || 0;
      samples.push(`${name}_bucket${labels({ ...base, le: String(bound) })} ${num(cumulative)}`);
    }
    samples.push(`${name}_bucket${labels({ ...base, le: '+Inf' })} ${num(latency.count)}`);
    samples.push(`${name}_sum${labels(base)} ${num(latency.sumMs)}`);
    samples.push(`${name}_count${labels(base)} ${num(latency.count)}`);
  }
  family(lines, name, 'histogram', 'HTTP request latency in milliseconds per method and route template.', samples);
}

function queueFamilies(lines, queues) {
  const rows = Array.isArray(queues) ? queues : [];
  family(lines, 'bioavanced_queue_up', 'gauge', 'Whether the queue depth could be read (1) or not (0).',
    rows.map((q) => `bioavanced_queue_up${labels({ queue: q.name })} ${q.status === 'up' ? 1 : 0}`));
  const samples = [];
  for (const q of rows) {
    if (q.status !== 'up' || !q.counts) continue;
    for (const [state, count] of Object.entries(q.counts)) {
      samples.push(`bioavanced_queue_jobs${labels({ queue: q.name, state })} ${num(count)}`);
    }
  }
  family(lines, 'bioavanced_queue_jobs', 'gauge', 'Jobs in the queue per state.', samples);
}

function jobFamilies(lines, jobs) {
  family(lines, 'bioavanced_worker_metrics_up', 'gauge', 'Whether the worker job metrics could be read (1) or not (0).',
    [`bioavanced_worker_metrics_up ${jobs === null || jobs === undefined ? 0 : 1}`]);
  const rows = Array.isArray(jobs) ? jobs : [];
  const totals = [];
  const durations = [];
  for (const row of rows) {
    const base = { worker: row.worker, job: row.job };
    totals.push(`bioavanced_worker_jobs_total${labels({ ...base, outcome: 'completed' })} ${num(row.completed)}`);
    totals.push(`bioavanced_worker_jobs_total${labels({ ...base, outcome: 'failed' })} ${num(row.failed)}`);
    durations.push(`bioavanced_worker_job_duration_milliseconds_total${labels(base)} ${num(row.durationMsSum)}`);
  }
  family(lines, 'bioavanced_worker_jobs_total', 'counter', 'Worker job runs per worker, job and outcome.', totals);
  family(lines, 'bioavanced_worker_job_duration_milliseconds_total', 'counter', 'Total worker job run time in milliseconds per worker and job.', durations);
}

function renderPrometheus({ http, queues, jobs } = {}) {
  const lines = [];
  httpFamilies(lines, http);
  queueFamilies(lines, queues);
  jobFamilies(lines, jobs);
  return `${lines.join('\n')}\n`;
}

module.exports = { renderPrometheus, CONTENT_TYPE };
