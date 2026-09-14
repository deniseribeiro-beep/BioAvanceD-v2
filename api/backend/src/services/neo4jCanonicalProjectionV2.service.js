const { Neo4jCanonicalProjectionService } = require('./neo4jCanonicalProjection.service');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

class Neo4jCanonicalProjectionV2Service extends Neo4jCanonicalProjectionService {
  async applyEvent(session, event) {
    const type = normalizeText(event?.eventType).toUpperCase();

    if (type === 'CONSENT_UPSERTED' || type === 'CONSENT_REVOKED') {
      return this.applyConsentProjectionV2(session, event);
    }
    if (type === 'SPECIMEN_UPSERTED') {
      return this.applySpecimenProjection(session, event);
    }
    if (type === 'CUSTODY_EVENT_RECORDED') {
      return this.applyCustodyProjection(session, event);
    }
    if (type === 'STORAGE_ASSIGNMENT_UPSERTED' || type === 'STORAGE_ASSIGNMENT_RELEASED') {
      return this.applyStorageAssignmentProjection(session, event);
    }
    if (type === 'TELEMETRY_EXPOSURE_SUMMARIZED') {
      return this.applyTelemetryExposureSummaryProjection(session, event);
    }

    return super.applyEvent(session, event);
  }

  async applyConsentProjectionV2(session, event) {
    const payload = event?.payload || {};
    const participantId = normalizeText(payload.participantId);
    const consentId = normalizeText(payload.ethicalConsentId || payload.consentId || event.aggregateId);
    if (!participantId || !consentId) {
      throw new Error('[RF023] Consent projection requires participantId and ethicalConsentId');
    }

    const donorId = this.pseudonymizeDonorId(participantId);
    const consentStatus = normalizeText(payload.status || 'ACTIVE').toUpperCase();
    const occurredAt = normalizeIso(payload.signedAt || event.occurredAt) || new Date().toISOString();
    const revoked = consentStatus === 'REVOKED';

    await session.run(
      `
        MERGE (donor:Donor {id: $donorId})
        ON CREATE SET donor.createdAt = datetime(), donor.source = $sourceService
        SET donor.updatedAt = datetime(),
            donor.lastProjectionEventId = $eventId,
            donor.lastProjectionAt = datetime()

        MERGE (consent:EthicalConsent {id: $consentId})
        ON CREATE SET consent.createdAt = datetime(), consent.source = $sourceService
        SET consent.updatedAt = datetime(),
            consent.status = $consentStatus,
            consent.schemaVersion = $schemaVersion,
            consent.occurredAt = datetime($occurredAt),
            consent.lastProjectionEventId = $eventId,
            consent.lastProjectionAt = datetime()

        MERGE (donor)-[consented:CONSENTED_UNDER]->(consent)
        ON CREATE SET consented.createdAt = datetime(), consented.source = $sourceService
        SET consented.updatedAt = datetime(), consented.eventId = $eventId

        WITH donor, consent
        OPTIONAL MATCH (donor)-[:DONATED]->(sample:Sample)
        OPTIONAL MATCH (sample)-[existing:GOVERNED_BY]->(consent)
        FOREACH (_ IN CASE WHEN sample IS NOT NULL AND $revoked = false THEN [1] ELSE [] END |
          MERGE (sample)-[governed:GOVERNED_BY]->(consent)
          ON CREATE SET governed.createdAt = datetime(), governed.source = $sourceService
          SET governed.updatedAt = datetime(), governed.eventId = $eventId
        )
        FOREACH (_ IN CASE WHEN existing IS NOT NULL AND $revoked = true THEN [1] ELSE [] END |
          DELETE existing
        )

        RETURN donor.id AS donorId, consent.id AS consentId
      `,
      {
        donorId,
        consentId,
        consentStatus,
        revoked,
        schemaVersion: Number(event.schemaVersion || 2),
        occurredAt,
        sourceService: normalizeText(event.sourceService) || 'unknown',
        eventId: normalizeText(event.eventId),
      }
    );

    return { projected: true, eventType: event.eventType, donorId, consentId };
  }

