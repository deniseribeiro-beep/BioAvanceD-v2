import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const legalHoldService = require('../../../src/services/legalHold.service');

/** Real query-matching fake, same pattern as accessRequest.service.test.js. */
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
  const collections = { legalHolds: createFakeCollection() };
  return {
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

function basePayload(overrides = {}) {
  return {
    targetEntityType: 'Sample',
    targetEntityIds: ['specimen-1'],
    reason: 'Investigação em andamento (ordem judicial)',
    imposedBy: 'user-1',
    ...overrides,
  };
}

describe('legalHold.service', () => {
  describe('imposeHold (AC#2)', () => {
    it('imposes an active hold', async () => {
      const db = createFakeDb();
      const hold = await legalHoldService.imposeHold(db, basePayload());

      expect(hold.legalHoldId).toBeTruthy();
      expect(hold.status).toBe('active');
    });

    it('rejects a payload missing targetEntityIds', async () => {
      const db = createFakeDb();
      await expect(legalHoldService.imposeHold(db, basePayload({ targetEntityIds: [] }))).rejects.toThrow(/targetEntityIds/);
    });
  });

  describe('releaseHold', () => {
    it('releases an active hold with a reason', async () => {
      const db = createFakeDb();
      const hold = await legalHoldService.imposeHold(db, basePayload());

      const released = await legalHoldService.releaseHold(db, hold.legalHoldId, 'user-2', 'Investigação encerrada');

      expect(released.status).toBe('released');
      expect(released.releasedBy).toBe('user-2');
      expect(released.releaseReason).toBe('Investigação encerrada');
    });

    it('requires a releaseReason', async () => {
      const db = createFakeDb();
      const hold = await legalHoldService.imposeHold(db, basePayload());

      await expect(legalHoldService.releaseHold(db, hold.legalHoldId, 'user-2', '')).rejects.toThrow(/releaseReason/);
    });

    it('refuses to release an already-released hold', async () => {
      const db = createFakeDb();
      const hold = await legalHoldService.imposeHold(db, basePayload());
      await legalHoldService.releaseHold(db, hold.legalHoldId, 'user-2', 'Primeira liberação');

      await expect(legalHoldService.releaseHold(db, hold.legalHoldId, 'user-2', 'Segunda tentativa')).rejects.toThrow(/ativo/);
    });

    it('refuses to release an unknown legalHoldId', async () => {
      const db = createFakeDb();
      await expect(legalHoldService.releaseHold(db, 'does-not-exist', 'user-2', 'motivo')).rejects.toThrow(/não encontrado/);
    });
  });

  describe('hasActiveHold (AC#2/#6 core check)', () => {
    it('returns true when an active hold covers one of the given ids', async () => {
      const db = createFakeDb();
      await legalHoldService.imposeHold(db, basePayload({ targetEntityIds: ['specimen-1', 'specimen-2'] }));

      expect(await legalHoldService.hasActiveHold(db, 'Sample', ['specimen-2', 'specimen-3'])).toBe(true);
    });

    it('returns false when no hold covers the given ids', async () => {
      const db = createFakeDb();
      await legalHoldService.imposeHold(db, basePayload({ targetEntityIds: ['specimen-1'] }));

      expect(await legalHoldService.hasActiveHold(db, 'Sample', ['specimen-9'])).toBe(false);
    });

    it('returns false once the covering hold has been released', async () => {
      const db = createFakeDb();
      const hold = await legalHoldService.imposeHold(db, basePayload({ targetEntityIds: ['specimen-1'] }));
      await legalHoldService.releaseHold(db, hold.legalHoldId, 'user-2', 'Encerrado');

      expect(await legalHoldService.hasActiveHold(db, 'Sample', ['specimen-1'])).toBe(false);
    });

    it('does not match across a different targetEntityType', async () => {
      const db = createFakeDb();
      await legalHoldService.imposeHold(db, basePayload({ targetEntityType: 'Patient', targetEntityIds: ['patient-1'] }));

      expect(await legalHoldService.hasActiveHold(db, 'Sample', ['patient-1'])).toBe(false);
    });
  });
});

describe('legalHold.service.specimenHoldRefusal (RF006 AC6, #1315)', () => {
  it('names an active hold on the specimen, by specimenId or stored _id, under Specimen or Sample', async () => {
    const db = createFakeDb();
    const byId = await legalHoldService.imposeHold(db, basePayload({ targetEntityType: 'Specimen', targetEntityIds: ['SPC-1'] }));
    expect(await legalHoldService.specimenHoldRefusal(db, { specimenId: 'SPC-1', _id: 'oid-1' })).toContain(byId.legalHoldId);
    await legalHoldService.imposeHold(db, basePayload({ targetEntityIds: ['oid-2'] }));
    expect(await legalHoldService.specimenHoldRefusal(db, { specimenId: 'SPC-2', _id: 'oid-2' })).toContain('bloqueio legal ativo');
  });

  it('ignores a released hold, another entity type, another specimen and a missing sample', async () => {
    const db = createFakeDb();
    const hold = await legalHoldService.imposeHold(db, basePayload({ targetEntityIds: ['SPC-1'] }));
    await legalHoldService.imposeHold(db, basePayload({ targetEntityType: 'Patient', targetEntityIds: ['SPC-3'] }));
    expect(await legalHoldService.specimenHoldRefusal(db, { specimenId: 'SPC-3' })).toBeNull();
    expect(await legalHoldService.specimenHoldRefusal(db, { specimenId: 'SPC-9' })).toBeNull();
    expect(await legalHoldService.specimenHoldRefusal(db, null)).toBeNull();
    await legalHoldService.releaseHold(db, hold.legalHoldId, 'user-1', 'ordem revogada');
    expect(await legalHoldService.specimenHoldRefusal(db, { specimenId: 'SPC-1' })).toBeNull();
  });
});
