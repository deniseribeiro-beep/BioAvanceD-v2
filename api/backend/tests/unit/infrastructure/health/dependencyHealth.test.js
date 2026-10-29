import { describe, it, expect, vi } from 'vitest';

const { checkDependencies, inputsFrom } = require('../../../../src/infrastructure/health/dependencyHealth');
const redisConfig = require('../../../../src/config/redis');

// RNF003 AC3 (#1323): checkDependencies is driven here by hand-built fakes, so
// no case touches the network.

function healthyInputs(overrides = {}) {
  return {
    db: { command: vi.fn().mockResolvedValue({ ok: 1 }) },
    neo4jDriver: { verifyConnectivity: vi.fn().mockResolvedValue({}) },
    neo4jConfigured: true,
    neo4jCritical: false,
    redisClient: { status: 'ready', ping: vi.fn().mockResolvedValue('PONG') },
    redisConfigured: true,
    influx: { url: 'http://influx:8086/', token: 't', org: 'o', bucket: 'b' },
    fetchImpl: vi.fn().mockResolvedValue({ ok: true }),
    timeoutMs: 50,
    ...overrides,
  };
}

const never = () => new Promise(() => {});

describe('#1323: checkDependencies', () => {
  it('reports every dependency up when every probe succeeds', async () => {
    const inputs = healthyInputs();
    const result = await checkDependencies(inputs);

    expect(result.critical).toBe(false);
    expect(result.degraded).toBe(false);
    for (const name of ['mongodb', 'neo4j', 'redis', 'influxdb']) {
      expect(result.checks[name].status).toBe('up');
      expect(typeof result.checks[name].latencyMs).toBe('number');
      expect(result.checks[name]).not.toHaveProperty('reason');
    }
    expect(inputs.db.command).toHaveBeenCalledWith({ ping: 1 });
    expect(inputs.fetchImpl).toHaveBeenCalledWith('http://influx:8086/health', expect.objectContaining({ signal: expect.anything() }));
  });

  it('marks the report critical when the MongoDB ping fails', async () => {
    const result = await checkDependencies(healthyInputs({
      db: { command: vi.fn().mockRejectedValue(new Error('down')) },
    }));

    expect(result.critical).toBe(true);
    expect(result.checks.mongodb).toMatchObject({ status: 'down', critical: true, reason: 'unreachable' });

    const missing = await checkDependencies(healthyInputs({ db: undefined }));
    expect(missing.critical).toBe(true);
    expect(missing.checks.mongodb).toMatchObject({ status: 'down', reason: 'not_connected' });
  });

  it('reports a down Redis as degraded, never critical', async () => {
    const result = await checkDependencies(healthyInputs({
      redisClient: { status: 'ready', ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
    }));

    expect(result.critical).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.checks.redis).toMatchObject({ status: 'down', critical: false, reason: 'unreachable' });
  });

  it('sends no command to a Redis client that is not ready', async () => {
    const ping = vi.fn().mockResolvedValue('PONG');
    const result = await checkDependencies(healthyInputs({
      redisClient: { status: 'reconnecting', ping },
    }));

    expect(ping).not.toHaveBeenCalled();
    expect(result.checks.redis).toMatchObject({ status: 'down', reason: 'not_connected' });
  });

  it('reports an unconfigured dependency as not_configured, neither critical nor degraded', async () => {
    const result = await checkDependencies(healthyInputs({
      neo4jDriver: null,
      neo4jConfigured: false,
      neo4jCritical: true,
      redisClient: null,
      redisConfigured: false,
      influx: { url: undefined },
    }));

    expect(result.checks.neo4j.status).toBe('not_configured');
    expect(result.checks.redis.status).toBe('not_configured');
    expect(result.checks.influxdb.status).toBe('not_configured');
    expect(result.critical).toBe(false);
    expect(result.degraded).toBe(false);
  });

  it('reports a probe that never settles as down with reason timeout', async () => {
    let signal;
    const result = await checkDependencies(healthyInputs({
      db: { command: never },
      fetchImpl: (url, opts) => { signal = opts.signal; return never(); },
    }));

    expect(result.checks.mongodb).toMatchObject({ status: 'down', reason: 'timeout' });
    expect(result.checks.influxdb).toMatchObject({ status: 'down', reason: 'timeout' });
    expect(signal.aborted).toBe(true);
    expect(result.critical).toBe(true);
  });

  it('treats a down Neo4j as critical only under fail-closed or NEO4J_REQUIRED', async () => {
    const failing = { verifyConnectivity: vi.fn().mockRejectedValue(new Error('down')) };

    const open = await checkDependencies(healthyInputs({ neo4jDriver: failing, neo4jCritical: false }));
    expect(open.checks.neo4j).toMatchObject({ status: 'down', critical: false });
    expect(open.critical).toBe(false);
    expect(open.degraded).toBe(true);

    const closed = await checkDependencies(healthyInputs({ neo4jDriver: failing, neo4jCritical: true }));
    expect(closed.checks.neo4j).toMatchObject({ status: 'down', critical: true });
    expect(closed.critical).toBe(true);

    const unbooted = await checkDependencies(healthyInputs({ neo4jDriver: null, neo4jConfigured: true, neo4jCritical: true }));
    expect(unbooted.checks.neo4j).toMatchObject({ status: 'down', reason: 'not_connected' });
    expect(unbooted.critical).toBe(true);
  });

  it('never copies an error message into the result', async () => {
    const leak = () => Promise.reject(new Error('mongodb://user:secret@host'));
    const result = await checkDependencies(healthyInputs({
      db: { command: leak },
      neo4jDriver: { verifyConnectivity: leak },
      redisClient: { status: 'ready', ping: leak },
      fetchImpl: leak,
    }));

    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('host');
  });

  it('inputsFrom creates no Redis connection when none exists', () => {
    const app = { locals: { db: {} } };

    expect(redisConfig.peekRedisInstance()).toBeNull();
    const inputs = inputsFrom(app);
    expect(inputs.redisClient).toBeNull();
    expect(redisConfig.peekRedisInstance()).toBeNull();
    expect(inputs.neo4jDriver).toBeNull();
  });
});