  async applySpecimenProjection(session, event) {
    const payload = event?.payload || {};
    const specimenId = normalizeText(payload.specimenId || event.aggregateId);
    if (!specimenId) throw new Error('[RF023] Specimen projection requires specimenId');

    const participantId = normalizeText(payload.participantId);
    const donorId = participantId ? this.pseudonymizeDonorId(participantId) : '';
    const parentSpecimenIds = Array.isArray(payload.parentSpecimenIds)
      ? payload.parentSpecimenIds.map(normalizeText).filter(Boolean)
      : [normalizeText(payload.parentSpecimenId)].filter(Boolean);

    await session.run(
      `
        MERGE (sample:Sample:Specimen {id: $specimenId})
        ON CREATE SET sample.createdAt = datetime(), sample.source = $sourceService
        SET sample.updatedAt = datetime(),
            sample.specimenId = $specimenId,
            sample.barcode = coalesce($barcode, sample.barcode),
            sample.specimenStatus = coalesce($specimenStatus, sample.specimenStatus),
            sample.lastProjectionEventId = $eventId,
            sample.lastProjectionAt = datetime()

        FOREACH (_ IN CASE WHEN $donorId = '' THEN [] ELSE [1] END |
          MERGE (donor:Donor {id: $donorId})
          ON CREATE SET donor.createdAt = datetime(), donor.source = $sourceService
          SET donor.updatedAt = datetime()
          MERGE (donor)-[donated:DONATED]->(sample)
          ON CREATE SET donated.createdAt = datetime(), donated.source = $sourceService
          SET donated.updatedAt = datetime(), donated.eventId = $eventId
        )

        FOREACH (parentSpecimenId IN $parentSpecimenIds |
          MERGE (parent:Sample:Specimen {id: parentSpecimenId})
          ON CREATE SET parent.createdAt = datetime(), parent.source = $sourceService
          SET parent.updatedAt = datetime()
          MERGE (sample)-[derived:DERIVED_FROM]->(parent)
          ON CREATE SET derived.createdAt = datetime(), derived.source = $sourceService
          SET derived.updatedAt = datetime(), derived.eventId = $eventId
        )

        WITH sample
        OPTIONAL MATCH (donor:Donor {id: $donorId})-[:CONSENTED_UNDER]->(consent:EthicalConsent)
        WHERE consent.status IN ['ACTIVE', 'VALID', 'GRANTED']
        FOREACH (_ IN CASE WHEN consent IS NULL THEN [] ELSE [1] END |
          MERGE (sample)-[governed:GOVERNED_BY]->(consent)
          ON CREATE SET governed.createdAt = datetime(), governed.source = $sourceService
          SET governed.updatedAt = datetime(), governed.eventId = $eventId
        )
        RETURN sample.id AS specimenId
      `,
      {
        specimenId,
        donorId,
        parentSpecimenIds,
        barcode: payload.barcode || null,
        specimenStatus: payload.specimenStatus || null,
        sourceService: normalizeText(event.sourceService) || 'unknown',
        eventId: normalizeText(event.eventId),
      }
    );

    return { projected: true, eventType: event.eventType, specimenId };
  }

  positionKey(ref) {
    if (!ref || typeof ref !== 'object') return '';
    if (ref.storagePositionId) return normalizeText(ref.storagePositionId);
    const boxId = normalizeText(ref.boxId);
    const position = normalizeText(ref.position).toUpperCase();
    return boxId && position ? `${boxId}:${position}` : '';
  }

  async applyCustodyProjection(session, event) {
    const payload = event?.payload || {};
    const specimenId = normalizeText(payload.specimenId || event.aggregateId);
    const custodyEventId = normalizeText(payload.custodyEventId || event.eventId);
    if (!specimenId || !custodyEventId) {
      throw new Error('[RF023] Custody projection requires specimenId and custodyEventId');
    }

    const fromPositionId = this.positionKey(payload.from);
    const toPositionId = this.positionKey(payload.to);
    const happenedAt = normalizeIso(payload.happenedAt || event.occurredAt) || new Date().toISOString();

    await session.run(
      `
        MERGE (sample:Sample:Specimen {id: $specimenId})
        ON CREATE SET sample.createdAt = datetime(), sample.source = $sourceService
        SET sample.updatedAt = datetime()

        MERGE (custody:CustodyEvent {id: $custodyEventId})
        ON CREATE SET custody.createdAt = datetime(), custody.source = $sourceService
        SET custody.updatedAt = datetime(),
            custody.eventType = $custodyEventType,
            custody.happenedAt = datetime($happenedAt),
            custody.actorId = $actorId,
            custody.reason = $reason,
            custody.lastProjectionEventId = $eventId

        MERGE (sample)-[hasEvent:HAS_CUSTODY_EVENT]->(custody)
        ON CREATE SET hasEvent.createdAt = datetime(), hasEvent.source = $sourceService
        SET hasEvent.updatedAt = datetime(), hasEvent.eventId = $eventId

        FOREACH (_ IN CASE WHEN $fromPositionId = '' THEN [] ELSE [1] END |
          MERGE (fromPos:StoragePosition {id: $fromPositionId})
          ON CREATE SET fromPos.createdAt = datetime(), fromPos.source = $sourceService
          SET fromPos.updatedAt = datetime()
          MERGE (custody)-[fromRel:FROM]->(fromPos)
          ON CREATE SET fromRel.createdAt = datetime(), fromRel.source = $sourceService
          SET fromRel.updatedAt = datetime(), fromRel.eventId = $eventId
        )

        FOREACH (_ IN CASE WHEN $toPositionId = '' THEN [] ELSE [1] END |
          MERGE (toPos:StoragePosition {id: $toPositionId})
          ON CREATE SET toPos.createdAt = datetime(), toPos.source = $sourceService
          SET toPos.updatedAt = datetime()
          MERGE (custody)-[toRel:TO]->(toPos)
          ON CREATE SET toRel.createdAt = datetime(), toRel.source = $sourceService
          SET toRel.updatedAt = datetime(), toRel.eventId = $eventId
        )

        RETURN custody.id AS custodyEventId
      `,
      {
        specimenId,
        custodyEventId,
        custodyEventType: normalizeText(payload.eventType),
        happenedAt,
        actorId: payload.actorId || null,
        reason: payload.reason || null,
        fromPositionId,
        toPositionId,
        sourceService: normalizeText(event.sourceService) || 'unknown',
        eventId: normalizeText(event.eventId),
      }
    );

    return { projected: true, eventType: event.eventType, specimenId, custodyEventId };
  }

