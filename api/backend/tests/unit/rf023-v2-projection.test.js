import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Neo4jCanonicalProjectionV2Service } = require('../../src/services/neo4jCanonicalProjectionV2.service');
const MongoLineageRepository = require('../../src/infrastructure/persistence/mongo/MongoLineageRepository');

describe('RF023 canonical v2 projection', () => {
  beforeEach(() => {
    process.env.NEO4J_CANONICAL_SALT = 'rf023-test-salt';
  });

  it('projects consent by ethicalConsentId without fabricating a Sample from the consent aggregate id', async () => {
    const run = vi.fn().mockResolvedValue({ records: [] });
    const service = new Neo4jCanonicalProjectionV2Service();

    await service.applyEvent({ run }, {
      eventId: 'evt-consent-1',
      eventType: 'CONSENT_UPSERTED',
      aggregateType: 'EthicalConsent',
      aggregateId: 'consent-1',
      schemaVersion: 2,
      sourceService: 'test',
      payload: {
        participantId: 'participant-1',
        ethicalConsentId: 'consent-1',
        status: 'ACTIVE',
      },
    });

    const [cypher, params] = run.mock.calls[0];
    expect(params.consentId).toBe('consent-1');
    expect(params.donorId).toMatch(/^DONOR_/);
    expect(params.donorId).not.toContain('participant-1');
    expect(params).not.toHaveProperty('specimenId');
    expect(cypher).toContain('(donor)-[:DONATED]->(sample:Sample)');
    expect(cypher).not.toContain('MERGE (sample:Sample {id: $consentId})');
  });

  it('projects a specimen and links it to the pseudonymized donor', async () => {
    const run = vi.fn().mockResolvedValue({ records: [] });
    const service = new Neo4jCanonicalProjectionV2Service();

    await service.applyEvent({ run }, {
      eventId: 'evt-specimen-1',
      eventType: 'SPECIMEN_UPSERTED',
      aggregateType: 'Specimen',
      aggregateId: 'specimen-1',
      schemaVersion: 2,
      sourceService: 'test',
      payload: {
        specimenId: 'specimen-1',
        participantId: 'participant-1',
        barcode: 'BC-1',
      },
    });

    const [cypher, params] = run.mock.calls[0];
    expect(params.specimenId).toBe('specimen-1');
    expect(params.donorId).toMatch(/^DONOR_/);
    expect(cypher).toContain('MERGE (donor)-[donated:DONATED]->(sample)');
    expect(cypher).toContain("consent.status IN ['ACTIVE', 'VALID', 'GRANTED']");
  });

  it('projects custody only from an outbox event consumed by the worker projector', async () => {
    const run = vi.fn().mockResolvedValue({ records: [] });
    const service = new Neo4jCanonicalProjectionV2Service();

    await service.applyEvent({ run }, {
      eventId: 'evt-custody-1',
      eventType: 'CUSTODY_EVENT_RECORDED',
      aggregateType: 'Specimen',
      aggregateId: 'specimen-1',
      sourceService: 'test',
      payload: {
        specimenId: 'specimen-1',
        custodyEventId: 'custody-1',
        eventType: 'move',
        from: { boxId: 'box-a', position: 'A1' },
        to: { boxId: 'box-b', position: 'B2' },
      },
    });

    const [, params] = run.mock.calls[0];
    expect(params.custodyEventId).toBe('custody-1');
    expect(params.fromPositionId).toBe('box-a:A1');
    expect(params.toPositionId).toBe('box-b:B2');
  });
});

