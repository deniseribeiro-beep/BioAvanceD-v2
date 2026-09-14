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
});
