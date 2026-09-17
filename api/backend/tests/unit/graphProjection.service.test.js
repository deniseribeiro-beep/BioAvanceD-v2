import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { GraphProjectionService, stableHash } = require('../../src/services/graphProjection.service');

function createFakeOutbox() {
  return { appendEvent: vi.fn().mockResolvedValue({ ok: true }) };
}

describe('graphProjection.service', () => {
  describe('stableHash', () => {
    it('produces the same hash regardless of key order', () => {
      expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
    });

    it('produces different hashes for different payloads', () => {
      expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
    });

    it('hashes nullish payloads as an empty object', () => {
      expect(stableHash(undefined)).toBe(stableHash({}));
      expect(stableHash(null)).toBe(stableHash({}));
    });

    it('returns a 64-char hex sha256 digest', () => {
      expect(stableHash({ x: 1 })).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('constructor', () => {
    it('defaults to a real Neo4jOutboxService when no outbox option is given', () => {
      const service = new GraphProjectionService();
      expect(service.outbox).toBeTruthy();
      expect(typeof service.outbox.appendEvent).toBe('function');
    });

    it('uses the injected outbox when provided', () => {
      const outbox = createFakeOutbox();
      expect(new GraphProjectionService({ outbox }).outbox).toBe(outbox);
    });
  });

  describe('appendConsentEvent', () => {
    it('emits participant-scoped CONSENT_UPSERTED without specimen authority (#1026)', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      const db = {};

      await service.appendConsentEvent(db, {
        ethicalConsentId: 'ec-1',
        participantId: 'donor-1',
        specimenId: 'must-not-leak',
        status: 'ACTIVE',
        signedAt: '2026-01-01T00:00:00Z',
        sourceService: 'custom-source',
        traceId: 'trace-1',
      });

      expect(outbox.appendEvent).toHaveBeenCalledTimes(1);
      const [calledDb, event] = outbox.appendEvent.mock.calls[0];
      expect(calledDb).toBe(db);
      expect(event).toEqual(expect.objectContaining({
        eventType: 'CONSENT_UPSERTED',
        aggregateType: 'EthicalConsent',
        aggregateId: 'ec-1',
        sourceService: 'custom-source',
        traceId: 'trace-1',
        schemaVersion: 2,
      }));
      expect(event.payload).toEqual({
        participantId: 'donor-1',
        ethicalConsentId: 'ec-1',
        consentTemplateId: null,
        status: 'ACTIVE',
        signedAt: '2026-01-01T00:00:00Z',
        revokedAt: null,
      });
      expect(event.payload).not.toHaveProperty('specimenId');
    });

    it('emits CONSENT_REVOKED only with explicit participant and status', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendConsentEvent({}, {
        ethicalConsentId: 'ec-2',
        participantId: 'p-2',
        status: 'REVOKED',
      });

      expect(outbox.appendEvent.mock.calls[0][1].eventType).toBe('CONSENT_REVOKED');
    });

    it('accepts consentId/aggregateId only as consent identity when participant/status are explicit', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendConsentEvent({}, { consentId: 'c-3', participantId: 'p-3', status: 'ACTIVE' });
      let event = outbox.appendEvent.mock.calls[0][1];
      expect(event.aggregateId).toBe('c-3');
      expect(event.payload.ethicalConsentId).toBe('c-3');
      expect(event.payload).not.toHaveProperty('specimenId');

      await service.appendConsentEvent({}, { aggregateId: 'c-4', participantId: 'p-4', status: 'VALID' });
      event = outbox.appendEvent.mock.calls[1][1];
      expect(event.aggregateId).toBe('c-4');
      expect(event.payload.ethicalConsentId).toBe('c-4');
      expect(event.payload.status).toBe('VALID');
    });

    it('fails closed when status, participantId or consent identity is absent (#1026)', async () => {
      const service = new GraphProjectionService({ outbox: createFakeOutbox() });

      await expect(service.appendConsentEvent({}, {
        ethicalConsentId: 'c-status', participantId: 'p-status',
      })).rejects.toThrow('requires explicit status');

      await expect(service.appendConsentEvent({}, {
        ethicalConsentId: 'c-participant', status: 'ACTIVE',
      })).rejects.toThrow('requires participantId');

      await expect(service.appendConsentEvent({}, {
        participantId: 'p-consent', status: 'ACTIVE',
      })).rejects.toThrow('requires ethicalConsentId');
    });

    it('rejects unsupported consent state instead of converting it to ACTIVE', async () => {
      const service = new GraphProjectionService({ outbox: createFakeOutbox() });
      await expect(service.appendConsentEvent({}, {
        ethicalConsentId: 'c-unknown', participantId: 'p-unknown', status: 'UNKNOWN',
      })).rejects.toThrow('Unsupported consent projection status');
    });
  });

  describe('appendLineageEvent', () => {
    it('uses specimenId for aggregateId and payload when present', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      await service.appendLineageEvent({}, { specimenId: 's-1', parentSpecimenId: 'p-1', traceId: 't-1' });
      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('LINEAGE_REGISTERED');
      expect(call.aggregateId).toBe('s-1');
      expect(call.payload).toEqual({ specimenId: 's-1', parentSpecimenId: 'p-1' });
      expect(call.traceId).toBe('t-1');
    });

    it('falls back to childSpecimenId then aggregateId', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      await service.appendLineageEvent({}, { childSpecimenId: 'child-1' });
      expect(outbox.appendEvent.mock.calls[0][1].aggregateId).toBe('child-1');
      await service.appendLineageEvent({}, { aggregateId: 'agg-2' });
      expect(outbox.appendEvent.mock.calls[1][1].aggregateId).toBe('agg-2');
    });
  });

  describe('appendQualityEvent', () => {
    it('emits QUALITY_ASSESSED with provided fields', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      await service.appendQualityEvent({}, {
        specimenId: 's-1', qualityAssessmentId: 'qa-1', status: 'PASSED', score: 0.9,
        evaluatedAt: '2026-01-02T00:00:00Z',
      });
      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('QUALITY_ASSESSED');
      expect(call.aggregateId).toBe('s-1');
      expect(call.payload.score).toBe(0.9);
    });

    it('preserves a score of 0', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      await service.appendQualityEvent({}, { specimenId: 's-0', score: 0 });
      expect(outbox.appendEvent.mock.calls[0][1].payload.score).toBe(0);
    });
  });

  describe('appendTelemetryEvent', () => {
    it('emits TELEMETRY_INCIDENT_RECORDED with provided fields', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      await service.appendTelemetryEvent({}, {
        specimenId: 's-1', telemetryIncidentId: 'ti-1', severity: 'HIGH', status: 'OPEN',
        occurredAt: '2026-01-03T00:00:00Z',
      });
      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('TELEMETRY_INCIDENT_RECORDED');
      expect(call.aggregateId).toBe('s-1');
      expect(call.payload.severity).toBe('HIGH');
    });
  });

  describe('appendTerminologyConceptEvent', () => {
    it('emits TERMINOLOGY_CONCEPT_PROMOTED with provided fields', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      await service.appendTerminologyConceptEvent({}, {
        terminologyConceptId: 'tc-1', systemUri: 'http://purl.obolibrary.org/obo/hp.owl',
        code: 'HP:0000001', version: 'sample-2026-07-31', display: 'All', conceptStatus: 'active',
        referenceDatasetReleaseId: 'rel-1',
      });
      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('TERMINOLOGY_CONCEPT_PROMOTED');
      expect(call.aggregateId).toBe('tc-1');
      expect(call.payload.code).toBe('HP:0000001');
    });
  });

  describe('appendTerminologyRelationEvent', () => {
    it('emits TERMINOLOGY_RELATION_PROMOTED with provided fields', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      await service.appendTerminologyRelationEvent({}, {
        terminologyRelationId: 'tr-1', sourceConceptId: 'tc-source', targetConceptId: 'tc-target',
        relationType: 'is_a', relationVersion: 'sample-2026-07-31', referenceDatasetReleaseId: 'rel-1',
      });
      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('TERMINOLOGY_RELATION_PROMOTED');
      expect(call.aggregateId).toBe('tr-1');
      expect(call.payload.sourceConceptId).toBe('tc-source');
    });
  });

  describe('canonical v2 projection branch matrix', () => {
    function setup() {
      const outbox = createFakeOutbox();
      return {
        outbox,
        service: new GraphProjectionService({ outbox }),
        eventAt(index = -1) {
          const calls = outbox.appendEvent.mock.calls;
          return calls[index < 0 ? calls.length - 1 : index][1];
        },
      };
    }

    it('normalizes consent aliases, status casing and governed defaults', async () => {
      const { service, outbox, eventAt } = setup();
      const options = { session: { id: 'tx-consent' } };

      await service.appendConsentEvent({}, {
        aggregateId: ' consent-aggregate ',
        participantId: ' participant-1 ',
        status: ' granted ',
        consentTemplateId: 'template-1',
        revokedAt: '2026-09-17T10:00:00Z',
      }, options);

      const event = eventAt();
      expect(event).toMatchObject({
        eventType: 'CONSENT_UPSERTED',
        aggregateId: 'consent-aggregate',
        sourceService: 'graph-projection-service',
        traceId: null,
      });
      expect(event.payload).toMatchObject({
        participantId: 'participant-1',
        ethicalConsentId: 'consent-aggregate',
        consentTemplateId: 'template-1',
        status: 'GRANTED',
        revokedAt: '2026-09-17T10:00:00Z',
      });
      expect(event.payload.signedAt).toBeInstanceOf(Date);
      expect(outbox.appendEvent).toHaveBeenCalledWith({}, event, options);
    });

    it('covers specimen parent arrays, singular fallback and null-safe projection fields', async () => {
      const { service, eventAt } = setup();

      await service.appendSpecimenEvent({}, {
        specimenId: 'specimen-1',
        participantId: 'participant-1',
        parentSpecimenIds: ['parent-1', 'parent-2'],
        barcode: 'BC-1',
        specimenStatus: 'available',
        sourceService: 'specimen-service',
        traceId: 'trace-specimen',
      });
      expect(eventAt().payload).toEqual({
        specimenId: 'specimen-1',
        participantId: 'participant-1',
        parentSpecimenId: null,
        parentSpecimenIds: ['parent-1', 'parent-2'],
        barcode: 'BC-1',
        specimenStatus: 'available',
      });

      await service.appendSpecimenEvent({}, {
        aggregateId: 'specimen-2',
        parentSpecimenId: 'parent-only',
        status: 'reserved',
      });
      expect(eventAt()).toMatchObject({
        aggregateId: 'specimen-2',
        sourceService: 'graph-projection-service',
        traceId: null,
        payload: {
          specimenId: null,
          participantId: null,
          parentSpecimenId: 'parent-only',
          parentSpecimenIds: ['parent-only'],
          barcode: null,
          specimenStatus: 'reserved',
        },
      });

      await service.appendSpecimenEvent({}, {});
      expect(eventAt().payload.parentSpecimenIds).toEqual([]);
      expect(eventAt().aggregateId).toBe('');
    });

    it('projects custody with supplied evidence and auditable defaults', async () => {
      const { service, eventAt } = setup();
      const supplied = {
        specimenId: 'specimen-1',
        custodyEventId: 'custody-1',
        eventType: 'TRANSFER',
        happenedAt: '2026-09-17T11:00:00Z',
        actorId: 'actor-1',
        reason: 'approved-transfer',
        from: { containerId: 'c-1' },
        to: { containerId: 'c-2' },
        sourceService: 'custody-service',
        traceId: 'trace-custody',
      };
      await service.appendCustodyEvent({}, supplied);
      expect(eventAt()).toMatchObject({
        aggregateId: 'specimen-1',
        sourceService: 'custody-service',
        traceId: 'trace-custody',
        payload: supplied,
      });

      await service.appendCustodyEvent({}, { aggregateId: 'aggregate-only' });
      const defaults = eventAt();
      expect(defaults.aggregateId).toBe('aggregate-only');
      expect(defaults.payload.happenedAt).toBeInstanceOf(Date);
      expect(defaults.payload).toMatchObject({
        specimenId: null,
        custodyEventId: null,
        eventType: null,
        actorId: null,
        reason: null,
        from: null,
        to: null,
      });
    });

    it('distinguishes assignment upsert from release without reintroducing storage snapshots', async () => {
      const { service, eventAt } = setup();
      const assignment = {
        specimenContainerAssignmentId: 'sca-1',
        specimenId: 'specimen-1',
        containerId: 'container-1',
        containerPositionAssignmentId: 'cpa-1',
        storagePositionId: 'position-1',
        rackLocationAssignmentId: 'rla-1',
        storageRackId: 'rack-1',
        storageLocationId: 'location-1',
        assignedAt: 'assigned',
        placedAt: 'placed',
        sourceService: 'storage-service',
        traceId: 'trace-storage',
      };
      await service.appendSpecimenContainerAssignmentEvent({}, assignment);
      expect(eventAt()).toMatchObject({
        eventType: 'SPECIMEN_CONTAINER_ASSIGNMENT_UPSERTED',
        aggregateId: 'sca-1',
        sourceService: 'storage-service',
        traceId: 'trace-storage',
        payload: {
          ...assignment,
          sourceService: undefined,
          traceId: undefined,
          releasedAt: null,
          removedAt: null,
        },
      });

      await service.appendSpecimenContainerAssignmentEvent({}, {
        aggregateId: 'sca-2',
        releasedAt: 'released',
        removedAt: 'removed',
      });
      expect(eventAt()).toMatchObject({
        eventType: 'SPECIMEN_CONTAINER_ASSIGNMENT_RELEASED',
        aggregateId: 'sca-2',
        payload: {
          specimenContainerAssignmentId: null,
          specimenId: null,
          containerId: null,
          containerPositionAssignmentId: null,
          storagePositionId: null,
          rackLocationAssignmentId: null,
          storageRackId: null,
          storageLocationId: null,
          assignedAt: null,
          releasedAt: 'released',
          placedAt: null,
          removedAt: 'removed',
        },
      });
    });

    it('covers lineage, quality and telemetry fallback identities and defaults', async () => {
      const { service, eventAt } = setup();

      await service.appendLineageEvent({}, { aggregateId: 'lineage-aggregate' });
      expect(eventAt()).toMatchObject({
        aggregateId: 'lineage-aggregate',
        sourceService: 'graph-projection-service',
        traceId: null,
        payload: { specimenId: null, parentSpecimenId: null },
      });

      await service.appendQualityEvent({}, { aggregateId: 'quality-aggregate' });
      expect(eventAt().payload).toMatchObject({
        specimenId: null,
        qualityAssessmentId: null,
        status: 'UNKNOWN',
        score: null,
      });
      expect(eventAt().payload.evaluatedAt).toBeInstanceOf(Date);

      await service.appendTelemetryEvent({}, { aggregateId: 'telemetry-aggregate' });
      expect(eventAt().payload).toMatchObject({
        specimenId: null,
        telemetryIncidentId: null,
        severity: 'UNKNOWN',
        status: 'OPEN',
      });
      expect(eventAt().payload.occurredAt).toBeInstanceOf(Date);
    });

    it('projects complete and defaulted telemetry exposure summaries deterministically', async () => {
      const { service, eventAt } = setup();
      await service.appendTelemetryExposureSummaryEvent({}, {
        telemetryExposureSummaryId: 'summary-1',
        specimenId: 'specimen-1',
        specimenContainerAssignmentId: 'sca-1',
        containerPositionAssignmentId: 'cpa-1',
        rackLocationAssignmentId: 'rla-1',
        exposurePathHash: 'path-hash',
        datastreamIds: ['stream-1'],
        windowStart: 'start',
        windowEnd: 'end',
        observationCount: 4,
        minimumValue: 0,
        maximumValue: 8,
        meanValue: 4,
        timeOutsideThresholdSeconds: 0,
        excursionCount: 2,
        coverageRatio: 0,
        sourceQueryHash: 'query-hash',
        sourceReadingSetHash: 'reading-hash',
        calculationVersion: '2.0.0',
        calculatedAt: 'calculated',
        sourceService: 'telemetry-service',
        traceId: 'trace-summary',
      });
      expect(eventAt().payload).toMatchObject({
        datastreamIds: ['stream-1'],
        observationCount: 4,
        minimumValue: 0,
        maximumValue: 8,
        meanValue: 4,
        timeOutsideThresholdSeconds: 0,
        excursionCount: 2,
        coverageRatio: 0,
        calculationVersion: '2.0.0',
        calculatedAt: 'calculated',
      });

      await service.appendTelemetryExposureSummaryEvent({}, { aggregateId: 'summary-defaults' });
      const event = eventAt();
      expect(event.aggregateId).toBe('summary-defaults');
      expect(event.payload).toMatchObject({
        telemetryExposureSummaryId: null,
        specimenId: null,
        specimenContainerAssignmentId: null,
        containerPositionAssignmentId: null,
        rackLocationAssignmentId: null,
        exposurePathHash: null,
        datastreamIds: [],
        windowStart: null,
        windowEnd: null,
        observationCount: 0,
        minimumValue: null,
        maximumValue: null,
        meanValue: null,
        timeOutsideThresholdSeconds: 0,
        excursionCount: 0,
        coverageRatio: null,
        sourceQueryHash: null,
        sourceReadingSetHash: null,
        calculationVersion: '1.0.0',
      });
      expect(event.payload.calculatedAt).toBeInstanceOf(Date);
    });

    it('covers terminology identity fallbacks, governed defaults and optional fields', async () => {
      const { service, eventAt } = setup();

      await service.appendTerminologyConceptEvent({}, { aggregateId: 'concept-defaults' });
      expect(eventAt()).toMatchObject({
        aggregateId: 'concept-defaults',
        sourceService: 'graph-projection-service',
        traceId: null,
        payload: {
          terminologyConceptId: null,
          systemUri: null,
          code: null,
          version: null,
          display: null,
          conceptStatus: 'active',
          referenceDatasetReleaseId: null,
        },
      });

      await service.appendTerminologyRelationEvent({}, { aggregateId: 'relation-defaults' });
      expect(eventAt()).toMatchObject({
        aggregateId: 'relation-defaults',
        sourceService: 'graph-projection-service',
        traceId: null,
        payload: {
          terminologyRelationId: null,
          sourceConceptId: null,
          targetConceptId: null,
          relationType: null,
          relationVersion: null,
          referenceDatasetReleaseId: null,
        },
      });
    });
  });

});
