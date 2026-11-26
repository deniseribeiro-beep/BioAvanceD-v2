const crypto = require('crypto');
const { neo4jTxConfig } = require('../utils/requestContext');
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

  async applyEvent(rawSession, event) {
    // #1323 RNF015 C1: the event's traceId rides each write as transaction
    // metadata; a missing or malformed one leaves the session untouched.
    const txConfig = neo4jTxConfig(event?.traceId ?? null);
    const session = txConfig
      ? { run: (query, params, config) => rawSession.run(query, params, { ...txConfig, ...(config || {}) }) }
      : rawSession;
    const type = normalizeText(event?.eventType).toUpperCase();
    const payload = event?.payload || {};

    if (type === 'CONSENT_UPSERTED' || type === 'CONSENT_REVOKED') {
      return this.applyConsentProjection(session, event);
    }
    if (type === 'SPECIMEN_UPSERTED') {
      return this.applySpecimenProjection(session, event);
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
    if (type === 'STORAGE_POSITION_ASSIGNED') {
      return this.applyStoragePositionProjection(session, event);
    }
    if (type === 'SPECIMEN_COMPROMISED') {
      return this.applySpecimenCompromiseProjection(session, event);
    }
    if (type === 'CUSTODY_EVENT_RECORDED') {
      return this.applyCustodyEventProjection(session, event);
    }
    if (type === 'TERMINOLOGY_CONCEPT_PROMOTED') {
      return this.applyTerminologyConceptProjection(session, event);
    }
    if (type === 'TERMINOLOGY_RELATION_PROMOTED') {
      return this.applyTerminologyRelationProjection(session, event);
    }
    if (type === 'BIOMARKER_ASSOCIATION_UPSERTED') {
      return this.applyBiomarkerAssociationProjection(session, event);
    }
    if (type === 'SPECIMEN_DONOR_UNLINKED') {
      return this.applySpecimenDonorUnlink(session, event);
    }
    if (type === 'STORAGE_POSITION_RELEASED') {
      return this.applyStoragePositionRelease(session, event);
    }
    // #1550 RF029 AC6: the event carries ids only and names no second node, so
    // it has no relation to draw; a target with relations appends its own graph
    // events (SPECIMEN_UPSERTED, LINEAGE_REGISTERED, CONSENT_UPSERTED).
    if (type === 'INGESTION_RECORD_PERSISTED') {
      return {
        skipped: true,
        eventType: type,
        aggregateType: normalizeText(event?.aggregateType),
        eventId: normalizeText(event?.eventId),
        reason: 'no graph relation: the ingested target appends its own graph events',
      };
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
    const donorId = this.pseudonymizeDonorId(payload.participantId || event.aggregateId);
    // #1225: no fallback to event.aggregateId. That is the consent's own id, so
    // the fallback put every GOVERNED_BY edge on a phantom Sample keyed by the
    // consent id, and no real sample was ever governed. The donor's samples are
    // governed below through DONATED, which SPECIMEN_UPSERTED writes.
    const specimenId = normalizeText(payload.specimenId);
    const consentId = normalizeText(payload.consentId || payload.ethicalConsentId || event.aggregateId);
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

      FOREACH (_ IN CASE WHEN $specimenId = '' THEN [] ELSE [1] END |
        MERGE (sample:Sample {id: $specimenId})
        ON CREATE SET sample.createdAt = datetime(), sample.source = $sourceService
        SET sample.updatedAt = datetime(),
            sample.specimenId = $specimenId,
            sample.lastProjectionEventId = $eventId,
            sample.lastProjectionAt = datetime()
        MERGE (donor)-[r2:DONATED]->(sample)
        ON CREATE SET r2.createdAt = datetime(), r2.source = $sourceService
        SET r2.updatedAt = datetime(), r2.schemaVersion = $schemaVersion, r2.eventId = $eventId
        MERGE (sample)-[r3:GOVERNED_BY]->(consent)
        ON CREATE SET r3.createdAt = datetime(), r3.source = $sourceService
        SET r3.updatedAt = datetime(), r3.schemaVersion = $schemaVersion, r3.eventId = $eventId
      )

      WITH donor, consent
      OPTIONAL MATCH (donor)-[:DONATED]->(donated:Sample)
      WITH donor, consent, collect(donated) AS donatedSamples
      FOREACH (owned IN donatedSamples |
        MERGE (owned)-[r4:GOVERNED_BY]->(consent)
        ON CREATE SET r4.createdAt = datetime(), r4.source = $sourceService
        SET r4.updatedAt = datetime(), r4.schemaVersion = $schemaVersion, r4.eventId = $eventId
      )

      RETURN donor.id AS donorId, consent.id AS consentId
    `;

    await session.run(cypher, {
      donorId,
      specimenId,
      consentId,
      consentStatus,
      schemaVersion: Number(event.schemaVersion || 1),
      occurredAt: consentAt || normalizeIso(event.occurredAt) || new Date().toISOString(),
      sourceService: normalizeText(event.sourceService) || 'unknown',
      eventId: normalizeText(event.eventId),
    });

    return { projected: true, eventType: event.eventType, donorId, consentId };
  }

  // #1225: a sample joins the graph under its Mongo _id, the key the custody
  // events (CUSTODY_EVENT_RECORDED) MERGE it by too, linked to its donor and governed by every consent that
  // donor already has. Consents projected later reach it through
  // applyConsentProjection's DONATED traversal, so either order converges.
  async applySpecimenProjection(session, event) {
    const payload = event.payload || {};
    const specimenId = normalizeText(payload.specimenId || event.aggregateId);
    const participantId = normalizeText(payload.participantId);
    const params = {
      specimenId,
      schemaVersion: Number(event.schemaVersion || 1),
      sourceService: normalizeText(event.sourceService) || 'unknown',
      eventId: normalizeText(event.eventId),
    };

    const mergeSample = `
      MERGE (sample:Sample {id: $specimenId})
      ON CREATE SET sample.createdAt = datetime(), sample.source = $sourceService
      SET sample.updatedAt = datetime(),
          sample.lastProjectionEventId = $eventId,
          sample.lastProjectionAt = datetime()
    `;

    if (!participantId) {
      await session.run(`${mergeSample}
      RETURN sample.id AS specimenId`, params);
      return { projected: true, eventType: event.eventType, specimenId, donorId: null };
    }

    const donorId = this.pseudonymizeDonorId(participantId);
    await session.run(`${mergeSample}
      MERGE (donor:Donor {id: $donorId})
      ON CREATE SET donor.createdAt = datetime(), donor.source = $sourceService
      SET donor.updatedAt = datetime(), donor.lastProjectionEventId = $eventId, donor.lastProjectionAt = datetime()

      MERGE (donor)-[r1:DONATED]->(sample)
      ON CREATE SET r1.createdAt = datetime(), r1.source = $sourceService
      SET r1.updatedAt = datetime(), r1.schemaVersion = $schemaVersion, r1.eventId = $eventId

      WITH donor, sample
      OPTIONAL MATCH (donor)-[:CONSENTED_UNDER]->(consent:EthicalConsent)
      WITH donor, sample, collect(consent) AS consents
      FOREACH (governing IN consents |
        MERGE (sample)-[r2:GOVERNED_BY]->(governing)
        ON CREATE SET r2.createdAt = datetime(), r2.source = $sourceService
        SET r2.updatedAt = datetime(), r2.schemaVersion = $schemaVersion, r2.eventId = $eventId
      )

      RETURN sample.id AS specimenId, donor.id AS donorId
    `, { ...params, donorId });

    return { projected: true, eventType: event.eventType, specimenId, donorId };
  }

  async applyLineageProjection(session, event) {
    const payload = event.payload || {};
    const parentSpecimenId = normalizeText(payload.parentSpecimenId);
    const specimenId = normalizeText(payload.specimenId || event.aggregateId);
    // #1368: an edge needs both ends, and a sample never derives from itself.
    if (!specimenId || !parentSpecimenId || specimenId === parentSpecimenId) {
      return { skipped: true, eventType: event.eventType, specimenId, reason: 'missing specimenId or parentSpecimenId' };
    }
    const cypher = `
        MERGE (child:Sample {id: $specimenId})
      ON CREATE SET child.createdAt = datetime(), child.source = $sourceService
      SET child.updatedAt = datetime(),
          child.lastProjectionEventId = $eventId,
          child.lastProjectionAt = datetime()

        MERGE (parent:Sample {id: $parentSpecimenId})
      ON CREATE SET parent.createdAt = datetime(), parent.source = $sourceService
      SET parent.updatedAt = datetime(),
          parent.lastProjectionEventId = $eventId,
          parent.lastProjectionAt = datetime()

      MERGE (child)-[r:DERIVED_FROM]->(parent)
      ON CREATE SET r.createdAt = datetime(), r.source = $sourceService
      SET r.updatedAt = datetime(), r.schemaVersion = $schemaVersion, r.eventId = $eventId

        RETURN child.id AS specimenId, parent.id AS parentSpecimenId
    `;

    await session.run(cypher, {
        specimenId,
        parentSpecimenId,
      schemaVersion: Number(event.schemaVersion || 1),
      sourceService: normalizeText(event.sourceService) || 'unknown',
      eventId: normalizeText(event.eventId),
    });
    return { projected: true, eventType: event.eventType, specimenId };
  }

  async applyQualityProjection(session, event) {
    const payload = event.payload || {};
    const specimenId = normalizeText(payload.specimenId || event.aggregateId);
    const assessmentId = normalizeText(payload.qualityAssessmentId || event.eventId);

    const cypher = `
        MERGE (sample:Sample {id: $specimenId})
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
        specimenId,
      assessmentId,
      schemaVersion: Number(event.schemaVersion || 1),
      sourceService: normalizeText(event.sourceService) || 'unknown',
      eventId: normalizeText(event.eventId),
      status: normalizeText(payload.status || 'UNKNOWN'),
      score: payload.score === undefined ? null : Number(payload.score),
      evaluatedAt: normalizeIso(payload.evaluatedAt || event.occurredAt) || new Date().toISOString(),
    });
    return { projected: true, eventType: event.eventType, specimenId };
  }

  async applyTelemetryProjection(session, event) {
    const payload = event.payload || {};
    const specimenId = normalizeText(payload.specimenId || event.aggregateId);
    const incidentId = normalizeText(payload.telemetryIncidentId || event.eventId);

    const cypher = `
        MERGE (sample:Sample {id: $specimenId})
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
        specimenId,
      incidentId,
      schemaVersion: Number(event.schemaVersion || 1),
      sourceService: normalizeText(event.sourceService) || 'unknown',
      eventId: normalizeText(event.eventId),
      severity: normalizeText(payload.severity || 'UNKNOWN'),
      status: normalizeText(payload.status || 'OPEN'),
      occurredAt: normalizeIso(payload.occurredAt || event.occurredAt) || new Date().toISOString(),
    });
    return { projected: true, eventType: event.eventType, specimenId };
  }

  // #1312: a sample sits in one position at a time. #1313 (RF023 AC5): the
  // placement is a temporal edge, validTime = [validFrom, validTo), with
  // the projection instant as transactionTime. A new placement closes the
  // open edge at its own validFrom rather than deleting it, so the graph
  // keeps where the sample was and when. Each placement is its own edge,
  // keyed by its validFrom, so a replay of the same event merges onto it and
  // a return to an earlier position opens a new interval. An edge from
  // before this change has no validFrom, and the next placement closes it.
  async applyStoragePositionProjection(session, event) {
    const payload = event.payload || {};
    const specimenId = normalizeText(payload.specimenId || event.aggregateId);
    const boxId = normalizeText(payload.boxId);
    const position = normalizeText(payload.position);
    if (!specimenId || !boxId || !position) {
      return { skipped: true, eventType: event.eventType, specimenId, reason: 'missing specimenId, boxId or position' };
    }

    const cypher = `
      MERGE (sample:Sample {id: $specimenId})
      ON CREATE SET sample.createdAt = datetime(), sample.source = $sourceService
      SET sample.updatedAt = datetime(),
          sample.lastProjectionEventId = $eventId,
          sample.lastProjectionAt = datetime()

      MERGE (pos:StoragePosition {boxId: $boxId, position: $position})
      ON CREATE SET pos.createdAt = datetime(), pos.source = $sourceService
      SET pos.updatedAt = datetime()

      WITH sample, pos
      OPTIONAL MATCH (sample)-[old:STORED_AT]->(:StoragePosition)
      WHERE old.validTo IS NULL
        AND (old.validFrom IS NULL OR old.validFrom < datetime($validFrom))
      SET old.validTo = datetime($validFrom)

      WITH DISTINCT sample, pos
      MERGE (sample)-[r:STORED_AT {validFrom: datetime($validFrom)}]->(pos)
      ON CREATE SET r.createdAt = datetime(), r.source = $sourceService,
                    r.transactionTime = datetime()
      SET r.updatedAt = datetime(), r.schemaVersion = $schemaVersion, r.eventId = $eventId

      RETURN sample.id AS specimenId, pos.boxId AS boxId, pos.position AS position
    `;

    await session.run(cypher, {
      specimenId,
      boxId,
      position,
      validFrom: normalizeIso(payload.assignedAt || event.occurredAt) || new Date().toISOString(),
      schemaVersion: Number(event.schemaVersion || 1),
      sourceService: normalizeText(event.sourceService) || 'unknown',
      eventId: normalizeText(event.eventId),
    });
    return { projected: true, eventType: event.eventType, specimenId };
  }

  // #1550: a donor edge Mongo does not hold. DONATED carries no validity
  // interval, so it is deleted, with the GOVERNED_BY edges the specimen
  // projection made from that donor's consents. A replay matches nothing.
  async applySpecimenDonorUnlink(session, event) {
    const payload = event.payload || {};
    const specimenId = normalizeText(payload.specimenId || event.aggregateId);
    const donorId = normalizeText(payload.donorId);
    if (!specimenId || !donorId) {
      return { skipped: true, eventType: event.eventType, specimenId, reason: 'missing specimenId or donorId' };
    }

    await session.run(`
      MATCH (donor:Donor {id: $donorId})-[r:DONATED]->(sample:Sample {id: $specimenId})
      OPTIONAL MATCH (donor)-[:CONSENTED_UNDER]->(:EthicalConsent)<-[g:GOVERNED_BY]-(sample)
      WITH r, collect(g) AS governed
      FOREACH (edge IN governed | DELETE edge)
      DELETE r
    `, { donorId, specimenId });
    return { projected: true, eventType: event.eventType, specimenId, donorId };
  }

  // #1550: a sample Mongo places nowhere. Its open STORED_AT edges are closed
  // at releasedAt, as a new placement closes the previous one, and stay as
  // history. A replay finds no open edge.
  async applyStoragePositionRelease(session, event) {
    const payload = event.payload || {};
    const specimenId = normalizeText(payload.specimenId || event.aggregateId);
    if (!specimenId) {
      return { skipped: true, eventType: event.eventType, specimenId, reason: 'missing specimenId' };
    }
    const releasedAt = normalizeIso(payload.releasedAt || event.occurredAt) || new Date().toISOString();

    await session.run(`
      MATCH (sample:Sample {id: $specimenId})-[r:STORED_AT]->(:StoragePosition)
      WHERE r.validTo IS NULL
        AND (r.validFrom IS NULL OR r.validFrom < datetime($releasedAt))
      SET r.validTo = datetime($releasedAt), r.updatedAt = datetime(), r.releasedByEventId = $eventId
    `, { specimenId, releasedAt, eventId: normalizeText(event.eventId) });
    return { projected: true, eventType: event.eventType, specimenId };
  }

  // #1312: one chain-of-custody step, the shape the custody use cases used to
  // write directly: Sample-[:HAS_CUSTODY_EVENT]->CustodyEvent, and
  // CustodyEvent-[:FROM]->/-[:TO]->StoragePosition {boxId, position} where the
  // step has them. Keyed by the outbox eventId, so a re-applied event merges
  // into the same node.
  async applyCustodyEventProjection(session, event) {
    const payload = event.payload || {};
    const specimenId = normalizeText(payload.specimenId || event.aggregateId);
    const custodyEventType = normalizeText(payload.custodyEventType);
    const eventId = normalizeText(event.eventId);
    if (!specimenId || !custodyEventType || !eventId) {
      return { skipped: true, eventType: event.eventType, specimenId, reason: 'missing specimenId, custodyEventType or eventId' };
    }
    const location = (value) => {
      const boxId = normalizeText(value?.boxId);
      const position = normalizeText(value?.position).toUpperCase();
      return boxId && position ? { boxId, position } : { boxId: null, position: null };
    };
    const from = location(payload.from);
    const to = location(payload.to);

    const cypher = `
      MERGE (sample:Sample {id: $specimenId})
      ON CREATE SET sample.createdAt = datetime(), sample.source = $sourceService
      SET sample.updatedAt = datetime(),
          sample.barcode = coalesce($barcode, sample.barcode),
          sample.lastProjectionEventId = $eventId,
          sample.lastProjectionAt = datetime()

      MERGE (custody:CustodyEvent {id: $eventId})
      ON CREATE SET custody.createdAt = datetime()
      SET custody.eventType = $custodyEventType,
          custody.happenedAt = datetime($happenedAt),
          custody.actorId = $actorId,
          custody.reason = $reason,
          custody.source = 'ISO20387',
          custody.schemaVersion = $schemaVersion

      MERGE (sample)-[:HAS_CUSTODY_EVENT]->(custody)

      FOREACH (_ IN CASE WHEN $fromBoxId IS NULL THEN [] ELSE [1] END |
        MERGE (fromPos:StoragePosition {boxId: $fromBoxId, position: $fromPosition})
        ON CREATE SET fromPos.createdAt = datetime()
        SET fromPos.updatedAt = datetime()
        MERGE (custody)-[:FROM]->(fromPos)
      )

      FOREACH (_ IN CASE WHEN $toBoxId IS NULL THEN [] ELSE [1] END |
        MERGE (toPos:StoragePosition {boxId: $toBoxId, position: $toPosition})
        ON CREATE SET toPos.createdAt = datetime()
        SET toPos.updatedAt = datetime()
        MERGE (custody)-[:TO]->(toPos)
      )

      RETURN custody.id AS custodyEventId
    `;

    await session.run(cypher, {
      specimenId,
      barcode: normalizeText(payload.barcode) || null,
      eventId,
      custodyEventType,
      happenedAt: normalizeIso(payload.happenedAt || event.occurredAt) || new Date().toISOString(),
      actorId: normalizeText(payload.actorId) || null,
      reason: normalizeText(payload.reason) || null,
      fromBoxId: from.boxId,
      fromPosition: from.position,
      toBoxId: to.boxId,
      toPosition: to.position,
      schemaVersion: Number(event.schemaVersion || 1),
      sourceService: normalizeText(event.sourceService) || 'unknown',
    });
    return { projected: true, eventType: event.eventType, specimenId, custodyEventId: eventId };
  }

  // #1312: the root sample and every descendant reachable through
  // DERIVED_FROM (child -> parent, so walked backwards from the root, *0..
  // to include the root itself). A root not yet projected marks nothing.
  async applySpecimenCompromiseProjection(session, event) {
    const payload = event.payload || {};
    const specimenId = normalizeText(payload.specimenId || event.aggregateId);
    if (!specimenId) {
      return { skipped: true, eventType: event.eventType, specimenId, reason: 'missing specimenId' };
    }

    const cypher = `
      MATCH (root:Sample {id: $specimenId})
      OPTIONAL MATCH (root)<-[:DERIVED_FROM*0..]-(descendant:Sample)
      WITH collect(DISTINCT root) + collect(DISTINCT descendant) AS samples
      UNWIND samples AS sample
      WITH DISTINCT sample WHERE sample IS NOT NULL
      SET sample.status = 'COMPROMISED',
          sample.compromisedAt = coalesce(sample.compromisedAt, datetime()),
          sample.compromiseFreezerKey = $freezerKey,
          sample.compromiseBreachedSince = $breachedSince,
          sample.lastProjectionEventId = $eventId,
          sample.lastProjectionAt = datetime()
      RETURN count(sample) AS compromisedCount
    `;

    await session.run(cypher, {
      specimenId,
      freezerKey: normalizeText(payload.freezerKey) || null,
      breachedSince: normalizeIso(payload.breachedSince),
      eventId: normalizeText(event.eventId),
    });
    return { projected: true, eventType: event.eventType, specimenId };
  }

  // RF028 AC9. Keyed by terminologyConceptId (not systemUri+code+version)
  // to match RF023's id-based MERGE pattern — code/systemUri/version/display
  // are projected as properties, queryable without knowing the Mongo id
  // ahead of time (see tests/e2e/pipeline-continuity.spec.ts's AC9 block).
  async applyTerminologyConceptProjection(session, event) {
    const payload = event.payload || {};
    const conceptId = normalizeText(payload.terminologyConceptId || event.aggregateId);

    const cypher = `
      MERGE (concept:TerminologyConcept {id: $conceptId})
      ON CREATE SET concept.createdAt = datetime(), concept.source = $sourceService
      SET concept.updatedAt = datetime(),
          concept.systemUri = $systemUri,
          concept.code = $code,
          concept.version = $version,
          concept.display = $display,
          concept.conceptStatus = $conceptStatus,
          concept.schemaVersion = $schemaVersion,
          concept.lastProjectionEventId = $eventId,
          concept.lastProjectionAt = datetime()

      RETURN concept.id AS conceptId
    `;

    await session.run(cypher, {
      conceptId,
      systemUri: normalizeText(payload.systemUri),
      code: normalizeText(payload.code),
      version: normalizeText(payload.version),
      display: normalizeText(payload.display),
      conceptStatus: normalizeText(payload.conceptStatus || 'active'),
      schemaVersion: Number(event.schemaVersion || 1),
      sourceService: normalizeText(event.sourceService) || 'unknown',
      eventId: normalizeText(event.eventId),
    });

    return { projected: true, eventType: event.eventType, conceptId };
  }

  // RF028 AC9. Endpoints are MERGEd by id in case this event is projected
  // before its own endpoints' TERMINOLOGY_CONCEPT_PROMOTED events land —
  // same eventual-consistency shape applyConsentProjection/
  // applyLineageProjection already rely on for their own endpoint nodes.
  async applyTerminologyRelationProjection(session, event) {
    const payload = event.payload || {};
    const relationId = normalizeText(payload.terminologyRelationId || event.aggregateId);
    const sourceConceptId = normalizeText(payload.sourceConceptId);
    const targetConceptId = normalizeText(payload.targetConceptId);

    const cypher = `
      MERGE (source:TerminologyConcept {id: $sourceConceptId})
      ON CREATE SET source.createdAt = datetime(), source.source = $sourceService
      SET source.updatedAt = datetime()

      MERGE (target:TerminologyConcept {id: $targetConceptId})
      ON CREATE SET target.createdAt = datetime(), target.source = $sourceService
      SET target.updatedAt = datetime()

      MERGE (source)-[r:TERMINOLOGY_RELATION {id: $relationId}]->(target)
      ON CREATE SET r.createdAt = datetime(), r.source = $sourceService
      SET r.updatedAt = datetime(),
          r.relationType = $relationType,
          r.relationVersion = $relationVersion,
          r.schemaVersion = $schemaVersion,
          r.lastProjectionEventId = $eventId,
          r.lastProjectionAt = datetime()

      RETURN source.id AS sourceConceptId, target.id AS targetConceptId
    `;

    await session.run(cypher, {
      sourceConceptId,
      targetConceptId,
      relationId,
      relationType: normalizeText(payload.relationType),
      relationVersion: normalizeText(payload.relationVersion),
      schemaVersion: Number(event.schemaVersion || 1),
      sourceService: normalizeText(event.sourceService) || 'unknown',
      eventId: normalizeText(event.eventId),
    });

    return { projected: true, eventType: event.eventType, sourceConceptId, targetConceptId };
  }

  // ADR 2026-11-26: (:Doenca_ORPHA)-[:POSSUI_BIOMARCADOR]->(:Biomarcador)
  async applyBiomarkerAssociationProjection(session, event) {
    const payload = event.payload || {};
    const orphaRaw = normalizeText(payload.orphaCode);
    const numericOrpha = orphaRaw.replace(/^ORPHA:/i, '');
    const analyte = payload.analyte || {};
    const analyteCode = normalizeText(analyte.code);
    const analyteSystem = normalizeText(analyte.systemUri);
    if (!numericOrpha || !analyteCode) {
      return {
        skipped: true,
        eventType: event.eventType,
        reason: 'missing orphaCode or analyte.code',
      };
    }
    const biomarkerKey = `${analyteSystem}|${analyteCode}`;
    const prefixedOrpha = `ORPHA:${numericOrpha}`;

    const cypher = `
      MERGE (d:Doenca_ORPHA {code: $numericOrpha})
      ON CREATE SET d.createdAt = datetime(), d.codePrefixed = $prefixedOrpha
      SET d.updatedAt = datetime(),
          d.codePrefixed = $prefixedOrpha

      MERGE (b:Biomarcador {id: $biomarkerKey})
      ON CREATE SET b.createdAt = datetime()
      SET b.updatedAt = datetime(),
          b.code = $analyteCode,
          b.systemUri = $analyteSystem,
          b.nome = $analyteDisplay,
          b.lastProjectionEventId = $eventId

      MERGE (d)-[r:POSSUI_BIOMARCADOR]->(b)
      ON CREATE SET r.createdAt = datetime()
      SET r.updatedAt = datetime(),
          r.biomarkerId = $biomarkerId,
          r.biomarkerRole = $biomarkerRole,
          r.lastProjectionEventId = $eventId

      RETURN d.code AS orphaCode, b.id AS biomarkerKey
    `;

    await session.run(cypher, {
      numericOrpha,
      prefixedOrpha,
      biomarkerKey,
      analyteCode,
      analyteSystem,
      analyteDisplay: normalizeText(analyte.display) || analyteCode,
      biomarkerId: normalizeText(payload.biomarkerId),
      biomarkerRole: normalizeText(payload.biomarkerRole),
      eventId: normalizeText(event.eventId),
    });

    return {
      projected: true,
      eventType: event.eventType,
      orphaCode: numericOrpha,
      biomarkerKey,
    };
  }
}

module.exports = {
  Neo4jCanonicalProjectionService,
  stableStringify,
};
