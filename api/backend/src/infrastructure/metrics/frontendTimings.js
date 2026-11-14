// RNF001 C4 and RNF015 C1 (#1469): the request timings the browser measures,
// served beside the HTTP metrics by GET /api/monitoring/metrics. Observational
// and in memory, as httpMetrics.js is: a name and a duration per request, no
// user identity kept, no audit row and no log line written.

const { emptyLatency, recordLatency, latencyView } = require('./httpMetrics');

const OTHER = '__other__';
const MAX_ITEMS = 50;
const MAX_NAME_LENGTH = 200;
const MAX_MS = 600000;
const NAME_PATTERN = /^(GET|POST|PUT|PATCH|DELETE) \/[A-Za-z0-9/_:.-]*$/;
const ITEM_KEYS = ['name', 'ms'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function refuse(reason) {
  return { ok: false, reason };
}

// RNF018 C2: a batch is taken whole or refused whole, the reason opening on
// the field path that failed.
function parseFrontendTimings(body) {
  if (!isPlainObject(body)) return refuse('timings é obrigatório: o corpo deve ser um objeto');
  const extraTop = Object.keys(body).find((key) => key !== 'timings');
  if (extraTop !== undefined) return refuse(`${extraTop} não é uma propriedade aceita`);
  const { timings } = body;
  if (timings === undefined) return refuse('timings é obrigatório');
  if (!Array.isArray(timings)) return refuse(`timings deve ser uma lista de 1 a ${MAX_ITEMS} itens`);
  if (timings.length < 1 || timings.length > MAX_ITEMS) return refuse(`timings deve ser uma lista de 1 a ${MAX_ITEMS} itens`);

  const value = [];
  for (let i = 0; i < timings.length; i += 1) {
    const at = `timings[${i}]`;
    const entry = timings[i];
    if (!isPlainObject(entry)) return refuse(`${at} deve ser um objeto com name e ms`);
    const extra = Object.keys(entry).find((key) => !ITEM_KEYS.includes(key));
    if (extra !== undefined) return refuse(`${at}.${extra} não é uma propriedade aceita`);
    const { name, ms } = entry;
    if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
      return refuse(`${at}.name deve ser um método e um caminho sem consulta, como GET /api/patients/:id, de até ${MAX_NAME_LENGTH} caracteres`);
    }
    if (typeof ms !== 'number') return refuse(`${at}.ms deve ser um número`);
    if (!(ms >= 0)) return refuse(`${at}.ms deve estar entre 0 e ${MAX_MS}`);
    if (!(ms <= MAX_MS)) return refuse(`${at}.ms deve estar entre 0 e ${MAX_MS}`);
    value.push({ name, ms });
  }
  return { ok: true, value };
}

function createFrontendTimings({ maxSeries = 200 } = {}) {
  let since;
  let totals;
  let series;

  function reset() {
    since = new Date();
    totals = emptyLatency();
    series = new Map();
  }
  reset();

  function seriesFor(name) {
    let latency = series.get(name);
    if (latency) return latency;
    const key = series.size >= maxSeries ? OTHER : name;
    latency = series.get(key);
    if (latency) return latency;
    latency = emptyLatency();
    series.set(key, latency);
    return latency;
  }

  function recordAll(items) {
    for (const { name, ms } of items) {
      recordLatency(totals, ms);
      recordLatency(seriesFor(name), ms);
    }
  }

  function snapshot() {
    return {
      since: since.toISOString(),
      totals: latencyView(totals),
      routes: [...series.entries()].map(([name, latency]) => ({ name, ...latencyView(latency) })),
    };
  }

  return { recordAll, snapshot, reset };
}

const defaultTimings = createFrontendTimings();

module.exports = {
  parseFrontendTimings,
  createFrontendTimings,
  defaultTimings,
  recordAll: defaultTimings.recordAll,
  snapshot: defaultTimings.snapshot,
  reset: defaultTimings.reset,
};
