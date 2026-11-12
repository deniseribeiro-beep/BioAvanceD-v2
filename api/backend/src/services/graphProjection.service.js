const crypto = require('crypto');
const { Neo4jOutboxService } = require('./neo4jOutbox.service');
const logger = require('../utils/logger');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');

function stableHash(payload) {
  const safePayload = payload || {};
  const ordered = JSON.stringify(safePayload, Object.keys(safePayload).sort());
  return crypto.createHash('sha256').update(ordered).digest('hex');
}

// #1313 (RF023 AC3): each append takes `options.session`, the aggregate
// write's transaction, and the outbox appends the event inside it.
class GraphProjectionService {
  constructor(options = {}) {
    this.outbox = options.outbox || new Neo4jOutboxService();
  }

  async appendConsentEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: payload.status === 'REVOKED' ? 'CONSENT_REVOKED' : 'CONSENT_UPSERTED',
      aggregateType: 'EthicalConsent',
      aggregateId: String(payload.ethicalConsentId || payload.consentId || payload.aggregateId || ''),
      payload: {
        participantId: payload.participantId,
        specimenId: payload.specimenId || null,
        ethicalConsentId: payload.ethicalConsentId || payload.consentId || null,
        status: payload.status || 'ACTIVE',
        signedAt: payload.signedAt || new Date(),
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 1,
    }, options);
  }

  // #1225: the sample's own projection event. It carries the donor, so the
  // projector can write Donor-[:DONATED]->Sample and govern the sample by the
  // donor's consents. specimenId is the Mongo _id, the key the lineage gate
  // reads.
  async appendSpecimenEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'SPECIMEN_UPSERTED',
      aggregateType: 'Sample',
      aggregateId: String(payload.specimenId || ''),
      payload: {
        specimenId: payload.specimenId ? String(payload.specimenId) : null,
        participantId: payload.participantId ? String(payload.participantId) : null,
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 1,
    }, options);
  }

  async appendLineageEvent(db, payload, options = {}) {
    const specimenId = payload.specimenId || payload.childSpecimenId;
    return this.outbox.appendEvent(db, {
      eventType: 'LINEAGE_REGISTERED',
      aggregateType: 'Sample',
      aggregateId: String(specimenId || payload.aggregateId || ''),
      payload: {
        specimenId: specimenId ? String(specimenId) : null,
        parentSpecimenId: payload.parentSpecimenId ? String(payload.parentSpecimenId) : null,
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 1,
    }, options);
  }

  // #1368: a derived sample's DERIVED_FROM edges, one LINEAGE_REGISTERED per
  // parent (the parents' Mongo _id), in order and inside the caller's session.
  async appendLineageEvents(db, { specimenId, parentSpecimenIds, sourceService }, options = {}) {
    const results = [];
    for (const parentSpecimenId of parentSpecimenIds || []) {
      results.push(await this.appendLineageEvent(db, { specimenId, parentSpecimenId, sourceService }, options));
    }
    return results;
  }

  async appendQualityEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'QUALITY_ASSESSED',
      aggregateType: 'Sample',
      aggregateId: String(payload.specimenId || payload.aggregateId || ''),
      payload: {
        specimenId: payload.specimenId || null,
        qualityAssessmentId: payload.qualityAssessmentId || null,
        status: payload.status || 'UNKNOWN',
        score: payload.score ?? null,
        evaluatedAt: payload.evaluatedAt || new Date(),
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 1,
    }, options);
  }

  async appendTelemetryEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'TELEMETRY_INCIDENT_RECORDED',
      aggregateType: 'Sample',
      aggregateId: String(payload.specimenId || payload.aggregateId || ''),
      payload: {
        specimenId: payload.specimenId || null,
        telemetryIncidentId: payload.telemetryIncidentId || null,
        severity: payload.severity || 'UNKNOWN',
        status: payload.status || 'OPEN',
        occurredAt: payload.occurredAt || new Date(),
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 1,
    }, options);
  }

  // #1312 (RF023 AC8): a sample's current storage position, written by
  // storageService's allocation. Projected as the canonical
  // Sample-[:STORED_AT]->StoragePosition {boxId, position}.
  async appendStoragePositionEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'STORAGE_POSITION_ASSIGNED',
      aggregateType: 'Sample',
      aggregateId: String(payload.specimenId || ''),
      payload: {
        specimenId: payload.specimenId ? String(payload.specimenId) : null,
        boxId: payload.boxId ? String(payload.boxId) : null,
        position: payload.position || null,
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 1,
    }, options);
  }

  // #1312 (RF023 AC8): a chain-of-custody step (register, allocate, move,
  // release), appended by the custody use cases inside their own Mongo
  // transaction where they run one. Projected as
  // Sample-[:HAS_CUSTODY_EVENT]->CustodyEvent, with -[:FROM]-> and -[:TO]->
  // StoragePosition where the step has them. The outbox eventId is the
  // CustodyEvent id.
  async appendCustodyEvent(db, payload, options = {}) {
    const location = (value) => (value?.boxId && value?.position
      ? { boxId: String(value.boxId), position: String(value.position).toUpperCase() }
      : null);
    const happenedAt = payload.happenedAt ? new Date(payload.happenedAt) : new Date();
    return this.outbox.appendEvent(db, {
      eventType: 'CUSTODY_EVENT_RECORDED',
      aggregateType: 'Sample',
      aggregateId: String(payload.specimenId || ''),
      payload: {
        specimenId: payload.specimenId ? String(payload.specimenId) : null,
        barcode: payload.barcode ? String(payload.barcode) : null,
        custodyEventType: payload.eventType ? String(payload.eventType) : null,
        happenedAt: Number.isNaN(happenedAt.getTime()) ? new Date().toISOString() : happenedAt.toISOString(),
        actorId: payload.actorId ? String(payload.actorId) : null,
        reason: payload.reason ? String(payload.reason) : null,
        from: location(payload.from),
        to: location(payload.to),
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 1,
    }, options);
  }

  // #1312 (RF023 AC8/AC9, RNF019 C8): a sustained freezer excursion marks the
  // root sample and its descendants COMPROMISED. The event carries the
  // excursion (freezer and start), never a temperature reading.
  async appendSpecimenCompromiseEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'SPECIMEN_COMPROMISED',
      aggregateType: 'Sample',
      aggregateId: String(payload.specimenId || ''),
      payload: {
        specimenId: payload.specimenId ? String(payload.specimenId) : null,
        freezerKey: payload.freezerKey ? String(payload.freezerKey) : null,
        breachedSince: payload.breachedSince || null,
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 1,
    }, options);
  }

  // #1510 (RF019 AC6): "Auditar a decisão e emitir outbox quando houver
  // projeção permitida". QuarantineAction has a derived Neo4j projection via
  // the transactional outbox (dict-ENTIDADES.md); an explicit release appends
  // this event in the action's write. The payload carries ids, rule codes and
  // the actor, no civil field.
  async appendQuarantineReleaseEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'QUARANTINE_RELEASED',
      aggregateType: 'QuarantineAction',
      aggregateId: String(payload.quarantineActionId || ''),
      payload: {
        quarantineActionId: payload.quarantineActionId ? String(payload.quarantineActionId) : null,
        specimenIds: (payload.specimenIds || []).map(String),
        reasonCodes: payload.reasonCodes || [],
        actionStatus: payload.actionStatus || 'released',
        releasedAt: payload.releasedAt || null,
        authorizedBy: payload.authorizedBy ? String(payload.authorizedBy) : null,
        evidenceIds: payload.evidenceIds || [],
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 1,
    }, options);
  }

  // RF028 AC9: "Persistir primeiro no MongoDB e projetar no Neo4j
  // exclusivamente pelo outbox" — appended by referenceRelease.service.js's
  // promoteRelease on the same write that inserts a TerminologyConcept, same
  // outbox pattern RF023 uses for consent/lineage/quality/telemetry.
  async appendTerminologyConceptEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'TERMINOLOGY_CONCEPT_PROMOTED',
      aggregateType: 'TerminologyConcept',
      aggregateId: String(payload.terminologyConceptId || payload.aggregateId || ''),
      payload: {
        terminologyConceptId: payload.terminologyConceptId || null,
        systemUri: payload.systemUri || null,
        code: payload.code || null,
        version: payload.version || null,
        display: payload.display || null,
        conceptStatus: payload.conceptStatus || 'active',
        referenceDatasetReleaseId: payload.referenceDatasetReleaseId || null,
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 1,
    }, options);
  }

  async appendTerminologyRelationEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'TERMINOLOGY_RELATION_PROMOTED',
      aggregateType: 'TerminologyRelation',
      aggregateId: String(payload.terminologyRelationId || payload.aggregateId || ''),
      payload: {
        terminologyRelationId: payload.terminologyRelationId || null,
        sourceConceptId: payload.sourceConceptId || null,
        targetConceptId: payload.targetConceptId || null,
        relationType: payload.relationType || null,
        relationVersion: payload.relationVersion || null,
        referenceDatasetReleaseId: payload.referenceDatasetReleaseId || null,
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 1,
    }, options);
  }
}

