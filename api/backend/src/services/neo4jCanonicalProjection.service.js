const crypto = require('crypto');
function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

class Neo4jCanonicalProjectionService {
  constructor(options = {}) {
    this.database = options.database || process.env.NEO4J_DATABASE || 'neo4j';
  }

  pseudonymizeDonorId(identity) {
    const salt = normalizeText(process.env.NEO4J_CANONICAL_SALT || process.env.GRAPH_PSEUDONYMIZATION_SALT || process.env.USER_ANON_SALT);
    if (!salt) {
      throw new Error('Salt de pseudonimização ausente');
    }
    const canonical = normalizeText(identity).toLowerCase();
    const digest = crypto.createHmac('sha256', salt).update(canonical).digest('hex');
    return `DONOR_${digest.slice(0, 24)}`;
  }

  async applyEvent(session, event) {
    const type = normalizeText(event?.eventType).toUpperCase();
    const payload = event?.payload || {};

    if (type === 'CONSENT_UPSERTED' || type === 'CONSENT_REVOKED') {
      return this.applyConsentProjection(session, event);
    }
    if (type === 'LINEAGE_REGISTERED') {
      return this.applyLineageProjection(session, event);
    }
    if (type === 'QUALITY_ASSESSED') {
      return this.applyQualityProjection(session, event);
    }
    if (type === 'TELEMETRY_INCIDENT_RECORDED') {
      return this.applyTelemetryProjection(session, event);
    }

    return {
      skipped: true,
      eventType: type,
      aggregateType: normalizeText(event?.aggregateType),
      eventId: normalizeText(event?.eventId),
    };
  }

  async applyConsentProjection(session, event) {
    const payload = event.payload || {};
    const donorId = this.pseudonymizeDonorId(payload.donorKey || payload.patientId || payload.patientID || payload.mongoPatientId || event.aggregateId);
    const sampleId = normalizeText(payload.sampleId || payload.mongoSampleId || event.aggregateId);
    const consentId = normalizeText(payload.ethicalConsentId || payload.consentId || event.aggregateId);
    const consentStatus = normalizeText(payload.status || 'ACTIVE').toUpperCase();
    const consentAt = normalizeIso(payload.signedAt || event.occurredAt);

    const cypher = `
      MERGE (donor:Donor {id: $donorId})
      ON CREATE SET donor.createdAt = datetime(), donor.source = $sourceService
      SET donor.updatedAt = datetime(), donor.lastProjectionEventId = $eventId, donor.lastProjectionAt = datetime()

      MERGE (consent:EthicalConsent {id: $consentId})
      ON CREATE SET consent.createdAt = datetime(), consent.source = $sourceService
      SET consent.updatedAt = datetime(),
          consent.status = $consentStatus,
          consent.schemaVersion = $schemaVersion,
          consent.occurredAt = datetime($occurredAt),
          consent.lastProjectionEventId = $eventId,
          consent.lastProjectionAt = datetime()

      MERGE (donor)-[r1:CONSENTED_UNDER]->(consent)
      ON CREATE SET r1.createdAt = datetime(), r1.source = $sourceService
      SET r1.updatedAt = datetime(), r1.schemaVersion = $schemaVersion, r1.eventId = $eventId

      FOREACH (_ IN CASE WHEN $sampleId = '' THEN [] ELSE [1] END |
        MERGE (sample:Sample {id: $sampleId})
        ON CREATE SET sample.createdAt = datetime(), sample.source = $sourceService
        SET sample.updatedAt = datetime(),
            sample.mongoSampleId = $sampleId,
            sample.lastProjectionEventId = $eventId,
            sample.lastProjectionAt = datetime()
        MERGE (donor)-[r2:DONATED]->(sample)
        ON CREATE SET r2.createdAt = datetime(), r2.source = $sourceService
        SET r2.updatedAt = datetime(), r2.schemaVersion = $schemaVersion, r2.eventId = $eventId
        MERGE (sample)-[r3:GOVERNED_BY]->(consent)
        ON CREATE SET r3.createdAt = datetime(), r3.source = $sourceService
        SET r3.updatedAt = datetime(), r3.schemaVersion = $schemaVersion, r3.eventId = $eventId
      )

      RETURN donor.id AS donorId, consent.id AS consentId
    `;

    await session.run(cypher, {
      donorId,
      sampleId,
      consentId,
      consentStatus,
      schemaVersion: Number(event.schemaVersion || 1),
      occurredAt: consentAt || normalizeIso(event.occurredAt) || new Date().toISOString(),
      sourceService: normalizeText(event.sourceService) || 'unknown',
      eventId: normalizeText(event.eventId),
    });

    return { projected: true, eventType: event.eventType, donorId, consentId };
  }