  async applyStorageAssignmentProjection(session, event) {
    const payload = event?.payload || {};
    const assignmentId = normalizeText(payload.specimenContainerAssignmentId || event.aggregateId);
    const specimenId = normalizeText(payload.specimenId);
    if (!assignmentId || !specimenId) {
      throw new Error('[RF023] Storage assignment projection requires assignment and specimen ids');
    }

    await session.run(
      `
        MERGE (sample:Sample:Specimen {id: $specimenId})
        ON CREATE SET sample.createdAt = datetime(), sample.source = $sourceService
        SET sample.updatedAt = datetime()

        MERGE (assignment:SpecimenContainerAssignment {id: $assignmentId})
        ON CREATE SET assignment.createdAt = datetime(), assignment.source = $sourceService
        SET assignment.updatedAt = datetime(),
            assignment.containerId = $containerId,
            assignment.assignedAt = CASE WHEN $assignedAt IS NULL THEN assignment.assignedAt ELSE datetime($assignedAt) END,
            assignment.releasedAt = CASE WHEN $releasedAt IS NULL THEN null ELSE datetime($releasedAt) END,
            assignment.lastProjectionEventId = $eventId

        MERGE (sample)-[stored:HAS_CONTAINER_ASSIGNMENT]->(assignment)
        ON CREATE SET stored.createdAt = datetime(), stored.source = $sourceService
        SET stored.updatedAt = datetime(), stored.eventId = $eventId

        FOREACH (_ IN CASE WHEN $containerPositionAssignmentId = '' THEN [] ELSE [1] END |
          MERGE (positionAssignment:ContainerPositionAssignment {id: $containerPositionAssignmentId})
          ON CREATE SET positionAssignment.createdAt = datetime(), positionAssignment.source = $sourceService
          SET positionAssignment.updatedAt = datetime(),
              positionAssignment.storagePositionId = $storagePositionId,
              positionAssignment.lastProjectionEventId = $eventId
          MERGE (assignment)-[:LOCATED_BY]->(positionAssignment)
        )

        FOREACH (_ IN CASE WHEN $rackLocationAssignmentId = '' THEN [] ELSE [1] END |
          MERGE (rackAssignment:RackLocationAssignment {id: $rackLocationAssignmentId})
          ON CREATE SET rackAssignment.createdAt = datetime(), rackAssignment.source = $sourceService
          SET rackAssignment.updatedAt = datetime(),
              rackAssignment.storageRackId = $storageRackId,
              rackAssignment.storageLocationId = $storageLocationId,
              rackAssignment.lastProjectionEventId = $eventId
          MERGE (assignment)-[:RESOLVES_RACK_LOCATION]->(rackAssignment)
        )

        RETURN assignment.id AS assignmentId
      `,
      {
        specimenId,
        assignmentId,
        containerId: payload.containerId || null,
        assignedAt: normalizeIso(payload.assignedAt),
        releasedAt: normalizeIso(payload.releasedAt),
        containerPositionAssignmentId: normalizeText(payload.containerPositionAssignmentId),
        storagePositionId: payload.storagePositionId || null,
        rackLocationAssignmentId: normalizeText(payload.rackLocationAssignmentId),
        storageRackId: payload.storageRackId || null,
        storageLocationId: payload.storageLocationId || null,
        sourceService: normalizeText(event.sourceService) || 'unknown',
        eventId: normalizeText(event.eventId),
      }
    );

    return { projected: true, eventType: event.eventType, specimenId, assignmentId };
  }

