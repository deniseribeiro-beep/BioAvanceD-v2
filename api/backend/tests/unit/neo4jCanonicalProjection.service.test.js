import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { Neo4jCanonicalProjectionService, stableStringify } = require('../../src/services/neo4jCanonicalProjection.service');

function makeSession() {
  return { run: vi.fn().mockResolvedValue({}) };
}

describe('neo4jCanonicalProjection.service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NEO4J_CANONICAL_SALT = 'test-salt';
    delete process.env.GRAPH_PSEUDONYMIZATION_SALT;
    delete process.env.USER_ANON_SALT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('constructor/pseudonymization', () => {
    it('uses configured database and deterministic pseudonymous donor ids', () => {
      const service = new Neo4jCanonicalProjectionService({ database: 'custom' });
      expect(service.database).toBe('custom');
      expect(service.pseudonymizeDonorId('Donor-1')).toMatch(/^DONOR_[0-9a-f]{24}$/);
      expect(service.pseudonymizeDonorId('Donor-1')).toBe(service.pseudonymizeDonorId('donor-1'));
    });

    it('falls back through salts and fails when none exists', () => {
      delete process.env.NEO4J_CANONICAL_SALT;
      process.env.GRAPH_PSEUDONYMIZATION_SALT = 'graph-salt';
      expect(() => new Neo4jCanonicalProjectionService().pseudonymizeDonorId('x')).not.toThrow();
      delete process.env.GRAPH_PSEUDONYMIZATION_SALT;
      expect(() => new Neo4jCanonicalProjectionService().pseudonymizeDonorId('x'))
        .toThrow('Salt de pseudonimização ausente');
    });
  });

  describe('applyEvent dispatch', () => {
    it.each([
      ['CONSENT_UPSERTED', { participantId: 'p1' }],
      ['CONSENT_REVOKED', { participantId: 'p1' }],
      ['LINEAGE_REGISTERED', {}],
      ['QUALITY_ASSESSED', {}],
      ['TELEMETRY_INCIDENT_RECORDED', {}],
      ['TERMINOLOGY_CONCEPT_PROMOTED', {}],
      ['TERMINOLOGY_RELATION_PROMOTED', {}],
    ])('routes %s to a projector', async (eventType, payload) => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType, aggregateId: 'agg', eventId: 'evt', payload });
      expect(result.projected).toBe(true);
      expect(session.run).toHaveBeenCalledTimes(1);
    });

    it('skips an unknown or missing event without Cypher', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      expect((await service.applyEvent(session, { eventType: 'SOMETHING_ELSE' })).skipped).toBe(true);
      expect((await service.applyEvent(session, undefined)).skipped).toBe(true);
      expect(session.run).not.toHaveBeenCalled();
    });
  });

  describe('applyConsentProjection', () => {
    it('uses an explicit legacy specimenId only when one is actually present', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const event = {
        eventType: 'CONSENT_UPSERTED',
        aggregateId: 'consent-aggregate',
        schemaVersion: 2,
        occurredAt: '2026-01-01T00:00:00.000Z',
        sourceService: 'legacy-compat',
        eventId: 'evt-1',
        payload: {
          participantId: 'participant-1',
          specimenId: 'spec-1',
          consentId: 'consent-1',
          status: 'active',
          signedAt: '2026-01-02T00:00:00.000Z',
        },
      };

      const result = await service.applyConsentProjection(session, event);
      const params = session.run.mock.calls[0][1];
      expect(result.consentId).toBe('consent-1');
      expect(params.specimenId).toBe('spec-1');
      expect(params.consentId).toBe('consent-1');
      expect(params.consentStatus).toBe('ACTIVE');
    });

    it('never turns consent aggregateId into a specimen id (#1026)', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const event = {
        eventType: 'CONSENT_REVOKED',
        aggregateId: 'CONSENT-NOT-A-SPECIMEN',
        eventId: 'evt-2',
        payload: { participantId: 'participant-2', status: 'REVOKED' },
      };

      await service.applyConsentProjection(session, event);
      const [cypher, params] = session.run.mock.calls[0];
      expect(params.specimenId).toBe('');
      expect(params.consentId).toBe('CONSENT-NOT-A-SPECIMEN');
      expect(params.consentStatus).toBe('REVOKED');
      expect(cypher).toContain("CASE WHEN $specimenId = '' THEN [] ELSE [1] END");
    });
  });

  describe('lineage/quality/telemetry projections', () => {
    it('projects explicit parent/child lineage', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyLineageProjection(session, {
        aggregateId: 'agg', eventId: 'evt', payload: { specimenId: 'child', parentSpecimenId: 'parent' },
      });
      expect(result.specimenId).toBe('child');
      expect(session.run.mock.calls[0][1].parentSpecimenId).toBe('parent');
    });

    it('projects quality score and preserves null defaults', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      await service.applyQualityProjection(session, {
        aggregateId: 'spec', eventId: 'qa-event', payload: { score: 92, status: 'passed' },
      });
      expect(session.run.mock.calls[0][1]).toEqual(expect.objectContaining({ score: 92, status: 'passed' }));

      const session2 = makeSession();
      await service.applyQualityProjection(session2, { aggregateId: 'spec', eventId: 'qa-event-2', payload: {} });
      expect(session2.run.mock.calls[0][1].score).toBeNull();
    });

    it('projects telemetry incident defaults', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      await service.applyTelemetryProjection(session, { aggregateId: 'spec', eventId: 'inc', payload: {} });
      expect(session.run.mock.calls[0][1]).toEqual(expect.objectContaining({
        incidentId: 'inc', severity: 'UNKNOWN', status: 'OPEN', specimenId: 'spec',
      }));
    });
  });

  describe('terminology projections', () => {
    it('projects terminology concepts by canonical id', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyTerminologyConceptProjection(session, {
        eventId: 'evt', aggregateId: 'fallback', sourceService: 'reference',
        payload: { terminologyConceptId: 'tc-1', code: 'HP:1', systemUri: 'http://example', display: 'Example' },
      });
      expect(result.conceptId).toBe('tc-1');
      expect(session.run.mock.calls[0][1].code).toBe('HP:1');
    });

    it('projects terminology relations by explicit endpoints', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyTerminologyRelationProjection(session, {
        eventId: 'evt', aggregateId: 'rel-fallback', sourceService: 'reference',
        payload: {
          terminologyRelationId: 'rel-1', sourceConceptId: 'tc-a', targetConceptId: 'tc-b', relationType: 'is_a',
        },
      });
      expect(result.sourceConceptId).toBe('tc-a');
      expect(result.targetConceptId).toBe('tc-b');
      expect(session.run.mock.calls[0][1].relationId).toBe('rel-1');
    });
  });

  describe('stableStringify', () => {
    it('sorts object keys recursively and normalizes Date values', () => {
      const value = {
        z: 1,
        a: { y: 2, x: new Date('2026-01-01T00:00:00.000Z') },
      };
      expect(stableStringify(value)).toBe('{"a":{"x":"2026-01-01T00:00:00.000Z","y":2},"z":1}');
    });
  });
});
