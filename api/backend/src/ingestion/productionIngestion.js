/**
 * RF029 (#1318): the production ingestion path. Validates a record through
 * the gateway (ingestionGateway.js) against the CanonicalModelRelease in
 * force, and persists an accepted one into its store with its
 * INGESTION_RECORD_PERSISTED outbox event in the same transaction where the
 * deployment runs one (RF029 AC6), the shape graphProjection.service.js's
 * insertSampleWithProjection follows (#1313). Every outcome carries the
 * canonicalModelReleaseId and the configurationReleaseId (CFG-004). Auditing
 * is the route's (interface/routes/ingestion.routes.js), as the gateway's
 * header sets out.
 */
const { randomUUID } = require('crypto');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { CANONICAL_MODEL_RELEASE_ID } = require('../foundation/readiness');
const { Neo4jOutboxService } = require('../services/neo4jOutbox.service');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const { ingestRecord } = require('./ingestionGateway');
const { resolveIngestionTarget } = require('./ingestionTargets');
const { validateMissingDataReasons, buildMissingDataReasons } = require('./missingness');
const { assessIngestedRecord, findSourceDuplicate, insertDataQualityAssessment } = require('./dataQualityAssessment');
const {
  ensureIdempotencyKeyIndex,
  findCompletedIdempotentEntry,
  recordCompletedIdempotentResult,
} = require('./idempotency');

function ingestionError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = [message];
  return error;
}

// CFG-004, read as accessRequest.service.js's activeConfigurationReleaseId
// reads it: null before any release exists.
async function activeConfigurationReleaseId(db) {
  const config = await db.collection('security_config').findOne({ _id: 'main' });
  return config?.configurationReleaseId || null;
}

// RF029 AC1 validates against the release in force, so a release that is
// absent or not active fails the ingestion closed.
async function assertCanonicalReleaseActive(db) {
  const release = await db.collection(CANONICAL_COLLECTIONS.canonicalModelReleases)
    .findOne({ canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID });
  if (!release || release.releaseStatus !== 'active') {
    throw ingestionError(
      503,
      'CANONICAL_RELEASE_NOT_ACTIVE',
      `CanonicalModelRelease ${CANONICAL_MODEL_RELEASE_ID} não está ativa`,
    );
  }
  return CANONICAL_MODEL_RELEASE_ID;
}

// A bad missingness declaration (RF029 AC7) quarantines through the gateway
// as any other violation.
function entityValidatorFor(target, declared) {
  return (payload) => {
    const data = payload && typeof payload === 'object' ? payload : {};
    return [
      ...target.model.validate(data).errors.map((message) => ({
        code: 'ENTITY_VALIDATION_FAILED',
        field: null,
        message,
      })),
      ...validateMissingDataReasons(target, data, declared),
    ];
  };
}

// A replay reports the first call's outcome: a quarantine answers again as
// a quarantine, with its record's violations. A key recorded without an
// outcome replays bare.
async function replayOf(db, entityType, entry, releases, opts = {}) {
  const base = { status: 'idempotent_replay', outcome: entry.outcome, entityType, resultRef: entry.resultRef, ...releases };
  if (entry.outcome !== 'quarantined') return base;
  const record = await db.collection(CANONICAL_COLLECTIONS.ingestionQuarantineRecords)
    .findOne({ ingestionQuarantineRecordId: entry.resultRef }, opts);
  return { ...base, ingestionQuarantineRecordId: entry.resultRef, violations: record?.violations || [] };
}

