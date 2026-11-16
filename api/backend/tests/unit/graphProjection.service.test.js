import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { GraphProjectionService, insertSampleWithProjection, recordLineageProjection, recordSpecimenProjection, stableHash } = require('../../src/services/graphProjection.service');
const logger = require('../../src/utils/logger');

function createFakeOutbox() {
  return { appendEvent: vi.fn().mockResolvedValue({ ok: true }) };
}

describe('graphProjection.service', () => {
  describe('stableHash', () => {
    it('produces the same hash regardless of key order', () => {
      const a = stableHash({ b: 2, a: 1 });
      const b = stableHash({ a: 1, b: 2 });
      expect(a).toBe(b);
    });

    it('produces different hashes for different payloads', () => {
      const a = stableHash({ a: 1 });
      const b = stableHash({ a: 2 });
      expect(a).not.toBe(b);
    });

    it('hashes an undefined payload the same as an empty object (issue #176 fix)', () => {
      expect(() => stableHash(undefined)).not.toThrow();
      expect(stableHash(undefined)).toBe(stableHash({}));
    });

    it('hashes a null payload the same as an empty object', () => {
      expect(() => stableHash(null)).not.toThrow();
      expect(stableHash(null)).toBe(stableHash({}));
    });

    it('returns a 64-char hex sha256 digest', () => {
      const hash = stableHash({ x: 1 });
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
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
      const service = new GraphProjectionService({ outbox });
      expect(service.outbox).toBe(outbox);
    });
  });

  describe('appendConsentEvent', () => {
    it('emits CONSENT_UPSERTED for a non-REVOKED status', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      const db = {};

      await service.appendConsentEvent(db, {
        ethicalConsentId: 'ec-1',
        participantId: 'donor-1',
        specimenId: 'sample-1',
        status: 'ACTIVE',
        signedAt: '2026-01-01T00:00:00Z',
        sourceService: 'custom-source',
        traceId: 'trace-1',
      });

      expect(outbox.appendEvent).toHaveBeenCalledWith(db, expect.objectContaining({
        eventType: 'CONSENT_UPSERTED',
        aggregateType: 'EthicalConsent',
        aggregateId: 'ec-1',
        sourceService: 'custom-source',
        traceId: 'trace-1',
        schemaVersion: 1,
        payload: expect.objectContaining({
          participantId: 'donor-1',
          specimenId: 'sample-1',
          ethicalConsentId: 'ec-1',
          status: 'ACTIVE',
          signedAt: '2026-01-01T00:00:00Z',
        }),
      }), {});
    });

    // #1313 (RF023 AC3): the caller's transaction reaches the outbox append.
    it('forwards the caller session to the outbox append', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      const session = { id: 'session-1' };

      await service.appendConsentEvent({}, { ethicalConsentId: 'ec-9' }, { session });

      expect(outbox.appendEvent.mock.calls[0][2]).toEqual({ session });
    });

    it('emits CONSENT_REVOKED when status is REVOKED', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendConsentEvent({}, { ethicalConsentId: 'ec-2', status: 'REVOKED' });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('CONSENT_REVOKED');
    });

    it('falls back through consentId then aggregateId for aggregateId, and defaults status/sourceService/signedAt', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendConsentEvent({}, { consentId: 'c-3' });
      let call = outbox.appendEvent.mock.calls[0][1];
      expect(call.aggregateId).toBe('c-3');
      expect(call.payload.status).toBe('ACTIVE');
      expect(call.payload.specimenId).toBeNull();
      expect(call.payload.ethicalConsentId).toBe('c-3');
      expect(call.sourceService).toBe('graph-projection-service');
      expect(call.traceId).toBeNull();
      expect(call.payload.signedAt).toBeInstanceOf(Date);

      await service.appendConsentEvent({}, { aggregateId: 'agg-4' });
      call = outbox.appendEvent.mock.calls[1][1];
      expect(call.aggregateId).toBe('agg-4');

      await service.appendConsentEvent({}, {});
      call = outbox.appendEvent.mock.calls[2][1];
      expect(call.aggregateId).toBe('');
      expect(call.payload.ethicalConsentId).toBeNull();
    });
  });

  describe('appendSpecimenEvent (#1225)', () => {
    it('emits SPECIMEN_UPSERTED carrying the specimen key and its donor', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendSpecimenEvent({}, { specimenId: 'mongo-1', participantId: 'P-1', sourceService: 'sample.service' });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('SPECIMEN_UPSERTED');
      expect(call.aggregateType).toBe('Sample');
      expect(call.aggregateId).toBe('mongo-1');
      expect(call.payload).toEqual({ specimenId: 'mongo-1', participantId: 'P-1' });
      expect(call.sourceService).toBe('sample.service');
    });

    it('recordSpecimenProjection logs and returns null when the append fails, rather than failing the committed insert', async () => {
      const service = { appendSpecimenEvent: vi.fn().mockRejectedValue(new Error('outbox down')) };
      await expect(recordSpecimenProjection({}, { specimenId: 'mongo-1', participantId: 'P-1' }, service)).resolves.toBeNull();
      expect(service.appendSpecimenEvent).toHaveBeenCalledWith({}, { specimenId: 'mongo-1', participantId: 'P-1', sourceService: undefined });
    });

    // #1313 (RF023 AC3): on a replica set the sample and its event share a
    // transaction, and a failed append fails the insert with it.
    describe('insertSampleWithProjection', () => {
      const sample = { specimenId: 'S-1', participantId: 'P-1' };
      const replicaSetDb = (session) => ({
        client: {
          db: () => ({ command: async () => ({ setName: 'rs0' }) }),
          startSession: () => session,
        },
      });

      it('inserts and appends with the same session on a replica set', async () => {
        const session = { withTransaction: vi.fn(async (fn) => { await fn(); }), endSession: vi.fn(async () => {}) };
        const db = replicaSetDb(session);
        const samples = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'mongo-1' }) };
        const service = { appendSpecimenEvent: vi.fn().mockResolvedValue({ eventId: 'e-1' }) };

        const result = await insertSampleWithProjection(db, samples, sample, { sourceService: 'import.service' }, service);

        expect(result.insertedId).toBe('mongo-1');
        expect(samples.insertOne).toHaveBeenCalledWith(sample, { session });
        expect(service.appendSpecimenEvent).toHaveBeenCalledWith(db, { specimenId: 'mongo-1', participantId: 'P-1', sourceService: 'import.service' }, { session });
      });

      it('fails the insert when the append fails inside the transaction', async () => {
        const session = { withTransaction: vi.fn(async (fn) => { await fn(); }), endSession: vi.fn(async () => {}) };
        const samples = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'mongo-1' }) };
        const service = { appendSpecimenEvent: vi.fn().mockRejectedValue(new Error('outbox down')) };

        await expect(insertSampleWithProjection(replicaSetDb(session), samples, sample, { sourceService: 'import.service' }, service))
          .rejects.toThrow('outbox down');
      });

      it('without a transaction inserts, then appends as recordSpecimenProjection does', async () => {
        const samples = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'mongo-2' }) };
        const service = { appendSpecimenEvent: vi.fn().mockRejectedValue(new Error('outbox down')) };

        const result = await insertSampleWithProjection({}, samples, sample, { sourceService: 'import.service' }, service);

        expect(result.insertedId).toBe('mongo-2');
        expect(samples.insertOne).toHaveBeenCalledWith(sample);
        expect(service.appendSpecimenEvent).toHaveBeenCalledWith({}, { specimenId: 'mongo-2', participantId: 'P-1', sourceService: 'import.service' });
      });
    });

    it('recordSpecimenProjection appends nothing without a specimen id', async () => {
      const service = { appendSpecimenEvent: vi.fn() };
      await expect(recordSpecimenProjection({}, { specimenId: '', participantId: 'P-1' }, service)).resolves.toBeNull();
      expect(service.appendSpecimenEvent).not.toHaveBeenCalled();
    });
  });

  describe('appendQuarantineReleaseEvent (#1510)', () => {
    it('emits QUARANTINE_RELEASED keyed by the action, with its specimens, rule, actor and evidence, inside the caller session', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      const session = { id: 'session-q' };
      const releasedAt = new Date('2026-11-12T10:00:00Z');

      await service.appendQuarantineReleaseEvent({}, {
        quarantineActionId: 'qa-1',
        specimenIds: ['SPC-1', 2],
        reasonCodes: ['nonconformance'],
        actionStatus: 'released',
        releasedAt,
        authorizedBy: 'coord-1',
        evidenceIds: ['file-1'],
        sourceService: 'quarantine-release',
      }, { session });

      const [, event, options] = outbox.appendEvent.mock.calls[0];
      expect(event).toMatchObject({
        eventType: 'QUARANTINE_RELEASED',
        aggregateType: 'QuarantineAction',
        aggregateId: 'qa-1',
        sourceService: 'quarantine-release',
        schemaVersion: 1,
      });
      expect(event.payload).toEqual({
        quarantineActionId: 'qa-1',
        specimenIds: ['SPC-1', '2'],
        reasonCodes: ['nonconformance'],
        actionStatus: 'released',
        releasedAt,
        authorizedBy: 'coord-1',
        evidenceIds: ['file-1'],
      });
      expect(options).toEqual({ session });
    });
  });

  describe('appendLineageEvent', () => {
    it('uses specimenId for aggregateId and payload when present', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendLineageEvent({}, { specimenId: 's-1', parentSpecimenId: 'p-1', traceId: 't-1' });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('LINEAGE_REGISTERED');
      expect(call.aggregateType).toBe('Sample');
      expect(call.aggregateId).toBe('s-1');
      expect(call.payload).toEqual({ specimenId: 's-1', parentSpecimenId: 'p-1' });
      expect(call.traceId).toBe('t-1');
    });

    it('falls back to childSpecimenId, then aggregateId, then empty string', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendLineageEvent({}, { childSpecimenId: 'child-1' });
      let call = outbox.appendEvent.mock.calls[0][1];
      expect(call.aggregateId).toBe('child-1');
      expect(call.payload.specimenId).toBe('child-1');

      await service.appendLineageEvent({}, { aggregateId: 'agg-2' });
      call = outbox.appendEvent.mock.calls[1][1];
      expect(call.aggregateId).toBe('agg-2');
      expect(call.payload.specimenId).toBeNull();

      await service.appendLineageEvent({}, {});
      call = outbox.appendEvent.mock.calls[2][1];
      expect(call.aggregateId).toBe('');
      expect(call.payload.parentSpecimenId).toBeNull();
    });

    it('stringifies the child and parent ids, as appendSpecimenEvent does', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      const objectId = (hex) => ({ toString: () => hex });

      await service.appendLineageEvent({}, { specimenId: objectId('c-1'), parentSpecimenId: objectId('p-1') });

      expect(outbox.appendEvent.mock.calls[0][1].payload).toEqual({ specimenId: 'c-1', parentSpecimenId: 'p-1' });
    });
  });

  // #1368: a derived sample's edges, one LINEAGE_REGISTERED per parent.
  describe('appendLineageEvents and recordLineageProjection (#1368)', () => {
    it('appends one LINEAGE_REGISTERED per parent, in order, inside the caller session', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      const session = { id: 'session-1' };

      const results = await service.appendLineageEvents({}, { specimenId: 'c-1', parentSpecimenIds: ['p-1', 'p-2', 'p-3'], sourceService: 'sample.service' }, { session });

      expect(results).toHaveLength(3);
      expect(outbox.appendEvent).toHaveBeenCalledTimes(3);
      outbox.appendEvent.mock.calls.forEach(([, event, options], index) => {
        expect(event.eventType).toBe('LINEAGE_REGISTERED');
        expect(event.aggregateId).toBe('c-1');
        expect(event.payload).toEqual({ specimenId: 'c-1', parentSpecimenId: `p-${index + 1}` });
        expect(event.sourceService).toBe('sample.service');
        expect(options).toEqual({ session });
      });
    });

    it.each([
      ['an empty array', []],
      ['no array', undefined],
    ])('appendLineageEvents appends nothing for %s', async (_label, parentSpecimenIds) => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await expect(service.appendLineageEvents({}, { specimenId: 'c-1', parentSpecimenIds })).resolves.toEqual([]);
      expect(outbox.appendEvent).not.toHaveBeenCalled();
    });

    it('appendLineageEvents rejects when an append fails, so the caller transaction aborts', async () => {
      const outbox = { appendEvent: vi.fn().mockRejectedValue(new Error('outbox down')) };
      const service = new GraphProjectionService({ outbox });

      await expect(service.appendLineageEvents({}, { specimenId: 'c-1', parentSpecimenIds: ['p-1'] }, { session: {} }))
        .rejects.toThrow('outbox down');
    });

    it.each([
      ['an empty array', {}, []],
      ['no array', {}, undefined],
      ['no db', null, ['p-1']],
    ])('recordLineageProjection appends nothing for %s', async (_label, db, parentSpecimenIds) => {
      const service = { appendLineageEvent: vi.fn() };
      await recordLineageProjection(db, { specimenId: 'c-1', parentSpecimenIds }, service);
      expect(service.appendLineageEvent).not.toHaveBeenCalled();
    });

    it('recordLineageProjection logs a failed parent and still appends the others, without a session', async () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const service = {
        appendLineageEvent: vi.fn()
          .mockResolvedValueOnce({ ok: true })
          .mockRejectedValueOnce(new Error('outbox down'))
          .mockResolvedValueOnce({ ok: true }),
      };

      await expect(recordLineageProjection({}, { specimenId: 'c-1', parentSpecimenIds: ['p-1', 'p-2', 'p-3'], sourceService: 'sample.service' }, service))
        .resolves.toBeUndefined();

      expect(service.appendLineageEvent.mock.calls).toEqual([
        [{}, { specimenId: 'c-1', parentSpecimenId: 'p-1', sourceService: 'sample.service' }],
        [{}, { specimenId: 'c-1', parentSpecimenId: 'p-2', sourceService: 'sample.service' }],
        [{}, { specimenId: 'c-1', parentSpecimenId: 'p-3', sourceService: 'sample.service' }],
      ]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain('[NEO4J_OUTBOX] LINEAGE_REGISTERED nao registrado para c-1 <- p-2: outbox down');
      errorSpy.mockRestore();
    });
  });

  describe('appendQualityEvent', () => {
    it('emits QUALITY_ASSESSED with provided fields', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendQualityEvent({}, {
        specimenId: 's-1',
        qualityAssessmentId: 'qa-1',
        status: 'PASSED',
        score: 0.9,
        evaluatedAt: '2026-01-02T00:00:00Z',
      });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('QUALITY_ASSESSED');
      expect(call.aggregateType).toBe('Sample');
      expect(call.aggregateId).toBe('s-1');
      expect(call.payload).toEqual({
        specimenId: 's-1',
        qualityAssessmentId: 'qa-1',
        status: 'PASSED',
        score: 0.9,
        evaluatedAt: '2026-01-02T00:00:00Z',
      });
    });

    it('defaults status to UNKNOWN, score to null, and falls back to aggregateId', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendQualityEvent({}, { aggregateId: 'agg-9' });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.aggregateId).toBe('agg-9');
      expect(call.payload.status).toBe('UNKNOWN');
      expect(call.payload.score).toBeNull();
      expect(call.payload.evaluatedAt).toBeInstanceOf(Date);
    });

    it('preserves a score of 0 rather than nullish-coalescing it away', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendQualityEvent({}, { specimenId: 's-0', score: 0 });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.payload.score).toBe(0);
    });
  });

  // #1312: the two writers that used to MERGE into Neo4j directly.
  describe('appendStoragePositionEvent', () => {
    it('emits STORAGE_POSITION_ASSIGNED keyed by the sample, with box and position as strings', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendStoragePositionEvent({}, { specimenId: { toString: () => 's-9' }, boxId: 'box-1', position: 'B2', sourceService: 'storage-service' });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('STORAGE_POSITION_ASSIGNED');
      expect(call.aggregateType).toBe('Sample');
      expect(call.aggregateId).toBe('s-9');
      expect(call.sourceService).toBe('storage-service');
      expect(call.payload).toEqual({ specimenId: 's-9', boxId: 'box-1', position: 'B2' });
    });
  });

  describe('appendCustodyEvent', () => {
    it('emits CUSTODY_EVENT_RECORDED keyed by the sample, inside the caller session', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });
      const session = { id: 'mongo-session' };

      await service.appendCustodyEvent({}, {
        specimenId: { toString: () => 's-1' },
        barcode: 'BC-1',
        eventType: 'move',
        happenedAt: new Date('2026-01-02T03:04:05.000Z'),
        actorId: 'u-1',
        reason: 'reorg',
        from: { boxId: 'b1', position: 'a1' },
        to: { boxId: 'b2', position: 'B2' },
        sourceService: 'lineage-repository',
      }, { session });

      const [, call, options] = outbox.appendEvent.mock.calls[0];
      expect(options).toEqual({ session });
      expect(call.eventType).toBe('CUSTODY_EVENT_RECORDED');
      expect(call.aggregateType).toBe('Sample');
      expect(call.aggregateId).toBe('s-1');
      expect(call.sourceService).toBe('lineage-repository');
      expect(call.payload).toEqual({
        specimenId: 's-1',
        barcode: 'BC-1',
        custodyEventType: 'move',
        happenedAt: '2026-01-02T03:04:05.000Z',
        actorId: 'u-1',
        reason: 'reorg',
        from: { boxId: 'b1', position: 'A1' },
        to: { boxId: 'b2', position: 'B2' },
      });
    });

    it('accepts a happenedAt string (a step replayed from the retry queue) and nulls a missing location', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendCustodyEvent({}, { specimenId: 's-1', eventType: 'register', happenedAt: '2026-01-02T03:04:05.000Z' });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.payload).toMatchObject({ happenedAt: '2026-01-02T03:04:05.000Z', from: null, to: null, actorId: null, reason: null });
    });
  });

  describe('appendSpecimenCompromiseEvent', () => {
    it('emits SPECIMEN_COMPROMISED with the excursion and drops any temperature field', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendSpecimenCompromiseEvent({}, {
        specimenId: 's-1',
        freezerKey: 'freezer-A',
        breachedSince: '2026-01-01T00:00:00.000Z',
        maxObservedTemp: -50,
      });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('SPECIMEN_COMPROMISED');
      expect(call.aggregateId).toBe('s-1');
      expect(call.payload).toEqual({ specimenId: 's-1', freezerKey: 'freezer-A', breachedSince: '2026-01-01T00:00:00.000Z' });
    });
  });

  describe('appendTelemetryEvent', () => {
    it('emits TELEMETRY_INCIDENT_RECORDED with provided fields', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendTelemetryEvent({}, {
        specimenId: 's-1',
        telemetryIncidentId: 'ti-1',
        severity: 'HIGH',
        status: 'OPEN',
        occurredAt: '2026-01-03T00:00:00Z',
      });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('TELEMETRY_INCIDENT_RECORDED');
      expect(call.aggregateType).toBe('Sample');
      expect(call.aggregateId).toBe('s-1');
      expect(call.payload).toEqual({
        specimenId: 's-1',
        telemetryIncidentId: 'ti-1',
        severity: 'HIGH',
        status: 'OPEN',
        occurredAt: '2026-01-03T00:00:00Z',
      });
    });

    it('defaults severity to UNKNOWN and status to OPEN, and falls back to aggregateId', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendTelemetryEvent({}, { aggregateId: 'agg-7' });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.aggregateId).toBe('agg-7');
      expect(call.payload.severity).toBe('UNKNOWN');
      expect(call.payload.status).toBe('OPEN');
      expect(call.payload.occurredAt).toBeInstanceOf(Date);
    });
  });

  describe('appendTerminologyConceptEvent', () => {
    it('emits TERMINOLOGY_CONCEPT_PROMOTED with provided fields', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendTerminologyConceptEvent({}, {
        terminologyConceptId: 'tc-1',
        systemUri: 'http://purl.obolibrary.org/obo/hp.owl',
        code: 'HP:0000001',
        version: 'sample-2026-07-31',
        display: 'All',
        conceptStatus: 'active',
        referenceDatasetReleaseId: 'rel-1',
      });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('TERMINOLOGY_CONCEPT_PROMOTED');
      expect(call.aggregateType).toBe('TerminologyConcept');
      expect(call.aggregateId).toBe('tc-1');
      expect(call.payload).toEqual({
        terminologyConceptId: 'tc-1',
        systemUri: 'http://purl.obolibrary.org/obo/hp.owl',
        code: 'HP:0000001',
        version: 'sample-2026-07-31',
        display: 'All',
        conceptStatus: 'active',
        referenceDatasetReleaseId: 'rel-1',
      });
    });

    it('defaults conceptStatus to active and falls back to aggregateId', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendTerminologyConceptEvent({}, { aggregateId: 'agg-tc' });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.aggregateId).toBe('agg-tc');
      expect(call.payload.conceptStatus).toBe('active');
      expect(call.payload.systemUri).toBeNull();
      expect(call.payload.code).toBeNull();
    });
  });

  describe('appendTerminologyRelationEvent', () => {
    it('emits TERMINOLOGY_RELATION_PROMOTED with provided fields', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendTerminologyRelationEvent({}, {
        terminologyRelationId: 'tr-1',
        sourceConceptId: 'tc-source',
        targetConceptId: 'tc-target',
        relationType: 'is_a',
        relationVersion: 'sample-2026-07-31',
        referenceDatasetReleaseId: 'rel-1',
      });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.eventType).toBe('TERMINOLOGY_RELATION_PROMOTED');
      expect(call.aggregateType).toBe('TerminologyRelation');
      expect(call.aggregateId).toBe('tr-1');
      expect(call.payload).toEqual({
        terminologyRelationId: 'tr-1',
        sourceConceptId: 'tc-source',
        targetConceptId: 'tc-target',
        relationType: 'is_a',
        relationVersion: 'sample-2026-07-31',
        referenceDatasetReleaseId: 'rel-1',
      });
    });

    it('falls back to aggregateId when terminologyRelationId is absent', async () => {
      const outbox = createFakeOutbox();
      const service = new GraphProjectionService({ outbox });

      await service.appendTerminologyRelationEvent({}, { aggregateId: 'agg-tr' });

      const call = outbox.appendEvent.mock.calls[0][1];
      expect(call.aggregateId).toBe('agg-tr');
      expect(call.payload.sourceConceptId).toBeNull();
      expect(call.payload.targetConceptId).toBeNull();
    });
  });
  // #1561: a batch of promoted records goes to the outbox as one call,
  // each event the shape its single append gives, in the caller's session.
  describe('appendTerminologyConceptEvents / appendTerminologyRelationEvents', () => {
    it('hands the outbox one batch of the single-append event shapes, with the caller session', async () => {
      const outbox = { ...createFakeOutbox(), appendEvents: vi.fn().mockResolvedValue([]) };
      const service = new GraphProjectionService({ outbox });
      const session = { id: 'tx-1561' };
      const concept = { terminologyConceptId: 'tc-1', systemUri: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0000001', version: 'v', display: 'All', referenceDatasetReleaseId: 'rel-1' };
      const relation = { terminologyRelationId: 'tr-1', sourceConceptId: 'tc-1', targetConceptId: 'tc-2', relationType: 'is_a', relationVersion: 'v', referenceDatasetReleaseId: 'rel-1' };

      await service.appendTerminologyConceptEvent({}, concept);
      await service.appendTerminologyRelationEvent({}, relation);
      await service.appendTerminologyConceptEvents({}, [concept, { aggregateId: 'agg-tc' }], { session });
      await service.appendTerminologyRelationEvents({}, [relation], { session });

      const [conceptBatch, relationBatch] = outbox.appendEvents.mock.calls;
      expect(conceptBatch[1][0]).toEqual(outbox.appendEvent.mock.calls[0][1]);
      expect(conceptBatch[1][1]).toMatchObject({ aggregateId: 'agg-tc', payload: { conceptStatus: 'active', code: null } });
      expect(conceptBatch[2]).toEqual({ session });
      expect(relationBatch[1]).toEqual([outbox.appendEvent.mock.calls[1][1]]);
      expect(relationBatch[2]).toEqual({ session });
    });
  });
});
