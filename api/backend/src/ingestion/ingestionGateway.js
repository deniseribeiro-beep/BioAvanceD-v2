/**
 * RF029 slice 1/6 (#669): the ingestion gateway shape itself. Composes
 * idempotency (AC5), the provenance envelope (AC3), canonical-contract +
 * reference-existence validation (AC1/2), and the active-code check (AC4)
 * into one call an entity slice (#670-673) makes per record, quarantining
 * (AC6) on any violation instead of correcting or dropping silently.
 *
 * AC8 (AuditEvent + GraphProjectionOutboxEvent) is deliberately NOT emitted
 * from here — this codebase's existing convention (routes/intakeWizard.js)
 * calls auditLogger/GraphProjectionService at the *route* layer, not the
 * service layer (reference-imports/quarantine.js follows the same
 * no-audit-call-in-the-service-module precedent). An entity slice's own
 * route is where AC8 gets wired, reusing auditLogger.log()/
 * GraphProjectionService as-is — no new infrastructure needed, see #669's
 * own scope note. interface/routes/ingestionTestSupport.routes.js
 * demonstrates the expected call shape for #670-673 to follow.
 *
 * The gateway itself does not persist the domain entity on an `accepted`
 * outcome. #1318: ingestion/productionIngestion.js is the caller that does,
 * for the entity types ingestion/ingestionTargets.js names, passing each
 * type's model check as `entityValidator`: a function of the payload whose
 * violations are appended to the gateway's own.
 */
const { validateProvenanceEnvelope } = require('./provenanceEnvelope');
const { validateIngestionPayload, assertReferencesExist } = require('./canonicalGateway');
const { validateActiveCodes } = require('./activeCodeValidator');
const { claimIdempotencyKey, recordIdempotentResult } = require('./idempotency');
const { quarantineRecord } = require('./quarantine');

async function ingestRecord({
  db,
  entityType,
  schemaId = null,
  aliasMap = {},
  payload,
  provenance,
  idempotencyKey = null,
  references = [],
  referenceCodes = [],
  entityValidator = null,
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
  const contractResult = validateIngestionPayload({ schemaId, payload, aliasMap });
  const referenceResult = await assertReferencesExist(db, references);
  const codeResult = await validateActiveCodes(db, referenceCodes);
  const entityViolations = entityValidator ? entityValidator(payload) : [];

  const violations = [
    ...provenanceResult.violations,
    ...contractResult.violations,
    ...referenceResult.violations,
    ...codeResult.violations,
    ...entityViolations,
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
