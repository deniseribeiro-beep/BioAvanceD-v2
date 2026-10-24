import { describe, it, expect, vi, afterEach } from 'vitest';
const { ObjectId } = require('mongodb');
const {
  validateConsentReferences,
  prepareConsentDocument,
  appendConsentProjection,
  removeConsentProjection,
} = require('../../../src/ingestion/consentTarget');
const consentEvidence = require('../../../src/services/consentEvidence.service');
const { createFakeDb } = require('./testHelpers');
const { createMatchingCollection } = require('../../factories/filter.factory');

// RF029 (#1318): Consent, the eighth ingestion target, reuses the consent
// mount's participant, template, validity and responses gates
// (consent.service.js createPatientConsent), and accepts only a granted,
// dated decision for a participant with no consent in force.

afterEach(() => { vi.restoreAllMocks(); });

const DAY = 24 * 60 * 60 * 1000;
const PARTICIPANT = '12345678';
const TEMPLATE_HEX = '64b7f0c2a1b2c3d4e5f60718';
const VALID_FROM = new Date(Date.now() - 30 * DAY).toISOString();
const ACCEPTED_AT = new Date(Date.now() - DAY).toISOString();

function template(overrides = {}) {
  return {
    _id: new ObjectId(TEMPLATE_HEX),
    title: 'TCLE',
    active: true,
    version: 3,
    consentModel: 'broad',
    validFrom: VALID_FROM,
    validTo: new Date(Date.now() + 365 * DAY).toISOString(),
    permissions: [
      { key: 'storage', required: true, label: 'Armazenamento' },
      { key: 'recontact', required: false, label: 'Recontato', purposeCode: 'DUO:0000042' },
    ],
    ...overrides,
  };
}

const CONSENT = {
  participantId: PARTICIPANT,
  consentTemplateId: ` ${TEMPLATE_HEX} `,
  responses: { storage: true, recontact: false },
  consentGranted: true,
  consentAcceptedAt: ACCEPTED_AT,
};

// consent_templates and patientConsents are matching collections: an
// ObjectId _id and a $in status filter.
function consentDb({ templates = [template()], consents = [], patients = [{ participantId: PARTICIPANT }] } = {}) {
  const db = createFakeDb({ patients });
  db.collections.consent_templates = createMatchingCollection(templates);
  db.collections.patientConsents = createMatchingCollection(consents);
  db.collections.consentPermissions = createMatchingCollection([]);
  db.collections.consentDecisionEvents = createMatchingCollection([]);
  db.collections.consentRevocations = createMatchingCollection([]);
  return db;
}

async function refusal(db, payload) {
  return validateConsentReferences(db, payload).then(() => null, (error) => error);
}

const EVIDENCE = {
  evidenceDocumentUri: 'objstore://consents/stub/evidence.json',
  evidenceHash: `sha256:${'0'.repeat(64)}`,
  evidenceMimeType: 'application/json',
  evidenceEncryption: null,
};

