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

  describe('constructor', () => {
    it('defaults database from options', () => {
      const service = new Neo4jCanonicalProjectionService({ database: 'custom' });
      expect(service.database).toBe('custom');
    });

    it('falls back to process.env.NEO4J_DATABASE then "neo4j"', () => {
      process.env.NEO4J_DATABASE = 'env-db';
      expect(new Neo4jCanonicalProjectionService().database).toBe('env-db');
      delete process.env.NEO4J_DATABASE;
      expect(new Neo4jCanonicalProjectionService().database).toBe('neo4j');
    });
  });

  describe('pseudonymizeDonorId', () => {
    it('hashes the identity using the primary salt', () => {
      const service = new Neo4jCanonicalProjectionService();
      const id = service.pseudonymizeDonorId('Donor-1');
      expect(id).toMatch(/^DONOR_[0-9a-f]{24}$/);
    });

    it('falls back through GRAPH_PSEUDONYMIZATION_SALT and USER_ANON_SALT when NEO4J_CANONICAL_SALT is unset', () => {
      delete process.env.NEO4J_CANONICAL_SALT;
      process.env.GRAPH_PSEUDONYMIZATION_SALT = 'graph-salt';
      const service = new Neo4jCanonicalProjectionService();
      expect(() => service.pseudonymizeDonorId('x')).not.toThrow();
    });

    it('throws when no salt is configured', () => {
      delete process.env.NEO4J_CANONICAL_SALT;
      const service = new Neo4jCanonicalProjectionService();
      expect(() => service.pseudonymizeDonorId('x')).toThrow('Salt de pseudonimização ausente');
    });
  });

  describe('applyEvent dispatch', () => {
    it('routes CONSENT_UPSERTED and CONSENT_REVOKED to applyConsentProjection', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const event = { eventType: 'consent_upserted', payload: { participantId: 'p1' } };
      const result = await service.applyEvent(session, event);
      expect(result.projected).toBe(true);
      expect(session.run).toHaveBeenCalledTimes(1);
    });

    it('routes LINEAGE_REGISTERED to applyLineageProjection', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType: 'LINEAGE_REGISTERED', payload: {} });
      expect(result.projected).toBe(true);
    });

    it('routes QUALITY_ASSESSED to applyQualityProjection', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType: 'QUALITY_ASSESSED', payload: {} });
      expect(result.projected).toBe(true);
    });

    it('routes TELEMETRY_INCIDENT_RECORDED to applyTelemetryProjection', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType: 'TELEMETRY_INCIDENT_RECORDED', payload: {} });
      expect(result.projected).toBe(true);
    });

    it('returns skipped for an unrecognized event type without calling session.run', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType: 'SOMETHING_ELSE', aggregateType: 'Foo', eventId: 'e1' });
      expect(result).toEqual({ skipped: true, eventType: 'SOMETHING_ELSE', aggregateType: 'Foo', eventId: 'e1' });
      expect(session.run).not.toHaveBeenCalled();
    });

    it('handles a missing event gracefully via optional chaining', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, undefined);
      expect(result.skipped).toBe(true);
      expect(result.eventType).toBe('');
    });
  });

  describe('applyConsentProjection', () => {
    it('projects using payload fields including specimenId (FOREACH branch taken)', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const event = {
        eventType: 'CONSENT_UPSERTED',
        aggregateId: 'agg-1',
        schemaVersion: 2,
        occurredAt: '2026-01-01T00:00:00.000Z',
        sourceService: 'lims',
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
      expect(result.projected).toBe(true);
      expect(result.consentId).toBe('consent-1');
      const params = session.run.mock.calls[0][1];
      expect(params.specimenId).toBe('spec-1');
      expect(params.consentStatus).toBe('ACTIVE');
      expect(params.occurredAt).toBe('2026-01-02T00:00:00.000Z');
    });

    it('falls back to aggregateId/defaults when payload fields are absent (empty-specimenId FOREACH skip)', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const event = { eventType: 'CONSENT_REVOKED', aggregateId: 'agg-2', payload: {} };
      await service.applyConsentProjection(session, event);
      const params = session.run.mock.calls[0][1];
      expect(params.specimenId).toBe('agg-2');
      expect(params.consentId).toBe('agg-2');
      expect(params.consentStatus).toBe('ACTIVE');
      expect(params.sourceService).toBe('unknown');
      expect(params.schemaVersion).toBe(1);
    });
  });

  describe('applyLineageProjection', () => {
    it('projects parent/child specimen ids from payload', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const event = {
        eventType: 'LINEAGE_REGISTERED',
        aggregateId: 'agg-3',
        eventId: 'evt-2',
        payload: { specimenId: 'child-1', parentSpecimenId: 'parent-1' },
      };
      const result = await service.applyLineageProjection(session, event);
      expect(result.specimenId).toBe('child-1');
      const params = session.run.mock.calls[0][1];
      expect(params.parentSpecimenId).toBe('parent-1');
    });

    it('falls back to aggregateId for specimenId when payload omits it', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyLineageProjection(session, { aggregateId: 'agg-4', payload: {} });
      expect(result.specimenId).toBe('agg-4');
    });
  });

  describe('applyQualityProjection', () => {
    it('projects score and evaluatedAt from payload', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const event = {
        aggregateId: 'agg-5',
        eventId: 'evt-3',
        payload: { specimenId: 'spec-5', qualityAssessmentId: 'qa-1', status: 'passed', score: 92, evaluatedAt: '2026-01-03T00:00:00.000Z' },
      };
      const result = await service.applyQualityProjection(session, event);
      expect(result.specimenId).toBe('spec-5');
      const params = session.run.mock.calls[0][1];
      expect(params.assessmentId).toBe('qa-1');
      expect(params.score).toBe(92);
      expect(params.status).toBe('passed');
    });

    it('defaults score to null and assessmentId to eventId when payload omits them', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      await service.applyQualityProjection(session, { aggregateId: 'agg-6', eventId: 'evt-4', payload: {} });
      const params = session.run.mock.calls[0][1];
      expect(params.score).toBeNull();
      expect(params.assessmentId).toBe('evt-4');
      expect(params.status).toBe('UNKNOWN');
    });
  });

  describe('applyTelemetryProjection', () => {
    it('projects severity/status/occurredAt from payload', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const event = {
        aggregateId: 'agg-7',
        eventId: 'evt-5',
        payload: { specimenId: 'spec-7', telemetryIncidentId: 'inc-1', severity: 'critical', status: 'closed', occurredAt: '2026-01-04T00:00:00.000Z' },
      };
      const result = await service.applyTelemetryProjection(session, event);
      expect(result.specimenId).toBe('spec-7');
      const params = session.run.mock.calls[0][1];
      expect(params.incidentId).toBe('inc-1');
      expect(params.severity).toBe('critical');
      expect(params.status).toBe('closed');
    });

    it('defaults severity/status/incidentId when payload omits them', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      await service.applyTelemetryProjection(session, { aggregateId: 'agg-8', eventId: 'evt-6', payload: {} });
      const params = session.run.mock.calls[0][1];
      expect(params.incidentId).toBe('evt-6');
      expect(params.severity).toBe('UNKNOWN');
      expect(params.status).toBe('OPEN');
    });
  });

  describe('normalizeIso branch (via applyQualityProjection evaluatedAt)', () => {
    it('falls back to now() when evaluatedAt/occurredAt are both invalid', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      await service.applyQualityProjection(session, { aggregateId: 'agg-9', eventId: 'evt-7', payload: { evaluatedAt: 'not-a-date' } });
      const params = session.run.mock.calls[0][1];
      expect(params.evaluatedAt).not.toBe('not-a-date');
      expect(() => new Date(params.evaluatedAt).toISOString()).not.toThrow();
    });

    it('normalizes a Date instance directly without re-parsing', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const evaluatedAt = new Date('2026-01-05T00:00:00.000Z');
      await service.applyQualityProjection(session, { aggregateId: 'agg-10', eventId: 'evt-8', payload: { evaluatedAt } });
      const params = session.run.mock.calls[0][1];
      expect(params.evaluatedAt).toBe('2026-01-05T00:00:00.000Z');
    });
  });

  describe('stableStringify', () => {
    it('sorts object keys and stringifies deterministically regardless of input key order', () => {
      const a = stableStringify({ b: 1, a: 2 });
      const b = stableStringify({ a: 2, b: 1 });
      expect(a).toBe(b);
      expect(a).toBe('{"a":2,"b":1}');
    });

    it('recurses into arrays and nested objects', () => {
      const result = stableStringify({ list: [{ z: 1, a: 2 }, 'x'] });
      expect(result).toBe('{"list":[{"a":2,"z":1},"x"]}');
    });

    it('serializes Date instances as ISO strings', () => {
      const date = new Date('2026-01-01T00:00:00.000Z');
      const result = stableStringify({ when: date });
      expect(result).toBe('{"when":"2026-01-01T00:00:00.000Z"}');
    });
  });
});
