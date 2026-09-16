import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { recordAction, getActionsForSpecimen, releaseActiveAction, markPendingReview } = require('../../../src/services/quarantine-action.service');

/**
 * Real query-matching fake — a scalar filter value against an array field
 * matches array-containment (Mongo's actual semantics for
 * `{ specimenIds: 'X' }` against `specimenIds: ['X', 'Y']`), not a stub
 * that returns canned data regardless of query, per this repo's
 * native-only "real backend" proof bar.
 */
function createFakeCollection() {
  const docs = [];
  const matches = (doc, filter) =>
    Object.keys(filter).every((key) => {
      const docValue = doc[key];
      const filterValue = filter[key];
      if (Array.isArray(docValue)) return docValue.includes(filterValue);
      return docValue === filterValue;
    });
  const calls = { insertOne: [], updateOne: [], find: [] };
  return {
    docs,
    calls,
    async insertOne(doc, options) {
      calls.insertOne.push(options);
      docs.push(doc);
      return { insertedId: `fake-${docs.length}` };
    },
    async updateOne(filter, update, options) {
      calls.updateOne.push(options);
      const doc = docs.find((d) => matches(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    },
    find(filter = {}, options) {
      calls.find.push(options);
      let current = docs.filter((doc) => matches(doc, filter));
      const cursor = {
        sort(criteria = {}) {
          const [[field, direction = 1]] = Object.entries(criteria);
          current = [...current].sort((a, b) => {
            const left = a?.[field]?.getTime ? a[field].getTime() : a?.[field];
            const right = b?.[field]?.getTime ? b[field].getTime() : b?.[field];
            if (left === right) return 0;
            return direction >= 0 ? (left > right ? 1 : -1) : (left > right ? -1 : 1);
          });
          return cursor;
        },
        async toArray() {
          return current;
        },
      };
      return cursor;
    },
  };
}

function createFakeDb() {
  const collections = { quarantineActions: createFakeCollection() };
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

describe('quarantine-action.service', () => {
  describe('recordAction', () => {
    it('persists a quarantine action referenced by specimenIds', async () => {
      const db = createFakeDb();

      const stored = await recordAction(db, {
        specimenIds: ['SPEC-1'],
        reasonCodes: [{ code: 'CONSENT_REVOKED' }],
        authorizedBy: 'user-1',
      });

      expect(stored.specimenIds).toEqual(['SPEC-1']);
      expect(stored.actionStatus).toBe('active');
      expect(db.collections.quarantineActions.docs).toHaveLength(1);
    });

    it('covers a batch of specimens tied to one incident in a single action', async () => {
      const db = createFakeDb();
      await recordAction(db, { specimenIds: ['SPEC-1', 'SPEC-2'], reasonCodes: [{ code: 'COLD_CHAIN' }] });

      const forSpec1 = await getActionsForSpecimen(db, 'SPEC-1');
      const forSpec2 = await getActionsForSpecimen(db, 'SPEC-2');
      expect(forSpec1).toHaveLength(1);
      expect(forSpec2).toHaveLength(1);
      expect(forSpec1[0].quarantineActionId).toBe(forSpec2[0].quarantineActionId);
    });
  });

  describe('getActionsForSpecimen', () => {
    it('scopes results to the requested specimenId only', async () => {
      const db = createFakeDb();
      await recordAction(db, { specimenIds: ['SPEC-1'] });
      await recordAction(db, { specimenIds: ['SPEC-2'] });

      const actions = await getActionsForSpecimen(db, 'SPEC-1');

      expect(actions).toHaveLength(1);
      expect(actions[0].specimenIds).toEqual(['SPEC-1']);
    });

    it('returns actions newest-first', async () => {
      const db = createFakeDb();
      await recordAction(db, { specimenIds: ['SPEC-1'], startedAt: '2026-01-01T00:00:00.000Z' });
      await recordAction(db, { specimenIds: ['SPEC-1'], startedAt: '2026-06-01T00:00:00.000Z' });

      const actions = await getActionsForSpecimen(db, 'SPEC-1');

      expect(actions.map((a) => a.startedAt.toISOString())).toEqual([
        '2026-06-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      ]);
    });
  });

  describe('releaseActiveAction', () => {
    it('releases the most recent still-active action, RF019 AC#7/AC#8 (authorized actor, audited)', async () => {
      const db = createFakeDb();
      await recordAction(db, { specimenIds: ['SPEC-1'], authorizedBy: 'user-1' });

      const released = await releaseActiveAction(db, 'SPEC-1', 'user-2', '2026-02-01T00:00:00.000Z');

      expect(released.actionStatus).toBe('released');
      expect(released.releasedAt.toISOString()).toBe('2026-02-01T00:00:00.000Z');
      expect(released.authorizedBy).toBe('user-2');
      expect(db.collections.quarantineActions.docs[0].actionStatus).toBe('released');
    });

    it('returns null when the specimen has no active action to release', async () => {
      const db = createFakeDb();
      const released = await releaseActiveAction(db, 'SPEC-1', 'user-2');
      expect(released).toBeNull();
    });

    it('does not release an already-released action', async () => {
      const db = createFakeDb();
      await recordAction(db, { specimenIds: ['SPEC-1'] });
      await releaseActiveAction(db, 'SPEC-1', 'user-1');

      const secondAttempt = await releaseActiveAction(db, 'SPEC-1', 'user-2');
      expect(secondAttempt).toBeNull();
    });
  });

  describe('session threading (#410)', () => {
    it('forwards an optional Mongo session to recordAction and getActionsForSpecimen', async () => {
      const db = createFakeDb();
      const fakeSession = { id: 'txn-session' };

      await recordAction(db, { specimenIds: ['SPEC-1'] }, fakeSession);
      await getActionsForSpecimen(db, 'SPEC-1', fakeSession);

      const { calls } = db.collections.quarantineActions;
      expect(calls.insertOne[0]).toEqual({ session: fakeSession });
      expect(calls.find[calls.find.length - 1]).toEqual({ session: fakeSession });
    });

    it('forwards an optional Mongo session to releaseActiveAction', async () => {
      const db = createFakeDb();
      const fakeSession = { id: 'txn-session' };
      await recordAction(db, { specimenIds: ['SPEC-1'] });

      await releaseActiveAction(db, 'SPEC-1', 'user-2', new Date('2026-02-01'), fakeSession);

      const { calls } = db.collections.quarantineActions;
      expect(calls.find[calls.find.length - 1]).toEqual({ session: fakeSession });
      expect(calls.updateOne[calls.updateOne.length - 1]).toEqual({ session: fakeSession });
    });

    it('forwards an optional Mongo session to markPendingReview', async () => {
      const db = createFakeDb();
      const fakeSession = { id: 'txn-session' };
      await recordAction(db, { specimenIds: ['SPEC-1'] });

      await markPendingReview(db, 'SPEC-1', fakeSession);

      const { calls } = db.collections.quarantineActions;
      expect(calls.find[calls.find.length - 1]).toEqual({ session: fakeSession });
      expect(calls.updateOne[calls.updateOne.length - 1]).toEqual({ session: fakeSession });
    });

    it('omits session options when no session is passed', async () => {
      const db = createFakeDb();
      await recordAction(db, { specimenIds: ['SPEC-1'] });

      const { calls } = db.collections.quarantineActions;
      expect(calls.insertOne[0]).toBeUndefined();
    });
  });
});