async function ingestAndPersist({
  db,
  entityType,
  payload,
  provenance,
  idempotencyKey = null,
  missingDataReasons = undefined,
  actorId,
  outbox = new Neo4jOutboxService(),
}) {
  const target = resolveIngestionTarget(entityType);
  if (!target) {
    throw ingestionError(422, 'INGESTION_TARGET_UNSUPPORTED', `entityType não suportado pela ingestão: ${String(entityType)}`);
  }

  const canonicalModelReleaseId = await assertCanonicalReleaseActive(db);
  const configurationReleaseId = await activeConfigurationReleaseId(db);
  const releases = { canonicalModelReleaseId, configurationReleaseId };

  try {
    return await ingestUnderRelease({ db, target, entityType, payload, provenance, idempotencyKey, missingDataReasons, actorId, outbox, releases });
  } catch (error) {
    // CFG-004: a refusal after the releases were read still names them.
    if (error && typeof error === 'object') {
      error.canonicalModelReleaseId = error.canonicalModelReleaseId ?? canonicalModelReleaseId;
      error.configurationReleaseId = error.configurationReleaseId ?? configurationReleaseId;
    }
    throw error;
  }
}

async function ingestUnderRelease({ db, target, entityType, payload, provenance, idempotencyKey, missingDataReasons, actorId, outbox, releases }) {
  const scope = { idempotencyKey, scope: entityType };
  if (idempotencyKey) {
    const entry = await findCompletedIdempotentEntry(db, scope);
    if (entry) return replayOf(db, entityType, entry, releases);
  }

  // No aliasMap, references or referenceCodes from the client: a
  // client-named collection is the #675 hazard. The gateway's own claim is
  // bypassed (idempotencyKey: null) because it claims before the write, and a
  // failed write would leave a claimed key with no record.
  const outcome = await ingestRecord({
    db,
    entityType,
    schemaId: target.schemaId,
    payload,
    provenance: { ...(provenance && typeof provenance === 'object' ? provenance : {}), createdBy: `Actor/${actorId}` },
    idempotencyKey: null,
    entityValidator: entityValidatorFor(target, missingDataReasons),
  });

  if (outcome.status === 'quarantined') {
    const ingestionQuarantineRecordId = outcome.quarantineRecord.ingestionQuarantineRecordId;
    if (idempotencyKey) {
      const ref = await recordCompletedIdempotentResult(db, { ...scope, resultRef: ingestionQuarantineRecordId, outcome: 'quarantined' });
      if (ref !== ingestionQuarantineRecordId) return replayOf(db, entityType, await findCompletedIdempotentEntry(db, scope), releases);
    }
    // RNF011 C3: a quarantined record is assessed too; only this request's
    // own record, never a lost race's.
    const envelope = outcome.quarantineRecord.provenance;
    const assessment = assessIngestedRecord({
      target,
      entityType,
      payload,
      violations: outcome.violations,
      envelope,
      duplicateFound: await findSourceDuplicate(db, target, envelope),
      scopeId: `IngestionQuarantineRecord/${ingestionQuarantineRecordId}`,
      releases,
      actorId,
    });
    await insertDataQualityAssessment(db, assessment);
    return {
      status: 'quarantined',
      entityType,
      violations: outcome.violations,
      ingestionQuarantineRecordId,
      dataQualityAssessmentId: assessment.dataQualityAssessmentId,
      ...releases,
    };
  }

  // RNF011 C3: read before the document exists, so the record never finds itself.
  const duplicateFound = await findSourceDuplicate(db, target, outcome.provenance);

  // INFERENCE, not a citation: the server always assigns the id, a uuid as
  // #896 settled. Unlike master-data POST, which keeps a body id, a body id
  // is ignored here; the client's own key travels as provenance.sourceRecordId.
  const entityId = randomUUID();
  const doc = target.model.create({ ...payload, [target.idField]: entityId });
  // BaseRecord provenance (ELM-0010/0011/0013) and the releases in force.
  doc.sourceSystem = outcome.provenance.sourceSystem;
  doc.sourceRecordId = outcome.provenance.sourceRecordId;
  doc.retrievedAt = outcome.provenance.retrievedAt;
  doc.canonicalModelReleaseId = releases.canonicalModelReleaseId;
  doc.configurationReleaseId = releases.configurationReleaseId;
  // INFERENCE, not a citation: createdBy (ELM-0007) is the ator, per
  // provenanceEnvelope.js's header, so the server's Actor/<id> overrides any
  // payload value (WorkflowRun's schema requires the client to send one).
  doc.createdBy = outcome.provenance.createdBy;
  // RF029 AC7: one MissingDataReason per absent missingness field, read off
  // the stored document, so an absence is recorded and never written as 0.
  const reasons = buildMissingDataReasons({
    target,
    entityType,
    entityId,
    doc,
    declared: missingDataReasons,
    releases,
    recordedAt: new Date(),
  });
  const reasonsCollection = db.collection(CANONICAL_COLLECTIONS.missingDataReasons);
  const assessment = assessIngestedRecord({
    target,
    entityType,
    payload,
    violations: outcome.violations,
    envelope: outcome.provenance,
    duplicateFound,
    scopeId: `${entityType}/${entityId}`,
    releases,
    actorId,
  });
  const dataQualityAssessmentId = assessment.dataQualityAssessmentId;

  const key = idempotencyKey ? { ...scope, resultRef: entityId, outcome: 'accepted' } : null;
  if (key) await ensureIdempotencyKeyIndex(db);

  try {
    return await withTransactionWhereSupported(db, async (session) => {
      const opts = session ? { session } : {};
      const persist = async () => {
        await db.collection(target.collection).insertOne(doc, opts);
        // Ids only: no PII and no raw payload (RF029 AC6).
        const event = await outbox.appendEvent(db, {
          eventType: 'INGESTION_RECORD_PERSISTED',
          aggregateType: entityType,
          aggregateId: entityId,
          canonicalModelReleaseId: releases.canonicalModelReleaseId,
          payload: { entityType, entityId, configurationReleaseId: releases.configurationReleaseId },
          sourceService: 'ingestion-gateway',
          schemaVersion: 1,
        }, opts);
        const eventId = event?.eventId || null;
        // In the document's transaction (RF029 AC6), one call per row.
        for (const row of reasons) {
          await reasonsCollection.insertOne(eventId ? { ...row, sourceEventId: eventId } : row, opts);
        }
        // RNF011 C3, in the same transaction (RF029 AC6).
        await insertDataQualityAssessment(db, assessment, opts);
        return eventId;
      };
      const accepted = (outboxEventId) => ({
        status: 'accepted',
        entityType,
        entityId,
        outboxEventId,
        missingDataReasons: reasons.map(({ missingDataReasonId, fieldPath, reasonCode }) => ({ missingDataReasonId, fieldPath, reasonCode })),
        dataQualityAssessmentId,
        ...releases,
      });

      if (session) {
        if (key) {
          const ref = await recordCompletedIdempotentResult(db, key, opts);
          if (ref !== entityId) return replayOf(db, entityType, await findCompletedIdempotentEntry(db, scope, opts), releases, opts);
        }
        return accepted(await persist());
      }

      // Without a transaction the key is recorded last, so a failed insert
      // leaves no completed key pointing at nothing (idempotency.js's
      // findCompletedIdempotentResult: a key is recorded once its result exists).
      const outboxEventId = await persist();
      if (key) {
        const ref = await recordCompletedIdempotentResult(db, key);
        if (ref !== entityId) {
          // A concurrent request with this key recorded first: this
          // request's document, event, MissingDataReason rows and
          // DataQualityAssessment are a duplicate of the winner's, so they
          // are removed before the winner's result is replayed.
          await db.collection(target.collection).deleteOne({ [target.idField]: entityId });
          if (outboxEventId) await outbox.getCollection(db).deleteOne({ eventId: outboxEventId });
          await reasonsCollection.deleteMany({ entityType, entityId });
          await db.collection(CANONICAL_COLLECTIONS.dataQualityAssessments).deleteOne({ dataQualityAssessmentId });
          return replayOf(db, entityType, await findCompletedIdempotentEntry(db, scope), releases);
        }
      }
      return accepted(outboxEventId);
    });
  } catch (error) {
    if (key && error?.code === 11000) {
      const entry = await findCompletedIdempotentEntry(db, scope);
      if (entry) return replayOf(db, entityType, entry, releases);
    }
    throw error;
  }
}

module.exports = { ingestAndPersist };
