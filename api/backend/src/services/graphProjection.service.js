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

  async appendConsentEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: payload.status === 'REVOKED' ? 'CONSENT_REVOKED' : 'CONSENT_UPSERTED',
      aggregateType: 'EthicalConsent',
      aggregateId: String(payload.ethicalConsentId || payload.consentId || payload.aggregateId || ''),
      payload: {
        participantId: payload.participantId,
        specimenId: payload.specimenId || null,
        ethicalConsentId: payload.ethicalConsentId || payload.consentId || null,
        consentTemplateId: payload.consentTemplateId || null,
        status: payload.status || 'ACTIVE',
        signedAt: payload.signedAt || new Date(),
        revokedAt: payload.revokedAt || null,
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 2,
    }, options);
  }

  async appendSpecimenEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'SPECIMEN_UPSERTED',
      aggregateType: 'Specimen',
      aggregateId: String(payload.specimenId || payload.aggregateId || ''),
      payload: {
        specimenId: payload.specimenId || null,
        participantId: payload.participantId || null,
        parentSpecimenId: payload.parentSpecimenId || null,
        parentSpecimenIds: Array.isArray(payload.parentSpecimenIds)
          ? payload.parentSpecimenIds
          : (payload.parentSpecimenId ? [payload.parentSpecimenId] : []),
        barcode: payload.barcode || null,
        specimenStatus: payload.specimenStatus || payload.status || null,
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 2,
    }, options);
  }

  async appendCustodyEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'CUSTODY_EVENT_RECORDED',
      aggregateType: 'Specimen',
      aggregateId: String(payload.specimenId || payload.aggregateId || ''),
      payload: {
        specimenId: payload.specimenId || null,
        custodyEventId: payload.custodyEventId || null,
        eventType: payload.eventType || null,
        happenedAt: payload.happenedAt || new Date(),
        actorId: payload.actorId || null,
        reason: payload.reason || null,
        from: payload.from || null,
        to: payload.to || null,
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 2,
    }, options);
  }

  async appendStorageAssignmentEvent(db, payload, options = {}) {
    const isReleased = Boolean(payload.removedAt || payload.releasedAt);
    return this.outbox.appendEvent(db, {
      eventType: isReleased ? 'STORAGE_ASSIGNMENT_RELEASED' : 'STORAGE_ASSIGNMENT_UPSERTED',
      aggregateType: 'SpecimenContainerAssignment',
      aggregateId: String(payload.specimenContainerAssignmentId || payload.aggregateId || ''),
      payload: {
        specimenContainerAssignmentId: payload.specimenContainerAssignmentId || null,
        specimenId: payload.specimenId || null,
        containerId: payload.containerId || null,
        containerPositionAssignmentId: payload.containerPositionAssignmentId || null,
        storagePositionId: payload.storagePositionId || null,
        rackLocationAssignmentId: payload.rackLocationAssignmentId || null,
        storageRackId: payload.storageRackId || null,
        storageLocationId: payload.storageLocationId || null,
        assignedAt: payload.assignedAt || null,
        releasedAt: payload.releasedAt || null,
        placedAt: payload.placedAt || null,
        removedAt: payload.removedAt || null,
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 2,
    }, options);
  }

  async appendLineageEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'LINEAGE_REGISTERED',
      aggregateType: 'Specimen',
      aggregateId: String(payload.specimenId || payload.childSpecimenId || payload.aggregateId || ''),
      payload: {
        specimenId: payload.specimenId || payload.childSpecimenId || null,
        parentSpecimenId: payload.parentSpecimenId || null,
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 2,
    }, options);
  }

  async appendQualityEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'QUALITY_ASSESSED',
      aggregateType: 'Specimen',
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
      schemaVersion: 2,
    }, options);
  }

  async appendTelemetryEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'TELEMETRY_INCIDENT_RECORDED',
      aggregateType: 'Specimen',
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

  async appendTelemetryExposureSummaryEvent(db, payload, options = {}) {
    return this.outbox.appendEvent(db, {
      eventType: 'TELEMETRY_EXPOSURE_SUMMARIZED',
      aggregateType: 'TelemetryExposureSummary',
      aggregateId: String(payload.telemetryExposureSummaryId || payload.aggregateId || ''),
      payload: {
        telemetryExposureSummaryId: payload.telemetryExposureSummaryId || null,
        specimenId: payload.specimenId || null,
        specimenContainerAssignmentId: payload.specimenContainerAssignmentId || null,
        containerPositionAssignmentId: payload.containerPositionAssignmentId || null,
        rackLocationAssignmentId: payload.rackLocationAssignmentId || null,
        exposurePathHash: payload.exposurePathHash || null,
        datastreamIds: Array.isArray(payload.datastreamIds) ? payload.datastreamIds : [],
        windowStart: payload.windowStart || null,
        windowEnd: payload.windowEnd || null,
        observationCount: Number(payload.observationCount || 0),
        minimumValue: payload.minimumValue ?? null,
        maximumValue: payload.maximumValue ?? null,
        meanValue: payload.meanValue ?? null,
        timeOutsideThresholdSeconds: Number(payload.timeOutsideThresholdSeconds || 0),
        excursionCount: Number(payload.excursionCount || 0),
        coverageRatio: payload.coverageRatio ?? null,
        sourceQueryHash: payload.sourceQueryHash || null,
        sourceReadingSetHash: payload.sourceReadingSetHash || null,
        calculationVersion: payload.calculationVersion || '1.0.0',
        calculatedAt: payload.calculatedAt || new Date(),
      },
      sourceService: payload.sourceService || 'graph-projection-service',
      traceId: payload.traceId || null,
      schemaVersion: 2,
    }, options);
  }

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

module.exports = {
  GraphProjectionService,
  stableHash,
};
