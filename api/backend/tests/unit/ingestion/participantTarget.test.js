import { describe, it, expect, vi, afterEach } from 'vitest';
const { ObjectId } = require('mongodb');
const { generateParticipantId, validateParticipantReferences } = require('../../../src/ingestion/participantTarget');
const { createFakeDb } = require('./testHelpers');
const { createMatchingCollection } = require('../../factories/filter.factory');

// RF029 (#1318): Participant, the seventh ingestion target, reuses the
// participant mount's clinical unit, deceased and consent template gates
// (patient.service.js createPatient), in the mount's order.

afterEach(() => { vi.restoreAllMocks(); });

const TEMPLATE_HEX = '64b7f0c2a1b2c3d4e5f60718';

// consent_templates is a matching collection: its _id is an ObjectId, which
// the plain fake's === never matches.
function participantDb({
  organizations = [{ organizationId: 'org-unit-1', officialName: '  Hospital Central ', acronym: ' HC ' }],
  templates = [{ _id: new ObjectId(TEMPLATE_HEX), title: 'TCLE' }],
  patients = [],
} = {}) {
  const db = createFakeDb({ organizations, patients });
  db.collections.consent_templates = createMatchingCollection(templates);
  return db;
}

const PARTICIPANT = { participantId: 'client-1', sex: 'F', clinicalUnitId: 'org-unit-1', consentTemplateId: TEMPLATE_HEX };

async function refusal(db, payload) {
  return validateParticipantReferences(db, payload).then(() => null, (error) => error);
}

describe('ingestion/participantTarget generateParticipantId (RF029, #1318)', () => {
  it('1. answers the mount\'s 8-digit participantId as a string, one patients does not hold', async () => {
    const id = await generateParticipantId(participantDb());

    expect(id).toMatch(/^[1-9]\d{7}$/);
  });
});

describe('ingestion/participantTarget validateParticipantReferences (RF029, #1318)', () => {
  it('2. a known clinical unit and a known template resolve, and the unit\'s snapshot is written back', async () => {
    const payload = { ...PARTICIPANT };

    await expect(validateParticipantReferences(participantDb(), payload)).resolves.toBeUndefined();

    expect(payload).toEqual({ ...PARTICIPANT, clinicalUnit: 'Hospital Central', unitAcronym: 'HC' });
  });

  it('3. a unit with no acronym gets the mount\'s fillAcronym of its name, and an empty name is null', async () => {
    const named = { ...PARTICIPANT };
    await validateParticipantReferences(participantDb({ organizations: [{ organizationId: 'org-unit-1', officialName: 'Hospital Central' }] }), named);
    expect(named).toMatchObject({ clinicalUnit: 'Hospital Central', unitAcronym: 'HC' });

    const unnamed = { ...PARTICIPANT };
    await validateParticipantReferences(participantDb({ organizations: [{ organizationId: 'org-unit-1', officialName: '  ' }] }), unnamed);
    expect(unnamed).toMatchObject({ clinicalUnit: null, unitAcronym: null });
  });

  it('4. an unknown clinicalUnitId is 404', async () => {
    const error = await refusal(participantDb({ organizations: [] }), { ...PARTICIPANT });

    expect(error).toMatchObject({ statusCode: 404, message: 'clinicalUnitId org-unit-1 não encontrado' });
    expect(error.violationCode).toBeUndefined();
  });

  it('5. a failing organization lookup rejects with its own error, never a 404 verdict', async () => {
    const db = participantDb();
    const outage = new Error('connection reset');
    db.collection('organizations').findOne = async () => { throw outage; };

    const error = await refusal(db, { ...PARTICIPANT });

    expect(error).toBe(outage);
    expect(error.statusCode).toBeUndefined();
  });

  it('6. a deceased participant is 409 DECEASED_REPRESENTATIVE_REQUIRED: the representative is identity, refused by ingestion', async () => {
    const error = await refusal(participantDb(), { ...PARTICIPANT, isDeceased: true });

    expect(error).toMatchObject({ statusCode: 409, violationCode: 'DECEASED_REPRESENTATIVE_REQUIRED' });
  });

  it('7. isDeceased false resolves', async () => {
    await expect(validateParticipantReferences(participantDb(), { ...PARTICIPANT, isDeceased: false })).resolves.toBeUndefined();
  });

  it.each([
    ['an unknown template', TEMPLATE_HEX, []],
    ['an id that is not an ObjectId', 'not-an-object-id', undefined],
  ])('8. %s is 404', async (_label, consentTemplateId, templates) => {
    const error = await refusal(participantDb(templates ? { templates } : {}), { ...PARTICIPANT, consentTemplateId });

    expect(error).toMatchObject({ statusCode: 404, message: `consentTemplateId ${consentTemplateId} não encontrado` });
  });

  it('9. the consentTemplateId is trimmed and written back', async () => {
    const payload = { ...PARTICIPANT, consentTemplateId: `  ${TEMPLATE_HEX} ` };

    await expect(validateParticipantReferences(participantDb(), payload)).resolves.toBeUndefined();

    expect(payload.consentTemplateId).toBe(TEMPLATE_HEX);
  });

  it('10. a failing consent template lookup rejects with its own error, never a 404 verdict', async () => {
    const db = participantDb();
    const outage = new Error('connection reset');
    db.collection('consent_templates').findOne = async () => { throw outage; };

    const error = await refusal(db, { ...PARTICIPANT });

    expect(error).toBe(outage);
    expect(error.statusCode).toBeUndefined();
  });
});