describe('ingestion/consentTarget validateConsentReferences (RF029, #1318)', () => {
  it('1. a known participant, an active template in force, valid responses, a granted past decision and no consent in force resolve, and the mount\'s create input is written back', async () => {
    const payload = { ...CONSENT };

    await expect(validateConsentReferences(consentDb(), payload)).resolves.toBeUndefined();

    expect(payload).toEqual({
      ...CONSENT,
      consentTemplateId: TEMPLATE_HEX,
      signedAt: ACCEPTED_AT,
      consentVersion: '3',
      consentModel: 'broad',
    });
  });

  it('2. a template with no version or consentModel writes back null for each', async () => {
    const payload = { ...CONSENT };

    await validateConsentReferences(consentDb({ templates: [template({ version: undefined, consentModel: undefined })] }), payload);

    expect(payload).toMatchObject({ consentVersion: null, consentModel: null });
  });

  it.each([
    ['an unknown participantId', { participantId: '87654321' }],
    ['a participantId that is not 8 digits', { participantId: 'P-1' }],
  ])('3. %s is 404 with no violationCode', async (_label, change) => {
    const error = await refusal(consentDb(), { ...CONSENT, ...change });

    expect(error).toMatchObject({ statusCode: 404, message: `participantId ${change.participantId} não encontrado` });
    expect(error.violationCode).toBeUndefined();
  });

  it.each([
    ['an unknown consentTemplateId', {}, { templates: [] }],
    ['a consentTemplateId that is not an ObjectId', { consentTemplateId: 'tcle-1' }, {}],
  ])('4. %s is 404', async (_label, change, dbOptions) => {
    const error = await refusal(consentDb(dbOptions), { ...CONSENT, ...change });

    expect(error).toMatchObject({ statusCode: 404 });
    expect(error.message).toMatch(/^consentTemplateId .* não encontrado$/);
  });

  it('5. an inactive template is 409, the mount\'s refusal', async () => {
    const error = await refusal(consentDb({ templates: [template({ active: false })] }), { ...CONSENT });

    expect(error).toMatchObject({ statusCode: 409, message: 'Template de consentimento não está ativo' });
    expect(error.violationCode).toBeUndefined();
  });

  it.each([
    ['not yet in force', { validFrom: new Date(Date.now() + DAY).toISOString() }, 'Template de consentimento ainda não está vigente'],
    ['expired', { validTo: new Date(Date.now() - 2 * DAY).toISOString(), validFrom: new Date(Date.now() - 60 * DAY).toISOString() }, 'Template de consentimento expirado'],
  ])('6. a template %s is 409', async (_label, change, message) => {
    const error = await refusal(consentDb({ templates: [template(change)] }), { ...CONSENT, consentAcceptedAt: new Date(Date.now() - 10 * DAY).toISOString() });

    expect(error).toMatchObject({ statusCode: 409, message });
  });

  it('7. an unparseable validity bound is ignored, as the mount ignores it', async () => {
    const payload = { ...CONSENT };

    await expect(validateConsentReferences(consentDb({ templates: [template({ validFrom: 'not-a-date', validTo: 'never' })] }), payload)).resolves.toBeUndefined();
  });

  it.each([
    ['a permission answered with a non-boolean', { storage: true, recontact: 'no' }, 'Respostas inválidas: recontact devem ser booleano'],
    ['a permission left unanswered', { storage: true }, 'Respostas inválidas: recontact devem ser booleano'],
    ['a required permission refused', { storage: false, recontact: true }, 'Permissões obrigatórias não aceitas: storage'],
    ['a key the template does not hold', { storage: true, recontact: false, marketing: true }, 'Respostas contêm chaves inválidas: marketing'],
  ])('8. %s is 409 CONSENT_RESPONSES_INVALID with the mount\'s message', async (_label, responses, message) => {
    const error = await refusal(consentDb(), { ...CONSENT, responses });

    expect(error).toMatchObject({ statusCode: 409, violationCode: 'CONSENT_RESPONSES_INVALID', message });
  });

  it('9. a template with no permissions takes empty responses', async () => {
    const payload = { ...CONSENT, responses: {} };

    await expect(validateConsentReferences(consentDb({ templates: [template({ permissions: undefined })] }), payload)).resolves.toBeUndefined();
  });

  it.each([
    ['false', { consentGranted: false }],
    ['absent', { consentGranted: undefined }],
  ])('10. consentGranted %s is 409 CONSENT_NOT_GRANTED: only positive evidence accepts', async (_label, change) => {
    const error = await refusal(consentDb(), { ...CONSENT, ...change });

    expect(error).toMatchObject({ statusCode: 409, violationCode: 'CONSENT_NOT_GRANTED' });
  });

  it.each([
    ['absent', undefined],
    ['unparseable', 'yesterday'],
    ['after now', new Date(Date.now() + DAY).toISOString()],
    ['before the template\'s validFrom', new Date(Date.now() - 31 * DAY).toISOString()],
  ])('11. a consentAcceptedAt %s is 409 CONSENT_DECISION_TIME_INVALID', async (_label, consentAcceptedAt) => {
    const error = await refusal(consentDb(), { ...CONSENT, consentAcceptedAt });

    expect(error).toMatchObject({ statusCode: 409, violationCode: 'CONSENT_DECISION_TIME_INVALID' });
  });

  // A template with no validFrom, so only the format refuses: each value
  // below is a past time the Date parser would otherwise read.
  it.each([
    ['that is the bare number 0', '0'],
    ['that is the bare year 2026', '2026'],
    ['with no time', '2026-10-24'],
    ['with no zone', '2026-10-24T10:00:00'],
  ])('11b. a consentAcceptedAt %s is 409 CONSENT_DECISION_TIME_INVALID: only an ISO 8601 date-time with a zone is read, never reinterpreted', async (_label, consentAcceptedAt) => {
    const error = await refusal(consentDb({ templates: [template({ validFrom: undefined })] }), { ...CONSENT, consentAcceptedAt });

    expect(error).toMatchObject({ statusCode: 409, violationCode: 'CONSENT_DECISION_TIME_INVALID' });
  });

  it.each(['2026-10-24T10:00:00Z', '2026-10-24T10:00:00.123-03:00'])('11c. a past consentAcceptedAt %s, an ISO 8601 date-time with a zone, resolves and is written back as signedAt', async (consentAcceptedAt) => {
    const payload = { ...CONSENT, consentAcceptedAt };

    await expect(validateConsentReferences(consentDb({ templates: [template({ validFrom: undefined })] }), payload)).resolves.toBeUndefined();

    expect(payload.signedAt).toBe(consentAcceptedAt);
  });

  it.each(['ACTIVE', 'VALID', 'GRANTED'])('12. a participant whose consent is %s is 409 CONSENT_ALREADY_ACTIVE: ingestion never supersedes', async (status) => {
    const error = await refusal(consentDb({ consents: [{ participantId: PARTICIPANT, status }] }), { ...CONSENT });

    expect(error).toMatchObject({ statusCode: 409, violationCode: 'CONSENT_ALREADY_ACTIVE' });
  });

  it('13. a revoked consent of this participant, or an active one of another, does not block', async () => {
    const db = consentDb({ consents: [{ participantId: PARTICIPANT, status: 'REVOKED' }, { participantId: '23456789', status: 'ACTIVE' }] });

    await expect(validateConsentReferences(db, { ...CONSENT })).resolves.toBeUndefined();
  });

  it.each(['patients', 'consent_templates', 'patientConsents'])('14. a %s lookup that fails rejects with its error, never a 404 or 409 verdict', async (collection) => {
    const db = consentDb();
    const outage = new Error('connection reset');
    db.collection(collection).findOne = async () => { throw outage; };

    const error = await refusal(db, { ...CONSENT });

    expect(error).toBe(outage);
    expect(error.statusCode).toBeUndefined();
  });
});