describe('MongoLineageRepository', () => {
  it('requires a Mongo session when recording custody so domain state and outbox cannot diverge', async () => {
    const repo = new MongoLineageRepository({ collection: vi.fn() }, {
      graphProjectionService: {
        appendSpecimenEvent: vi.fn(),
        appendCustodyEvent: vi.fn(),
      },
    });

    await expect(repo.recordCustodyEvent({ specimenId: 's1', eventType: 'move' }))
      .rejects.toThrow('compartilhar a transação MongoDB');
  });

  it('passes the same session to specimen and custody projection events', async () => {
    const session = { id: 'tx-1' };
    const specimen = { _id: 's1', participantId: 'p1', barcode: 'BC1', status: 'available' };
    const sampleCollection = { findOne: vi.fn().mockResolvedValue(specimen) };
    const db = {
      collection: vi.fn((name) => {
        if (name === 'samples') return sampleCollection;
        return {};
      }),
    };
    const graphProjectionService = {
      appendSpecimenEvent: vi.fn().mockResolvedValue({}),
      appendCustodyEvent: vi.fn().mockResolvedValue({}),
    };
    const repo = new MongoLineageRepository(db, { graphProjectionService });
    vi.spyOn(repo, 'findSpecimen').mockResolvedValue(specimen);

    const result = await repo.recordCustodyEvent({ specimenId: 's1', eventType: 'move' }, session);

    expect(result.queued).toBe(true);
    expect(graphProjectionService.appendSpecimenEvent.mock.calls[0][2]).toEqual({ session });
    expect(graphProjectionService.appendCustodyEvent.mock.calls[0][2]).toEqual({ session });
  });
});


