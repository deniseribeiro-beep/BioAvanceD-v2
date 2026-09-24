const { getCollection } = require('../utils/collectionResolver');
const ParticipantIdentityModel = require('../models/ParticipantIdentity');
const participantIdentityService = require('./participantIdentity.service');

/**
 * #565 — one-time backfill: create a ParticipantIdentity record for any
 * Patient document that predates #363's dual-write (patient.service.js
 * #createPatient has mirrored patientName/birthDate/identityDocument into
 * participantIdentities since #363; anything created before that only has
 * them on the Patient document). Safe to run more than once — a patient
 * that already has a matching ParticipantIdentity (by participantId) is
 * left untouched.
 */
async function backfillParticipantIdentities(db) {
  const patientsCollection = await getCollection(db, 'Participant');
  const identityCollection = await getCollection(db, 'participantIdentities');

  const patients = await patientsCollection.find({}).toArray();
  const existingIdentities = await identityCollection.find({}).toArray();
  const existingParticipantIds = new Set(existingIdentities.map((identity) => identity.participantId));

  const summary = { patientsProcessed: 0, identitiesCreated: 0, skippedNoParticipantId: 0, skippedAlreadyPresent: 0 };

  for (const patient of patients) {
    summary.patientsProcessed += 1;

    if (!patient.participantId) {
      summary.skippedNoParticipantId += 1;
      continue;
    }

    if (existingParticipantIds.has(patient.participantId)) {
      summary.skippedAlreadyPresent += 1;
      continue;
    }

    // Scoped to exactly the three fields #565 backfills — patient.email/
    // phone/representative* are out of this issue's scope and, on a Patient
    // document that already went through encryptSensitivePatientFields, may
    // already be nulled-with-ciphertext-sibling; passing the whole document
    // through would copy that null into a fresh ParticipantIdentity record
    // instead of leaving those fields alone.
    const identityDoc = participantIdentityService.encryptIdentityFields(
      ParticipantIdentityModel.create({
        participantId: patient.participantId,
        patientName: patient.patientName,
        birthDate: patient.birthDate,
        identityDocument: patient.identityDocument
      })
    );
    await identityCollection.insertOne(identityDoc);
    existingParticipantIds.add(patient.participantId);
    summary.identitiesCreated += 1;
  }

  return { summary };
}

function normalizeForCompare(field, value) {
  if (value === undefined || value === null || value === '') return null;
  // #1111 (and #1109): identityDocument is canonicalized to digits-only at
  // rest for every writer, while a pre-#363 Patient document keeps whatever
  // spelling was typed. Comparing the two verbatim reported drift for every
  // punctuated legacy row. Punctuation is formatting, not identity.
  if (field === 'identityDocument') {
    return participantIdentityService.normalizeIdentityDocument(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  return value;
}

const IDENTITY_FIELDS = ['patientName', 'birthDate', 'identityDocument'];

/**
 * #565 — parity check: every Patient document's civil-identity fields must
 * already be represented in ParticipantIdentity before those fields can be
 * safely dropped from Patient (the removal's own precondition — "don't drop
 * data that was never backfilled"). Reports any Patient missing a matching
 * ParticipantIdentity record at all, and separately any whose patientName/
 * birthDate/identityDocument have drifted from the ParticipantIdentity
 * mirror, rather than trusting record existence alone.
 */
async function checkParticipantIdentityParity(db) {
  const patientsCollection = await getCollection(db, 'Participant');
  const identityCollection = await getCollection(db, 'participantIdentities');

  const patients = await patientsCollection.find({}).toArray();
  const identities = await identityCollection.find({}).toArray();
  const identityByParticipantId = new Map(identities.map((identity) => [identity.participantId, identity]));

  const missing = [];
  const drifted = [];

  for (const patient of patients) {
    if (!patient.participantId) continue;

    const identity = identityByParticipantId.get(patient.participantId);
    if (!identity) {
      missing.push(patient.participantId);
      continue;
    }

    const decrypted = participantIdentityService.decryptIdentity(identity);

    // #1111: #575 removed patientName/birthDate/identityDocument from the
    // Patient document entirely, so for every patient created since there
    // is nothing on the Patient side to compare -- and comparing anyway
    // reported drift for all of them, which meant isFullParity could never
    // be true on a live database and the gate #574 depends on could never
    // open. Compare only the fields this Patient actually still carries.
    const legacyFields = IDENTITY_FIELDS.filter(
      (field) => normalizeForCompare(field, patient[field]) !== null
    );

    if (legacyFields.length === 0) {
      // Nothing was ever on this Patient to drop, so the precondition is
      // about the mirror alone: it must exist and actually hold a civil
      // identity. "Exists and decrypts" is NOT enough -- backfill above
      // creates an all-null record for a post-#575 Patient (fieldsOf nulls
      // every absent field and create() only requires participantId), and
      // calling that parity would open the gate on data that was never
      // backfilled, which is exactly what this check exists to prevent.
      // patientName is the criterion because it is the one field every
      // writer must supply -- patient.service.js#createPatient rejects a
      // missing patientName outright and matchOrUpsertParticipant defaults
      // it to 'PACIENTE SEM NOME'.
      if (normalizeForCompare('patientName', decrypted.patientName) === null) {
        drifted.push(patient.participantId);
      }
      continue;
    }

    const fieldsMatch = legacyFields.every(
      (field) => normalizeForCompare(field, patient[field]) === normalizeForCompare(field, decrypted[field])
    );
    if (!fieldsMatch) {
      drifted.push(patient.participantId);
    }
  }

  return {
    isFullParity: missing.length === 0 && drifted.length === 0,
    totalPatients: patients.length,
    missing,
    drifted
  };
}

module.exports = { backfillParticipantIdentities, checkParticipantIdentityParity };
