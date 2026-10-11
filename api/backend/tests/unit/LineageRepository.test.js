import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require2 = createRequire(import.meta.url);
const LineageRepository = require2('../../src/infrastructure/database/neo4j/LineageRepository.js');

// #1312 (RF023 AC8): the repository appends custody events to the graph
// outbox in MongoDB. It holds no Neo4j driver and runs no Cypher.
function makeGraphProjection(impl) {
  return {
    appendCustodyEvent: vi.fn(impl || (async () => ({ eventId: 'evt-outbox-1' })))
  };
}

describe('LineageRepository', () => {
  describe('validateBeforePersistence', () => {
    it('resolves true for a payload with specimenId and eventType, appending nothing', async () => {
      const graphProjection = makeGraphProjection();
      const repo = new LineageRepository({ fake: 'db' }, { graphProjection });

      await expect(repo.validateBeforePersistence({ specimenId: 's-1', eventType: 'move' })).resolves.toBe(true);
      expect(graphProjection.appendCustodyEvent).not.toHaveBeenCalled();
    });

    it('rejects a payload without specimenId', async () => {
      const repo = new LineageRepository({}, { graphProjection: makeGraphProjection() });
      await expect(repo.validateBeforePersistence({ specimenId: '  ', eventType: 'move' })).rejects.toThrow('specimenId obrigatório');
    });

    it('rejects a payload without eventType', async () => {
      const repo = new LineageRepository({}, { graphProjection: makeGraphProjection() });
      await expect(repo.validateBeforePersistence({ specimenId: 's-1' })).rejects.toThrow('eventType obrigatório');
    });

    it('needs no database: it reads nothing', async () => {
      const repo = new LineageRepository(null, { graphProjection: makeGraphProjection() });
      await expect(repo.validateBeforePersistence({ specimenId: 's-1', eventType: 'register' })).resolves.toBe(true);
    });
  });

  describe('recordCustodyEvent', () => {
    it('appends the custody step to the outbox with the caller session and returns the outbox eventId', async () => {
      const db = { fake: 'db' };
      const session = { id: 'mongo-session' };
      const graphProjection = makeGraphProjection();
      const repo = new LineageRepository(db, { graphProjection });
      const happenedAt = new Date('2026-01-02T03:04:05.000Z');

      const result = await repo.recordCustodyEvent({
        specimenId: 's-1',
        barcode: 'BC-1',
        eventType: 'move',
        actorId: 'u-1',
        reason: 'reorg',
        happenedAt,
        from: { boxId: 'b1', position: 'a1' },
        to: { boxId: 'b2', position: 'B2' }
      }, { session });

      expect(result).toEqual({ eventId: 'evt-outbox-1' });
      expect(graphProjection.appendCustodyEvent).toHaveBeenCalledWith(db, {
        specimenId: 's-1',
        barcode: 'BC-1',
        eventType: 'move',
        happenedAt,
        actorId: 'u-1',
        reason: 'reorg',
        from: { boxId: 'b1', position: 'a1' },
        to: { boxId: 'b2', position: 'B2' },
        sourceService: 'lineage-repository'
      }, { session });
    });

    it('appends outside any transaction when no session is passed', async () => {
      const graphProjection = makeGraphProjection();
      const repo = new LineageRepository({}, { graphProjection });

      await repo.recordCustodyEvent({ specimenId: 's-1', eventType: 'register' });

      expect(graphProjection.appendCustodyEvent.mock.calls[0][2]).toEqual({});
    });

    it('propagates an append failure', async () => {
      const graphProjection = makeGraphProjection(async () => { throw new Error('outbox down'); });
      const repo = new LineageRepository({}, { graphProjection });

      await expect(repo.recordCustodyEvent({ specimenId: 's-1', eventType: 'allocate' })).rejects.toThrow('outbox down');
    });

    it('refuses without a database, appending nothing', async () => {
      const graphProjection = makeGraphProjection();
      const repo = new LineageRepository(null, { graphProjection });

      await expect(repo.recordCustodyEvent({ specimenId: 's-1', eventType: 'allocate' })).rejects.toThrow('MongoDB indisponível');
      expect(graphProjection.appendCustodyEvent).not.toHaveBeenCalled();
    });

    it('refuses an invalid payload before appending', async () => {
      const graphProjection = makeGraphProjection();
      const repo = new LineageRepository({}, { graphProjection });

      await expect(repo.recordCustodyEvent({ specimenId: 's-1' })).rejects.toThrow('eventType obrigatório');
      expect(graphProjection.appendCustodyEvent).not.toHaveBeenCalled();
    });

    it('returns a null eventId when the append resolves without one', async () => {
      const repo = new LineageRepository({}, { graphProjection: makeGraphProjection(async () => ({})) });
      await expect(repo.recordCustodyEvent({ specimenId: 's-1', eventType: 'release' })).resolves.toEqual({ eventId: null });
    });
  });

  it('exposes no compensation or derivation writer', () => {
    const repo = new LineageRepository({});
    expect(repo.compensateCustodyEvent).toBeUndefined();
    expect(repo.createSampleNodeWithParent).toBeUndefined();
  });
});
