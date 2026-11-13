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
const { DICTIONARY_VERSION } = require('../reference-data/canonical-dictionary/v2');
const LabelIdentifierModel = require('../models/LabelIdentifier');
const { policiesInForce } = require('../models/AccessPolicy');
const { Neo4jOutboxService } = require('../services/neo4jOutbox.service');
const { resolveClockDriftLimitMs } = require('../services/clockDriftLimit');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const { ingestRecord } = require('./ingestionGateway');
const { buildProvenanceEnvelope } = require('./provenanceEnvelope');
const { resolveIngestionTarget, resolveOtherStoreEntityType } = require('./ingestionTargets');
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

// What an other-store refusal states of the entity, per store.
const STORE_PHRASES = Object.freeze({
  influxdb: 'é armazenado no InfluxDB',
  objectStorage: 'tem seu binário no Object Storage',
});

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

// A bad missingness declaration (RF029 AC7) or an unresolved reference
// (RF029 AC3) quarantines through the gateway as any other violation.
function entityValidatorFor(target, declared, referenceViolations = []) {
  return (payload) => {
    const data = payload && typeof payload === 'object' ? payload : {};
    return [
      ...target.model.validate(data).errors.map((message) => ({
        code: 'ENTITY_VALIDATION_FAILED',
        field: null,
        message,
      })),
      ...validateMissingDataReasons(target, data, declared),
      ...referenceViolations,
    ];
  };
}

// #1182: a target with a scopeField is written only on positive evidence, a
// global scope or an organization scope naming the field's value exactly.
// Every other input refuses, and the value is never restamped to the
// caller's organization as the master mount does: ingestion refuses rather
// than correct (RF029 AC3). A target with organizationField stamps its
// tenancy from the value, so it needs one even from a global caller.
async function assertInOrganizationScope(target, payload, resolveOrganizationScope) {
  if (!target.scopeField) return;
  const scope = typeof resolveOrganizationScope === 'function' ? await resolveOrganizationScope() : null;
  const value = payload && typeof payload === 'object' ? payload[target.scopeField] : undefined;
  const stampable = !target.organizationField || (typeof value === 'string' && value !== '');
  const inScope = (scope?.scope === 'global' && stampable)
    || (scope?.scope === 'organization'
      && typeof value === 'string'
      && Array.isArray(scope.organizationIds)
      && scope.organizationIds.includes(value));
  if (!inScope) {
    throw ingestionError(403, 'INGESTION_OUT_OF_SCOPE', `${target.scopeField} fora do escopo de organização do usuário`);
  }
}

