// RNF015 C1/C2 (#1323): in-process request count, latency and error metrics,
// served by GET /api/monitoring/metrics. No npm package: plain counters.

const LATENCY_BUCKETS_MS = Object.freeze([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]);

const UNMATCHED = '__unmatched__';
const OTHER = '__other__';

function emptyLatency() {
  return { buckets: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0), count: 0, sumMs: 0, maxMs: 0 };
}

function emptyCounters() {
  return { requests: 0, errors: 0, clientErrors: 0, aborted: 0, statusCounts: {}, latency: emptyLatency() };
}

function record(counters, status, aborted, ms) {
  counters.requests += 1;
  if (aborted) {
    counters.aborted += 1;
  } else {
    if (status >= 500) counters.errors += 1;
    else if (status >= 400) counters.clientErrors += 1;
    counters.statusCounts[status] = (counters.statusCounts[status] || 0) + 1;
  }
  recordLatency(counters.latency, ms);
}

function recordLatency(latency, ms) {
  let i = LATENCY_BUCKETS_MS.findIndex((bound) => ms <= bound);
  if (i === -1) i = LATENCY_BUCKETS_MS.length;
  latency.buckets[i] += 1;
  latency.count += 1;
  latency.sumMs += ms;
  if (ms > latency.maxMs) latency.maxMs = ms;
}

// The upper bound of the bucket holding the 95th percentile, not an exact value.
function p95UpperBound(latency) {
  if (latency.count === 0) return null;
  const rank = Math.ceil(latency.count * 0.95);
  let seen = 0;
  for (let i = 0; i < latency.buckets.length; i += 1) {
    seen += latency.buckets[i];
    if (seen >= rank) return i < LATENCY_BUCKETS_MS.length ? LATENCY_BUCKETS_MS[i] : '+Inf';
  }
  return '+Inf';
}

function latencyView(latency) {
  const buckets = {};
  LATENCY_BUCKETS_MS.forEach((bound, i) => { buckets[bound] = latency.buckets[i]; });
  buckets['+Inf'] = latency.buckets[LATENCY_BUCKETS_MS.length];
  return {
    buckets,
    count: latency.count,
    sumMs: Number(latency.sumMs.toFixed(3)),
    maxMs: Number(latency.maxMs.toFixed(3)),
    p95UpperBoundMs: p95UpperBound(latency),
  };
}

function countersView(c) {
  return {
    requests: c.requests,
    errors: c.errors,
    clientErrors: c.clientErrors,
    aborted: c.aborted,
    statusCounts: { ...c.statusCounts },
    latency: latencyView(c.latency),
  };
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// Never the URL: the base as it was when Express matched the route, each
// segment that equals a matched param's value turned back into :<name>.
function routeLabel(matched) {
  if (!matched || !matched.route || typeof matched.route.path !== 'string') return UNMATCHED;
  const byValue = new Map();
  for (const [name, value] of Object.entries(matched.params || {})) {
    if (typeof value === 'string' && value !== '' && !byValue.has(value)) byValue.set(value, name);
  }
  const base = (matched.baseUrl || '')
    .split('/')
    .map((segment) => (segment && byValue.has(safeDecode(segment)) ? `:${byValue.get(safeDecode(segment))}` : segment))
    .join('/');
  return `${base}${matched.route.path}` || '/';
}

function createHttpMetrics({ maxSeries = 300 } = {}) {
  let since;
  let totals;
  let series;

  function reset() {
    since = new Date();
    totals = emptyCounters();
    series = new Map();
  }
  reset();

  function seriesFor(method, route) {
    const key = `${method} ${route}`;
    let entry = series.get(key);
    if (entry) return entry;
    if (series.size >= maxSeries) {
      const otherKey = `${method} ${OTHER}`;
      entry = series.get(otherKey);
      if (entry) return entry;
      entry = { method, route: OTHER, counters: emptyCounters() };
      series.set(otherKey, entry);
      return entry;
    }
    entry = { method, route, counters: emptyCounters() };
    series.set(key, entry);
    return entry;
  }

  function middleware(req, res, next) {
    const started = process.hrtime.bigint();
    let matched = null;
    let route;
    // Express sets req.route in Route.dispatch, after req.params; the setter
    // keeps baseUrl and params from that moment, since next(err) out of a
    // sub-router resets req.baseUrl to ''.
    Object.defineProperty(req, 'route', {
      configurable: true,
      enumerable: true,
      get() { return route; },
      set(value) {
        route = value;
        if (value) matched = { route: value, baseUrl: req.baseUrl, params: { ...req.params } };
      },
    });

    let done = false;
    function finish(aborted) {
      if (done) return;
      done = true;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const status = res.statusCode;
      record(totals, status, aborted, ms);
      record(seriesFor(req.method, routeLabel(matched)).counters, status, aborted, ms);
    }
    res.once('finish', () => finish(false));
    // 'close' also fires after 'finish'; the once flag keeps one record.
    res.once('close', () => finish(!res.writableFinished));
    next();
  }

  function snapshot() {
    return {
      since: since.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      totals: countersView(totals),
      routes: [...series.values()].map((entry) => ({ method: entry.method, route: entry.route, ...countersView(entry.counters) })),
    };
  }

  return { middleware, snapshot, reset };
}

const defaultMetrics = createHttpMetrics();

module.exports = {
  createHttpMetrics,
  defaultMetrics,
  middleware: defaultMetrics.middleware,
  snapshot: defaultMetrics.snapshot,
  LATENCY_BUCKETS_MS,
  emptyLatency,
  recordLatency,
  latencyView,
};
