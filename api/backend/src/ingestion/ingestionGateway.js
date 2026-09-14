/**
 * RF029 ingestion gateway. It composes idempotency, provenance, canonical
 * v2 contract validation, reference existence and active-reference-code
 * validation, and quarantines invalid records instead of correcting them
 * silently.
 */
const { validateProvenanceEnvelope } = require('./provenanceEnvelope');
const { validateIngestionPayload, assertReferencesExist } = require('./canonicalGateway');
const { validateActiveCodes } = require('./activeCodeValidator');
const { claimIdempotencyKey, recordIdempotentResult } = require('./idempotency');
const { quarantineRecord } = require('./quarantine');

async function ingestRecord({
  db,
  entityType,
  aliasMap = {},
  payload,
  provenance,
  idempotencyKey = null,
  references = [],
  referenceCodes = [],
}) {
  if (!db) throw new Error('ingestRecord: db é obrigatório');
  if (!entityType) throw new Error('ingestRecord: entityType é obrigatório');

  if (idempotencyKey) {
    const claim = await claimIdempotencyKey(db, { idempotencyKey, scope: entityType });
    if (claim.idempotent) {
      return {
        status: 'idempotent_replay',
        entityType,
        idempotencyKey,
        resultRef: claim.existing?.resultRef || null,
        violations: [],
      };
    }
  }

  const provenanceResult = validateProvenanceEnvelope(provenance);
  const contractResult = await validateIngestionPayload({ entityType, payload, aliasMap });
  const referenceResult = await assertReferencesExist(db, references);
  const codeResult = await validateActiveCodes(db, referenceCodes);

  const violations = [
    ...provenanceResult.violations,
    ...contractResult.violations,
    ...referenceResult.violations,
    ...codeResult.violations,
  ];

  let outcome;
  if (violations.length > 0) {
    const record = await quarantineRecord(db, {
      entityType,
      sourceRecordId: provenanceResult.envelope.sourceRecordId,
      idempotencyKey,
      payload,
      violations,
      provenance: provenanceResult.envelope,
    });
    outcome = {
      status: 'quarantined',
      entityType,
      violations,
      quarantineRecord: record,
    };
  } else {
    outcome = {
      status: 'accepted',
      entityType,
      violations: [],
      provenance: provenanceResult.envelope,
      payload,
    };
  }

  if (idempotencyKey) {
    await recordIdempotentResult(db, {
      idempotencyKey,
      scope: entityType,
      resultRef: outcome.status === 'quarantined' ? outcome.quarantineRecord.ingestionQuarantineRecordId : null,
    });
  }

  return outcome;
}

module.exports = { ingestRecord };
