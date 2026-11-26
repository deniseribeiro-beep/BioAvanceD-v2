import { describe, it, expect, vi, afterEach } from 'vitest';
const env = require('../../../src/config/env');
const { generateSpecimenId, validateSpecimenReferences, appendSpecimenProjection } = require('../../../src/ingestion/specimenTarget');
const { createFakeDb } = require('./testHelpers');

// RF029 (#1318): Specimen, the sixth ingestion target, reuses the sample
// mount's gates (sample.service.js, RegisterSample.js), with the consent
// gate always applied and failing closed (RF029 AC2).

afterEach(() => { vi.restoreAllMocks(); });

const PARTICIPANT = '12345678';

// RF004 AC2 (#1538): a biobank collection with an approval in force, so the
// mount's collection gate admits the specimen.
const GOVERNED_COLLECTION = { collectionId: 'COL-GOV-1', governanceRegime: 'biobank', governanceContext: { biobankGovernanceContextId: 'BGC-1' } };
const GOVERNED_APPROVAL = { collectionId: 'COL-GOV-1', approvalId: 'APPR-GOV-1', status: 'active', effectivePeriod: { start: '2020-01-01', end: null }, createdAt: new Date('2020-01-01') };

function specimenDb({
  patients = [{ participantId: PARTICIPANT }],
  consents = [{ participantId: PARTICIPANT, status: 'ACTIVE' }],
  organizations = [{ organizationId: 'org-site-1' }],
  samples = [],
  labelIdentifiers = [],
  collections = [GOVERNED_COLLECTION],
  collectionGovernanceApprovals = [GOVERNED_APPROVAL],
  terminologyConcepts = [],
  referenceDatasetReleases = [],
} = {}) {
  return createFakeDb({ patients, patientConsents: consents, organizations, samples, labelIdentifiers, collections, collectionGovernanceApprovals, terminologyConcepts, referenceDatasetReleases });
}

const SPECIMEN = { specimenId: 'client-1', participantId: PARTICIPANT, collectionSite: 'org-site-1', collectionId: 'COL-GOV-1' };

async function refusal(db, payload) {
  return validateSpecimenReferences(db, payload).then(() => null, (error) => error);
}

describe('ingestion/specimenTarget generateSpecimenId (RF029, #1318)', () => {
  it('1. answers the mount\'s 7-digit specimenId as a string, one samples does not hold', async () => {
    const id = await generateSpecimenId(specimenDb());

    expect(id).toMatch(/^\d{7}$/);
  });
});

