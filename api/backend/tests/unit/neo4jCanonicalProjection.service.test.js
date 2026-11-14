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
      const result = await service.applyEvent(session, { eventType: 'LINEAGE_REGISTERED', payload: { specimenId: 'c-1', parentSpecimenId: 'p-1' } });
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

    it('routes TERMINOLOGY_CONCEPT_PROMOTED to applyTerminologyConceptProjection', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType: 'TERMINOLOGY_CONCEPT_PROMOTED', payload: {} });
      expect(result.projected).toBe(true);
    });

    it('routes TERMINOLOGY_RELATION_PROMOTED to applyTerminologyRelationProjection', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType: 'TERMINOLOGY_RELATION_PROMOTED', payload: {} });
      expect(result.projected).toBe(true);
    });

    // #1550: the rebuild removes the edges the reconcile reports for it.
    it('SPECIMEN_DONOR_UNLINKED deletes the donor edge and the GOVERNED_BY edges through that donor\'s consents', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType: 'SPECIMEN_DONOR_UNLINKED', aggregateId: 's-1', payload: { specimenId: 's-1', donorId: 'DONOR_x' } });
      expect(session.run).toHaveBeenCalledTimes(1);
      const [cypher, params] = session.run.mock.calls[0];
      expect(cypher).toContain('(donor:Donor {id: $donorId})-[r:DONATED]->(sample:Sample {id: $specimenId})');
      expect(cypher).toContain('OPTIONAL MATCH (donor)-[:CONSENTED_UNDER]->(:EthicalConsent)<-[g:GOVERNED_BY]-(sample)');
      expect(cypher).toContain('WITH r, collect(g) AS governed');
      expect(cypher).toContain('FOREACH (edge IN governed | DELETE edge)');
      expect(cypher).toContain('DELETE r');
      expect(cypher).toContain('GOVERNED_BY');
      expect(params).toEqual({ donorId: 'DONOR_x', specimenId: 's-1' });
      expect(result).toEqual({ projected: true, eventType: 'SPECIMEN_DONOR_UNLINKED', specimenId: 's-1', donorId: 'DONOR_x' });
    });

    it('SPECIMEN_DONOR_UNLINKED without a donorId is skipped with its reason and runs nothing', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType: 'SPECIMEN_DONOR_UNLINKED', aggregateId: 's-1', payload: { specimenId: 's-1' } });
      expect(result).toEqual({ skipped: true, eventType: 'SPECIMEN_DONOR_UNLINKED', specimenId: 's-1', reason: 'missing specimenId or donorId' });
      expect(session.run).not.toHaveBeenCalled();
    });

    it('STORAGE_POSITION_RELEASED closes the open STORED_AT at releasedAt', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType: 'STORAGE_POSITION_RELEASED', eventId: 'e-9', aggregateId: 's-1', payload: { specimenId: 's-1', releasedAt: '2026-11-13T10:00:00.000Z' } });
      expect(session.run).toHaveBeenCalledTimes(1);
      const [cypher, params] = session.run.mock.calls[0];
      expect(cypher).toContain('r.validTo IS NULL');
      // A placement that began at or after releasedAt stays open.
      expect(cypher).toContain('AND (r.validFrom IS NULL OR r.validFrom < datetime($releasedAt))');
      expect(cypher).toContain('SET r.validTo = datetime($releasedAt)');
      expect(params.releasedAt).toBe('2026-11-13T10:00:00.000Z');
      expect(params.specimenId).toBe('s-1');
      expect(result).toEqual({ projected: true, eventType: 'STORAGE_POSITION_RELEASED', specimenId: 's-1' });
    });

    it('STORAGE_POSITION_RELEASED without a specimenId is skipped with its reason and runs nothing', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType: 'STORAGE_POSITION_RELEASED', aggregateId: '', payload: { specimenId: '', releasedAt: '2026-11-13T10:00:00.000Z' } });
      expect(result).toEqual({ skipped: true, eventType: 'STORAGE_POSITION_RELEASED', specimenId: '', reason: 'missing specimenId' });
      expect(session.run).not.toHaveBeenCalled();
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
      // #1225: the aggregateId is the consent's id, never a specimen's.
      expect(params.specimenId).toBe('');
      expect(params.consentId).toBe('agg-2');
      expect(params.consentStatus).toBe('ACTIVE');
      expect(params.sourceService).toBe('unknown');
      expect(params.schemaVersion).toBe(1);
    });
  });

  describe('#1225 consent governance', () => {
    it('a consent event without specimenId keys no Sample by the consent id', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      await service.applyConsentProjection(session, {
        eventType: 'CONSENT_UPSERTED',
        aggregateType: 'EthicalConsent',
        aggregateId: 'consent-9',
        payload: { participantId: 'P-9', specimenId: null, ethicalConsentId: 'consent-9', status: 'ACTIVE' },
      });
      const params = session.run.mock.calls[0][1];
      expect(params.specimenId).toBe('');
      expect(params.consentId).toBe('consent-9');
    });

    it('a consent event governs the samples its donor already DONATED', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      await service.applyConsentProjection(session, {
        eventType: 'CONSENT_UPSERTED',
        aggregateId: 'consent-9',
        payload: { participantId: 'P-9', ethicalConsentId: 'consent-9' },
      });
      const cypher = session.run.mock.calls[0][0];
      expect(cypher).toMatch(/OPTIONAL MATCH \(donor\)-\[:DONATED\]->\(donated:Sample\)/);
      expect(cypher).toMatch(/MERGE \(owned\)-\[r4:GOVERNED_BY\]->\(consent\)/);
    });

    it('routes SPECIMEN_UPSERTED to the specimen projection, linking the donor and its consents', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, {
        eventType: 'SPECIMEN_UPSERTED',
        aggregateType: 'Sample',
        aggregateId: 'mongo-1',
        eventId: 'evt-s1',
        sourceService: 'sample.service',
        payload: { specimenId: 'mongo-1', participantId: 'P-9' },
      });
      expect(result).toEqual({
        projected: true,
        eventType: 'SPECIMEN_UPSERTED',
        specimenId: 'mongo-1',
        donorId: service.pseudonymizeDonorId('P-9'),
      });
      expect(session.run).toHaveBeenCalledTimes(1);
      const [cypher, params] = session.run.mock.calls[0];
      expect(params.specimenId).toBe('mongo-1');
      expect(params.donorId).toBe(service.pseudonymizeDonorId('P-9'));
      expect(cypher).toMatch(/MERGE \(donor\)-\[r1:DONATED\]->\(sample\)/);
      expect(cypher).toMatch(/OPTIONAL MATCH \(donor\)-\[:CONSENTED_UNDER\]->\(consent:EthicalConsent\)/);
      expect(cypher).toMatch(/MERGE \(sample\)-\[r2:GOVERNED_BY\]->\(governing\)/);
    });

    it('a SPECIMEN_UPSERTED with no participant merges the Sample alone and mints no Donor', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, {
        eventType: 'SPECIMEN_UPSERTED',
        aggregateId: 'mongo-2',
        payload: { specimenId: 'mongo-2', participantId: null },
      });
      expect(result.donorId).toBeNull();
      const [cypher, params] = session.run.mock.calls[0];
      expect(params.specimenId).toBe('mongo-2');
      expect(cypher).not.toMatch(/Donor/);
      expect(cypher).not.toMatch(/GOVERNED_BY/);
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
      const result = await service.applyLineageProjection(session, { aggregateId: 'agg-4', payload: { parentSpecimenId: 'p-1' } });
      expect(result.specimenId).toBe('agg-4');
    });

    // #1368: an event without both ends, or with the child as its own parent,
    // writes no edge.
    it.each([
      ['no parent', { specimenId: 'c-1' }],
      ['no child', { parentSpecimenId: 'p-1' }],
      ['the child as its own parent', { specimenId: 'c-1', parentSpecimenId: 'c-1' }],
    ])('skips an event with %s', async (_label, payload) => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyLineageProjection(session, { eventType: 'LINEAGE_REGISTERED', payload });
      expect(result).toMatchObject({ skipped: true, eventType: 'LINEAGE_REGISTERED', reason: 'missing specimenId or parentSpecimenId' });
      expect(session.run).not.toHaveBeenCalled();
    });

    // #1368: the edge points child -> parent, the direction the compromise
    // projection walks backwards from its root to reach the descendants.
    it('writes DERIVED_FROM from child to parent, the direction the compromise projection walks', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      await service.applyLineageProjection(session, {
        eventType: 'LINEAGE_REGISTERED',
        eventId: 'evt-9',
        payload: { specimenId: 'c-1', parentSpecimenId: 'p-1' },
      });
      const [lineageCypher, params] = session.run.mock.calls[0];
      const lineage = lineageCypher.replace(/\s+/g, ' ');
      expect(lineage).toContain('MERGE (child:Sample {id: $specimenId})');
      expect(lineage).toContain('MERGE (parent:Sample {id: $parentSpecimenId})');
      expect(lineage).toContain('MERGE (child)-[r:DERIVED_FROM]->(parent)');
      expect(params).toMatchObject({ specimenId: 'c-1', parentSpecimenId: 'p-1', eventId: 'evt-9' });

      await service.applySpecimenCompromiseProjection(session, { eventType: 'SPECIMEN_COMPROMISED', payload: { specimenId: 'p-1' } });
      const compromise = session.run.mock.calls[1][0].replace(/\s+/g, ' ');
      expect(compromise).toContain('(root)<-[:DERIVED_FROM*0..]-(descendant:Sample)');
    });
  });

  // #1312: the placement and the cold-chain compromise, projected from the
  // outbox instead of written by storageService and TelemetryMonitor.
  describe('#1312 storage and compromise projections', () => {
    // #1313 (RF023 AC5): the placement is a temporal edge; the earlier one is
    // closed at the new validFrom, never deleted.
    it('routes STORAGE_POSITION_ASSIGNED to a temporal STORED_AT, closing an earlier position', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, {
        eventType: 'STORAGE_POSITION_ASSIGNED',
        eventId: 'evt-s',
        occurredAt: '2026-10-09T10:00:00.000Z',
        payload: { specimenId: 'sample-1', boxId: 'box-1', position: 'A3' },
      });
      expect(result).toMatchObject({ projected: true, specimenId: 'sample-1' });
      const [cypher, params] = session.run.mock.calls[0];
      expect(cypher).toContain('MERGE (pos:StoragePosition {boxId: $boxId, position: $position})');
      expect(cypher).not.toContain('DELETE old');
      expect(cypher).toContain('SET old.validTo = datetime($validFrom)');
      expect(cypher).toContain('MERGE (sample)-[r:STORED_AT {validFrom: datetime($validFrom)}]->(pos)');
      expect(cypher).toContain('r.transactionTime = datetime()');
      expect(cypher).not.toContain('STORED_IN');
      expect(params).toMatchObject({
        specimenId: 'sample-1', boxId: 'box-1', position: 'A3', eventId: 'evt-s', validFrom: '2026-10-09T10:00:00.000Z',
      });
    });

    it('takes the placement instant from payload.assignedAt over the event time', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      await service.applyEvent(session, {
        eventType: 'STORAGE_POSITION_ASSIGNED',
        occurredAt: '2026-10-09T10:00:00.000Z',
        payload: { specimenId: 'sample-1', boxId: 'box-1', position: 'A3', assignedAt: '2026-10-08T09:00:00.000Z' },
      });
      expect(session.run.mock.calls[0][1].validFrom).toBe('2026-10-08T09:00:00.000Z');
    });

    it('skips a STORAGE_POSITION_ASSIGNED missing its box or position, writing nothing', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType: 'STORAGE_POSITION_ASSIGNED', payload: { specimenId: 'sample-1', boxId: 'box-1' } });
      expect(result.skipped).toBe(true);
      expect(session.run).not.toHaveBeenCalled();
    });

    it('routes SPECIMEN_COMPROMISED to the root and its DERIVED_FROM descendants, with no temperature', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, {
        eventType: 'SPECIMEN_COMPROMISED',
        eventId: 'evt-c',
        payload: { specimenId: 'root-1', freezerKey: 'freezer-A', breachedSince: '2026-01-01T00:00:00Z', maxObservedTemp: -50 },
      });
      expect(result).toMatchObject({ projected: true, specimenId: 'root-1' });
      const [cypher, params] = session.run.mock.calls[0];
      expect(cypher).toContain('(root)<-[:DERIVED_FROM*0..]-(descendant:Sample)');
      expect(cypher).toContain("SET sample.status = 'COMPROMISED'");
      expect(cypher).not.toContain('Temp');
      expect(params).toEqual({ specimenId: 'root-1', freezerKey: 'freezer-A', breachedSince: '2026-01-01T00:00:00.000Z', eventId: 'evt-c' });
    });

    it('skips a SPECIMEN_COMPROMISED with no sample, writing nothing', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyEvent(session, { eventType: 'SPECIMEN_COMPROMISED', payload: {} });
      expect(result.skipped).toBe(true);
      expect(session.run).not.toHaveBeenCalled();
    });
  });

  // #1312: the custody step the custody use cases used to write directly,
  // now projected from CUSTODY_EVENT_RECORDED with the same graph shape.
  describe('#1312 custody event projection', () => {
    const custodyEvent = (payload = {}) => ({
      eventType: 'CUSTODY_EVENT_RECORDED',
      eventId: 'evt-cust-1',
      sourceService: 'lineage-repository',
      schemaVersion: 1,
      payload: {
        specimenId: 'sample-1',
        barcode: 'BC-1',
        custodyEventType: 'move',
        happenedAt: '2026-01-02T03:04:05.000Z',
        actorId: 'user-1',
        reason: 'reorg',
        from: { boxId: 'box-1', position: 'a1' },
        to: { boxId: 'box-2', position: 'B2' },
        ...payload,
      },
    });

    it('writes Sample-[:HAS_CUSTODY_EVENT]->CustodyEvent with FROM and TO StoragePositions, keyed by the outbox eventId', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();

      const result = await service.applyEvent(session, custodyEvent());

      expect(result).toMatchObject({ projected: true, specimenId: 'sample-1', custodyEventId: 'evt-cust-1' });
      expect(session.run).toHaveBeenCalledTimes(1);
      const [cypher, params] = session.run.mock.calls[0];
      expect(cypher).toContain('MERGE (sample:Sample {id: $specimenId})');
      expect(cypher).toContain('MERGE (custody:CustodyEvent {id: $eventId})');
      expect(cypher).toContain('MERGE (sample)-[:HAS_CUSTODY_EVENT]->(custody)');
      expect(cypher).toContain('MERGE (fromPos:StoragePosition {boxId: $fromBoxId, position: $fromPosition})');
      expect(cypher).toContain('MERGE (custody)-[:FROM]->(fromPos)');
      expect(cypher).toContain('MERGE (toPos:StoragePosition {boxId: $toBoxId, position: $toPosition})');
      expect(cypher).toContain('MERGE (custody)-[:TO]->(toPos)');
      expect(cypher).toContain("custody.source = 'ISO20387'");
      expect(params).toMatchObject({
        specimenId: 'sample-1',
        barcode: 'BC-1',
        eventId: 'evt-cust-1',
        custodyEventType: 'move',
        happenedAt: '2026-01-02T03:04:05.000Z',
        actorId: 'user-1',
        reason: 'reorg',
        fromBoxId: 'box-1',
        fromPosition: 'A1',
        toBoxId: 'box-2',
        toPosition: 'B2',
      });
    });

    it('passes null positions for a step without a destination (release), so no TO edge is written', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();

      await service.applyEvent(session, custodyEvent({ custodyEventType: 'release', to: null }));

      const [, params] = session.run.mock.calls[0];
      expect(params).toMatchObject({ fromBoxId: 'box-1', fromPosition: 'A1', toBoxId: null, toPosition: null });
    });

    it('skips a custody event with no sample or custody type, writing nothing', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();

      const noType = await service.applyEvent(session, custodyEvent({ custodyEventType: null }));
      const noSample = await service.applyEvent(session, { ...custodyEvent({ specimenId: null }), aggregateId: '' });

      expect(noType.skipped).toBe(true);
      expect(noSample.skipped).toBe(true);
      expect(session.run).not.toHaveBeenCalled();
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

  describe('applyTerminologyConceptProjection', () => {
    it('projects systemUri/code/version/display from payload, keyed by terminologyConceptId', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const event = {
        eventType: 'TERMINOLOGY_CONCEPT_PROMOTED',
        aggregateId: 'agg-tc',
        eventId: 'evt-tc-1',
        schemaVersion: 1,
        sourceService: 'reference-imports-pipeline',
        payload: {
          terminologyConceptId: 'tc-1',
          systemUri: 'http://purl.obolibrary.org/obo/hp.owl',
          code: 'HP:0000001',
          version: 'sample-2026-07-31',
          display: 'All',
          conceptStatus: 'active',
        },
      };
      const result = await service.applyTerminologyConceptProjection(session, event);
      expect(result.projected).toBe(true);
      expect(result.conceptId).toBe('tc-1');
      const params = session.run.mock.calls[0][1];
      expect(params.conceptId).toBe('tc-1');
      expect(params.code).toBe('HP:0000001');
      expect(params.systemUri).toBe('http://purl.obolibrary.org/obo/hp.owl');
      expect(params.display).toBe('All');
    });

    it('falls back to aggregateId for conceptId and "active" for conceptStatus when payload omits them', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const result = await service.applyTerminologyConceptProjection(session, { aggregateId: 'agg-tc-2', payload: {} });
      expect(result.conceptId).toBe('agg-tc-2');
      const params = session.run.mock.calls[0][1];
      expect(params.conceptStatus).toBe('active');
      expect(params.code).toBe('');
    });
  });

  describe('applyTerminologyRelationProjection', () => {
    it('projects sourceConceptId/targetConceptId/relationType from payload', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      const event = {
        eventType: 'TERMINOLOGY_RELATION_PROMOTED',
        aggregateId: 'agg-tr',
        eventId: 'evt-tr-1',
        payload: {
          terminologyRelationId: 'tr-1',
          sourceConceptId: 'tc-source',
          targetConceptId: 'tc-target',
          relationType: 'is_a',
          relationVersion: 'sample-2026-07-31',
        },
      };
      const result = await service.applyTerminologyRelationProjection(session, event);
      expect(result.projected).toBe(true);
      expect(result.sourceConceptId).toBe('tc-source');
      expect(result.targetConceptId).toBe('tc-target');
      const params = session.run.mock.calls[0][1];
      expect(params.relationId).toBe('tr-1');
      expect(params.relationType).toBe('is_a');
    });

    it('falls back to aggregateId for relationId when payload omits terminologyRelationId', async () => {
      const service = new Neo4jCanonicalProjectionService();
      const session = makeSession();
      await service.applyTerminologyRelationProjection(session, { aggregateId: 'agg-tr-2', payload: {} });
      const params = session.run.mock.calls[0][1];
      expect(params.relationId).toBe('agg-tr-2');
      expect(params.sourceConceptId).toBe('');
      expect(params.targetConceptId).toBe('');
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

// #1323: RNF015 C1 -- the outbox event's traceId rides each projection write
// as Neo4j transaction metadata.
describe('neo4jCanonicalProjection.service applyEvent traceId', () => {
  beforeEach(() => {
    process.env.NEO4J_CANONICAL_SALT = 'test-salt';
  });

  it('#1323 passes the traceId as transaction metadata to session.run', async () => {
    const session = makeSession();
    await new Neo4jCanonicalProjectionService().applyEvent(session, {
      eventType: 'SPECIMEN_UPSERTED',
      traceId: 'req-proj-0001',
      payload: { specimenId: 's-1' },
    });
    expect(session.run).toHaveBeenCalled();
    expect(session.run.mock.calls[0][2]).toEqual({ metadata: { requestId: 'req-proj-0001' } });
  });

  it('#1323 adds no transaction config for a malformed traceId', async () => {
    const session = makeSession();
    await new Neo4jCanonicalProjectionService().applyEvent(session, {
      eventType: 'SPECIMEN_UPSERTED',
      traceId: 'bad id!',
      payload: { specimenId: 's-1' },
    });
    expect(session.run).toHaveBeenCalled();
    expect(session.run.mock.calls[0].length).toBe(2);
  });
});