describe('RF023 canonical v2 assignment and telemetry coverage', () => {
  function makeSession() {
    return { run: vi.fn().mockResolvedValue({ records: [] }) };
  }

  it('projects a full SpecimenContainerAssignment through the v2 dispatcher', async () => {
    const session = makeSession();
    const service = new Neo4jCanonicalProjectionV2Service();

    const result = await service.applyEvent(session, {
      eventId: 'evt-assignment-1',
      eventType: 'SPECIMEN_CONTAINER_ASSIGNMENT_UPSERTED',
      aggregateId: 'assignment-fallback',
      sourceService: 'storage-service',
      payload: {
        specimenContainerAssignmentId: 'assignment-1',
        specimenId: 'specimen-1',
        containerId: 'container-1',
        assignedAt: '2026-09-18T12:00:00.000Z',
        releasedAt: '2026-09-18T13:00:00.000Z',
        containerPositionAssignmentId: 'position-assignment-1',
        storagePositionId: 'position-1',
        rackLocationAssignmentId: 'rack-location-assignment-1',
        storageRackId: 'rack-1',
        storageLocationId: 'freezer-1',
      },
    });

    expect(result).toEqual({
      projected: true,
      eventType: 'SPECIMEN_CONTAINER_ASSIGNMENT_UPSERTED',
      specimenId: 'specimen-1',
      specimenContainerAssignmentId: 'assignment-1',
    });
    expect(session.run).toHaveBeenCalledTimes(1);
    const [cypher, params] = session.run.mock.calls[0];
    expect(cypher).toContain('SpecimenContainerAssignment');
    expect(cypher).toContain('ContainerPositionAssignment');
    expect(cypher).toContain('RackLocationAssignment');
    expect(params).toMatchObject({
      specimenId: 'specimen-1',
      specimenContainerAssignmentId: 'assignment-1',
      containerId: 'container-1',
      assignedAt: '2026-09-18T12:00:00.000Z',
      releasedAt: '2026-09-18T13:00:00.000Z',
      containerPositionAssignmentId: 'position-assignment-1',
      storagePositionId: 'position-1',
      rackLocationAssignmentId: 'rack-location-assignment-1',
      storageRackId: 'rack-1',
      storageLocationId: 'freezer-1',
      sourceService: 'storage-service',
      eventId: 'evt-assignment-1',
    });
  });

  it('projects a released assignment with aggregate/default fallbacks and invalid optional dates', async () => {
    const session = makeSession();
    const service = new Neo4jCanonicalProjectionV2Service();

    const result = await service.applyEvent(session, {
      eventType: 'SPECIMEN_CONTAINER_ASSIGNMENT_RELEASED',
      aggregateId: 'assignment-2',
      payload: {
        specimenId: 'specimen-2',
        assignedAt: 'not-a-date',
        releasedAt: '',
      },
    });

    expect(result.specimenContainerAssignmentId).toBe('assignment-2');
    expect(result.eventType).toBe('SPECIMEN_CONTAINER_ASSIGNMENT_RELEASED');
    const params = session.run.mock.calls[0][1];
    expect(params).toMatchObject({
      specimenId: 'specimen-2',
      specimenContainerAssignmentId: 'assignment-2',
      containerId: null,
      assignedAt: null,
      releasedAt: null,
      containerPositionAssignmentId: '',
      storagePositionId: null,
      rackLocationAssignmentId: '',
      storageRackId: null,
      storageLocationId: null,
      sourceService: 'unknown',
      eventId: '',
    });
  });

  it.each([
    [{ eventType: 'SPECIMEN_CONTAINER_ASSIGNMENT_UPSERTED', payload: { specimenId: 'specimen-1' } }],
    [{ eventType: 'SPECIMEN_CONTAINER_ASSIGNMENT_UPSERTED', aggregateId: 'assignment-1', payload: {} }],
  ])('rejects assignment projection when either canonical identifier is absent', async (event) => {
    const service = new Neo4jCanonicalProjectionV2Service();
    await expect(service.applyEvent(makeSession(), event))
      .rejects.toThrow('SpecimenContainerAssignment projection requires specimen and assignment ids');
  });

  it('projects a complete telemetry exposure summary through the v2 dispatcher', async () => {
    const session = makeSession();
    const service = new Neo4jCanonicalProjectionV2Service();

    const result = await service.applyEvent(session, {
      eventId: 'evt-telemetry-1',
      eventType: 'TELEMETRY_EXPOSURE_SUMMARIZED',
      aggregateId: 'summary-fallback',
      sourceService: 'telemetry-service',
      occurredAt: '2026-09-18T15:00:00.000Z',
      payload: {
        telemetryExposureSummaryId: 'summary-1',
        specimenId: 'specimen-1',
        specimenContainerAssignmentId: 'assignment-1',
        exposurePathHash: 'path-hash',
        datastreamIds: ['stream-a', 22],
        windowStart: '2026-09-18T10:00:00.000Z',
        windowEnd: '2026-09-18T14:00:00.000Z',
        observationCount: '7',
        minimumValue: 0,
        maximumValue: 9.5,
        meanValue: 4.25,
        timeOutsideThresholdSeconds: '120',
        excursionCount: '2',
        coverageRatio: 0,
        sourceQueryHash: 'query-hash',
        sourceReadingSetHash: 'reading-set-hash',
        calculationVersion: '2.1.0',
        calculatedAt: '2026-09-18T14:30:00.000Z',
      },
    });

    expect(result).toEqual({
      projected: true,
      eventType: 'TELEMETRY_EXPOSURE_SUMMARIZED',
      specimenId: 'specimen-1',
      summaryId: 'summary-1',
    });
    const [cypher, params] = session.run.mock.calls[0];
    expect(cypher).toContain('TelemetryExposureSummary');
    expect(cypher).toContain('EXPOSURE_THROUGH');
    expect(params).toMatchObject({
      summaryId: 'summary-1',
      specimenId: 'specimen-1',
      specimenContainerAssignmentId: 'assignment-1',
      exposurePathHash: 'path-hash',
      datastreamIds: ['stream-a', '22'],
      windowStart: '2026-09-18T10:00:00.000Z',
      windowEnd: '2026-09-18T14:00:00.000Z',
      observationCount: 7,
      minimumValue: 0,
      maximumValue: 9.5,
      meanValue: 4.25,
      timeOutsideThresholdSeconds: 120,
      excursionCount: 2,
      coverageRatio: 0,
      sourceQueryHash: 'query-hash',
      sourceReadingSetHash: 'reading-set-hash',
      calculationVersion: '2.1.0',
      calculatedAt: '2026-09-18T14:30:00.000Z',
      sourceService: 'telemetry-service',
      eventId: 'evt-telemetry-1',
    });
  });

  it('projects telemetry defaults, aggregate fallback, empty streams and invalid optional windows', async () => {
    const session = makeSession();
    const service = new Neo4jCanonicalProjectionV2Service();

    const result = await service.applyEvent(session, {
      eventType: 'TELEMETRY_EXPOSURE_SUMMARIZED',
      aggregateId: 'summary-2',
      payload: {
        specimenId: 'specimen-2',
        datastreamIds: null,
        windowStart: 'invalid',
        windowEnd: '',
        calculatedAt: 'invalid',
        observationCount: null,
        timeOutsideThresholdSeconds: '',
        excursionCount: undefined,
      },
    });

    expect(result.summaryId).toBe('summary-2');
    const params = session.run.mock.calls[0][1];
    expect(params.summaryId).toBe('summary-2');
    expect(params.specimenContainerAssignmentId).toBe('');
    expect(params.exposurePathHash).toBeNull();
    expect(params.datastreamIds).toEqual([]);
    expect(params.windowStart).toBeNull();
    expect(params.windowEnd).toBeNull();
    expect(params.observationCount).toBe(0);
    expect(params.minimumValue).toBeNull();
    expect(params.maximumValue).toBeNull();
    expect(params.meanValue).toBeNull();
    expect(params.timeOutsideThresholdSeconds).toBe(0);
    expect(params.excursionCount).toBe(0);
    expect(params.coverageRatio).toBeNull();
    expect(params.sourceQueryHash).toBeNull();
    expect(params.sourceReadingSetHash).toBeNull();
    expect(params.calculationVersion).toBe('2.0.0');
    expect(params.calculatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(params.sourceService).toBe('unknown');
    expect(params.eventId).toBe('');
  });

  it.each([
    [{ eventType: 'TELEMETRY_EXPOSURE_SUMMARIZED', payload: { specimenId: 'specimen-1' } }],
    [{ eventType: 'TELEMETRY_EXPOSURE_SUMMARIZED', aggregateId: 'summary-1', payload: {} }],
  ])('rejects telemetry projection when either canonical identifier is absent', async (event) => {
    const service = new Neo4jCanonicalProjectionV2Service();
    await expect(service.applyEvent(makeSession(), event))
      .rejects.toThrow('Telemetry exposure projection requires summary and specimen ids');
  });
});


describe('RF023 canonical v2 item 8 edge branches', () => {
  const makeSession = () => ({ run: vi.fn().mockResolvedValue({ records: [] }) });

  it('covers consent id fallbacks, default status/source/schema and Date normalization', async () => {
    const service = new Neo4jCanonicalProjectionV2Service();

    let session = makeSession();
    await service.applyEvent(session, {
      eventType: 'CONSENT_UPSERTED',
      payload: {
        participantId: 'participant-2',
        consentId: 'consent-from-payload',
        signedAt: new Date('2026-09-18T16:00:00.000Z'),
      },
    });
    let params = session.run.mock.calls[0][1];
    expect(params).toMatchObject({
      consentId: 'consent-from-payload',
      consentStatus: 'ACTIVE',
      schemaVersion: 2,
      occurredAt: '2026-09-18T16:00:00.000Z',
      sourceService: 'unknown',
      eventId: '',
      revoked: false,
    });

    session = makeSession();
    await service.applyEvent(session, {
      eventType: 'CONSENT_REVOKED',
      aggregateId: 'consent-from-aggregate',
      occurredAt: '2026-09-18T17:00:00.000Z',
      payload: { participantId: 'participant-2', status: 'REVOKED' },
    });
    params = session.run.mock.calls[0][1];
    expect(params.consentId).toBe('consent-from-aggregate');
    expect(params.revoked).toBe(true);

    await expect(service.applyEvent(makeSession(), {
      eventType: 'CONSENT_UPSERTED',
      payload: { participantId: 'participant-only' },
    })).rejects.toThrow('Consent projection requires participantId and ethicalConsentId');
  });

  it('covers specimen aggregate fallback, parent array path, donor absence and required-id guard', async () => {
    const service = new Neo4jCanonicalProjectionV2Service();
    const session = makeSession();

    await service.applyEvent(session, {
      eventType: 'SPECIMEN_UPSERTED',
      aggregateId: 'specimen-aggregate',
      payload: {
        parentSpecimenIds: [' parent-1 ', '', null],
      },
    });

    const params = session.run.mock.calls[0][1];
    expect(params.specimenId).toBe('specimen-aggregate');
    expect(params.donorId).toBe('');
    expect(params.parentSpecimenIds).toEqual(['parent-1']);
    expect(params.barcode).toBeNull();
    expect(params.specimenStatus).toBeNull();
    expect(params.sourceService).toBe('unknown');

    await expect(service.applyEvent(makeSession(), {
      eventType: 'SPECIMEN_UPSERTED',
      payload: {},
    })).rejects.toThrow('Specimen projection requires specimenId');
  });

  it('covers position-key alternatives and custody aggregate/event fallbacks', async () => {
    const service = new Neo4jCanonicalProjectionV2Service();

    expect(service.positionKey(null)).toBe('');
    expect(service.positionKey('not-an-object')).toBe('');
    expect(service.positionKey({ storagePositionId: '  POS-1  ' })).toBe('POS-1');
    expect(service.positionKey({ boxId: 'box-1' })).toBe('');

    const session = makeSession();
    await service.applyEvent(session, {
      eventType: 'CUSTODY_EVENT_RECORDED',
      aggregateId: 'specimen-custody',
      eventId: 'custody-from-event',
      occurredAt: new Date('2026-09-18T18:00:00.000Z'),
      payload: {
        eventType: 'move',
        from: null,
        to: { storagePositionId: ' position-2 ' },
      },
    });
    const params = session.run.mock.calls[0][1];
    expect(params).toMatchObject({
      specimenId: 'specimen-custody',
      custodyEventId: 'custody-from-event',
      fromPositionId: '',
      toPositionId: 'position-2',
      happenedAt: '2026-09-18T18:00:00.000Z',
      actorId: null,
      reason: null,
      sourceService: 'unknown',
    });

    await expect(service.applyEvent(makeSession(), {
      eventType: 'CUSTODY_EVENT_RECORDED',
      payload: {},
    })).rejects.toThrow('Custody projection requires specimenId and custodyEventId');
  });

  it('delegates non-v2 event types to the base projector', async () => {
    const { Neo4jCanonicalProjectionService } = require('../../src/services/neo4jCanonicalProjection.service');
    const baseSpy = vi
      .spyOn(Neo4jCanonicalProjectionService.prototype, 'applyEvent')
      .mockResolvedValue({ projected: true, delegated: true });

    const service = new Neo4jCanonicalProjectionV2Service();
    const event = { eventType: 'QUALITY_ASSESSED', aggregateId: 'specimen-1' };
    const result = await service.applyEvent(makeSession(), event);

    expect(result).toEqual({ projected: true, delegated: true });
    expect(baseSpy).toHaveBeenCalledWith(expect.anything(), event);
    baseSpy.mockRestore();
  });

  it('uses event occurredAt when telemetry calculatedAt is absent', async () => {
    const service = new Neo4jCanonicalProjectionV2Service();
    const session = makeSession();
    await service.applyEvent(session, {
      eventType: 'TELEMETRY_EXPOSURE_SUMMARIZED',
      aggregateId: 'summary-occurred',
      occurredAt: new Date('2026-09-18T19:00:00.000Z'),
      payload: { specimenId: 'specimen-occurred' },
    });

    expect(session.run.mock.calls[0][1].calculatedAt).toBe('2026-09-18T19:00:00.000Z');
  });
});
