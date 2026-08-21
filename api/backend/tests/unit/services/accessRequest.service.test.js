import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const accessRequestService = require('../../../src/services/accessRequest.service');
const { evaluateAccessState, DUO_SYSTEM_URI } = accessRequestService;

/**
 * Real query-matching fake (exact-match findOne/find/sort, insertOne,
 * updateOne $set), not a canned stub — per build-loop's native-only "real
 * backend" proof bar, this proves the service's query logic itself is
 * correct rather than trusting whatever a stub was told to return.
 */
function createFakeCollection(seedDocs = []) {
  const docs = [...seedDocs];
  // `_id` gets a dedicated comparison (dispositionAction.service.test.js's
  // own precedent) since the service constructs a real ObjectId instance to
  // query by, and two ObjectId instances with the same value are never
  // `===` to each other.
  const matches = (doc, filter) => Object.keys(filter).every((key) => {
    if (key === '_id') return String(doc._id) === String(filter._id);
    return doc[key] === filter[key];
  });
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

function createFakeDb({ samples = [], consents = [], terminologyConcepts = [], studies = [], sampleFiles = [] } = {}) {
  const collections = {
    accessRequests: createFakeCollection(),
    samples: createFakeCollection(samples),
    patientConsents: createFakeCollection(consents),
    terminologyConcepts: createFakeCollection(terminologyConcepts),
    studies: createFakeCollection(studies),
    sample_files: createFakeCollection(sampleFiles),
  };
  return {
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

function baseRequestPayload(overrides = {}) {
  return {
    requesterId: 'researcher-1',
    studyId: 'study-1',
    requestedPurpose: 'Estudo de biomarcadores oncológicos',
    requestedItems: [{ itemType: 'specimen', itemId: 'SPEC-1' }],
    ...overrides,
  };
}

describe('accessRequest.service', () => {
  describe('createRequest', () => {
    it('creates and persists a request with pending decision/distribution defaults', async () => {
      const db = createFakeDb();

      const created = await accessRequestService.createRequest(db, baseRequestPayload());

      expect(created.accessRequestId).toBeTruthy();
      expect(created.committeeDecision).toEqual({ status: 'pending', justification: null, decidedBy: null, decidedAt: null });
      expect(created.distributionStatus).toBe('pending');
      expect(created.overallCompatible).toBeNull();
    });

    it('rejects a request with no requestedItems', async () => {
      const db = createFakeDb();

      await expect(
        accessRequestService.createRequest(db, baseRequestPayload({ requestedItems: [] }))
      ).rejects.toThrow(/requestedItems/);
    });
  });

  describe('evaluateCompatibility (AC#2)', () => {
    async function seedAndCreate(overrides = {}, dbOverrides = {}) {
      const db = createFakeDb({
        samples: [{ specimenId: 'SPEC-1', participantId: 'participant-1' }],
        consents: [{ participantId: 'participant-1', status: 'ACTIVE' }],
        studies: [{ studyId: 'study-1', studyStatus: 'active' }],
        terminologyConcepts: [{ systemUri: DUO_SYSTEM_URI, code: 'DUO:0000004', conceptStatus: 'active' }],
        ...dbOverrides,
      });
      const created = await accessRequestService.createRequest(db, baseRequestPayload(overrides));
      return { db, created };
    }

    it('marks a specimen item compatible when consent is active, DUO resolves, and the study is active', async () => {
      const { db, created } = await seedAndCreate({ duoCode: 'DUO:0000004' });

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.overallCompatible).toBe(true);
      expect(evaluated.consentCompatibility).toEqual([
        {
          itemId: 'SPEC-1',
          itemType: 'specimen',
          participantId: 'participant-1',
          consentValid: true,
          duoCompatible: true,
          studyActive: true,
          compatible: true,
        },
      ]);
    });

    it('marks incompatible when the participant has no ACTIVE consent', async () => {
      const { db, created } = await seedAndCreate({}, { consents: [] });

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.overallCompatible).toBe(false);
      expect(evaluated.consentCompatibility[0].consentValid).toBe(false);
    });

    it('marks incompatible when the requested specimen does not resolve to a real sample', async () => {
      const { db, created } = await seedAndCreate({}, { samples: [] });

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.overallCompatible).toBe(false);
      expect(evaluated.consentCompatibility[0].participantId).toBeNull();
      expect(evaluated.consentCompatibility[0].consentValid).toBe(false);
    });

    it('marks incompatible when the requested duoCode does not resolve to an active TerminologyConcept', async () => {
      const { db, created } = await seedAndCreate({ duoCode: 'DUO:DOES-NOT-EXIST' });

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.overallCompatible).toBe(false);
      expect(evaluated.consentCompatibility[0].duoCompatible).toBe(false);
    });

    it('marks incompatible when the destination study is not active (RF021-style gate)', async () => {
      const { db, created } = await seedAndCreate({}, { studies: [{ studyId: 'study-1', studyStatus: 'inactive' }] });

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.overallCompatible).toBe(false);
      expect(evaluated.consentCompatibility[0].studyActive).toBe(false);
    });

    it('does not block on DUO when the request carries no duoCode at all', async () => {
      const { db, created } = await seedAndCreate();

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.consentCompatibility[0].duoCompatible).toBeNull();
      expect(evaluated.overallCompatible).toBe(true);
    });

    it('#661: resolves a file item to its specimen/participant and checks consent, same as specimen', async () => {
      const fileId = new ObjectId();
      const db = createFakeDb({
        sampleFiles: [{ _id: fileId, specimenId: 'SPEC-1' }],
        samples: [{ specimenId: 'SPEC-1', participantId: 'participant-1' }],
        consents: [{ participantId: 'participant-1', status: 'ACTIVE' }],
        studies: [{ studyId: 'study-1', studyStatus: 'active' }],
      });
      const created = await accessRequestService.createRequest(
        db,
        baseRequestPayload({ requestedItems: [{ itemType: 'file', itemId: fileId.toString() }] })
      );

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.overallCompatible).toBe(true);
      expect(evaluated.consentCompatibility[0]).toMatchObject({
        itemType: 'file',
        participantId: 'participant-1',
        consentValid: true,
        compatible: true,
      });
    });

    it('#661: marks a file item incompatible when its resolved participant has no ACTIVE consent', async () => {
      const fileId = new ObjectId();
      const db = createFakeDb({
        sampleFiles: [{ _id: fileId, specimenId: 'SPEC-1' }],
        samples: [{ specimenId: 'SPEC-1', participantId: 'participant-1' }],
        consents: [],
        studies: [{ studyId: 'study-1', studyStatus: 'active' }],
      });
      const created = await accessRequestService.createRequest(
        db,
        baseRequestPayload({ requestedItems: [{ itemType: 'file', itemId: fileId.toString() }] })
      );

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.overallCompatible).toBe(false);
      expect(evaluated.consentCompatibility[0].consentValid).toBe(false);
    });

    it('#661: marks a file item incompatible when its itemId does not resolve to a real file', async () => {
      const db = createFakeDb({
        studies: [{ studyId: 'study-1', studyStatus: 'active' }],
      });
      const created = await accessRequestService.createRequest(
        db,
        baseRequestPayload({ requestedItems: [{ itemType: 'file', itemId: new ObjectId().toString() }] })
      );

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.overallCompatible).toBe(false);
      expect(evaluated.consentCompatibility[0].participantId).toBeNull();
      expect(evaluated.consentCompatibility[0].consentValid).toBe(false);
    });

    it('#661: a malformed (non-ObjectId) file itemId does not throw, just fails to resolve', async () => {
      const db = createFakeDb({
        studies: [{ studyId: 'study-1', studyStatus: 'active' }],
      });
      const created = await accessRequestService.createRequest(
        db,
        baseRequestPayload({ requestedItems: [{ itemType: 'file', itemId: 'not-an-object-id' }] })
      );

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.consentCompatibility[0].participantId).toBeNull();
      expect(evaluated.consentCompatibility[0].consentValid).toBe(false);
    });

    it('#661: dataset items stay exempt -- non-blocking null consent, per de-identified-by-design', async () => {
      const db = createFakeDb({
        studies: [{ studyId: 'study-1', studyStatus: 'active' }],
      });
      const created = await accessRequestService.createRequest(
        db,
        baseRequestPayload({ requestedItems: [{ itemType: 'dataset', itemId: 'DATASET-1' }] })
      );

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.overallCompatible).toBe(true);
      expect(evaluated.consentCompatibility[0]).toMatchObject({
        itemType: 'dataset',
        participantId: null,
        consentValid: null,
        compatible: true,
      });
    });
  });

  describe('recordDecision (AC#3)', () => {
    async function seedEvaluated() {
      const db = createFakeDb({
        samples: [{ specimenId: 'SPEC-1', participantId: 'participant-1' }],
        consents: [{ participantId: 'participant-1', status: 'ACTIVE' }],
        studies: [{ studyId: 'study-1', studyStatus: 'active' }],
      });
      const created = await accessRequestService.createRequest(db, baseRequestPayload());
      await accessRequestService.evaluateCompatibility(db, created.accessRequestId);
      return { db, accessRequestId: created.accessRequestId };
    }

    it('refuses a decision before compatibility has been evaluated', async () => {
      const db = createFakeDb({ studies: [{ studyId: 'study-1', studyStatus: 'active' }] });
      const created = await accessRequestService.createRequest(db, baseRequestPayload());

      await expect(
        accessRequestService.recordDecision(db, created.accessRequestId, { status: 'approved', justification: 'ok' })
      ).rejects.toThrow(/avaliada antes/);
    });

    it('rejects an invalid decision status', async () => {
      const { db, accessRequestId } = await seedEvaluated();

      await expect(
        accessRequestService.recordDecision(db, accessRequestId, { status: 'pending', justification: 'ok' })
      ).rejects.toThrow(/status/);
    });

    it('requires a justification', async () => {
      const { db, accessRequestId } = await seedEvaluated();

      await expect(
        accessRequestService.recordDecision(db, accessRequestId, { status: 'approved', justification: '  ' })
      ).rejects.toThrow(/justification/);
    });

    it('records an approval with its approvalPeriod and decidedBy', async () => {
      const { db, accessRequestId } = await seedEvaluated();

      const decided = await accessRequestService.recordDecision(
        db,
        accessRequestId,
        { status: 'approved', justification: 'Compatível com DUO e consentimento ativo', approvalPeriod: { start: '2026-01-01', end: '2026-12-31' } },
        'coordinator-1'
      );

      expect(decided.committeeDecision.status).toBe('approved');
      expect(decided.committeeDecision.decidedBy).toBe('coordinator-1');
      expect(decided.approvalPeriod.end.toISOString()).toContain('2026-12-31');
    });

    it('leaves approvalPeriod null for a rejection', async () => {
      const { db, accessRequestId } = await seedEvaluated();

      const decided = await accessRequestService.recordDecision(db, accessRequestId, {
        status: 'rejected',
        justification: 'Finalidade incompatível com o consentimento registrado',
      });

      expect(decided.committeeDecision.status).toBe('rejected');
      expect(decided.approvalPeriod).toBeNull();
    });
  });

  describe('markDistributed (AC#4) and revokeAccess (AC#5)', () => {
    async function seedApproved(approvalPeriod) {
      const db = createFakeDb({
        samples: [{ specimenId: 'SPEC-1', participantId: 'participant-1' }],
        consents: [{ participantId: 'participant-1', status: 'ACTIVE' }],
        studies: [{ studyId: 'study-1', studyStatus: 'active' }],
      });
      const created = await accessRequestService.createRequest(db, baseRequestPayload());
      await accessRequestService.evaluateCompatibility(db, created.accessRequestId);
      await accessRequestService.recordDecision(db, created.accessRequestId, {
        status: 'approved',
        justification: 'ok',
        approvalPeriod,
      });
      return { db, accessRequestId: created.accessRequestId };
    }

    it('links distribution only while access is currently allowed', async () => {
      const { db, accessRequestId } = await seedApproved();

      const distributed = await accessRequestService.markDistributed(db, accessRequestId);

      expect(distributed.distributionStatus).toBe('released');
      expect(distributed.distributedAt).toBeTruthy();
    });

    it('refuses to link distribution once the approval period has expired', async () => {
      const { db, accessRequestId } = await seedApproved({ start: '2020-01-01', end: '2020-01-31' });

      await expect(accessRequestService.markDistributed(db, accessRequestId)).rejects.toThrow(/expired/);
    });

    it('refuses to revoke a request that was never approved/conditioned', async () => {
      const db = createFakeDb({ studies: [{ studyId: 'study-1', studyStatus: 'active' }] });
      const created = await accessRequestService.createRequest(db, baseRequestPayload());

      await expect(accessRequestService.revokeAccess(db, created.accessRequestId, 'motivo')).rejects.toThrow(/aprovada ou condicionada/);
    });

    it('revokes a previously approved request and blocks further distribution', async () => {
      const { db, accessRequestId } = await seedApproved();

      const revoked = await accessRequestService.revokeAccess(db, accessRequestId, 'Consentimento retirado pelo participante', 'coordinator-1');
      expect(revoked.committeeDecision.status).toBe('revoked');

      await expect(accessRequestService.markDistributed(db, accessRequestId)).rejects.toThrow(/revoked/);
    });
  });

  describe('getAccessCheck (AC#5 read path)', () => {
    it('returns null for an unknown accessRequestId', async () => {
      const db = createFakeDb();
      expect(await accessRequestService.getAccessCheck(db, 'does-not-exist')).toBeNull();
    });
  });

  describe('evaluateAccessState (pure function, all branches)', () => {
    const now = new Date('2026-06-15T00:00:00Z');

    it.each([
      [{ committeeDecision: { status: 'pending' } }, { allowed: false, reason: 'pending' }],
      [{ committeeDecision: { status: 'rejected' } }, { allowed: false, reason: 'denied' }],
      [{ committeeDecision: { status: 'revoked' } }, { allowed: false, reason: 'revoked' }],
      [
        { committeeDecision: { status: 'approved' }, approvalPeriod: { start: '2026-01-01', end: '2026-01-31' } },
        { allowed: false, reason: 'expired' },
      ],
      [
        { committeeDecision: { status: 'approved' }, approvalPeriod: { start: '2026-12-01', end: null } },
        { allowed: false, reason: 'not_yet_active' },
      ],
      [
        { committeeDecision: { status: 'approved' }, approvalPeriod: { start: '2026-01-01', end: null } },
        { allowed: true, reason: 'approved' },
      ],
      [
        { committeeDecision: { status: 'conditioned' }, approvalPeriod: { start: '2026-01-01', end: '2026-12-31' } },
        { allowed: true, reason: 'conditioned' },
      ],
    ])('%j -> %j', (accessRequest, expected) => {
      expect(evaluateAccessState(accessRequest, now)).toEqual(expected);
    });
  });
});