describe('ingestion/specimenTarget validateSpecimenReferences (RF029, #1318)', () => {
  it('2. a known participant with an active consent, a known site and no parents or barcode resolves', async () => {
    await expect(validateSpecimenReferences(specimenDb(), { ...SPECIMEN })).resolves.toBeUndefined();
  });

  it.each(['VALID', 'GRANTED'])('3. a %s consent is active evidence', async (status) => {
    const db = specimenDb({ consents: [{ participantId: PARTICIPANT, status }] });

    await expect(validateSpecimenReferences(db, { ...SPECIMEN })).resolves.toBeUndefined();
  });

  it('4. an unknown participant is 404', async () => {
    const error = await refusal(specimenDb({ patients: [] }), { ...SPECIMEN });

    expect(error).toMatchObject({ statusCode: 404, message: `participantId ${PARTICIPANT} não encontrado` });
    expect(error.violationCode).toBeUndefined();
  });

  it('5. a participantId that is not 8 digits is 404, even with a matching patient', async () => {
    const db = specimenDb({ patients: [{ participantId: 'P-1' }], consents: [{ participantId: 'P-1', status: 'ACTIVE' }] });

    expect(await refusal(db, { ...SPECIMEN, participantId: 'P-1' })).toMatchObject({ statusCode: 404 });
  });

  it('5b. a failing participant lookup rejects with its own error, never a 404 or 409 verdict', async () => {
    const db = specimenDb();
    const outage = new Error('connection reset');
    db.collection('patients').findOne = async () => { throw outage; };

    const error = await refusal(db, { ...SPECIMEN });

    expect(error).toBe(outage);
    expect(error.statusCode).toBeUndefined();
  });

  it.each([
    ['no consent', []],
    ['a revoked consent', [{ participantId: PARTICIPANT, status: 'REVOKED' }]],
    ['a consent with no status', [{ participantId: PARTICIPANT }]],
    ['another participant\'s active consent', [{ participantId: '87654321', status: 'ACTIVE' }]],
  ])('6. %s is 409 CONSENT_NOT_ACTIVE (RF029 AC2)', async (_label, consents) => {
    const error = await refusal(specimenDb({ consents }), { ...SPECIMEN });

    expect(error).toMatchObject({ statusCode: 409, violationCode: 'CONSENT_NOT_ACTIVE' });
  });

  it('7. an unknown collectionSite is 404', async () => {
    const error = await refusal(specimenDb({ organizations: [] }), { ...SPECIMEN });

    expect(error).toMatchObject({ statusCode: 404, message: 'collectionSite org-site-1 não encontrado' });
  });

  it('8. an unknown parent is 404', async () => {
    const error = await refusal(specimenDb(), { ...SPECIMEN, parentSpecimenIds: ['1111111'] });

    expect(error).toMatchObject({ statusCode: 404, message: 'parentSpecimenIds 1111111 não encontrado' });
  });

  it('9. a parent of another participant is 409', async () => {
    const db = specimenDb({ samples: [{ _id: 'p-1', specimenId: '1111111', participantId: '87654321', specimenStatus: 'available' }] });

    const error = await refusal(db, { ...SPECIMEN, parentSpecimenIds: ['1111111'] });

    expect(error).toMatchObject({ statusCode: 409, message: 'parentSpecimenIds 1111111 pertence a outro participante' });
  });

  it.each(['closed', 'destroyed', 'disposed'])('10. a %s parent is 409', async (specimenStatus) => {
    const db = specimenDb({ samples: [{ _id: 'p-1', specimenId: '1111111', participantId: PARTICIPANT, specimenStatus }] });

    const error = await refusal(db, { ...SPECIMEN, parentSpecimenIds: ['1111111'] });

    expect(error).toMatchObject({ statusCode: 409, message: expect.stringContaining('está encerrada') });
  });

  it('10b. a quarantined parent is 409', async () => {
    const db = specimenDb({ samples: [{ _id: 'p-1', specimenId: '1111111', participantId: PARTICIPANT, specimenStatus: 'quarantined' }] });

    const error = await refusal(db, { ...SPECIMEN, parentSpecimenIds: ['1111111'] });

    expect(error).toMatchObject({ statusCode: 409, message: expect.stringContaining('em quarentena') });
  });

  it('11. a parent of the same participant that is not terminal resolves', async () => {
    const db = specimenDb({ samples: [{ _id: 'p-1', specimenId: '1111111', participantId: PARTICIPANT, specimenStatus: 'available' }] });

    await expect(validateSpecimenReferences(db, { ...SPECIMEN, parentSpecimenIds: ['1111111'] })).resolves.toBeUndefined();
  });

  it('12. while the barcode window is open, a new barcode resolves', async () => {
    await expect(validateSpecimenReferences(specimenDb(), { ...SPECIMEN, barcode: 'BC-1' })).resolves.toBeUndefined();
  });

  it('13. while the barcode window is open, a barcode samples already holds is 409 DUPLICATE_BARCODE', async () => {
    const db = specimenDb({ samples: [{ _id: 's-1', specimenId: '2222222', participantId: PARTICIPANT, barcode: 'BC-1' }] });

    const error = await refusal(db, { ...SPECIMEN, barcode: 'BC-1' });

    expect(error).toMatchObject({ statusCode: 409, violationCode: 'DUPLICATE_BARCODE' });
  });

  it('14. once the barcode window is closed, any barcode is 409 LEGACY_BARCODE_WRITE_REFUSED (#1378)', async () => {
    const saved = env.SAMPLE_BARCODE_WINDOW_CLOSED;
    env.SAMPLE_BARCODE_WINDOW_CLOSED = true;
    try {
      const error = await refusal(specimenDb(), { ...SPECIMEN, barcode: 'BC-1' });

      expect(error).toMatchObject({ statusCode: 409, violationCode: 'LEGACY_BARCODE_WRITE_REFUSED' });
      await expect(validateSpecimenReferences(specimenDb(), { ...SPECIMEN })).resolves.toBeUndefined();
    } finally {
      env.SAMPLE_BARCODE_WINDOW_CLOSED = saved;
    }
  });

  it('14b. while the barcode window is open, a barcode no sample holds but active as a label in legacy-sample-barcode is 409 DUPLICATE_BARCODE', async () => {
    const db = specimenDb({ labelIdentifiers: [{ namespaceRegistryId: 'legacy-sample-barcode', encodedValue: 'BC-1', status: 'active' }] });

    const error = await refusal(db, { ...SPECIMEN, barcode: 'BC-1' });

    expect(error).toMatchObject({ statusCode: 409, message: 'barcode BC-1 já ativo como etiqueta', violationCode: 'DUPLICATE_BARCODE' });
  });

  it('14c. the same value active as a label in another namespace, or retired in legacy-sample-barcode, resolves', async () => {
    const db = specimenDb({ labelIdentifiers: [
      { namespaceRegistryId: 'manufacturer-tube', encodedValue: 'BC-1', status: 'active' },
      { namespaceRegistryId: 'legacy-sample-barcode', encodedValue: 'BC-1', status: 'retired' },
    ] });

    await expect(validateSpecimenReferences(db, { ...SPECIMEN, barcode: 'BC-1' })).resolves.toBeUndefined();
  });

  it('14e. the all-digit barcode 0001234 is no personal data and resolves', async () => {
    await expect(validateSpecimenReferences(specimenDb(), { ...SPECIMEN, barcode: '0001234' })).resolves.toBeUndefined();
  });

  it('14f. a specimen that names no collection is 409 COLLECTION_REQUIRED (RF004 AC2, ELM-0118, #1538)', async () => {
    const withoutCollection = { ...SPECIMEN };
    delete withoutCollection.collectionId;

    const error = await refusal(specimenDb(), withoutCollection);

    expect(error).toMatchObject({ statusCode: 409, violationCode: 'COLLECTION_REQUIRED' });
  });

  it('14g. an unknown collectionId is 404, with no violationCode (#1538)', async () => {
    const error = await refusal(specimenDb(), { ...SPECIMEN, collectionId: 'COL-UNKNOWN' });

    expect(error).toMatchObject({ statusCode: 404, message: 'collectionId COL-UNKNOWN não encontrado' });
    expect(error.violationCode).toBeUndefined();
  });

  it('14h. a collection with no governance approval in force is 409 COLLECTION_NOT_ADMITTED (RF004 AC2, #1538)', async () => {
    const error = await refusal(specimenDb({ collectionGovernanceApprovals: [] }), { ...SPECIMEN });

    expect(error).toMatchObject({ statusCode: 409, violationCode: 'COLLECTION_NOT_ADMITTED' });
  });

  it('14i. a failing collections lookup rejects with its own error, never a 404 or 409 verdict (#1538)', async () => {
    const db = specimenDb();
    const outage = new Error('connection reset');
    vi.spyOn(db.collection('collections'), 'findOne').mockRejectedValue(outage);

    const error = await refusal(db, { ...SPECIMEN });

    expect(error).toBe(outage);
    expect(error.statusCode).toBeUndefined();
  });
});

