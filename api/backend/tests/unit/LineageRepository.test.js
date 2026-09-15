import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MongoLineageRepository = require('../../src/infrastructure/persistence/mongo/MongoLineageRepository.js');

function makeRepository({
  specimen = {
    _id: 'mongo-id-1',
    specimenId: 'specimen-1',
    participantId: 'participant-1',
    parentSpecimenIds: ['parent-1'],
    barcode: 'SYNTHETIC-001',
    specimenStatus: 'available'
  },
  authorization = { decision: 'permit' },
  findOneImpl,
  projection = {}
} = {}) {
  const samples = {
    createIndex: vi.fn().mockResolvedValue('idx'),
    findOne: vi.fn(findOneImpl || (() => Promise.resolve(specimen)))
  };
  const db = {
    collection: vi.fn().mockImplementation((name) => {
      if (name !== 'samples') throw new Error(`unexpected collection: ${name}`);
      return samples;
    })
  };
  const graphProjectionService = {
    appendSpecimenEvent: vi.fn().mockResolvedValue({ eventId: 'specimen-outbox-1' }),
    appendLineageEvent: vi.fn().mockResolvedValue({ eventId: 'lineage-outbox-1' }),
    appendCustodyEvent: vi.fn().mockResolvedValue({ eventId: 'custody-outbox-1' }),
    ...projection
  };
  const consentRepository = {
    authorize: vi.fn().mockResolvedValue(authorization)
  };
  const repository = new MongoLineageRepository(db, {
    graphProjectionService,
    consentRepository
  });

  return { repository, db, samples, graphProjectionService, consentRepository };
}

