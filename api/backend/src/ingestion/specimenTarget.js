/**
 * RF029 (#1318): what the Specimen ingestion target reuses from the sample
 * mount (sample.service.js createSample, RegisterSample.js), so ingesting a
 * specimen is never a way around a gate the mount holds
 * (docs/decisions/2026-10-23-ingestion-specimen-target.md). A given barcode
 * is issued as the specimen's LabelIdentifier (#1378); storage is never
 * allocated here (docs/decisions/2026-10-25-ingestion-specimen-storage-and-label.md).
 */
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { SampleModel } = require('../models/Sample');
const { GraphProjectionService } = require('../services/graphProjection.service');
const sampleCollectionGate = require('../services/sample-collection-gate.service');
const { SPECIMEN_LABEL_NAMESPACE_ID, issueSpecimenLabel } = require('../services/specimenLabel.service');
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

// The acting user's id from the stamped `Actor/<id>`, else null, so the
// label's issuer falls back to the stamped organization (V2E-0176).
function actorIdOf(doc) {
  const match = typeof doc.createdBy === 'string' ? /^Actor\/(.+)$/.exec(doc.createdBy) : null;
  return match && match[1] !== 'undefined' && match[1] !== 'null' ? match[1] : null;
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
  // participant, is not terminal and is not quarantined, since deriving is
  // processing (RF019 AC3).
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
      if (SampleModel.resolveSpecimenStatus(parent) === 'quarantined') {
        throw referenceError(409, `parentSpecimenIds ${parentId} está em quarentena e não pode ser processada (RF019)`);
      }
    }
  }

  // #1378: no legacy barcode once the window is closed; while it is open, a
  // duplicate, in samples or among the active labels, is a verdict here,
  // never a failure at the insert. A value the label model refuses (RULE-012)
  // never reaches here: productionIngestion.js refuses it 422 first.
  if (typeof payload.barcode === 'string' && payload.barcode !== '') {
    if (!sampleBarcodeWindowOpen()) {
      throw referenceError(409, 'Sample.barcode (ELM-0116) não é mais gravado: o código da amostra é um LabelIdentifier', LEGACY_BARCODE_WRITE_REFUSED);
    }
    if (await samples.findOne({ barcode: payload.barcode })) {
      throw referenceError(409, `barcode ${payload.barcode} já cadastrado`, 'DUPLICATE_BARCODE');
    }
    const activeLabel = { namespaceRegistryId: SPECIMEN_LABEL_NAMESPACE_ID, encodedValue: payload.barcode, status: 'active' };
    if (await getCollection(db, 'labelIdentifiers').findOne(activeLabel)) {
      throw referenceError(409, `barcode ${payload.barcode} já ativo como etiqueta`, 'DUPLICATE_BARCODE');
    }
  }

  // RF004 AC2, ELM-0118 (#1538): the mount's own collection gate, last. An
  // unknown collection is a 404; a missing or refused one quarantines under
  // the gate's code; a failed lookup rethrows, as the other gates do.
  try {
    await sampleCollectionGate.assertSampleCollectionAdmits(db, payload);
  } catch (error) {
    if (error.statusCode === 404) throw referenceError(404, error.message);
    if (error.code === sampleCollectionGate.COLLECTION_REQUIRED
      || error.code === sampleCollectionGate.COLLECTION_NOT_ADMITTED) {
      throw referenceError(409, error.message, error.code);
    }
    throw error;
  }
}

/**
 * #1313: the sample's SPECIMEN_UPSERTED and one LINEAGE_REGISTERED per parent,
 * keyed by the inserted _id as the mount keys them, in the insert's session.
 * Answers the appended eventIds, so a lost race can remove them.
 * #1378: a given barcode is first issued, unprinted, as the LabelIdentifier
 * on a container loaded for the specimen; none is generated, none is placed.
 */
async function appendSpecimenProjection(db, { doc, insertedId, outbox }, opts = {}) {
  if (typeof doc.barcode === 'string' && doc.barcode !== '') {
    await issueSpecimenLabel(db, { ...doc, _id: insertedId }, { code: doc.barcode, actorId: actorIdOf(doc), at: new Date(), session: opts.session });
  }
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