describe('ingestion/consentTarget prepareConsentDocument (RF029, #1318)', () => {
  const DOC = {
    consentId: 'consent-uuid-1',
    participantId: PARTICIPANT,
    consentTemplateId: TEMPLATE_HEX,
    responses: { storage: true, recontact: false },
    signedAt: new Date(ACCEPTED_AT),
  };

  it('15. stores the evidence of the decision at its own time, stamps its fields and answers one permission row per response', async () => {
    const store = vi.spyOn(consentEvidence, 'storeConsentEvidence').mockReturnValue(EVIDENCE);
    const doc = { ...DOC };

    const prepared = await prepareConsentDocument(consentDb(), doc);

    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0][0]).toEqual({
      consentId: 'consent-uuid-1',
      participantId: PARTICIPANT,
      template: expect.objectContaining({ title: 'TCLE', version: 3 }),
      responses: { storage: true, recontact: false },
      decisionDateTime: new Date(ACCEPTED_AT),
      signatureHash: null,
      signerRole: 'participant',
      ipAddress: null,
      userAgent: null,
    });
    expect(doc).toEqual({ ...DOC, ...EVIDENCE });
    expect(prepared.permissionRows.map((row) => [row.consentId, row.participantId, row.permissionCode, row.decision, row.policyVersion]))
      .toEqual([['consent-uuid-1', PARTICIPANT, 'storage', 'permit', '3'], ['consent-uuid-1', PARTICIPANT, 'recontact', 'deny', '3']]);
    expect(prepared.permissionRows[1].purpose).toMatchObject({ code: 'DUO:0000042' });
  });

  it('16. a template gone since the gates is a plain failure, never a verdict, and stores no evidence', async () => {
    const store = vi.spyOn(consentEvidence, 'storeConsentEvidence').mockReturnValue(EVIDENCE);

    const error = await prepareConsentDocument(consentDb({ templates: [] }), { ...DOC }).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBeUndefined();
    expect(store).not.toHaveBeenCalled();
  });

  it('17. a template lookup that fails rejects with its error', async () => {
    vi.spyOn(consentEvidence, 'storeConsentEvidence').mockReturnValue(EVIDENCE);
    const db = consentDb();
    const outage = new Error('connection reset');
    db.collection('consent_templates').findOne = async () => { throw outage; };

    await expect(prepareConsentDocument(db, { ...DOC })).rejects.toBe(outage);
  });
});

