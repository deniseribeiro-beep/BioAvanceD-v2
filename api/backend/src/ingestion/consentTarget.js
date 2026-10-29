/**
 * RF029 (#1318): what the Consent ingestion target reuses from the consent
 * mount (consent.service.js createPatientConsent), so ingesting a consent is
 * never a way around a gate the mount holds, and what it writes beside the
 * consent document, as the mount writes it
 * (docs/decisions/2026-10-24-ingestion-consent-target.md).
 */
const { ObjectId } = require('mongodb');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const ConsentPermissionModel = require('../models/ConsentPermission');
const consentEvidence = require('../services/consentEvidence.service');
const consentHistory = require('../services/consentHistory.service');
const { GraphProjectionService } = require('../services/graphProjection.service');
const { getCollection } = require('../utils/collectionResolver');

// RegisterSample.js's assertConsent: the statuses that are positive evidence
// of a consent in force, the ones Specimen's consent gate trusts.
const ACTIVE_CONSENT_STATUSES = ['ACTIVE', 'VALID', 'GRANTED'];

// The staff-portal mount's actor (consent.controller.js createPatientConsent):
// a participant signing under an authenticated staff session.
const DECISION_ACTOR = { channel: 'staff_portal', signerRole: 'participant', authenticationLevel: 'session' };

// ELM-0093's dateTime as the decision time is read: a date, a time and a zone.
const ISO_DATE_TIME_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

function referenceError(statusCode, message, violationCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (violationCode) error.violationCode = violationCode;
  return error;
}

// A template validity bound as the mount reads it: an unparseable one is ignored.
function boundOf(value) {
  const bound = value ? new Date(value) : null;
  return bound && !Number.isNaN(bound.getTime()) ? bound : null;
}

// validateResponsesAgainstTemplate's three checks and messages, as verdicts.
function responsesViolation(template, responses) {
  const permissions = Array.isArray(template.permissions) ? template.permissions : [];
  const keys = new Set(permissions.map((permission) => permission.key));

  const missing = permissions.filter((permission) => typeof responses[permission.key] !== 'boolean');
  if (missing.length > 0) {
    return `Respostas inválidas: ${missing.map((p) => p.key).join(', ')} devem ser booleano`;
  }
  const missingRequired = permissions.filter((permission) => permission.required && responses[permission.key] !== true);
  if (missingRequired.length > 0) {
    return `Permissões obrigatórias não aceitas: ${missingRequired.map((p) => p.key).join(', ')}`;
  }
  const extraKeys = Object.keys(responses).filter((key) => !keys.has(key));
  if (extraKeys.length > 0) {
    return `Respostas contêm chaves inválidas: ${extraKeys.join(', ')}`;
  }
  return null;
}

async function findTemplate(db, consentTemplateId) {
  return ObjectId.isValid(consentTemplateId)
    ? getCollection(db, 'consentTemplates').findOne({ _id: new ObjectId(consentTemplateId) })
    : null;
}

/**
 * The consent mount's gates, on a model-valid payload, in the mount's order,
 * then the three an ingested record needs, in the contract of
 * assayReferenceValidator.validateAssayReferences: a 404 for a reference that
 * does not resolve, a 409 for one that resolves but cannot be used, under its
 * own violationCode where it names one. No lookup has a catch: a failed
 * lookup rethrows, never a verdict replayed for good.
 */
