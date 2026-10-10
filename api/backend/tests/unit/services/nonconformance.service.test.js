import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const nonconformanceService = require('../../../src/services/nonconformance.service');
const notificationDispatchService = require('../../../src/services/notificationDispatch.service');
const { matchesFilter } = require('../../factories/filter.factory');

afterEach(() => { vi.restoreAllMocks(); });

/**
 * Real query-matching fake (exact-match findOne/find/sort, insertOne,
 * updateOne $set), not a canned stub -- same pattern as
 * accessRequest.service.test.js's own fake, per this repo's native-only
 * "real backend" proof bar.
 */
function createFakeCollection() {
  const docs = [];
  const matches = (doc, filter) => Object.keys(filter).every((key) => doc[key] === filter[key]);
  return {
    docs,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: `fake-${docs.length}` };
    },
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    find(filter = {}) {
      const matched = docs.filter((doc) => matches(doc, filter));
      return {
        sort() {
          return this;
        },
        async toArray() {
          return matched;
        },
      };
    },
  };
}

/**
 * #1315 (RF019 AC1): opening a nonconformance quarantines its affected
 * specimens, which reads `samples` with $and/$in/$ne and writes the
 * quarantine action, the ledger movement and the state decision. Those
 * collections match through the shared filter factory.
 */
