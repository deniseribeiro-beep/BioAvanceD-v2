import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  Neo4jCanonicalProjectionService,
  stableStringify,
} = require('../../src/services/neo4jCanonicalProjection.service');

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEO4J_CANONICAL_SALT;
  delete process.env.GRAPH_PSEUDONYMIZATION_SALT;
  delete process.env.USER_ANON_SALT;
});

describe('neo4jCanonicalProjection.service item 8 residual branches', () => {
  it('stableStringify recursively normalizes arrays and nested objects', () => {
    const encoded = stableStringify({
      b: 2,
      a: [{ z: 1, y: new Date('2020-01-01T00:00:00.000Z') }, 'x'],
    });
    expect(encoded).toBe(JSON.stringify({
      a: [{ y: '2020-01-01T00:00:00.000Z', z: 1 }, 'x'],
      b: 2,
    }));
  });

  it('projects consent with Date signedAt and falls back when signedAt is invalid', async () => {
    process.env.NEO4J_CANONICAL_SALT = 'test-salt';
    const service = new Neo4jCanonicalProjectionService();
    const run = vi.fn(async () => ({ records: [] }));
    const session = { run };

    await service.applyEvent(session, {
      eventType: 'CONSENT_UPSERTED',
      aggregateId: 'consent-1',
      occurredAt: '2021-02-03T04:05:06.000Z',
      payload: {
        participantId: 'participant-1',
        signedAt: new Date('2020-05-06T07:08:09.000Z'),
        status: 'active',
      },
    });
    expect(run).toHaveBeenCalled();
    const firstParams = run.mock.calls[0][1];
    expect(firstParams.occurredAt).toBe('2020-05-06T07:08:09.000Z');

    run.mockClear();
    await service.applyEvent(session, {
      eventType: 'CONSENT_UPSERTED',
      aggregateId: 'consent-2',
      occurredAt: '2021-02-03T04:05:06.000Z',
      payload: {
        participantId: 'participant-2',
        signedAt: 'not-a-date',
        status: 'active',
      },
    });
    const secondParams = run.mock.calls[0][1];
    expect(secondParams.occurredAt).toBe('2021-02-03T04:05:06.000Z');
  });
});