  async applyTelemetryExposureSummaryProjection(session, event) {
    const payload = event?.payload || {};
    const summaryId = normalizeText(payload.telemetryExposureSummaryId || event.aggregateId);
    const specimenId = normalizeText(payload.specimenId);
    if (!summaryId || !specimenId) {
      throw new Error('[RF023] Telemetry exposure projection requires summary and specimen ids');
    }

    const windowStart = normalizeIso(payload.windowStart);
    const windowEnd = normalizeIso(payload.windowEnd);
    const calculatedAt = normalizeIso(payload.calculatedAt || event.occurredAt) || new Date().toISOString();

    await session.run(
      `
        MERGE (sample:Sample:Specimen {id: $specimenId})
        ON CREATE SET sample.createdAt = datetime(), sample.source = $sourceService
        SET sample.updatedAt = datetime()

        MERGE (summary:TelemetryExposureSummary {id: $summaryId})
        ON CREATE SET summary.createdAt = datetime(), summary.source = $sourceService
        SET summary.updatedAt = datetime(),
            summary.exposurePathHash = $exposurePathHash,
            summary.datastreamIds = $datastreamIds,
            summary.observationCount = $observationCount,
            summary.minimumValue = $minimumValue,
            summary.maximumValue = $maximumValue,
            summary.meanValue = $meanValue,
            summary.timeOutsideThresholdSeconds = $timeOutsideThresholdSeconds,
            summary.excursionCount = $excursionCount,
            summary.coverageRatio = $coverageRatio,
            summary.sourceQueryHash = $sourceQueryHash,
            summary.sourceReadingSetHash = $sourceReadingSetHash,
            summary.calculationVersion = $calculationVersion,
            summary.calculatedAt = datetime($calculatedAt),
            summary.windowStart = CASE WHEN $windowStart IS NULL THEN null ELSE datetime($windowStart) END,
            summary.windowEnd = CASE WHEN $windowEnd IS NULL THEN null ELSE datetime($windowEnd) END,
            summary.lastProjectionEventId = $eventId,
            summary.lastProjectionAt = datetime()

        MERGE (sample)-[exposed:HAS_TELEMETRY_EXPOSURE]->(summary)
        ON CREATE SET exposed.createdAt = datetime(), exposed.source = $sourceService
        SET exposed.updatedAt = datetime(), exposed.eventId = $eventId

        FOREACH (_ IN CASE WHEN $specimenContainerAssignmentId = '' THEN [] ELSE [1] END |
          MERGE (assignment:SpecimenContainerAssignment {id: $specimenContainerAssignmentId})
          ON CREATE SET assignment.createdAt = datetime(), assignment.source = $sourceService
          SET assignment.updatedAt = datetime()
          MERGE (summary)-[through:EXPOSURE_THROUGH]->(assignment)
          ON CREATE SET through.createdAt = datetime(), through.source = $sourceService
          SET through.updatedAt = datetime(), through.eventId = $eventId
        )

        RETURN summary.id AS summaryId
      `,
      {
        summaryId,
        specimenId,
        specimenContainerAssignmentId: normalizeText(payload.specimenContainerAssignmentId),
        exposurePathHash: payload.exposurePathHash || null,
        datastreamIds: Array.isArray(payload.datastreamIds) ? payload.datastreamIds.map(String) : [],
        windowStart,
        windowEnd,
        observationCount: Number(payload.observationCount || 0),
        minimumValue: payload.minimumValue ?? null,
        maximumValue: payload.maximumValue ?? null,
        meanValue: payload.meanValue ?? null,
        timeOutsideThresholdSeconds: Number(payload.timeOutsideThresholdSeconds || 0),
        excursionCount: Number(payload.excursionCount || 0),
        coverageRatio: payload.coverageRatio ?? null,
        sourceQueryHash: payload.sourceQueryHash || null,
        sourceReadingSetHash: payload.sourceReadingSetHash || null,
        calculationVersion: payload.calculationVersion || '2.0.0',
        calculatedAt,
        sourceService: normalizeText(event.sourceService) || 'unknown',
        eventId: normalizeText(event.eventId),
      }
    );

    return { projected: true, eventType: event.eventType, specimenId, summaryId };
  }
}

module.exports = {
  Neo4jCanonicalProjectionV2Service,
};