// RF029 AC4: a target with otherStore refuses a record whose field names a
// value stored outside MongoDB, so it never lands in the wrong store. Any
// other value, absent or unknown included, goes on to the model and schema.
function assertStoredHere(target, entityType, payload) {
  const { otherStore } = target;
  if (!otherStore || !payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const value = payload[otherStore.field];
  if (typeof value === 'string' && otherStore.values.includes(value)) {
    throw ingestionError(422, 'INGESTION_STORE_UNSUPPORTED', `${entityType} com ${otherStore.field} ${value} é armazenado em Object Storage, não suportado pela ingestão`);
  }
}

// RF029 AC4, #575: a target with identityFields refuses a record holding any
// of them, whatever its value, because civil identity lives on
// ParticipantIdentity alone and a quarantine would store it as sent. The
// refusal names the fields, never their values.
function assertNoIdentityFields(target, entityType, payload) {
  const { identityFields } = target;
  if (!identityFields || !payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const present = identityFields.filter((field) => Object.prototype.hasOwnProperty.call(payload, field));
  if (present.length > 0) {
    throw ingestionError(422, 'INGESTION_STORE_UNSUPPORTED', `${entityType} com ${present.join(', ')}: identidade civil é armazenada em ParticipantIdentity, não suportado pela ingestão`);
  }
}

// RULE-012 (#1318): a target with labelFields refuses a record whose label
// value the LabelIdentifier model refuses (whitespace, an e-mail or a CPF),
// before the gateway, because a quarantine would store it as sent. The
// refusal names the kind, never the value.
function assertNoPersonalDataInLabels(target, entityType, payload) {
  const { labelFields } = target;
  if (!labelFields || !payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  for (const field of labelFields) {
    const value = payload[field];
    if (typeof value !== 'string' || value === '') continue;
    try {
      LabelIdentifierModel.assertNoPersonalData(value);
    } catch (error) {
      throw ingestionError(422, 'BARCODE_PERSONAL_DATA', `${entityType} com ${field}: ${error.message}, não suportado pela ingestão`);
    }
  }
}

// The status codes the master mount's reference check throws (#664, RF019).
const REFERENCE_VIOLATION_CODES = { 404: 'REFERENCE_NOT_FOUND', 409: 'REFERENCE_NOT_USABLE' };

// RF029 AC3: a target with validateReferences runs its master mount's check
// on a clone of a model-valid payload. A resolved check yields the clone,
// with the canonical ids the check writes back (#1219), as the create input;
// a 404 or 409 becomes a violation, so the original payload quarantines, under
// the check's own violationCode where it names one (Specimen's
// CONSENT_NOT_ACTIVE). Any other error is a failure, not a verdict, and
// rethrows.
async function checkReferences(db, target, payload) {
  const unchecked = { input: payload, violations: [] };
  if (!target.validateReferences) return unchecked;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return unchecked;
  if (!target.model.validate(payload).isValid) return unchecked;
  const resolved = structuredClone(payload);
  try {
    await target.validateReferences(db, resolved);
    return { input: resolved, violations: [] };
  } catch (error) {
    const statusViolation = REFERENCE_VIOLATION_CODES[error?.statusCode];
    if (!statusViolation) throw error;
    const code = typeof error.violationCode === 'string' && error.violationCode !== '' ? error.violationCode : statusViolation;
    return { input: payload, violations: [{ code, field: null, message: error.message }] };
  }
}

// RF029 AC2 (#1523): each AccessPolicy the provenance names (ELM-0022) is
// accepted only on positive evidence, the highest version in force naming the
// exact entityType in applicableEntityTypes; an unknown id, a policy out of
// force or one not applicable quarantines. A read error is a failure, not a
// verdict, and throws.
async function checkAccessPolicies(db, entityType, provenance) {
  const ids = buildProvenanceEnvelope(provenance).accessPolicyId;
  if (ids.length === 0) return [];
  const rows = await db.collection(CANONICAL_COLLECTIONS.accessPolicies).find({ accessPolicyId: { $in: ids } }).toArray();
  const inForce = policiesInForce(rows, new Date());
  const violations = [];
  for (const id of ids) {
    const policies = inForce.filter((policy) => policy.accessPolicyId === id);
    const applicable = policies.some((policy) => Array.isArray(policy.applicableEntityTypes) && policy.applicableEntityTypes.includes(entityType));
    if (!applicable) violations.push({
      code: 'ACCESS_POLICY_NOT_APPLICABLE',
      field: 'provenance.accessPolicyId',
      message: `AccessPolicy ${id} inexistente, fora de vigência ou não aplicável a ${entityType}`,
    });
  }
  return violations;
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
  resolveOrganizationScope = null,
}) {
  const target = resolveIngestionTarget(entityType);
  const otherStore = target ? null : resolveOtherStoreEntityType(entityType);
  if (!target && !otherStore) {
    throw ingestionError(422, 'INGESTION_TARGET_UNSUPPORTED', `entityType não suportado pela ingestão: ${String(entityType)}`);
  }

  const canonicalModelReleaseId = await assertCanonicalReleaseActive(db);
  const configurationReleaseId = await activeConfigurationReleaseId(db);
  // RNF025 AC6 (#1520): the clock-drift limit the timeliness metric reads.
  const clockDriftLimitMs = await resolveClockDriftLimitMs(db);
  const releases = { canonicalModelReleaseId, configurationReleaseId };

  try {
    // RF029 AC4: an entity stored elsewhere is refused by name, reading
    // neither payload nor key and writing nothing, so none of its fields
    // reaches MongoDB.
    if (otherStore) {
      throw ingestionError(422, 'INGESTION_STORE_UNSUPPORTED', `${entityType} ${STORE_PHRASES[otherStore.store]}, não suportado pela ingestão; registre ${otherStore.record} por ${otherStore.route}`);
    }
    return await ingestUnderRelease({ db, target, entityType, payload, provenance, idempotencyKey, missingDataReasons, actorId, outbox, releases, clockDriftLimitMs, resolveOrganizationScope });
  } catch (error) {
    // CFG-004: a refusal after the releases were read still names them.
    if (error && typeof error === 'object') {
      error.canonicalModelReleaseId = error.canonicalModelReleaseId ?? canonicalModelReleaseId;
      error.configurationReleaseId = error.configurationReleaseId ?? configurationReleaseId;
    }
    throw error;
  }
}

async function ingestUnderRelease({ db, target, entityType, payload, provenance, idempotencyKey, missingDataReasons, actorId, outbox, releases, clockDriftLimitMs, resolveOrganizationScope }) {
  // Before the replay, so an out-of-scope caller learns nothing of a key.
  await assertInOrganizationScope(target, payload, resolveOrganizationScope);
  assertStoredHere(target, entityType, payload);
  assertNoIdentityFields(target, entityType, payload);
  assertNoPersonalDataInLabels(target, entityType, payload);

  const scope = { idempotencyKey, scope: entityType };
  if (idempotencyKey) {
    const entry = await findCompletedIdempotentEntry(db, scope);
    if (entry) return replayOf(db, entityType, entry, releases);
  }

  // No aliasMap, references or referenceCodes from the client: a
  // client-named collection is the #675 hazard. The gateway's own claim is
  // bypassed (idempotencyKey: null) because it claims before the write, and a
  // failed write would leave a claimed key with no record.
  const references = await checkReferences(db, target, payload);
  const policyViolations = await checkAccessPolicies(db, entityType, provenance);
  const outcome = await ingestRecord({
    db,
    entityType,
    schemaId: target.schemaId,
    payload,
    provenance: { ...(provenance && typeof provenance === 'object' ? provenance : {}), createdBy: `Actor/${actorId}` },
    idempotencyKey: null,
    entityValidator: entityValidatorFor(target, missingDataReasons, [...references.violations, ...policyViolations]),
    missingDataReasons,
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
      clockDriftLimitMs,
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
  // #896 settled, or the target's own format (Specimen's 7-digit
  // specimenId, Participant's 8-digit participantId). Unlike master-data POST, which keeps a body id, a body id
  // is ignored here; the client's own key travels as provenance.sourceRecordId.
  const entityId = target.generateId ? await target.generateId(db) : randomUUID();
  const doc = target.model.create({ ...references.input, [target.idField]: entityId });
  // #1192: the tenancy key is stamped by the server, from the scopeField
  // value assertInOrganizationScope proved in the caller's scope.
  if (target.organizationField) doc[target.organizationField] = payload[target.scopeField];
  // BaseRecord provenance (ELM-0010/0011/0013) and the releases in force.
  doc.sourceSystem = outcome.provenance.sourceSystem;
  doc.sourceRecordId = outcome.provenance.sourceRecordId;
  // ELM-0022 (RF029 AC2, #1523): the verified policies; none named, no key.
  if (outcome.provenance.accessPolicyId.length > 0) doc.accessPolicyId = [...outcome.provenance.accessPolicyId];
  doc.retrievedAt = outcome.provenance.retrievedAt;
  doc.canonicalModelReleaseId = releases.canonicalModelReleaseId;
  // ELM-0004, RNF023 AC1: the schema version that validated the document.
  // INFERENCE, not a citation: the release in force is release-<dictionary
  // version> (readiness.js), so the schema version is DICTIONARY_VERSION;
  // the server value overrides any payload value, as the release id does.
  doc.schemaVersion = DICTIONARY_VERSION;
  doc.configurationReleaseId = releases.configurationReleaseId;
  // INFERENCE, not a citation: createdBy (ELM-0007) is the ator, per
  // provenanceEnvelope.js's header, so the server's Actor/<id> overrides any
  // payload value (WorkflowRun's schema requires the client to send one).
  doc.createdBy = outcome.provenance.createdBy;
  // A target's own preparation of the stamped document before its write,
  // outside the transaction (Consent stores its evidence and builds its
  // permission rows), from the stamped document and the create input; what
  // it answers goes to appendProjection and appendAfterAccept.
  const prepared = target.prepareDocument ? await target.prepareDocument(db, doc, references.input) : undefined;
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
    clockDriftLimitMs,
  });
  const dataQualityAssessmentId = assessment.dataQualityAssessmentId;

  const key = idempotencyKey ? { ...scope, resultRef: entityId, outcome: 'accepted' } : null;
  if (key) await ensureIdempotencyKeyIndex(db);

  try {
    return await withTransactionWhereSupported(db, async (session) => {
      const opts = session ? { session } : {};
      const persist = async () => {
        const inserted = await db.collection(target.collection).insertOne(doc, opts);
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
        // The target's own rows and graph events, in the same transaction
        // (#1313): Specimen's SPECIMEN_UPSERTED and LINEAGE_REGISTERED,
        // Consent's permissions, decision event and CONSENT_UPSERTED.
        const projectionEventIds = target.appendProjection
          ? await target.appendProjection(db, { doc, insertedId: inserted?.insertedId, outbox, prepared }, opts)
          : [];
        // In the document's transaction (RF029 AC6), one call per row.
        for (const row of reasons) {
          await reasonsCollection.insertOne(eventId ? { ...row, sourceEventId: eventId } : row, opts);
        }
        // RNF011 C3, in the same transaction (RF029 AC6).
        await insertDataQualityAssessment(db, assessment, opts);
        return { eventId, projectionEventIds, insertedId: inserted?.insertedId };
      };
      // A target's own writes to another record, made only once this record
      // has won its key, so a lost race never touches them (Consent
      // supersedes the consent in force the record names).
      const appendAfterAccept = async ({ insertedId }, afterOpts) => {
        if (target.appendAfterAccept) await target.appendAfterAccept(db, { doc, insertedId, prepared }, afterOpts);
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
        const persisted = await persist();
        await appendAfterAccept(persisted, opts);
        return accepted(persisted.eventId);
      }

      // Without a transaction the key is recorded last, so a failed insert
      // leaves no completed key pointing at nothing (idempotency.js's
      // findCompletedIdempotentResult: a key is recorded once its result exists).
      const persisted = await persist();
      const { eventId: outboxEventId, projectionEventIds } = persisted;
      if (key) {
        const ref = await recordCompletedIdempotentResult(db, key);
        if (ref !== entityId) {
          // A concurrent request with this key recorded first: this
          // request's document, events, the target's own rows,
          // MissingDataReason rows and DataQualityAssessment are a duplicate
          // of the winner's, so they are removed before the winner's result
          // is replayed.
          await db.collection(target.collection).deleteOne({ [target.idField]: entityId });
          if (outboxEventId) await outbox.getCollection(db).deleteOne({ eventId: outboxEventId });
          for (const projectionEventId of projectionEventIds) {
            await outbox.getCollection(db).deleteOne({ eventId: projectionEventId });
          }
          if (target.removeProjection) await target.removeProjection(db, { entityId });
          await reasonsCollection.deleteMany({ entityType, entityId });
          await db.collection(CANONICAL_COLLECTIONS.dataQualityAssessments).deleteOne({ dataQualityAssessmentId });
          return replayOf(db, entityType, await findCompletedIdempotentEntry(db, scope), releases);
        }
      }
      await appendAfterAccept(persisted, {});
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
