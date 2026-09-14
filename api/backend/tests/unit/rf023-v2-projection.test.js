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
