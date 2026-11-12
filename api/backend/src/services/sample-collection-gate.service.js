'use strict';

const collectionGovernanceService = require('./collectionGovernance.service');

// RF004 AC2 (#1538): the one collection gate every writer of a sample runs,
// createSample, the batch, JSON and LGPD imports and the ingestion Specimen
// target, so none is a way around it.
const COLLECTION_REQUIRED = 'COLLECTION_REQUIRED';
const COLLECTION_NOT_ADMITTED = 'COLLECTION_NOT_ADMITTED';

function collectionGateError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Throws a 422 (code COLLECTION_REQUIRED) for a sample naming no collection,
 * a 404 for one whose collectionId resolves to no Collection, and a 422
 * (code COLLECTION_NOT_ADMITTED) for a collection whose regime, context or
 * approval refuses registration, or a biorepository whose study or protocol
 * the sample contradicts. Answers the collection document.
 */
async function assertSampleCollectionAdmits(db, sampleData) {
  // RF004 AC2, ELM-0118 (Specimen.collectionId, 1..1 Core).
  if (isBlank(sampleData.collectionId)) {
    throw collectionGateError('collectionId é obrigatório: a amostra precisa de uma coleção com regime de governança (RF004 AC2, ELM-0118)', 422, COLLECTION_REQUIRED);
  }
  const collectionDoc = await db.collection('collections').findOne({ collectionId: String(sampleData.collectionId) });
  if (!collectionDoc) {
    throw collectionGateError(`collectionId ${sampleData.collectionId} não encontrado`, 404);
  }
  // RF004 AC2/AC3/AC7, RF021 AC6: human research material enters only
  // a collection governed as a biobank or a biorepository, with the
  // one context its regime names and an approval in force.
  const refusal = await collectionGovernanceService.registrationRefusal(db, collectionDoc);
  if (refusal) {
    throw collectionGateError(refusal, 422, COLLECTION_NOT_ADMITTED);
  }
  // RF004 AC4: a biorepository specimen belongs to the context's study
  // and protocol; one naming another is refused.
  const ctx = collectionDoc.governanceContext;
  if (collectionDoc.governanceRegime === 'biorepository') {
    for (const field of ['studyId', 'protocolId']) {
      const given = sampleData[field];
      if (given !== undefined && given !== null && given !== '' && String(given) !== ctx[field]) {
        throw collectionGateError(`${field} ${given} difere do ${field} do biorrepositório da coleção (${ctx[field]})`, 422, COLLECTION_NOT_ADMITTED);
      }
    }
  }
  return collectionDoc;
}

module.exports = { assertSampleCollectionAdmits, COLLECTION_REQUIRED, COLLECTION_NOT_ADMITTED };
