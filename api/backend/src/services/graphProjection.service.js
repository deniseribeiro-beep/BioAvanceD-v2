const crypto = require('crypto');
const { Neo4jOutboxService } = require('./neo4jOutbox.service');

function stableHash(payload) {
  const safePayload = payload || {};
  const ordered = JSON.stringify(safePayload, Object.keys(safePayload).sort());
  return crypto.createHash('sha256').update(ordered).digest('hex');
}

class GraphProjectionService {
  constructor(options = {}) {
    this.outbox = options.outbox || new Neo4jOutboxService();
  }

  async appendConsentEvent(db, payload) {
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
    });
  }

  async appendLineageEvent(db, payload) {
    return this.outbox.appendEvent(db, {
      eventType: 'LINEAGE_REGISTERED',
      aggregateType: 'Sample',
      aggregateId: String(payload.specimenId || payload.childSpecimenId || payload.aggregateId || ''),
      payload: {
        specimenId: payload.specimenId || payload.childSpecimenId || null,
        parentSpecimenId: payload.parentSpecimenId || null,
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 1,
    });
  }

  async appendQualityEvent(db, payload) {
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
    });
  }

  async appendTelemetryEvent(db, payload) {
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
    });
  }

  // RF028 AC9: "Persistir primeiro no MongoDB e projetar no Neo4j
  // exclusivamente pelo outbox" — appended by reference-imports/pipeline.js's
  // promote() on the same write that inserts a TerminologyConcept, same
  // outbox pattern RF023 uses for consent/lineage/quality/telemetry.
  async appendTerminologyConceptEvent(db, payload) {
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
    });
  }

  async appendTerminologyRelationEvent(db, payload) {
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
    });
  }
}

module.exports = {
  GraphProjectionService,
  stableHash,
};