async function validateConsentReferences(db, payload) {
  // validateParticipantId's check and lookup, without its catch.
  const { participantId } = payload;
  const participant = typeof participantId === 'string' && /^\d{8}$/.test(participantId)
    ? await db.collection(CANONICAL_COLLECTIONS.patients).findOne({ participantId }, { projection: { participantId: 1, _id: 0 } })
    : null;
  if (!participant) {
    throw referenceError(404, `participantId ${payload.participantId} não encontrado`);
  }

  const consentTemplateId = payload.consentTemplateId.trim();
  const template = await findTemplate(db, consentTemplateId);
  if (!template) {
    throw referenceError(404, `consentTemplateId ${payload.consentTemplateId} não encontrado`);
  }
  if (!template.active) {
    throw referenceError(409, 'Template de consentimento não está ativo');
  }

  const now = new Date();
  const validFrom = boundOf(template.validFrom);
  const validTo = boundOf(template.validTo);
  if (validFrom && now.getTime() < validFrom.getTime()) {
    throw referenceError(409, 'Template de consentimento ainda não está vigente');
  }
  if (validTo && now.getTime() > validTo.getTime()) {
    throw referenceError(409, 'Template de consentimento expirado');
  }

  const invalidResponses = responsesViolation(template, payload.responses);
  if (invalidResponses) {
    throw referenceError(409, invalidResponses, 'CONSENT_RESPONSES_INVALID');
  }

  // The record becomes an ACTIVE consent Specimen's gate trusts, so only
  // positive evidence of the grant accepts.
  if (payload.consentGranted !== true) {
    throw referenceError(409, 'consentGranted deve ser true: só uma concessão expressa é registrada como consentimento ativo', 'CONSENT_NOT_GRANTED');
  }

  // ELM-0093: the decision time is the record's own, never the ingestion's
  // (an absence never becomes a value, RF029 AC7), and never before the
  // term was in force. One after validTo is after now, refused above. Only
  // an ISO 8601 date-time with a zone is read: a looser string the Date
  // parser would reinterpret is refused, never corrected (RF029 AC3).
  const decidedAt = typeof payload.consentAcceptedAt === 'string' && ISO_DATE_TIME_WITH_ZONE.test(payload.consentAcceptedAt)
    ? new Date(payload.consentAcceptedAt)
    : null;
  if (!decidedAt
    || Number.isNaN(decidedAt.getTime())
    || decidedAt.getTime() > now.getTime()
    || (validFrom && decidedAt.getTime() < validFrom.getTime())) {
    throw referenceError(409, 'consentAcceptedAt deve ser uma data válida, não futura e dentro da vigência do template', 'CONSENT_DECISION_TIME_INVALID');
  }

  // RF010 AC5: the mount supersedes a consent in force through its history;
  // ingestion does so only for a record naming the one consent in force with
  // a newer decision, and never silently
  // (docs/decisions/2026-10-25-ingestion-consent-supersession.md).
  const inForce = await getCollection(db, 'consents').find({
    participantId: payload.participantId,
    status: { $in: ACTIVE_CONSENT_STATUSES },
  }).toArray();
  const named = payload.supersedesConsentId;
  if (inForce.length === 0) {
    if (named !== undefined) {
      throw referenceError(409, `supersedesConsentId ${named} não é um consentimento em vigor do participantId ${payload.participantId}`, 'CONSENT_SUPERSESSION_INVALID');
    }
  } else if (named === undefined) {
    throw referenceError(409, `participantId ${payload.participantId} já tem consentimento ativo`, 'CONSENT_ALREADY_ACTIVE');
  } else if (inForce.length > 1) {
    throw referenceError(409, `participantId ${payload.participantId} tem mais de um consentimento em vigor: ${inForce.map(consentHistory.consentKeyOf).join(', ')}`, 'CONSENT_SUPERSESSION_INVALID');
  } else {
    const [prior] = inForce;
    const priorKey = consentHistory.consentKeyOf(prior);
    const priorSignedAt = prior.signedAt ? new Date(prior.signedAt) : null;
    if (typeof named !== 'string'
      || named !== consentHistory.consentKeyOf(prior)
      // A claim another record holds, in flight or left by a failure, is
      // never positive evidence the prior can be superseded.
      || prior.supersededByConsentId != null
      || !priorSignedAt
      || Number.isNaN(priorSignedAt.getTime())
      || decidedAt.getTime() <= priorSignedAt.getTime()) {
      throw referenceError(409, `supersedesConsentId ${named} deve ser o consentimento em vigor ${priorKey}, com uma decisão posterior à dele`, 'CONSENT_SUPERSESSION_INVALID');
    }
  }

  // The mount's create input.
  payload.consentTemplateId = consentTemplateId;
  payload.signedAt = payload.consentAcceptedAt;
  payload.consentVersion = template.version != null ? String(template.version) : null;
  payload.consentModel = template.consentModel || null;
}

/**
 * #827 (RF010 AC3/AC4): the evidence of the decision, stored before the
 * insert as the mount stores it, so a keyless deployment refuses rather than
 * record a consent with none, and the permission rows the transaction
 * writes. The template is read again with no catch: one gone since the gates
 * is a failure, never a verdict. A record naming a consent to supersede
 * (`input`, the create input, since the model's create drops the name) has
 * it read again the same way, before any evidence is stored, and answered as
 * `supersedes` for supersedeConsentInForce.
 */