describe('ingestion/specimenTarget appendSpecimenProjection (RF029 AC6, #1313)', () => {
  function fakeOutbox() {
    let next = 0;
    return { appendEvent: vi.fn(async (_db, event) => ({ eventId: `evt-${++next}`, ...event })) };
  }

  it('15. appends SPECIMEN_UPSERTED keyed by the inserted _id, with the session, and answers its eventId', async () => {
    const outbox = fakeOutbox();
    const session = { id: 'sess-1' };

    const eventIds = await appendSpecimenProjection(specimenDb(), { doc: { participantId: PARTICIPANT, parentSpecimenIds: [] }, insertedId: 'oid-new', outbox }, { session });

    expect(eventIds).toEqual(['evt-1']);
    expect(outbox.appendEvent).toHaveBeenCalledTimes(1);
    expect(outbox.appendEvent.mock.calls[0][1]).toMatchObject({
      eventType: 'SPECIMEN_UPSERTED',
      aggregateType: 'Sample',
      aggregateId: 'oid-new',
      payload: { specimenId: 'oid-new', participantId: PARTICIPANT },
      sourceService: 'ingestion-gateway',
    });
    expect(outbox.appendEvent.mock.calls[0][2]).toEqual({ session });
  });

  it('16. appends one LINEAGE_REGISTERED per parent, carrying the parent\'s _id, and answers every eventId', async () => {
    const db = specimenDb({ samples: [
      { _id: 'oid-p1', specimenId: '1111111', participantId: PARTICIPANT },
      { _id: 'oid-p2', specimenId: '3333333', participantId: PARTICIPANT },
    ] });
    const outbox = fakeOutbox();

    const eventIds = await appendSpecimenProjection(db, { doc: { participantId: PARTICIPANT, parentSpecimenIds: ['3333333', '1111111'] }, insertedId: 'oid-new', outbox }, {});

    expect(eventIds).toEqual(['evt-1', 'evt-2', 'evt-3']);
    expect(outbox.appendEvent.mock.calls.map(([, event]) => [event.eventType, event.aggregateId, event.payload.parentSpecimenId ?? null]))
      .toEqual([['SPECIMEN_UPSERTED', 'oid-new', null], ['LINEAGE_REGISTERED', 'oid-new', 'oid-p2'], ['LINEAGE_REGISTERED', 'oid-new', 'oid-p1']]);
  });

  it('17. a doc with a barcode has it issued, unprinted, as one LabelIdentifier on a container loaded for the specimen, in the session, and answers the same eventIds (#1378)', async () => {
    const db = specimenDb();
    const writes = ['labelIdentifiers', 'containers', 'specimenContainerAssignments'].map((name) => vi.spyOn(db.collection(name), 'insertOne'));
    const outbox = fakeOutbox();
    const session = { id: 'sess-1' };
    const doc = { specimenId: '7654321', participantId: PARTICIPANT, organizationId: 'org-site-1', barcode: 'BC-1', createdBy: 'Actor/u-1', parentSpecimenIds: [] };

    const eventIds = await appendSpecimenProjection(db, { doc, insertedId: 'oid-new', outbox }, { session });

    expect(eventIds).toEqual(['evt-1']);
    const labels = db.collections.labelIdentifiers.docs;
    const containers = db.collections.containers.docs;
    const loads = db.collections.specimenContainerAssignments.docs;
    expect(containers).toHaveLength(1);
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ specimenId: '7654321', containerId: containers[0].containerId });
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      encodedValue: 'BC-1',
      namespaceRegistryId: 'legacy-sample-barcode',
      targetType: 'container',
      targetId: containers[0].containerId,
      status: 'active',
      printBatchId: null,
      issuedBy: 'u-1',
    });
    for (const write of writes) {
      expect(write).toHaveBeenCalledTimes(1);
      expect(write.mock.calls[0][1]).toEqual({ session });
    }
  });

  it.each([
    ['Actor/undefined', 'org-site-1'],
    [undefined, 'org-site-1'],
  ])('17b. with createdBy %s the label is issued by the stamped organization (V2E-0176)', async (createdBy, issuedBy) => {
    const db = specimenDb();
    const doc = { specimenId: '7654321', participantId: PARTICIPANT, organizationId: 'org-site-1', barcode: 'BC-1', createdBy, parentSpecimenIds: [] };

    await appendSpecimenProjection(db, { doc, insertedId: 'oid-new', outbox: fakeOutbox() }, { session: { id: 'sess-1' } });

    expect(db.collections.labelIdentifiers.docs.map((label) => label.issuedBy)).toEqual([issuedBy]);
  });

  it.each([
    ['no barcode', {}],
    ['a null barcode', { barcode: null }],
    ['an empty barcode', { barcode: '' }],
  ])('18. a doc with %s writes no label, container or load, and generates no code', async (_label, barcode) => {
    const db = specimenDb();
    const doc = { specimenId: '7654321', participantId: PARTICIPANT, organizationId: 'org-site-1', createdBy: 'Actor/u-1', parentSpecimenIds: [], ...barcode };

    const eventIds = await appendSpecimenProjection(db, { doc, insertedId: 'oid-new', outbox: fakeOutbox() }, {});

    expect(eventIds).toEqual(['evt-1']);
    expect(db.collection('labelIdentifiers').docs).toHaveLength(0);
    expect(db.collection('containers').docs).toHaveLength(0);
    expect(db.collection('specimenContainerAssignments').docs).toHaveLength(0);
  });
});

