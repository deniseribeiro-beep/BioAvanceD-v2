import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const env = require('../../src/config/env');
const { readSampleGraphStatus } = require('../../src/services/sampleGraphStatus.service');

function recordOf(fields) {
  return { get: (key) => fields[key] };
}

function fakeDriver(run) {
  const fakeSession = { run: vi.fn(run), close: vi.fn().mockResolvedValue(undefined) };
  const driver = { session: vi.fn(() => fakeSession) };
  return { driver, fakeSession };
}

describe('readSampleGraphStatus (#1559)', () => {
  it('opens a READ session on the configured database and passes the Mongo id', async () => {
    const { driver, fakeSession } = fakeDriver(async () => ({ records: [] }));

    await readSampleGraphStatus(driver, 'oid-1');

    expect(driver.session).toHaveBeenCalledWith({
      database: env.NEO4J_DATABASE || 'neo4j',
      defaultAccessMode: 'READ',
    });
    expect(fakeSession.run).toHaveBeenCalledTimes(1);
    const [cypher, params] = fakeSession.run.mock.calls[0];
    expect(cypher).toContain('MATCH (sample:Sample {id: $sampleId})');
    expect(params).toEqual({ sampleId: 'oid-1' });
  });

  it('reports an unprojected sample as projected false with null fields', async () => {
    const { driver } = fakeDriver(async () => ({ records: [] }));

    const status = await readSampleGraphStatus(driver, 'oid-1');

    expect(status).toEqual({
      sampleId: 'oid-1',
      projected: false,
      status: null,
      compromisedAt: null,
      compromiseFreezerKey: null,
      compromiseBreachedSince: null,
    });
  });

  it('returns the compromise fields of a COMPROMISED node', async () => {
    const { driver } = fakeDriver(async () => ({
      records: [recordOf({
        status: 'COMPROMISED',
        compromisedAt: '2026-11-16T10:00:00Z',
        compromiseFreezerKey: 'freezer-7',
        compromiseBreachedSince: '2026-11-16T09:30:00Z',
      })],
    }));

    const status = await readSampleGraphStatus(driver, 'oid-1');

    expect(status).toEqual({
      sampleId: 'oid-1',
      projected: true,
      status: 'COMPROMISED',
      compromisedAt: '2026-11-16T10:00:00Z',
      compromiseFreezerKey: 'freezer-7',
      compromiseBreachedSince: '2026-11-16T09:30:00Z',
    });
  });

  it('closes the session when the read throws', async () => {
    const { driver, fakeSession } = fakeDriver(async () => { throw new Error('graph down'); });

    await expect(readSampleGraphStatus(driver, 'oid-1')).rejects.toThrow('graph down');
    expect(fakeSession.close).toHaveBeenCalledTimes(1);
  });
});
