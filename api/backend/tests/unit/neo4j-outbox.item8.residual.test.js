import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const env = require('../../src/config/env');
const { Neo4jOutboxService } = require('../../src/services/neo4jOutbox.service');

function fakeCollection(events = []) {
  return {
    createIndex: vi.fn(async () => 'idx'),
    updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    updateMany: vi.fn(async () => ({ modifiedCount: 1 })),
    find: vi.fn(() => {
      const direct = { toArray: vi.fn(async () => events) };
      direct.sort = vi.fn(() => ({
        limit: vi.fn(() => ({ toArray: vi.fn(async () => events) })),
      }));
      return direct;
    }),
  };
}

describe('Neo4jOutboxService item 8 residual canonical branches', () => {
  afterEach(() => vi.restoreAllMocks());

  it('preserves a positive aggregateVersion and explicit occurredAt', () => {
    const service = new Neo4jOutboxService();
    const occurredAt = '2026-09-19T12:00:00.000Z';
    const doc = service.buildEvent({
      eventId: 'evt-versioned',
      eventType: 'SPECIMEN_UPSERTED',
      aggregateType: 'Specimen',
      aggregateId: 'SPEC-1',
      aggregateVersion: 3,
      occurredAt,
      payload: {},
    });

    expect(doc.aggregateVersion).toBe(3);
    expect(doc.occurredAt).toEqual(new Date(occurredAt));
  });

  it('normalizes invalid aggregateVersion to one', () => {
    const service = new Neo4jOutboxService();
    expect(service.buildEvent({
      eventType: 'SPECIMEN_UPSERTED',
      aggregateType: 'Specimen',
      aggregateId: 'SPEC-1',
      aggregateVersion: 0,
    }).aggregateVersion).toBe(1);
  });

  it('uses hard-coded lease fallbacks when options and env are absent', async () => {
    const snapshot = {
      lease: env.GRAPH_OUTBOX_LEASE_MS,
      batch: env.GRAPH_OUTBOX_BATCH_SIZE,
      attempts: env.GRAPH_OUTBOX_MAX_ATTEMPTS,
    };
    env.GRAPH_OUTBOX_LEASE_MS = 0;
    env.GRAPH_OUTBOX_BATCH_SIZE = 0;
    env.GRAPH_OUTBOX_MAX_ATTEMPTS = 0;

    const coll = fakeCollection([]);
    const service = new Neo4jOutboxService();
    const db = { collection: vi.fn(() => coll) };

    await expect(service.leaseNextBatch(db)).resolves.toEqual([]);
    await expect(service.rescheduleStaleProcessing(db)).resolves.toBe(1);

    env.GRAPH_OUTBOX_LEASE_MS = snapshot.lease;
    env.GRAPH_OUTBOX_BATCH_SIZE = snapshot.batch;
    env.GRAPH_OUTBOX_MAX_ATTEMPTS = snapshot.attempts;
  });

  it('covers Error and unknown-error dead-letter serialization branches', async () => {
    const coll = fakeCollection();
    const service = new Neo4jOutboxService();
    const db = { collection: vi.fn(() => coll) };

    await service.markDeadLetter(db, 'evt-error', new Error('fatal object'));
    await service.markDeadLetter(db, 'evt-null', null);

    expect(coll.updateOne.mock.calls[0][1].$set.lastError).toBe('fatal object');
    expect(coll.updateOne.mock.calls[1][1].$set.lastError).toBe('unknown_error');
  });

  it('uses the recoverProcessing default lease fallback when env is blank', async () => {
    const previous = env.GRAPH_OUTBOX_LEASE_MS;
    env.GRAPH_OUTBOX_LEASE_MS = 0;
    const coll = fakeCollection();
    const service = new Neo4jOutboxService();
    const db = { collection: vi.fn(() => coll) };

    await expect(service.recoverProcessing(db)).resolves.toBe(1);

    env.GRAPH_OUTBOX_LEASE_MS = previous;
  });
});