// RNF011 AC1 (#1523): a named unit is a code of the active UCUM release.
const UCUM_MG = { systemUri: 'http://unitsofmeasure.org', code: 'mg', referenceDatasetReleaseId: 'rel-ucum', conceptStatus: 'active' };

describe('ingestion/specimenTarget validateSpecimenReferences unit (RNF011 AC1, #1523)', () => {
  it('19. a unit of the active UCUM release resolves', async () => {
    const db = specimenDb({ terminologyConcepts: [UCUM_MG], referenceDatasetReleases: [{ referenceDatasetReleaseId: 'rel-ucum', releaseStatus: 'active' }] });

    await expect(validateSpecimenReferences(db, { ...SPECIMEN, unit: 'mg' })).resolves.toBeUndefined();
  });

  it('20. an unknown unit is 409 INACTIVE_OR_UNKNOWN_CODE', async () => {
    const error = await refusal(specimenDb(), { ...SPECIMEN, unit: 'banana' });

    expect(error).toMatchObject({ statusCode: 409, violationCode: 'INACTIVE_OR_UNKNOWN_CODE' });
  });

  it('21. a unit of a superseded release is 409 INACTIVE_OR_UNKNOWN_CODE', async () => {
    const db = specimenDb({ terminologyConcepts: [UCUM_MG], referenceDatasetReleases: [{ referenceDatasetReleaseId: 'rel-ucum', releaseStatus: 'superseded' }] });

    const error = await refusal(db, { ...SPECIMEN, unit: 'mg' });

    expect(error).toMatchObject({ statusCode: 409, violationCode: 'INACTIVE_OR_UNKNOWN_CODE' });
  });

  it('22. no unit resolves with no concept seeded', async () => {
    await expect(validateSpecimenReferences(specimenDb(), { ...SPECIMEN })).resolves.toBeUndefined();
  });
});
