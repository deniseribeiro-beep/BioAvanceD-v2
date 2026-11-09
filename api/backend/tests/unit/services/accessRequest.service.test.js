import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const accessRequestService = require('../../../src/services/accessRequest.service');
const { evaluateAccessState, DUO_SYSTEM_URI } = accessRequestService;

/**
 * Real query-matching fake (exact-match findOne/find/sort, insertOne,
 * updateOne $set), not a canned stub — per this repo's native-only "real
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

function createFakeDb({
  samples = [],
  consents = [],
  terminologyConcepts = [],
  studies = [],
  sampleFiles = [],
  organizations = [{ organizationId: 'org-1' }],
  protocols = [{ protocolId: 'protocol-1', protocolVersion: '2.1', approvalStatus: 'approved' }],
  securityConfig = [{ _id: 'main', configurationReleaseId: 'release-1' }],
  accessPolicies = [],
  consentPermissions = [],
  terminologyRelations = [],
} = {}) {
  const collections = {
    accessRequests: createFakeCollection(),
    samples: createFakeCollection(samples),
    patientConsents: createFakeCollection(consents),
    terminologyConcepts: createFakeCollection(terminologyConcepts),
    studies: createFakeCollection(studies),
    sample_files: createFakeCollection(sampleFiles),
    organizations: createFakeCollection(organizations),
    protocols: createFakeCollection(protocols),
    security_config: createFakeCollection(securityConfig),
    accessPolicies: createFakeCollection(accessPolicies),
    consentAuthorizationDecisions: createFakeCollection(),
    consentPermissions: createFakeCollection(consentPermissions),
    terminologyRelations: createFakeCollection(terminologyRelations),
  };
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

function baseRequestPayload(overrides = {}) {
  return {
    requesterId: 'researcher-1',
    organizationId: 'org-1',
    studyId: 'study-1',
    protocolId: 'protocol-1',
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
      expect(created.committeeDecision).toEqual({
        decisionId: null,
        status: 'pending',
        justification: null,
        decidedBy: null,
        decidedAt: null,
        policyVersion: null,
        appliedPolicies: [],
        policyEffect: null,
        policyReasons: [],
        configurationReleaseId: null,
      });
      expect(created.policyDecision).toBeNull();
      expect(created.distributionStatus).toBe('pending');
      expect(created.distributionDecisionId).toBeNull();
      expect(created.overallCompatible).toBeNull();
    });

    it('rejects a request with no requestedItems', async () => {
      const db = createFakeDb();

      await expect(
        accessRequestService.createRequest(db, baseRequestPayload({ requestedItems: [] }))
      ).rejects.toThrow(/requestedItems/);
    });

    // RF024 AC1: requester, organization, study, protocol, purpose and items.
    it('records the organization, the protocol and the protocol version in force', async () => {
      const db = createFakeDb();

      const created = await accessRequestService.createRequest(db, baseRequestPayload({ protocolVersion: 'from-body' }));

      expect(created).toMatchObject({ organizationId: 'org-1', protocolId: 'protocol-1', protocolVersion: '2.1' });
      expect((await accessRequestService.getById(db, created.accessRequestId)).protocolVersion).toBe('2.1');
    });

    it.each([
      ['organizationId', { organizationId: undefined }, /organizationId é obrigatório/],
      ['protocolId', { protocolId: undefined }, /protocolId é obrigatório/],
      ['an unknown organization', { organizationId: 'org-x' }, /organizationId org-x não encontrado/],
      ['an unknown protocol', { protocolId: 'protocol-x' }, /protocolId protocol-x não encontrado/],
    ])('answers 422 for a request missing or naming %s', async (_label, overrides, message) => {
      const db = createFakeDb();

      const error = await accessRequestService.createRequest(db, baseRequestPayload(overrides)).catch((e) => e);

      expect(error.message).toMatch(message);
      expect(error.statusCode).toBe(422);
    });

    it('answers 422 for a protocol that is not approved', async () => {
      const db = createFakeDb({ protocols: [{ protocolId: 'protocol-1', protocolVersion: '1', approvalStatus: 'draft' }] });

      const error = await accessRequestService.createRequest(db, baseRequestPayload()).catch((e) => e);

      expect(error.message).toMatch(/não está aprovado/);
      expect(error.statusCode).toBe(422);
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
          studyId: null,
          protocolId: null,
          collectionId: null,
          consentValid: true,
          consentAuthorizationDecisionId: expect.any(String),
          consentAuthorizationResult: 'permit',
          consentAuthorizationReasons: ['consentimento vigente, sem restrição aplicável ao uso'],
          duoCompatible: true,
          studyActive: true,
          compatible: true,
        },
      ]);
    });

    // RF010 AC7: the consent in force answers for the requested use, and
    // the answer is recorded as its own ConsentAuthorizationDecision.
    it('records a permit ConsentAuthorizationDecision for the consent in force', async () => {
      const { db, created } = await seedAndCreate({}, {
        consents: [{ consentId: 'consent-1', participantId: 'participant-1', status: 'ACTIVE', currentStateDerived: 'active' }],
      });

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      const [decision] = db.collections.consentAuthorizationDecisions.docs;
      expect(decision).toMatchObject({
        consentId: 'consent-1',
        participantId: 'participant-1',
        purpose: 'Estudo de biomarcadores oncológicos',
        studyId: 'study-1',
        protocolId: 'protocol-1',
        accessRequestId: created.accessRequestId,
        itemId: 'SPEC-1',
        policyVersion: 'rf010-consent-authorization/1.1.0',
        configurationReleaseId: 'release-1',
        result: 'permit',
        appliedRules: ['consent_in_force', 'consent_study_scope', 'consent_partial_revocation'],
      });
      expect(decision.decisionAt).toBeInstanceOf(Date);
      expect(evaluated.consentCompatibility[0].consentAuthorizationDecisionId).toBe(decision.consentAuthorizationDecisionId);
    });

    it('denies, and makes the item incompatible, when the consent was given for another study', async () => {
      const { db, created } = await seedAndCreate({}, {
        consents: [{ consentId: 'consent-1', participantId: 'participant-1', status: 'ACTIVE', studyId: 'study-9' }],
      });

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.overallCompatible).toBe(false);
      expect(evaluated.consentCompatibility[0]).toMatchObject({
        consentValid: false,
        consentAuthorizationResult: 'deny',
        consentAuthorizationReasons: [expect.stringContaining('study-9')],
      });
    });

    it('asks for review, and leaves the item to the committee, when permissions were revoked by scope', async () => {
      const { db, created } = await seedAndCreate({}, {
        consents: [{ consentId: 'consent-1', participantId: 'participant-1', status: 'ACTIVE', currentStateDerived: 'partially_revoked', withdrawalScope: ['contact'] }],
      });

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.consentCompatibility[0]).toMatchObject({
        consentValid: true,
        compatible: true,
        consentAuthorizationResult: 'review_required',
        consentAuthorizationReasons: [expect.stringContaining('contact')],
      });
    });

    // #1347: with governed purposes (GA4GH DUO) on the consent's permissions
    // and on the request, a partial revocation is judged on the purpose. The
    // seeded hierarchy is DUO's own: DS is_a HMB is_a GRU.
    describe('a partially revoked consent with DUO-coded permissions (#1347)', () => {
      const duoConcepts = [
        { systemUri: DUO_SYSTEM_URI, code: 'DUO:0000042', terminologyConceptId: 'c-gru', conceptStatus: 'active' },
        { systemUri: DUO_SYSTEM_URI, code: 'DUO:0000006', terminologyConceptId: 'c-hmb', conceptStatus: 'active' },
        { systemUri: DUO_SYSTEM_URI, code: 'DUO:0000007', terminologyConceptId: 'c-ds', conceptStatus: 'active' },
        { systemUri: DUO_SYSTEM_URI, code: 'DUO:0000004', terminologyConceptId: 'c-nres', conceptStatus: 'active' },
      ];
      const duoRelations = [
        { sourceConceptId: 'c-ds', targetConceptId: 'c-hmb', relationType: 'is_a', relationStatus: 'active' },
        { sourceConceptId: 'c-hmb', targetConceptId: 'c-gru', relationType: 'is_a', relationStatus: 'active' },
      ];
      const row = (permissionCode, code) => ({
        consentId: 'consent-1',
        permissionCode,
        purpose: { system: DUO_SYSTEM_URI, code, display: permissionCode },
        decision: 'permit',
      });
      const evaluate = async ({ duoCode, rows, effectivePermissions, withdrawalScope }) => {
        const { db, created } = await seedAndCreate({ duoCode }, {
          terminologyConcepts: duoConcepts,
          terminologyRelations: duoRelations,
          consentPermissions: rows,
          consents: [{
            consentId: 'consent-1', participantId: 'participant-1', status: 'ACTIVE',
            currentStateDerived: 'partially_revoked', withdrawalScope, effectivePermissions,
          }],
        });
        return (await accessRequestService.evaluateCompatibility(db, created.accessRequestId)).consentCompatibility[0];
      };

      it('permits a purpose a permission still in effect covers, through its DUO ancestor', async () => {
        const item = await evaluate({
          duoCode: 'DUO:0000007',
          rows: [row('hmb', 'DUO:0000006'), row('ds', 'DUO:0000007')],
          effectivePermissions: { hmb: true, ds: false },
          withdrawalScope: ['ds'],
        });

        expect(item).toMatchObject({ consentAuthorizationResult: 'permit', consentValid: true, compatible: true });
      });

      it('denies, and makes the item incompatible, when only revoked permissions cover the purpose', async () => {
        const item = await evaluate({
          duoCode: 'DUO:0000006',
          rows: [row('hmb', 'DUO:0000006'), row('ds', 'DUO:0000007')],
          effectivePermissions: { hmb: false, ds: true },
          withdrawalScope: ['hmb'],
        });

        expect(item).toMatchObject({
          consentAuthorizationResult: 'deny',
          consentValid: false,
          compatible: false,
          consentAuthorizationReasons: [expect.stringContaining('DUO:0000006')],
        });
      });

      it('asks for review when no granted permission covers the purpose', async () => {
        const item = await evaluate({
          duoCode: 'DUO:0000006',
          rows: [row('ds', 'DUO:0000007'), row('nres', 'DUO:0000004')],
          effectivePermissions: { ds: true, nres: false },
          withdrawalScope: ['nres'],
        });

        expect(item).toMatchObject({
          consentAuthorizationResult: 'review_required',
          consentAuthorizationReasons: [expect.stringContaining('nenhuma permissão concedida cobre')],
        });
      });

      it('asks for review when a granted permission names no governed purpose', async () => {
        const item = await evaluate({
          duoCode: 'DUO:0000006',
          rows: [row('hmb', 'DUO:0000006'), { consentId: 'consent-1', permissionCode: 'contact', purpose: { code: 'contact', display: 'Contato' }, decision: 'permit' }],
          effectivePermissions: { hmb: false, contact: true },
          withdrawalScope: ['hmb'],
        });

        expect(item).toMatchObject({
          consentAuthorizationResult: 'review_required',
          consentAuthorizationReasons: [expect.stringContaining('não é computável')],
        });
      });
    });

    it('records no decision when the participant has no consent in force', async () => {
      const { db, created } = await seedAndCreate({}, { consents: [] });

      await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(db.collections.consentAuthorizationDecisions.docs).toHaveLength(0);
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

    // RNF008 AC3 (#1496): the AccessPolicy collectionId condition reads it.
    it('records the study, protocol and collection of each specimen and file item on its compatibility entry', async () => {
      const fileId = new ObjectId();
      const db = createFakeDb({
        sampleFiles: [{ _id: fileId, specimenId: 'SPEC-2' }],
        samples: [
          { specimenId: 'SPEC-1', participantId: 'participant-1', studyId: 'study-1', protocolId: 'protocol-1', collectionId: 'COL-1' },
          { specimenId: 'SPEC-2', participantId: 'participant-1', studyId: 'study-2', protocolId: 'protocol-2', collectionId: 'COL-2' },
        ],
        consents: [{ participantId: 'participant-1', status: 'ACTIVE' }],
        studies: [{ studyId: 'study-1', studyStatus: 'active' }],
      });
      const created = await accessRequestService.createRequest(
        db,
        baseRequestPayload({
          requestedItems: [
            { itemType: 'specimen', itemId: 'SPEC-1' },
            { itemType: 'file', itemId: fileId.toString() },
          ],
        })
      );

      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      expect(evaluated.consentCompatibility.map((entry) => [entry.itemType, entry.studyId, entry.protocolId, entry.collectionId])).toEqual([
        ['specimen', 'study-1', 'protocol-1', 'COL-1'],
        ['file', 'study-2', 'protocol-2', 'COL-2'],
      ]);
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

    // RF024 AC4: policyVersion, configurationReleaseId and the instant.
    it('records the decision id, the policy version, the configuration release and the instant', async () => {
      const { db, accessRequestId } = await seedEvaluated();

      const decided = await accessRequestService.recordDecision(db, accessRequestId, { status: 'rejected', justification: 'não' });

      expect(decided.committeeDecision).toMatchObject({
        policyVersion: accessRequestService.ACCESS_COMPATIBILITY_POLICY_VERSION,
        configurationReleaseId: 'release-1',
      });
      expect(decided.committeeDecision.decisionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(decided.committeeDecision.decidedAt).toBeInstanceOf(Date);
    });

    it('records a null configurationReleaseId before any configuration release exists', async () => {
      const db = createFakeDb({
        samples: [{ specimenId: 'SPEC-1', participantId: 'participant-1' }],
        consents: [{ participantId: 'participant-1', status: 'ACTIVE' }],
        studies: [{ studyId: 'study-1', studyStatus: 'active' }],
        securityConfig: [],
      });
      const created = await accessRequestService.createRequest(db, baseRequestPayload());
      await accessRequestService.evaluateCompatibility(db, created.accessRequestId);

      const decided = await accessRequestService.recordDecision(db, created.accessRequestId, { status: 'approved', justification: 'ok' });

      expect(decided.committeeDecision.configurationReleaseId).toBeNull();
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

    // RF024 AC6: an evaluated but incompatible request cannot be approved.
    async function seedIncompatible() {
      const db = createFakeDb({
        samples: [{ specimenId: 'SPEC-1', participantId: 'participant-1' }],
        consents: [],
        studies: [{ studyId: 'study-1', studyStatus: 'active' }],
      });
      const created = await accessRequestService.createRequest(db, baseRequestPayload());
      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);
      expect(evaluated.overallCompatible).toBe(false);
      return { db, accessRequestId: created.accessRequestId };
    }

    it.each(['approved', 'conditioned'])('refuses a %s decision on an incompatible request', async (status) => {
      const { db, accessRequestId } = await seedIncompatible();

      await expect(
        accessRequestService.recordDecision(db, accessRequestId, { status, justification: 'ok' })
      ).rejects.toThrow(/incompatível/);
      expect((await accessRequestService.getById(db, accessRequestId)).committeeDecision.status).toBe('pending');
    });

    it('still records a rejection of an incompatible request', async () => {
      const { db, accessRequestId } = await seedIncompatible();

      const decided = await accessRequestService.recordDecision(db, accessRequestId, {
        status: 'rejected',
        justification: 'Sem consentimento ativo',
      });

      expect(decided.committeeDecision.status).toBe('rejected');
    });
  });

  // RF024 AC3, RNF008 AC4/AC5: the AccessPolicy effect of each evaluation.
  describe('AccessPolicy effect (RF024 AC3)', () => {
    function policy(overrides = {}) {
      return {
        accessPolicyId: 'policy-1',
        policyName: 'Oncologia',
        policyVersion: '1.0.0',
        applicableEntityTypes: ['AccessRequest'],
        purposeCodes: [],
        decisionEffect: 'permit',
        ruleExpression: 'all-conditions',
        effectivePeriod: { start: new Date('2020-01-01'), end: null },
        roleCodes: ['researcher'],
        organizationScopeIds: ['org-1'],
        resourceScopes: ['Specimen'],
        conditions: [{ consent: 'compatible' }],
        decisionReasonsRequired: true,
        ...overrides,
      };
    }

    async function seedEvaluatedWith(accessPolicies) {
      const db = createFakeDb({
        samples: [{ specimenId: 'SPEC-1', participantId: 'participant-1' }],
        consents: [{ participantId: 'participant-1', status: 'ACTIVE' }],
        studies: [{ studyId: 'study-1', studyStatus: 'active' }],
        accessPolicies,
      });
      const created = await accessRequestService.createRequest(db, baseRequestPayload());
      const evaluated = await accessRequestService.evaluateCompatibility(db, created.accessRequestId);
      return { db, accessRequestId: created.accessRequestId, evaluated };
    }

    it('is review_required, with its reason, when no policy applies, and the committee may approve', async () => {
      const { db, accessRequestId, evaluated } = await seedEvaluatedWith([]);

      expect(evaluated.policyDecision).toMatchObject({ effect: 'review_required', appliedPolicies: [] });
      expect(evaluated.policyDecision.reasons.join(' ')).toMatch(/nenhuma AccessPolicy aplicável/);

      const decided = await accessRequestService.recordDecision(db, accessRequestId, { status: 'approved', justification: 'revisado' });
      expect(decided.committeeDecision).toMatchObject({ status: 'approved', policyEffect: 'review_required', appliedPolicies: [] });
    });

    it('permits under a policy whose conditions hold, and the decision records the policy and version', async () => {
      const { db, accessRequestId, evaluated } = await seedEvaluatedWith([policy()]);

      expect(evaluated.policyDecision.effect).toBe('permit');

      const decided = await accessRequestService.recordDecision(db, accessRequestId, { status: 'approved', justification: 'ok' });
      expect(decided.committeeDecision.appliedPolicies).toEqual([
        { accessPolicyId: 'policy-1', policyVersion: '1.0.0', decisionEffect: 'permit' },
      ]);
      expect(decided.committeeDecision.policyEffect).toBe('permit');
      expect(decided.committeeDecision.policyReasons).toEqual(['Oncologia 1.0.0: permit']);
    });

    it.each(['approved', 'conditioned'])('refuses a %s decision when a policy denies, and still records a rejection', async (status) => {
      const { db, accessRequestId, evaluated } = await seedEvaluatedWith([
        policy(),
        policy({ accessPolicyId: 'policy-2', policyName: 'Embargo', decisionEffect: 'deny', conditions: [{ organizationId: 'org-1' }] }),
      ]);

      expect(evaluated.overallCompatible).toBe(true);
      expect(evaluated.policyDecision.effect).toBe('deny');
      await expect(
        accessRequestService.recordDecision(db, accessRequestId, { status, justification: 'ok' })
      ).rejects.toThrow(/negada pela política de acesso.*Embargo 1\.0\.0: deny/);

      const rejected = await accessRequestService.recordDecision(db, accessRequestId, { status: 'rejected', justification: 'embargo' });
      expect(rejected.committeeDecision).toMatchObject({ status: 'rejected', policyEffect: 'deny' });
    });

    it('refuses an approval of a request evaluated before it carried a policy decision', async () => {
      const { db, accessRequestId } = await seedEvaluatedWith([]);
      delete db.collection('accessRequests').docs[0].policyDecision;

      await expect(
        accessRequestService.recordDecision(db, accessRequestId, { status: 'approved', justification: 'ok' })
      ).rejects.toThrow(/reavaliada contra as políticas/);
    });

    it('blocks an approved request once a re-evaluation meets a deny policy', async () => {
      const { db, accessRequestId } = await seedEvaluatedWith([policy()]);
      await accessRequestService.recordDecision(db, accessRequestId, { status: 'approved', justification: 'ok' });
      db.collection('accessPolicies').docs.push(policy({ policyVersion: '2.0.0', decisionEffect: 'deny' }));

      const reevaluated = await accessRequestService.evaluateCompatibility(db, accessRequestId);
      expect(reevaluated.policyDecision.appliedPolicies).toEqual([
        expect.objectContaining({ accessPolicyId: 'policy-1', policyVersion: '2.0.0', decisionEffect: 'deny' }),
      ]);

      expect(await accessRequestService.getAccessCheck(db, accessRequestId)).toMatchObject({ allowed: false, reason: 'policy_denied' });
      await expect(accessRequestService.markDistributed(db, accessRequestId)).rejects.toThrow(/policy_denied/);
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
      // RF024 AC7: correlated to the approval that allowed it.
      expect(distributed.distributionDecisionId).toBe(distributed.committeeDecision.decisionId);
      expect(distributed.distributionDecisionId).toBeTruthy();
    });

    it('refuses to link distribution once the approval period has expired', async () => {
      const { db, accessRequestId } = await seedApproved({ start: '2020-01-01', end: '2020-01-31' });

      await expect(accessRequestService.markDistributed(db, accessRequestId)).rejects.toThrow(/expired/);
    });

    it('refuses to link distribution while a requested specimen is quarantined, and links it once released (RF019 AC3, #1315)', async () => {
      const { db, accessRequestId } = await seedApproved();
      const sample = db.collection('samples').docs.find((doc) => doc.specimenId === 'SPEC-1');
      sample.specimenStatus = 'quarantined';

      await expect(accessRequestService.markDistributed(db, accessRequestId)).rejects.toThrow(/quarentena \(SPEC-1\)/);

      sample.specimenStatus = 'available';
      expect((await accessRequestService.markDistributed(db, accessRequestId)).distributionStatus).toBe('released');
    });

    it('refuses to revoke a request that was never approved/conditioned', async () => {
      const db = createFakeDb({ studies: [{ studyId: 'study-1', studyStatus: 'active' }] });
      const created = await accessRequestService.createRequest(db, baseRequestPayload());

      await expect(accessRequestService.revokeAccess(db, created.accessRequestId, 'motivo')).rejects.toThrow(/aprovada ou condicionada/);
    });

    it('revokes a previously approved request and blocks further distribution', async () => {
      const { db, accessRequestId } = await seedApproved();
      const approvalDecisionId = (await accessRequestService.getById(db, accessRequestId)).committeeDecision.decisionId;

      const revoked = await accessRequestService.revokeAccess(db, accessRequestId, 'Consentimento retirado pelo participante', 'coordinator-1');
      expect(revoked.committeeDecision.status).toBe('revoked');
      // A revocation is its own decision (RF024 AC4).
      expect(revoked.committeeDecision.decisionId).toBeTruthy();
      expect(revoked.committeeDecision.decisionId).not.toBe(approvalDecisionId);
      expect(revoked.committeeDecision.configurationReleaseId).toBe('release-1');

      await expect(accessRequestService.markDistributed(db, accessRequestId)).rejects.toThrow(/revoked/);
    });

    it('blocks distribution once a re-evaluation of an approved request comes back incompatible (RF024 AC6)', async () => {
      const { db, accessRequestId } = await seedApproved();
      db.collection('patientConsents').docs.length = 0; // the participant withdraws

      const reevaluated = await accessRequestService.evaluateCompatibility(db, accessRequestId);
      expect(reevaluated.overallCompatible).toBe(false);

      await expect(accessRequestService.markDistributed(db, accessRequestId)).rejects.toThrow(/incompatible/);
      expect(await accessRequestService.getAccessCheck(db, accessRequestId)).toMatchObject({ allowed: false, reason: 'incompatible' });
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
        { committeeDecision: { status: 'approved' }, overallCompatible: true, approvalPeriod: { start: '2026-01-01', end: '2026-01-31' } },
        { allowed: false, reason: 'expired' },
      ],
      [
        { committeeDecision: { status: 'approved' }, overallCompatible: true, approvalPeriod: { start: '2026-12-01', end: null } },
        { allowed: false, reason: 'not_yet_active' },
      ],
      [
        { committeeDecision: { status: 'approved' }, overallCompatible: true, approvalPeriod: { start: '2026-01-01', end: null } },
        { allowed: true, reason: 'approved' },
      ],
      [
        { committeeDecision: { status: 'conditioned' }, overallCompatible: true, approvalPeriod: { start: '2026-01-01', end: '2026-12-31' } },
        { allowed: true, reason: 'conditioned' },
      ],
      // RF024 AC6: incompatible, or never shown compatible, blocks an approval.
      [
        { committeeDecision: { status: 'approved' }, overallCompatible: false, approvalPeriod: { start: '2026-01-01', end: null } },
        { allowed: false, reason: 'incompatible' },
      ],
      // RF024 AC3: a deny effect blocks an approval; review_required does not.
      [
        { committeeDecision: { status: 'approved' }, overallCompatible: true, policyDecision: { effect: 'deny' }, approvalPeriod: { start: '2026-01-01', end: null } },
        { allowed: false, reason: 'policy_denied' },
      ],
      [
        { committeeDecision: { status: 'approved' }, overallCompatible: true, policyDecision: { effect: 'review_required' }, approvalPeriod: { start: '2026-01-01', end: null } },
        { allowed: true, reason: 'approved' },
      ],
      [
        { committeeDecision: { status: 'conditioned' }, overallCompatible: null, approvalPeriod: { start: '2026-01-01', end: null } },
        { allowed: false, reason: 'incompatible' },
      ],
    ])('%j -> %j', (accessRequest, expected) => {
      expect(evaluateAccessState(accessRequest, now)).toEqual(expected);
    });
  });
});
