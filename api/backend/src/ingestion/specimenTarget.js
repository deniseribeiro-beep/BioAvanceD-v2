/**
 * RF029 (#1318): what the Specimen ingestion target reuses from the sample
 * mount (sample.service.js createSample, RegisterSample.js), so ingesting a
 * specimen is never a way around a gate the mount holds
 * (docs/decisions/2026-10-23-ingestion-specimen-target.md).
 */
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { SampleModel } = require('../models/Sample');
const { GraphProjectionService } = require('../services/graphProjection.service');
const { getCollection } = require('../utils/collectionResolver');
const { LEGACY_BARCODE_WRITE_REFUSED, sampleBarcodeWindowOpen } = require('../utils/sampleBarcodeWindow');
const { generateUniqueSpecimenId } = require('../utils/sampleIDGenerator');

// RegisterSample.js's assertConsent: the statuses that are positive evidence.
const ACTIVE_CONSENT_STATUSES = ['ACTIVE', 'VALID', 'GRANTED'];

function referenceError(statusCode, message, violationCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (violationCode) error.violationCode = violationCode;
  return error;
}

// Sample.create's normalization, so the parents checked are the ones stored.
function parentIdsOf(payload) {
  return Array.isArray(payload.parentSpecimenIds)
    ? [...new Set(payload.parentSpecimenIds
      .filter((parentId) => typeof parentId === 'string' && parentId.trim() !== '')
      .map((parentId) => parentId.trim()))]
    : [];
}

/** The mount's 7-digit specimenId, as a string: every reader of samples expects it, not a uuid. */
async function generateSpecimenId(db) {
  return String(await generateUniqueSpecimenId(db, CANONICAL_COLLECTIONS.samples));
}

/**
 * The sample mount's gates, on a model-valid payload, in the contract of
 * assayReferenceValidator.validateAssayReferences: a 404 for a reference that
 * does not resolve, a 409 for one that resolves but cannot be used. A 409
 * with a violationCode names its own violation.
 */
async function validateSpecimenReferences(db, payload) {
  // validateParticipantId's check and lookup, without its catch: a failed
  // lookup is a failure that rethrows, never a 404 verdict replayed for good.
  const { participantId } = payload;
  const participant = typeof participantId === 'string' && /^\d{8}$/.test(participantId)
    ? await db.collection(CANONICAL_COLLECTIONS.patients).findOne({ participantId }, { projection: { participantId: 1, _id: 0 } })
    : null;
  if (!participant) {
    throw referenceError(404, `participantId ${payload.participantId} não encontrado`);
  }

  // RF029 AC2: always applied, unlike the mount's permissive mode, and only
  // on positive evidence. A revoked, unknown or missing consent never accepts.
  const consent = await getCollection(db, 'consents').findOne({
    participantId: payload.participantId,
    status: { $in: ACTIVE_CONSENT_STATUSES },
  });
  if (!consent) {
    throw referenceError(409, `participantId ${payload.participantId} sem consentimento ativo`, 'CONSENT_NOT_ACTIVE');
  }

  // ELM-0128: the collection site resolves to a real Organization.
  if (typeof payload.collectionSite === 'string' && payload.collectionSite !== '') {
    const organization = await db.collection(CANONICAL_COLLECTIONS.organizations).findOne({ organizationId: payload.collectionSite });
    if (!organization) {
      throw referenceError(404, `collectionSite ${payload.collectionSite} não encontrado`);
    }
  }

  // dict-02 ELM-0120 (#1368): each parent exists, belongs to the same
  // participant and is not terminal.
  const samples = db.collection(CANONICAL_COLLECTIONS.samples);
  const parentIds = parentIdsOf(payload);
  if (parentIds.length > 0) {
    const parents = await samples.find({ specimenId: { $in: parentIds } }).toArray();
    const byId = new Map(parents.map((parent) => [String(parent.specimenId), parent]));
    for (const parentId of parentIds) {
      const parent = byId.get(parentId);
      if (!parent) {
        throw referenceError(404, `parentSpecimenIds ${parentId} não encontrado`);
      }
      if (String(parent.participantId) !== String(payload.participantId)) {
        throw referenceError(409, `parentSpecimenIds ${parentId} pertence a outro participante`);
      }
      if (SampleModel.isTerminalSpecimen(parent)) {
        throw referenceError(409, `parentSpecimenIds ${parentId} está encerrada (status: ${parent.specimenStatus})`);
      }
    }
  }

  // #1378: no legacy barcode once the window is closed; while it is open, a
  // duplicate is a verdict here, never a unique-index 500 at the insert.
  if (typeof payload.barcode === 'string' && payload.barcode !== '') {
    if (!sampleBarcodeWindowOpen()) {
      throw referenceError(409, 'Sample.barcode (ELM-0116) não é mais gravado: o código da amostra é um LabelIdentifier', LEGACY_BARCODE_WRITE_REFUSED);
    }
    if (await samples.findOne({ barcode: payload.barcode })) {
      throw referenceError(409, `barcode ${payload.barcode} já cadastrado`, 'DUPLICATE_BARCODE');
    }
  }
}

/**
 * #1313: the sample's SPECIMEN_UPSERTED and one LINEAGE_REGISTERED per parent,
 * keyed by the inserted _id as the mount keys them, in the insert's session.
 * Answers the appended eventIds, so a lost race can remove them.
 */
async function appendSpecimenProjection(db, { doc, insertedId, outbox }, opts = {}) {
  const projection = new GraphProjectionService({ outbox });
  const specimenId = String(insertedId);
  const events = [await projection.appendSpecimenEvent(db, {
    specimenId,
    participantId: doc.participantId,
    sourceService: 'ingestion-gateway',
  }, opts)];

  const parentIds = Array.isArray(doc.parentSpecimenIds) ? doc.parentSpecimenIds : [];
  if (parentIds.length > 0) {
    const parents = await db.collection(CANONICAL_COLLECTIONS.samples)
      .find({ specimenId: { $in: parentIds } }, opts).toArray();
    const byId = new Map(parents.map((parent) => [String(parent.specimenId), parent]));
    events.push(...await projection.appendLineageEvents(db, {
      specimenId,
      parentSpecimenIds: parentIds.map((parentId) => String(byId.get(parentId)._id)),
      sourceService: 'ingestion-gateway',
    }, opts));
  }
  return events.map((event) => event?.eventId).filter(Boolean);
}

module.exports = { generateSpecimenId, validateSpecimenReferences, appendSpecimenProjection };