function createMatchingCollection(seed = []) {
  const docs = [...seed];
  const cursor = (items) => ({
    sort() { return this; },
    limit() { return this; },
    async toArray() { return items; },
    async next() { return items[0] || null; },
  });
  return {
    docs,
    find: (filter = {}) => cursor(docs.filter((doc) => matchesFilter(doc, filter))),
    findOne: async (filter = {}) => docs.find((doc) => matchesFilter(doc, filter)) || null,
    insertOne: vi.fn(async (doc) => { docs.push(doc); return { insertedId: `fake-${docs.length}` }; }),
    updateOne: async (filter, update) => {
      const doc = docs.find((entry) => matchesFilter(entry, filter));
      if (doc && update?.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    },
    createIndex: async () => 'idx',
    findOneAndUpdate: async () => ({ value: { seq: 1 } }),
  };
}

function createFakeDb({ samples = [] } = {}) {
  const collections = { nonconformances: createFakeCollection(), samples: createMatchingCollection(samples) };
  return {
    collections,
    collection(name) {
      if (!collections[name]) collections[name] = createMatchingCollection();
      return collections[name];
    },
  };
}

function basePayload(overrides = {}) {
  return {
    nonconformanceType: 'deviation',
    detectedAt: '2026-08-20T10:00:00.000Z',
    detectedBy: 'user-1',
    description: 'Temperatura do freezer fora da faixa durante o ensaio',
    affectedEntityIds: ['assay-1'],
    ...overrides,
  };
}

describe('nonconformance.service', () => {
  describe('open quarantines the affected specimens (RF019 AC1, #1315)', () => {
    it('quarantines each affected id that names a specimen, records why, and leaves the other ids alone', async () => {
      const db = createFakeDb({ samples: [
        { _id: 'S1', specimenId: 'SPC-NC', specimenStatus: 'available', quantity: 1 },
        { _id: 'S2', specimenId: 'SPC-OTHER', specimenStatus: 'available', quantity: 1 },
      ] });

      const opened = await nonconformanceService.open(db, basePayload({ affectedEntityIds: ['SPC-NC', 'equipment-7'] }));

      expect(opened.quarantinedSpecimenCount).toBe(1);
      const [quarantinedSample, untouched] = db.collections.samples.docs;
      expect(quarantinedSample).toMatchObject({ specimenStatus: 'quarantined', quarantineSource: 'nonconformance', quarantineSourceId: opened.nonconformanceId });
      expect(untouched.specimenStatus).toBe('available');
      expect(db.collections.quarantineActions.docs).toHaveLength(1);
      expect(db.collections.operationalStateDecisions.docs[0]).toMatchObject({
        specimenId: 'SPC-NC', previousStatus: 'available', newStatus: 'quarantined', rulesApplied: ['nonconformance_quarantine'], reasonCodes: ['nonconformance'],
      });
    });

    it('quarantines nothing when no affected id names a specimen', async () => {
      const db = createFakeDb({ samples: [{ _id: 'S1', specimenId: 'SPC-NC', specimenStatus: 'available' }] });
      const opened = await nonconformanceService.open(db, basePayload({ affectedEntityIds: ['assay-1'] }));
      expect(opened.quarantinedSpecimenCount).toBeUndefined();
      expect(db.collections.samples.docs[0].specimenStatus).toBe('available');
    });
  });

  describe('open (AC#5)', () => {
    it('opens a nonconformance with status open', async () => {
      const db = createFakeDb();

      const opened = await nonconformanceService.open(db, basePayload());

      expect(opened.nonconformanceId).toBeTruthy();
      expect(opened.status).toBe('open');
      expect(opened.correctiveAction).toBeNull();
    });

    it('rejects a payload missing affectedEntityIds', async () => {
      const db = createFakeDb();

      await expect(
        nonconformanceService.open(db, basePayload({ affectedEntityIds: [] }))
      ).rejects.toThrow(/affectedEntityIds/);
    });
  });

  describe('recordCorrectiveAction (AC#5/#6)', () => {
    it('records description/responsible and advances status', async () => {
      const db = createFakeDb();
      const opened = await nonconformanceService.open(db, basePayload());

      const updated = await nonconformanceService.recordCorrectiveAction(db, opened.nonconformanceId, {
        description: 'Recalibrar sensor e revisar protocolo de controle',
        responsible: 'user-2',
        dueDate: '2026-09-01',
      });

      expect(updated.status).toBe('corrective_action_recorded');
      expect(updated.correctiveAction.responsible).toBe('user-2');
      expect(updated.correctiveAction.dueDate).toBeInstanceOf(Date);
    });

    it('refuses a corrective action for an unknown nonconformanceId', async () => {
      const db = createFakeDb();

      await expect(
        nonconformanceService.recordCorrectiveAction(db, 'does-not-exist', {
          description: 'x',
          responsible: 'user-2',
        })
      ).rejects.toThrow(/não encontrada/);
    });

    it('requires a responsible party', async () => {
      const db = createFakeDb();
      const opened = await nonconformanceService.open(db, basePayload());

      await expect(
        nonconformanceService.recordCorrectiveAction(db, opened.nonconformanceId, { description: 'x' })
      ).rejects.toThrow(/responsible/);
    });
  });

  describe('verifyEffectiveness (AC#6)', () => {
    async function seedWithCorrectiveAction() {
      const db = createFakeDb();
      const opened = await nonconformanceService.open(db, basePayload());
      await nonconformanceService.recordCorrectiveAction(db, opened.nonconformanceId, {
        description: 'Recalibrar sensor',
        responsible: 'user-2',
      });
      return { db, nonconformanceId: opened.nonconformanceId };
    }

    it('refuses verification before a corrective action is recorded', async () => {
      const db = createFakeDb();
      const opened = await nonconformanceService.open(db, basePayload());

      await expect(
        nonconformanceService.verifyEffectiveness(db, opened.nonconformanceId, {
          verifiedBy: 'user-3',
          outcome: 'effective',
        })
      ).rejects.toThrow(/ação corretiva/);
    });

    it('closes the nonconformance when the outcome is effective', async () => {
      const { db, nonconformanceId } = await seedWithCorrectiveAction();

      const verified = await nonconformanceService.verifyEffectiveness(db, nonconformanceId, {
        verifiedBy: 'user-3',
        outcome: 'effective',
        notes: 'Confirmado em nova rodada de controle',
      });

      expect(verified.status).toBe('closed');
      expect(verified.closureDate).toBeTruthy();
      expect(verified.effectivenessVerification.outcome).toBe('effective');
    });

    it('keeps the nonconformance open (not closed) when the outcome is ineffective', async () => {
      const { db, nonconformanceId } = await seedWithCorrectiveAction();

      const verified = await nonconformanceService.verifyEffectiveness(db, nonconformanceId, {
        verifiedBy: 'user-3',
        outcome: 'ineffective',
      });

      expect(verified.status).toBe('corrective_action_recorded');
      expect(verified.closureDate).toBeNull();
    });
  });

  describe('#650 (RF015 qualidade) dispatches a nonconformance_opened notification', () => {
    it('dispatches when a nonconformance is opened', async () => {
      const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);
      const db = createFakeDb();

      const opened = await nonconformanceService.open(db, basePayload());

      expect(dispatchSpy).toHaveBeenCalledWith(db, {
        eventType: 'nonconformance_opened',
        sourceEventType: 'Nonconformance',
        sourceEventId: opened.nonconformanceId,
        payload: {
          nonconformanceType: 'deviation',
          affectedEntityIds: ['assay-1']
        }
      });
    });

    it('does NOT dispatch when the payload fails validation', async () => {
      const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);
      const db = createFakeDb();

      await expect(
        nonconformanceService.open(db, basePayload({ affectedEntityIds: [] }))
      ).rejects.toThrow(/affectedEntityIds/);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('getById / getAll', () => {
    it('returns null for an unknown nonconformanceId', async () => {
      const db = createFakeDb();
      expect(await nonconformanceService.getById(db, 'does-not-exist')).toBeNull();
    });

    it('lists opened nonconformances', async () => {
      const db = createFakeDb();
      await nonconformanceService.open(db, basePayload());
      await nonconformanceService.open(db, basePayload({ affectedEntityIds: ['assay-2'] }));

      const all = await nonconformanceService.getAll(db);
      expect(all).toHaveLength(2);
    });
  });
});