describe('MongoLineageRepository — canonical v2 authority', () => {
  describe('MongoDB authority and identifiers', () => {
    it('fails closed when a MongoDB collection provider is unavailable', async () => {
      const repository = new MongoLineageRepository({}, {
        graphProjectionService: {},
        consentRepository: {}
      });

      await expect(
        repository.validateBeforePersistence({ specimenId: 'specimen-1', eventType: 'MOVE' })
      ).rejects.toThrow('[RF023] MongoDB obrigatório para linhagem canônica');
    });

    it('normalizes a non-empty canonical pointer', () => {
      const { repository } = makeRepository();

      expect(repository.normalizePointerId('  specimen-1  ', 'specimenId')).toBe('specimen-1');
      expect(repository.normalizePointerId(42, 'specimenId')).toBe('42');
    });

    it('rejects null, undefined, and blank canonical pointers', () => {
      const { repository } = makeRepository();

      expect(() => repository.normalizePointerId(null, 'specimenId')).toThrow('specimenId obrigatório');
      expect(() => repository.normalizePointerId(undefined, 'parentSpecimenId')).toThrow(
        'parentSpecimenId obrigatório'
      );
      expect(() => repository.normalizePointerId('   ', 'specimenId')).toThrow('specimenId obrigatório');
    });

    it('reads the canonical specimen from MongoDB with the caller session', async () => {
      const { repository, samples } = makeRepository();
      const session = { id: 'mongo-session' };

      await repository.findSpecimen('specimen-1', session);

      expect(samples.findOne).toHaveBeenCalledWith(
        {
          $or: [
            { _id: 'specimen-1' },
            { specimenId: 'specimen-1' }
          ]
        },
        { session }
      );
    });
  });

  describe('consent-governed validation', () => {
    it('rejects an event without eventType before authorization', async () => {
      const { repository, consentRepository } = makeRepository();

      await expect(
        repository.validateBeforePersistence({ specimenId: 'specimen-1' }, { id: 'mongo-session' })
      ).rejects.toThrow('eventType obrigatório');
      expect(consentRepository.authorize).not.toHaveBeenCalled();
    });

    it('rejects when the specimen does not exist in canonical MongoDB', async () => {
      const { repository, consentRepository } = makeRepository({ specimen: null });

      await expect(
        repository.validateBeforePersistence(
          { specimenId: 'missing-specimen', eventType: 'MOVE' },
          { id: 'mongo-session' }
        )
      ).rejects.toThrow('Espécime canônico não encontrado no MongoDB');
      expect(consentRepository.authorize).not.toHaveBeenCalled();
    });

    it('rejects a governed operation when the specimen has no participantId', async () => {
      const { repository } = makeRepository({
        specimen: { specimenId: 'specimen-1', participantId: null }
      });

      await expect(
        repository.validateBeforePersistence(
          { specimenId: 'specimen-1', eventType: 'MOVE' },
          { id: 'mongo-session' }
        )
      ).rejects.toThrow('Espécime sem participantId');
    });

    it('permits an authorized operation and forwards purpose, permission, time, and session', async () => {
      const happenedAt = new Date('2026-09-15T12:00:00.000Z');
      const session = { id: 'mongo-session' };
      const { repository, consentRepository } = makeRepository();

      await expect(
        repository.validateBeforePersistence({
          specimenId: 'specimen-1',
          eventType: 'MOVE',
          permissionCode: 'biospecimen.move',
          purposeCode: 'research',
          happenedAt
        }, session)
      ).resolves.toBe(true);

      expect(consentRepository.authorize).toHaveBeenCalledWith({
        participantId: 'participant-1',
        permissionCode: 'biospecimen.move',
        purposeCode: 'research',
        evaluatedAt: happenedAt
      }, session);
    });

    it('supports an explicitly non-consent-governed operation without authorizing it', async () => {
      const { repository, consentRepository } = makeRepository();

      await expect(
        repository.validateBeforePersistence({
          specimenId: 'specimen-1',
          eventType: 'SYSTEM_RECONCILIATION',
          requireEthicalConsent: false
        }, { id: 'mongo-session' })
      ).resolves.toBe(true);
      expect(consentRepository.authorize).not.toHaveBeenCalled();
    });

    it.each([
      ['deny', 'Operação negada pela governança de consentimento v2'],
      ['review_required', 'Operação requer revisão de consentimento/finalidade']
    ])('fails closed for the %s authorization decision', async (decision, message) => {
      const { repository } = makeRepository({ authorization: { decision } });

      await expect(
        repository.validateBeforePersistence(
          { specimenId: 'specimen-1', eventType: 'MOVE' },
          { id: 'mongo-session' }
        )
      ).rejects.toThrow(message);
    });
  });

  describe('transactional custody outbox', () => {
    it('requires the MongoDB transaction session shared by custody and outbox', async () => {
      const { repository, graphProjectionService } = makeRepository();

      await expect(
        repository.recordCustodyEvent({ specimenId: 'specimen-1', eventType: 'MOVE' })
      ).rejects.toThrow('Custódia e outbox devem compartilhar a transação MongoDB');
      expect(graphProjectionService.appendCustodyEvent).not.toHaveBeenCalled();
    });

    it('rejects a malformed custody event before reading or appending', async () => {
      const { repository, samples, graphProjectionService } = makeRepository();

      await expect(
        repository.recordCustodyEvent({ specimenId: 'specimen-1' }, { id: 'mongo-session' })
      ).rejects.toThrow('eventType obrigatório');
      expect(samples.findOne).not.toHaveBeenCalled();
      expect(graphProjectionService.appendCustodyEvent).not.toHaveBeenCalled();
    });

    it('rejects custody for a specimen absent from canonical MongoDB', async () => {
      const { repository, graphProjectionService } = makeRepository({ specimen: null });

      await expect(
        repository.recordCustodyEvent(
          { specimenId: 'missing-specimen', eventType: 'MOVE' },
          { id: 'mongo-session' }
        )
      ).rejects.toThrow('Espécime canônico não encontrado no MongoDB');
      expect(graphProjectionService.appendSpecimenEvent).not.toHaveBeenCalled();
      expect(graphProjectionService.appendCustodyEvent).not.toHaveBeenCalled();
    });

    it('queues specimen and custody projections in order using the same MongoDB session', async () => {
      const order = [];
      const appendSpecimenEvent = vi.fn().mockImplementation(async () => {
        order.push('specimen');
      });
      const appendCustodyEvent = vi.fn().mockImplementation(async () => {
        order.push('custody');
      });
      const { repository, db, graphProjectionService } = makeRepository({
        projection: { appendSpecimenEvent, appendCustodyEvent }
      });
      const session = { id: 'mongo-session' };
      const happenedAt = new Date('2026-09-15T13:00:00.000Z');

      const result = await repository.recordCustodyEvent({
        specimenId: 'specimen-1',
        custodyEventId: 'custody-1',
        eventType: 'MOVE',
        happenedAt,
        actorId: 'synthetic-actor-1',
        reason: 'synthetic-reconciliation',
        from: { storagePositionId: 'position-a1' },
        to: { storagePositionId: 'position-b2' }
      }, session);

      expect(order).toEqual(['specimen', 'custody']);
      expect(graphProjectionService.appendSpecimenEvent).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          specimenId: 'specimen-1',
          participantId: 'participant-1',
          parentSpecimenIds: ['parent-1'],
          sourceService: 'mongo-lineage-repository'
        }),
        { session }
      );
      expect(graphProjectionService.appendCustodyEvent).toHaveBeenCalledWith(
        db,
        {
          specimenId: 'specimen-1',
          custodyEventId: 'custody-1',
          eventType: 'MOVE',
          happenedAt,
          actorId: 'synthetic-actor-1',
          reason: 'synthetic-reconciliation',
          from: { storagePositionId: 'position-a1' },
          to: { storagePositionId: 'position-b2' },
          sourceService: 'mongo-lineage-repository'
        },
        { session }
      );
      expect(result).toEqual({ eventId: 'custody-1', queued: true });
    });

    it('generates an opaque custody event identifier when none is supplied', async () => {
      const { repository } = makeRepository();

      const result = await repository.recordCustodyEvent(
        { specimenId: 'specimen-1', eventType: 'MOVE' },
        { id: 'mongo-session' }
      );

      expect(result.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(result.queued).toBe(true);
    });

    it('propagates an outbox failure without issuing any cross-store compensation', async () => {
      const appendCustodyEvent = vi.fn().mockRejectedValue(new Error('outbox unavailable'));
      const { repository } = makeRepository({ projection: { appendCustodyEvent } });
      const compensation = vi.spyOn(repository, 'compensateCustodyEvent');

      await expect(
        repository.recordCustodyEvent(
          { specimenId: 'specimen-1', eventType: 'MOVE' },
          { id: 'mongo-session' }
        )
      ).rejects.toThrow('outbox unavailable');
      expect(compensation).not.toHaveBeenCalled();
    });
  });

  describe('transactional lineage outbox', () => {
    it('requires the MongoDB transaction session shared by lineage and outbox', async () => {
      const { repository, graphProjectionService } = makeRepository();

      await expect(
        repository.createSampleNodeWithParent({ specimenId: 'specimen-1' })
      ).rejects.toThrow('Linhagem e outbox devem compartilhar a transação MongoDB');
      expect(graphProjectionService.appendLineageEvent).not.toHaveBeenCalled();
    });

    it('rejects lineage for a specimen absent from canonical MongoDB', async () => {
      const { repository, graphProjectionService } = makeRepository({ specimen: null });

      await expect(
        repository.createSampleNodeWithParent(
          { specimenId: 'missing-specimen', parentSpecimenIds: ['parent-1'] },
          { id: 'mongo-session' }
        )
      ).rejects.toThrow('Espécime canônico não encontrado no MongoDB');
      expect(graphProjectionService.appendSpecimenEvent).not.toHaveBeenCalled();
      expect(graphProjectionService.appendLineageEvent).not.toHaveBeenCalled();
    });

    it('queues one canonical lineage event per parent using the same MongoDB session', async () => {
      const { repository, db, graphProjectionService } = makeRepository();
      const session = { id: 'mongo-session' };

      const result = await repository.createSampleNodeWithParent({
        specimenId: 'specimen-1',
        parentSpecimenIds: ['parent-a', 'parent-b'],
        relationshipType: 'ALIQUOT'
      }, session);

      expect(graphProjectionService.appendSpecimenEvent).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          specimenId: 'specimen-1',
          parentSpecimenIds: ['parent-a', 'parent-b']
        }),
        { session }
      );
      expect(graphProjectionService.appendLineageEvent).toHaveBeenNthCalledWith(
        1,
        db,
        {
          specimenId: 'specimen-1',
          parentSpecimenId: 'parent-a',
          sourceService: 'mongo-lineage-repository'
        },
        { session }
      );
      expect(graphProjectionService.appendLineageEvent).toHaveBeenNthCalledWith(
        2,
        db,
        {
          specimenId: 'specimen-1',
          parentSpecimenId: 'parent-b',
          sourceService: 'mongo-lineage-repository'
        },
        { session }
      );
      expect(result).toEqual({
        specimenId: 'specimen-1',
        parentSpecimenIds: ['parent-a', 'parent-b'],
        relationshipType: 'ALIQUOT',
        queued: true
      });
    });

    it('uses the canonical specimen parent list when the input does not override it', async () => {
      const { repository, graphProjectionService } = makeRepository();

      const result = await repository.createSampleNodeWithParent(
        { specimenId: 'specimen-1' },
        { id: 'mongo-session' }
      );

      expect(result.parentSpecimenIds).toEqual(['parent-1']);
      expect(graphProjectionService.appendLineageEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('retired cross-store compensation', () => {
    it('reports that transactional outbox requires no Neo4j compensation', async () => {
      const { repository } = makeRepository();

      await expect(repository.compensateCustodyEvent()).resolves.toEqual({
        compensated: false,
        reason: 'transactional_outbox_requires_no_compensation'
      });
    });
  });
});
