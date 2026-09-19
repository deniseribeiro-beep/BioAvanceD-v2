import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mongo = require('../../src/database/mongo');
const neo4jConnection = require('../../src/infrastructure/database/neo4j/connection');
const logger = require('../../src/utils/logger');
const env = require('../../src/config/env');

vi.spyOn(mongo, 'connectDB').mockResolvedValue({ __fakeDb: true });
vi.spyOn(neo4jConnection, 'connectNeo4j').mockResolvedValue({
  session: () => ({ close: async () => undefined }),
});

const workerPath = require.resolve('../../src/workers/neo4jProjection.worker');
delete require.cache[workerPath];
const { runProjectionOnce } = require(workerPath);

describe('neo4jProjection.worker item 8 residual canonical branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(mongo, 'connectDB').mockResolvedValue({ __fakeDb: true });
    vi.spyOn(neo4jConnection, 'connectNeo4j').mockResolvedValue({
      session: () => ({ close: async () => undefined }),
    });
  });

  it('logs a raw Neo4j connection failure in fail-open mode', async () => {
    const previousRequired = env.NEO4J_REQUIRED;
    env.NEO4J_REQUIRED = false;
    neo4jConnection.connectNeo4j.mockRejectedValueOnce('raw neo4j failure');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await expect(runProjectionOnce({ db: {} })).resolves.toEqual({
      processed: 0, projected: 0, failed: 0, deferred: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('projeção adiada'),
      { error: 'raw neo4j failure' }
    );

    env.NEO4J_REQUIRED = previousRequired;
  });

  it('constructs the canonical outbox/projector defaults when not injected', async () => {
    const coll = {
      updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
      find: vi.fn(() => ({
        sort: vi.fn(() => ({
          limit: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
        })),
      })),
    };
    const db = { collection: vi.fn(() => coll) };
    const neo4jDriver = { session: vi.fn(() => ({ close: vi.fn() })) };

    await expect(runProjectionOnce({ db, neo4jDriver })).resolves.toEqual({
      processed: 0, projected: 0, failed: 0,
    });
  });

  it('uses the default Neo4j database when env.NEO4J_DATABASE is blank and events exist', async () => {
    const previous = env.NEO4J_DATABASE;
    env.NEO4J_DATABASE = '';
    const outboxService = {
      rescheduleStaleProcessing: vi.fn(async () => 0),
      leaseNextBatch: vi.fn(async () => [{ eventId: 'evt-1', attempts: 0 }]),
      markProjected: vi.fn(async () => undefined),
      markRetrying: vi.fn(async () => undefined),
      markDeadLetter: vi.fn(async () => undefined),
    };
    const projector = { applyEvent: vi.fn(async () => ({ projected: true })) };
    const session = { close: vi.fn(async () => undefined) };
    const neo4jDriver = { session: vi.fn(() => session) };

    await expect(runProjectionOnce({ db: {}, neo4jDriver, outboxService, projector })).resolves.toEqual({
      processed: 1, projected: 1, failed: 0,
    });
    expect(neo4jDriver.session).toHaveBeenCalledWith({ database: 'neo4j' });

    env.NEO4J_DATABASE = previous;
  });
});
