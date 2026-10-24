/**
 * RF029 (#1318): what the Participant ingestion target reuses from the
 * participant mount (patient.service.js createPatient), so ingesting a
 * participant is never a way around a gate the mount holds
 * (docs/decisions/2026-10-24-ingestion-participant-target.md).
 */
const { ObjectId } = require('mongodb');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const PatientModel = require('../models/Patient');
const { getCollection } = require('../utils/collectionResolver');
const { generateUniqueParticipantId } = require('../utils/patientAnonymization');

function referenceError(statusCode, message, violationCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (violationCode) error.violationCode = violationCode;
  return error;
}

/** The mount's 8-digit participantId, as a string, one patients does not hold. */
async function generateParticipantId(db) {
  return generateUniqueParticipantId(db);
}

/**
 * The participant mount's gates, on a model-valid payload, in the mount's
 * order and in the contract of assayReferenceValidator.validateAssayReferences:
 * a 404 for a reference that does not resolve, a 409 for one that resolves
 * but cannot be used. No lookup has a catch: a failed lookup rethrows, never
 * a 404 verdict replayed for good.
 */
async function validateParticipantReferences(db, payload) {
  // resolveClinicalUnitSnapshot's lookup by organizationId and its snapshot.
  // The scope gate has already required a non-empty clinicalUnitId, so the
  // mount's fallback by name never applies.
  const organization = await db.collection(CANONICAL_COLLECTIONS.organizations).findOne({ organizationId: payload.clinicalUnitId });
  if (!organization) {
    throw referenceError(404, `clinicalUnitId ${payload.clinicalUnitId} não encontrado`);
  }
  const resolvedName = String(organization.officialName || '').trim();
  payload.clinicalUnit = resolvedName || null;
  payload.unitAcronym = String(organization.acronym || '').trim() || PatientModel.fillAcronym(resolvedName);

  // applyDeceasedRepresentativeRules: a deceased participant needs the
  // representative's name, email, document and phone, identity fields the
  // ingestion refuses, so no ingested record can satisfy it.
  if (payload.isDeceased === true) {
    throw referenceError(409, 'Participante falecido exige representante legal, identidade civil não suportada pela ingestão', 'DECEASED_REPRESENTATIVE_REQUIRED');
  }

  // The mount's consent template gate.
  const consentTemplateId = payload.consentTemplateId.trim();
  const template = ObjectId.isValid(consentTemplateId)
    ? await getCollection(db, 'consentTemplates').findOne({ _id: new ObjectId(consentTemplateId) })
    : null;
  if (!template) {
    throw referenceError(404, `consentTemplateId ${payload.consentTemplateId} não encontrado`);
  }
  payload.consentTemplateId = consentTemplateId;
}

module.exports = { generateParticipantId, validateParticipantReferences };
