import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const nonconformanceService = require('../../../src/services/nonconformance.service');
const notificationDispatchService = require('../../../src/services/notificationDispatch.service');

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

function createFakeDb() {
  const collections = { nonconformances: createFakeCollection() };
  return {
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
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