  async applyLineageProjection(session, event) {
    const payload = event.payload || {};
    const parentSampleId = normalizeText(payload.parentSampleId);
    const sampleId = normalizeText(payload.sampleId || event.aggregateId);
    const cypher = `
      MERGE (child:Sample {id: $sampleId})
      ON CREATE SET child.createdAt = datetime(), child.source = $sourceService
      SET child.updatedAt = datetime(),
          child.lastProjectionEventId = $eventId,
          child.lastProjectionAt = datetime()

      MERGE (parent:Sample {id: $parentSampleId})
      ON CREATE SET parent.createdAt = datetime(), parent.source = $sourceService
      SET parent.updatedAt = datetime(),
          parent.lastProjectionEventId = $eventId,
          parent.lastProjectionAt = datetime()

      MERGE (child)-[r:DERIVED_FROM]->(parent)
      ON CREATE SET r.createdAt = datetime(), r.source = $sourceService
      SET r.updatedAt = datetime(), r.schemaVersion = $schemaVersion, r.eventId = $eventId

      RETURN child.id AS sampleId, parent.id AS parentSampleId
    `;

    await session.run(cypher, {
      sampleId,
      parentSampleId,
      schemaVersion: Number(event.schemaVersion || 1),
      sourceService: normalizeText(event.sourceService) || 'unknown',
      eventId: normalizeText(event.eventId),
    });
    return { projected: true, eventType: event.eventType, sampleId };
  }

  async applyQualityProjection(session, event) {
    const payload = event.payload || {};
    const sampleId = normalizeText(payload.sampleId || event.aggregateId);
    const assessmentId = normalizeText(payload.qualityAssessmentId || event.eventId);

    const cypher = `
      MERGE (sample:Sample {id: $sampleId})
      ON CREATE SET sample.createdAt = datetime(), sample.source = $sourceService
      SET sample.updatedAt = datetime(),
          sample.lastProjectionEventId = $eventId,
          sample.lastProjectionAt = datetime()

      MERGE (assessment:QualityAssessment {id: $assessmentId})
      ON CREATE SET assessment.createdAt = datetime(), assessment.source = $sourceService
      SET assessment.updatedAt = datetime(),
          assessment.schemaVersion = $schemaVersion,
          assessment.status = $status,
          assessment.score = $score,
          assessment.evaluatedAt = datetime($evaluatedAt),
          assessment.lastProjectionEventId = $eventId,
          assessment.lastProjectionAt = datetime()

      MERGE (sample)-[r:HAS_QUALITY_ASSESSMENT]->(assessment)
      ON CREATE SET r.createdAt = datetime(), r.source = $sourceService
      SET r.updatedAt = datetime(), r.schemaVersion = $schemaVersion, r.eventId = $eventId

      RETURN sample.id AS sampleId, assessment.id AS assessmentId
    `;

    await session.run(cypher, {
      sampleId,
      assessmentId,
      schemaVersion: Number(event.schemaVersion || 1),
      sourceService: normalizeText(event.sourceService) || 'unknown',
      eventId: normalizeText(event.eventId),
      status: normalizeText(payload.status || 'UNKNOWN'),
      score: payload.score === undefined ? null : Number(payload.score),
      evaluatedAt: normalizeIso(payload.evaluatedAt || event.occurredAt) || new Date().toISOString(),
    });
    return { projected: true, eventType: event.eventType, sampleId };
  }

  async applyTelemetryProjection(session, event) {
    const payload = event.payload || {};
    const sampleId = normalizeText(payload.sampleId || event.aggregateId);
    const incidentId = normalizeText(payload.telemetryIncidentId || event.eventId);

    const cypher = `
      MERGE (sample:Sample {id: $sampleId})
      ON CREATE SET sample.createdAt = datetime(), sample.source = $sourceService
      SET sample.updatedAt = datetime(),
          sample.lastProjectionEventId = $eventId,
          sample.lastProjectionAt = datetime()

      MERGE (incident:TelemetryIncident {id: $incidentId})
      ON CREATE SET incident.createdAt = datetime(), incident.source = $sourceService
      SET incident.updatedAt = datetime(),
          incident.schemaVersion = $schemaVersion,
          incident.severity = $severity,
          incident.status = $status,
          incident.occurredAt = datetime($occurredAt),
          incident.lastProjectionEventId = $eventId,
          incident.lastProjectionAt = datetime()

      MERGE (sample)-[r:AFFECTED_BY]->(incident)
      ON CREATE SET r.createdAt = datetime(), r.source = $sourceService
      SET r.updatedAt = datetime(), r.schemaVersion = $schemaVersion, r.eventId = $eventId

      RETURN sample.id AS sampleId, incident.id AS incidentId
    `;

    await session.run(cypher, {
      sampleId,
      incidentId,
      schemaVersion: Number(event.schemaVersion || 1),
      sourceService: normalizeText(event.sourceService) || 'unknown',
      eventId: normalizeText(event.eventId),
      severity: normalizeText(payload.severity || 'UNKNOWN'),
      status: normalizeText(payload.status || 'OPEN'),
      occurredAt: normalizeIso(payload.occurredAt || event.occurredAt) || new Date().toISOString(),
    });
    return { projected: true, eventType: event.eventType, sampleId };
  }
}

module.exports = {
  Neo4jCanonicalProjectionService,
  stableStringify,
};
