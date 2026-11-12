import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { recordAction, getActionsForSpecimen, releaseActiveAction, markPendingReview, auditDecision, canonicalSpecimenId } = require('../../../src/services/quarantine-action.service');

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
      // #1219: { $in } matches when any listed value would.
      if (filterValue && typeof filterValue === 'object' && Array.isArray(filterValue.$in)) {
        return filterValue.$in.some((value) => (Array.isArray(docValue) ? docValue.includes(value) : docValue === value));
      }
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

// #1505 (RF019 AC6): the outbox's two collections, recording each append's
// event and options.
function createFakeOutbox() {
  const outbox = {
    appended: [],
    calls: [],
    async createIndex() { return 'ok'; },
    async updateOne(filter, update, options) {
      outbox.calls.push(options);
      outbox.appended.push(update.$setOnInsert);
      return { upsertedCount: 1 };
    },
  };
  const versions = {
    calls: [],
    async findOneAndUpdate(filter, update, options) {
      versions.calls.push(options);
      return { version: 1 };
    },
  };
  return { graph_projection_outbox: outbox, graph_projection_outbox_aggregate_versions: versions };
}

function createFakeDb() {
  const collections = { quarantineActions: createFakeCollection(), ...createFakeOutbox() };
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

  describe('recordAction outbox event (#1505, RF019 AC6)', () => {
    it('appends one QUARANTINE_APPLIED event keyed by the action, with its specimens, rule and actor and no other field', async () => {
      const db = createFakeDb();
      const stored = await recordAction(db, { specimenIds: ['SPEC-1'], reasonCodes: ['CONSENT_REVOKED'], authorizedBy: 'user-1' });

      const events = db.collections.graph_projection_outbox.appended;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: 'QUARANTINE_APPLIED',
        aggregateType: 'QuarantineAction',
        aggregateId: stored.quarantineActionId,
        sourceService: 'quarantine-action',
        payload: {
          quarantineActionId: stored.quarantineActionId,
          specimenIds: ['SPEC-1'],
          reasonCodes: ['CONSENT_REVOKED'],
          actionStatus: 'active',
          authorizedBy: 'user-1',
        },
      });
      expect(events[0].payload.startedAt).toBeInstanceOf(Date);
      expect(Object.keys(events[0].payload).sort()).toEqual(
        ['actionStatus', 'authorizedBy', 'quarantineActionId', 'reasonCodes', 'specimenIds', 'startedAt']
      );
    });

    it('appends the event in the session the caller passes', async () => {
      const db = createFakeDb();
      const fakeSession = { id: 'txn-session' };
      await recordAction(db, { specimenIds: ['SPEC-1'] }, fakeSession);

      expect(db.collections.graph_projection_outbox.calls[0]).toEqual({ upsert: true, session: fakeSession });
      expect(db.collections.graph_projection_outbox_aggregate_versions.calls[0]).toMatchObject({ session: fakeSession });
    });

    it('appends no event when the action insert fails', async () => {
      const db = createFakeDb();
      db.collections.quarantineActions.insertOne = async () => { throw new Error('insert failed'); };

      await expect(recordAction(db, { specimenIds: ['SPEC-1'] })).rejects.toThrow('insert failed');
      expect(db.collections.graph_projection_outbox.appended).toHaveLength(0);
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
  // #1219: every writer used to record the sample's Mongo _id, while
  // GET /api/samples/:id/quarantine-actions read by the canonical
  // specimenId, so it never found an action. New actions carry the
  // specimenId, and a lookup handed the sample matches both forms.
  describe('#1219: one sample, its legacy _id-keyed and its canonical actions', () => {
    const sample = { _id: '507f1f77bcf86cd799439011', specimenId: '3116768' };

    it('canonicalSpecimenId prefers the specimenId, and falls back to the _id', () => {
      expect(canonicalSpecimenId(sample)).toBe('3116768');
      expect(canonicalSpecimenId({ _id: '507f1f77bcf86cd799439011' })).toBe('507f1f77bcf86cd799439011');
    });

    it('getActionsForSpecimen handed the sample finds both a legacy and a canonical action', async () => {
      const db = createFakeDb();
      await recordAction(db, { specimenIds: [sample._id], reasonCodes: [{ code: 'LEGACY' }] });
      await recordAction(db, { specimenIds: [canonicalSpecimenId(sample)], reasonCodes: [{ code: 'CANONICAL' }] });
      await recordAction(db, { specimenIds: ['someone-else'], reasonCodes: [{ code: 'OTHER' }] });

      const actions = await getActionsForSpecimen(db, sample);

      expect(actions.map((a) => a.reasonCodes[0].code).sort()).toEqual(['CANONICAL', 'LEGACY']);
    });

    it('getActionsForSpecimen handed a bare id matches that id only', async () => {
      const db = createFakeDb();
      await recordAction(db, { specimenIds: [sample._id], reasonCodes: [{ code: 'LEGACY' }] });

      expect(await getActionsForSpecimen(db, sample.specimenId)).toHaveLength(0);
      expect(await getActionsForSpecimen(db, sample._id)).toHaveLength(1);
    });

    it('releaseActiveAction handed the sample releases an action recorded under its legacy _id', async () => {
      const db = createFakeDb();
      await recordAction(db, { specimenIds: [sample._id], reasonCodes: [{ code: 'LEGACY' }] });

      const released = await releaseActiveAction(db, sample, 'user-1');

      expect(released?.actionStatus).toBe('released');
      expect(db.collections.quarantineActions.docs[0].actionStatus).toBe('released');
    });
  });
});

describe("auditDecision (RF019 AC#6)", () => {
  const auditLogger = require("../../../src/utils/auditLogger");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("audits an applied quarantine under the action id, with its specimens and reasons", async () => {
    const db = createFakeDb();
    const log = vi.spyOn(auditLogger, "log").mockResolvedValue(undefined);
    const action = await recordAction(db, { specimenIds: ["SPC-1"], reasonCodes: ["CONSENT_REVOKED"] });
    const req = { path: "/api/e-consent/update" };

    await auditDecision(db, { decision: "applied", action, req });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({
      action: "QUARANTINE_APPLIED",
      resourceType: "QuarantineAction",
      resourceId: action.quarantineActionId,
      req,
      payload: { specimenIds: ["SPC-1"], reasonCodes: ["CONSENT_REVOKED"], actionStatus: "active" },
    });
  });

  it("audits a release as QUARANTINE_RELEASED with the releasing actor", async () => {
    const db = createFakeDb();
    const log = vi.spyOn(auditLogger, "log").mockResolvedValue(undefined);
    await recordAction(db, { specimenIds: ["SPC-2"], reasonCodes: ["INTAKE_GOVERNANCE"] });
    const released = await releaseActiveAction(db, "SPC-2", "user-7");

    await auditDecision(db, { decision: "released", action: released });

    expect(log.mock.calls[0][0]).toMatchObject({
      action: "QUARANTINE_RELEASED",
      resourceId: released.quarantineActionId,
      payload: { actionStatus: "released", authorizedBy: "user-7" },
    });
  });

  it("audits nothing when no action was recorded or released", async () => {
    const log = vi.spyOn(auditLogger, "log").mockResolvedValue(undefined);

    await auditDecision(createFakeDb(), { decision: "released", action: null });

    expect(log).not.toHaveBeenCalled();
  });
});
