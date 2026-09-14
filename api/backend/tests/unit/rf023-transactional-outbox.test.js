import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Neo4jOutboxService } = require('../../src/services/neo4jOutbox.service');
const { GraphProjectionService } = require('../../src/services/graphProjection.service');

describe('RF023 transactional graph outbox', () => {
  it('enlists appendEvent in the caller MongoDB session', async () => {
    const session = { id: 'mongo-session' };
    const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 });
    const collection = {
      createIndex: vi.fn().mockResolvedValue('idx'),
      updateOne,
    };
    const db = { collection: vi.fn().mockReturnValue(collection) };
    const service = new Neo4jOutboxService({ collectionName: 'rf023_transaction_test' });

    await service.appendEvent(
      db,
      {
        eventId: 'evt-rf023-1',
        eventType: 'SPECIMEN_UPSERTED',
        aggregateType: 'Specimen',
        aggregateId: 'specimen-1',
        payload: { specimenId: 'specimen-1' },
      },
      { session }
    );

    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls[0][2]).toEqual({ upsert: true, session });
  });

  it('keeps appendEvent usable outside an explicit transaction', async () => {
    const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 });
    const collection = {
      createIndex: vi.fn().mockResolvedValue('idx'),
      updateOne,
    };
    const db = { collection: vi.fn().mockReturnValue(collection) };
    const service = new Neo4jOutboxService({ collectionName: 'rf023_non_transaction_test' });

    await service.appendEvent(db, {
      eventId: 'evt-rf023-2',
      eventType: 'CONSENT_UPSERTED',
      aggregateType: 'EthicalConsent',
      aggregateId: 'consent-1',
      payload: {},
    });

    expect(updateOne.mock.calls[0][2]).toEqual({ upsert: true });
  });

  it('forwards the session through GraphProjectionService producers', async () => {
    const session = { id: 'mongo-session' };
    const outbox = { appendEvent: vi.fn().mockResolvedValue({ eventId: 'evt-1' }) };
    const service = new GraphProjectionService({ outbox });
    const db = {};

    await service.appendSpecimenEvent(
      db,
      { specimenId: 'specimen-1', participantId: 'participant-1', barcode: 'BC-1' },
      { session }
    );

    expect(outbox.appendEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        eventType: 'SPECIMEN_UPSERTED',
        aggregateType: 'Specimen',
        aggregateId: 'specimen-1',
        schemaVersion: 2,
        payload: expect.objectContaining({
          specimenId: 'specimen-1',
          participantId: 'participant-1',
          barcode: 'BC-1',
        }),
      }),
      { session }
    );
  });

  it('provides v2 custody and normalized-storage events without writing Neo4j directly', async () => {
    const outbox = { appendEvent: vi.fn().mockResolvedValue({ eventId: 'evt-1' }) };
    const service = new GraphProjectionService({ outbox });

    await service.appendCustodyEvent({}, {
      specimenId: 'specimen-1',
      custodyEventId: 'custody-1',
      eventType: 'MOVE',
      from: { storagePositionId: 'pos-a1' },
      to: { storagePositionId: 'pos-b1' },
    });
    await service.appendStorageAssignmentEvent({}, {
      specimenContainerAssignmentId: 'sca-1',
      specimenId: 'specimen-1',
      containerId: 'container-1',
      containerPositionAssignmentId: 'cpa-1',
      storagePositionId: 'pos-b1',
      rackLocationAssignmentId: 'rla-1',
      storageRackId: 'rack-1',
      storageLocationId: 'freezer-1',
    });

    expect(outbox.appendEvent.mock.calls[0][1]).toMatchObject({
      eventType: 'CUSTODY_EVENT_RECORDED',
      aggregateType: 'Specimen',
      schemaVersion: 2,
    });
    expect(outbox.appendEvent.mock.calls[1][1]).toMatchObject({
      eventType: 'STORAGE_ASSIGNMENT_UPSERTED',
      aggregateType: 'SpecimenContainerAssignment',
      schemaVersion: 2,
    });
  });
});
