import { describe, it, expect } from 'vitest';

const { renderPrometheus, CONTENT_TYPE } = require('../../../../src/infrastructure/metrics/prometheusText');
const { LATENCY_BUCKETS_MS } = require('../../../../src/infrastructure/metrics/httpMetrics');

// RNF015 C7 (#1468): the metrics in the Prometheus text exposition format
// 0.0.4, rendered from fixed snapshots.

function bucketsWith(own) {
  const buckets = {};
  for (const bound of LATENCY_BUCKETS_MS) buckets[String(bound)] = 0;
  buckets['+Inf'] = 0;
  return { ...buckets, ...own };
}

function route(overrides = {}) {
  return {
    method: 'GET',
    route: '/api/health',
    requests: 4,
    errors: 1,
    latency: { buckets: bucketsWith({ 5: 1, 10: 2, '+Inf': 1 }), count: 4, sumMs: 20123.5 },
    ...overrides,
  };
}

const UP_QUEUE = { name: 'import-queue', status: 'up', counts: { waiting: 2, delayed: 0, active: 1, failed: 3, paused: 0 } };
const DOWN_QUEUE = { name: 'notification-queue', status: 'unavailable', reason: 'timeout' };
const JOB = { worker: 'neo4j-projection', job: 'project-event', completed: 7, failed: 2, durationMsSum: 41.5, durationMsMax: 9 };

function render(overrides = {}) {
  return renderPrometheus({ http: { routes: [route()] }, queues: [UP_QUEUE, DOWN_QUEUE], jobs: [JOB], ...overrides });
}

function sampleLines(text) {
  return text.split('\n').filter((line) => line && !line.startsWith('#'));
}

describe('#1468: renderPrometheus', () => {
  it('names the text format 0.0.4 content type and ends the text in a newline', () => {
    expect(CONTENT_TYPE).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(render().endsWith('\n')).toBe(true);
  });

  it('writes the request and error counters per method and route', () => {
    const text = render();
    expect(text).toContain('bioavanced_http_requests_total{method="GET",route="/api/health"} 4\n');
    expect(text).toContain('bioavanced_http_errors_total{method="GET",route="/api/health"} 1\n');
  });

  it('writes the latency buckets cumulative, then +Inf, sum and count', () => {
    const text = render();
    const bucketValues = text.split('\n')
      .filter((line) => line.startsWith('bioavanced_http_request_duration_milliseconds_bucket{'))
      .map((line) => [line.match(/le="([^"]+)"/)[1], line.split(' ').pop()]);
    // Own counts 1, 2, 0 ... 0 and 1 above the last bound: 1, 3, 3 ... 3, then 4.
    const expected = LATENCY_BUCKETS_MS.map((bound, i) => [String(bound), i === 0 ? '1' : '3']);
    expected.push(['+Inf', '4']);
    expect(bucketValues).toEqual(expected);
    expect(text).toContain('bioavanced_http_request_duration_milliseconds_sum{method="GET",route="/api/health"} 20123.5\n');
    expect(text).toContain('bioavanced_http_request_duration_milliseconds_count{method="GET",route="/api/health"} 4\n');
  });

  it('escapes a backslash, a double quote and a newline in a label value', () => {
    const text = render({ http: { routes: [route({ route: 'a"b\\c\nd' })] } });
    expect(text).toContain('bioavanced_http_requests_total{method="GET",route="a\\"b\\\\c\\nd"} 4\n');
  });

  it('writes 0 for a value that is not finite', () => {
    const text = render({ http: { routes: [route({ requests: Number.NaN })] } });
    expect(text).toContain('bioavanced_http_requests_total{method="GET",route="/api/health"} 0\n');
  });

  it('writes an up queue as 1 with its job counts, and an unavailable queue as 0 with none', () => {
    const text = render();
    expect(text).toContain('bioavanced_queue_up{queue="import-queue"} 1\n');
    expect(text).toContain('bioavanced_queue_jobs{queue="import-queue",state="failed"} 3\n');
    expect(text).toContain('bioavanced_queue_up{queue="notification-queue"} 0\n');
    expect(text).not.toContain('bioavanced_queue_jobs{queue="notification-queue"');
  });

  it('writes the worker job counters per outcome and the duration sum', () => {
    const text = render();
    expect(text).toContain('bioavanced_worker_metrics_up 1\n');
    expect(text).toContain('bioavanced_worker_jobs_total{worker="neo4j-projection",job="project-event",outcome="completed"} 7\n');
    expect(text).toContain('bioavanced_worker_jobs_total{worker="neo4j-projection",job="project-event",outcome="failed"} 2\n');
    expect(text).toContain('bioavanced_worker_job_duration_milliseconds_total{worker="neo4j-projection",job="project-event"} 41.5\n');
  });

  it('writes the worker metrics as down and no job line when jobs is null', () => {
    const text = render({ jobs: null });
    expect(text).toContain('bioavanced_worker_metrics_up 0\n');
    expect(text).not.toContain('bioavanced_worker_jobs_total{');
  });

  it('puts one # TYPE line before the samples of every family', () => {
    const text = render();
    const lines = text.split('\n');
    const typed = new Map();
    lines.forEach((line, i) => {
      const m = line.match(/^# TYPE (\S+) (counter|gauge|histogram)$/);
      if (m) {
        expect(typed.has(m[1])).toBe(false);
        typed.set(m[1], { index: i, type: m[2] });
      }
    });
    const samples = sampleLines(text);
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      const metric = sample.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)/)[1];
      const familyName = typed.has(metric) ? metric : metric.replace(/_(bucket|sum|count)$/, '');
      expect(typed.has(familyName), sample).toBe(true);
      expect(typed.get(familyName).index).toBeLessThan(lines.indexOf(sample));
      if (familyName !== metric) expect(typed.get(familyName).type).toBe('histogram');
    }
  });
});
