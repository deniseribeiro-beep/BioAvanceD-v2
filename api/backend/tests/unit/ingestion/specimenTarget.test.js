import { describe, it, expect, vi, afterEach } from 'vitest';
const env = require('../../../src/config/env');
const { generateSpecimenId, validateSpecimenReferences, appendSpecimenProjection } = require('../../../src/ingestion/specimenTarget');
const { createFakeDb } = require('./testHelpers');

// RF029 (#1318): Specimen, the sixth ingestion target, reuses the sample
// mount's gates (sample.service.js, RegisterSample.js), with the consent
// gate always applied and failing closed (RF029 AC2).

afterEach(() => { vi.restoreAllMocks(); });

const PARTICIPANT = '12345678';

function specimenDb({
  patients = [{ participantId: PARTICIPANT }],
  consents = [{ participantId: PARTICIPANT, status: 'ACTIVE' }],
  organizations = [{ organizationId: 'org-site-1' }],
  samples = [],
} = {}) {
  return createFakeDb({ patients, patientConsents: consents, organizations, samples });
}

const SPECIMEN = { specimenId: 'client-1', participantId: PARTICIPANT, collectionSite: 'org-site-1' };

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
});