// #1225: called right after a sample's Mongo insert. Logged, not thrown: the
// sample is already committed, so failing the request would report a failure
// for a write that happened. scripts/neo4j-canonical-rebuild.js re-emits the
// event for every sample, which is the recovery path.
async function recordSpecimenProjection(db, { specimenId, participantId, sourceService }, service = new GraphProjectionService()) {
  if (!db || !specimenId) return null;
  try {
    return await service.appendSpecimenEvent(db, { specimenId, participantId, sourceService });
  } catch (error) {
    logger.error(`[NEO4J_OUTBOX] SPECIMEN_UPSERTED nao registrado para ${specimenId}: ${error.message || error}`);
    return null;
  }
}

// #1368: the lineage twin of recordSpecimenProjection, for a write without a
// transaction. Each parent is appended on its own and a failure is logged,
// so one lost edge neither fails the committed sample nor drops the others.
async function recordLineageProjection(db, { specimenId, parentSpecimenIds, sourceService }, service = new GraphProjectionService()) {
  if (!db || !specimenId) return;
  for (const parentSpecimenId of parentSpecimenIds || []) {
    try {
      await service.appendLineageEvent(db, { specimenId, parentSpecimenId, sourceService });
    } catch (error) {
      logger.error(`[NEO4J_OUTBOX] LINEAGE_REGISTERED nao registrado para ${specimenId} <- ${parentSpecimenId}: ${error.message || error}`);
    }
  }
}

// #1313 (RF023 AC3): inserts a sample and appends its SPECIMEN_UPSERTED in one
// transaction where the deployment runs one, so neither lands without the
// other and a failed append fails the insert. Without a transaction it is
// the insert followed by recordSpecimenProjection, as before.
async function insertSampleWithProjection(db, samplesCollection, sample, { sourceService }, service = new GraphProjectionService()) {
  return withTransactionWhereSupported(db, async (session) => {
    if (!session) {
      const insertResult = await samplesCollection.insertOne(sample);
      await recordSpecimenProjection(db, {
        specimenId: String(insertResult.insertedId),
        participantId: sample.participantId,
        sourceService,
      }, service);
      return insertResult;
    }
    const insertResult = await samplesCollection.insertOne(sample, { session });
    await service.appendSpecimenEvent(db, {
      specimenId: String(insertResult.insertedId),
      participantId: sample.participantId,
      sourceService,
    }, { session });
    return insertResult;
  });
}

module.exports = {
  GraphProjectionService,
  insertSampleWithProjection,
  recordLineageProjection,
  recordSpecimenProjection,
  stableHash,
};