describe('ingestion/consentTarget appendConsentProjection and removeConsentProjection (RF029, #1318)', () => {
  function storedConsent(db) {
    const doc = {
      consentId: 'consent-uuid-1',
      participantId: PARTICIPANT,
      consentTemplateId: TEMPLATE_HEX,
      responses: { storage: true, recontact: false },
      signedAt: new Date(ACCEPTED_AT),
      status: 'ACTIVE',
      ...EVIDENCE,
    };
    db.collections.patientConsents.docs.push(doc);
    doc._id = new ObjectId();
    return doc;
  }

  function permissionRows() {
    return [
      { consentPermissionId: 'perm-1', consentId: 'consent-uuid-1', permissionCode: 'storage' },
      { consentPermissionId: 'perm-2', consentId: 'consent-uuid-1', permissionCode: 'recontact' },
    ];
  }

  it('18. writes the permissions, one accepted decision event, the recomputed state and one CONSENT_UPSERTED event, and answers its eventId', async () => {
    const db = consentDb();
    const doc = storedConsent(db);
    const outbox = { appendEvent: vi.fn(async (_db, event) => ({ eventId: 'evt-consent', ...event })) };

    const eventIds = await appendConsentProjection(db, { doc, insertedId: doc._id, outbox, prepared: { permissionRows: permissionRows() } });

    expect(eventIds).toEqual(['evt-consent']);
    expect(db.collections.consentPermissions.docs.map((row) => row.consentPermissionId)).toEqual(['perm-1', 'perm-2']);
    const events = db.collections.consentDecisionEvents.docs;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      consentId: 'consent-uuid-1',
      participantId: PARTICIPANT,
      templateVersionId: TEMPLATE_HEX,
      channel: 'staff_portal',
      signerRole: 'participant',
      signerId: PARTICIPANT,
      authenticationLevel: 'session',
      decision: 'accepted',
      evidenceUri: EVIDENCE.evidenceDocumentUri,
      evidenceHash: EVIDENCE.evidenceHash,
    });
    expect(db.collections.patientConsents.docs[0]).toMatchObject({ currentStateDerived: 'active', status: 'ACTIVE', effectivePermissions: { storage: true, recontact: false } });
    expect(outbox.appendEvent).toHaveBeenCalledTimes(1);
    expect(outbox.appendEvent.mock.calls[0][1]).toMatchObject({
      eventType: 'CONSENT_UPSERTED',
      aggregateType: 'EthicalConsent',
      aggregateId: String(doc._id),
      payload: { participantId: PARTICIPANT, specimenId: null, ethicalConsentId: String(doc._id), status: 'ACTIVE', signedAt: new Date(ACCEPTED_AT) },
      sourceService: 'ingestion-gateway',
    });
  });

  it('19. writes every row and the event in the insert\'s session (#1313)', async () => {
    const db = consentDb();
    const doc = storedConsent(db);
    const session = { id: 'session-1' };
    const outbox = { appendEvent: vi.fn(async (_db, event) => ({ eventId: 'evt-consent', ...event })) };
    const rows = permissionRows();

    await appendConsentProjection(db, { doc, insertedId: doc._id, outbox, prepared: { permissionRows: rows } }, { session });

    expect(db.collections.consentPermissions.insertMany).toHaveBeenCalledWith(rows, { session });
    expect(db.collections.consentDecisionEvents.insertOne).toHaveBeenCalledWith(expect.objectContaining({ decision: 'accepted' }), { session });
    expect(db.collections.patientConsents.updateOne).toHaveBeenCalledWith({ _id: doc._id }, expect.any(Object), { session });
    expect(outbox.appendEvent.mock.calls[0][2]).toEqual({ session });
  });

  it('20. writes no permission rows when the template asked for none', async () => {
    const db = consentDb();
    const doc = storedConsent(db);
    const outbox = { appendEvent: vi.fn(async (_db, event) => ({ eventId: 'evt-consent', ...event })) };

    await appendConsentProjection(db, { doc, insertedId: doc._id, outbox, prepared: { permissionRows: [] } });

    expect(db.collections.consentPermissions.insertMany).not.toHaveBeenCalled();
    expect(db.collections.consentDecisionEvents.docs).toHaveLength(1);
  });

  it('21. removeConsentProjection deletes this consent\'s permission and decision rows, and no other consent\'s', async () => {
    const db = consentDb();
    db.collections.consentPermissions.docs.push({ consentId: 'consent-uuid-1' }, { consentId: 'consent-uuid-1' }, { consentId: 'other' });
    db.collections.consentDecisionEvents.docs.push({ consentId: 'consent-uuid-1' }, { consentId: 'other' });

    await removeConsentProjection(db, { entityId: 'consent-uuid-1' });

    expect(db.collections.consentPermissions.docs).toEqual([{ consentId: 'other' }]);
    expect(db.collections.consentDecisionEvents.docs).toEqual([{ consentId: 'other' }]);
  });
});