async function prepareConsentDocument(db, doc, input) {
  const template = await findTemplate(db, doc.consentTemplateId);
  if (!template) {
    throw new Error(`consentTemplateId ${doc.consentTemplateId} não encontrado ao registrar a evidência`);
  }
  let supersedes = null;
  if (typeof input?.supersedesConsentId === 'string') {
    const inForce = await getCollection(db, 'consents').find({
      participantId: doc.participantId,
      status: { $in: ACTIVE_CONSENT_STATUSES },
    }).toArray();
    supersedes = inForce.find((consent) => consentHistory.consentKeyOf(consent) === input.supersedesConsentId) || null;
    if (!supersedes) {
      throw new Error(`supersedesConsentId ${input.supersedesConsentId} não está mais em vigor ao registrar a evidência`);
    }
    // As the mount stamps it.
    doc.supersedesConsentId = input.supersedesConsentId;
  }
  const evidence = consentEvidence.storeConsentEvidence({
    consentId: doc.consentId,
    participantId: doc.participantId,
    template,
    responses: doc.responses,
    decisionDateTime: doc.signedAt,
    signatureHash: null,
    signerRole: 'participant',
    ipAddress: null,
    userAgent: null,
  });
  Object.assign(doc, evidence);
  return {
    permissionRows: ConsentPermissionModel.fromAnswers({
      consentId: doc.consentId,
      participantId: doc.participantId,
      responses: doc.responses,
      template,
      signedAt: doc.signedAt,
    }),
    supersedes,
  };
}

/**
 * #1313 (RF023 AC3): the consent's permissions, its accepted decision event
 * and derived state, and its CONSENT_UPSERTED event keyed by the inserted
 * _id, as the mount writes them, in the insert's session. Answers the
 * appended eventIds, so a lost race can remove them.
 */
async function appendConsentProjection(db, { doc, insertedId, outbox, prepared }, opts = {}) {
  if (prepared.permissionRows.length > 0) {
    await getCollection(db, 'consentPermissions').insertMany(prepared.permissionRows, opts);
  }
  await consentHistory.recordAcceptance(
    db,
    { _id: insertedId, ...doc },
    { ...DECISION_ACTOR, signerId: String(doc.participantId) },
    opts.session || null,
  );
  const event = await new GraphProjectionService({ outbox }).appendConsentEvent(db, {
    participantId: doc.participantId,
    specimenId: null,
    ethicalConsentId: String(insertedId),
    status: 'ACTIVE',
    signedAt: doc.signedAt,
    sourceService: 'ingestion-gateway',
  }, opts);
  return [event?.eventId].filter(Boolean);
}

/** A lost race's permission and decision rows, keyed by its consentId. */
async function removeConsentProjection(db, { entityId }) {
  await getCollection(db, 'consentPermissions').deleteMany({ consentId: entityId });
  await getCollection(db, 'consentDecisionEvents').deleteMany({ consentId: entityId });
}

/**
 * RF010 AC5: the consent the record named is superseded through its history,
 * as the mount supersedes it, once the record has won its idempotency key, so
 * a lost race never touches it. One conditional claim decides: a prior no
 * longer in force, or already superseded, is never rewritten. In a
 * transaction that aborts the record; without one the record stays accepted
 * and nothing is written. Without a transaction, a history write that fails
 * after the claim releases it and rethrows, so the prior is never left in
 * force with a claim that refuses every later supersession.
 */
async function supersedeConsentInForce(db, { doc, insertedId, prepared }, opts = {}) {
  const prior = prepared?.supersedes;
  if (!prior) return;
  const claim = await getCollection(db, 'consents').updateOne(
    { _id: prior._id, status: { $in: ACTIVE_CONSENT_STATUSES }, supersededByConsentId: null },
    { $set: { supersededByConsentId: doc.consentId } },
    opts,
  );
  if (claim?.modifiedCount !== 1) {
    if (opts.session) {
      throw new Error(`consentimento ${consentHistory.consentKeyOf(prior)} não está mais em vigor para ser substituído por ${doc.consentId}`);
    }
    return;
  }
  try {
    await consentHistory.recordSupersession(
      db,
      prior,
      { _id: insertedId, ...doc },
      { ...DECISION_ACTOR, signerId: String(doc.participantId) },
      opts.session || null,
    );
  } catch (error) {
    if (!opts.session) {
      await getCollection(db, 'consents').updateOne(
        { _id: prior._id, supersededByConsentId: doc.consentId },
        { $set: { supersededByConsentId: null } },
      );
    }
    throw error;
  }
}

module.exports = {
  validateConsentReferences,
  prepareConsentDocument,
  appendConsentProjection,
  removeConsentProjection,
  supersedeConsentInForce,
};
