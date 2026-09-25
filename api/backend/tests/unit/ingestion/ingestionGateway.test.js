import { describe, it, expect } from 'vitest';
const { ingestRecord } = require('../../../src/ingestion/ingestionGateway');
const { createFakeDb } = require('./testHelpers');

const PARTICIPANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const SPECIMEN_ID = '550e8400-e29b-41d4-a716-446655440001';

function validProvenance() {
  return {
    sourceSystem: 'urn:system:test',
    createdBy: 'Actor/tech-1',
    retrievedAt: new Date().toISOString(),
    purpose: 'operational_registration',
  };
}

function validSpecimen(overrides = {}) {
  return {
    specimenId: SPECIMEN_ID,
    accessionIdentifier: [{ system: 'urn:bioadvanced:test', value: 'SP-001' }],
    participantId: PARTICIPANT_ID,
    collectionId: 'Collection/test',
    specimenRole: 'primary',
    materialType: { coding: [{ system: 'urn:bioadvanced:material', code: 'blood' }] },
    specimenStatus: 'available',
    collectionDateTime: new Date().toISOString(),
    organismTaxon: { system: 'https://www.ncbi.nlm.nih.gov/taxonomy', code: '9606' },
    quantityStatus: 'full',
    quantityLedgerVersion: 1,
    ...overrides,
  };
}

describe('ingestion/ingestionGateway (RF029; canonical v2.0.0)', () => {
  const HPO_SYSTEM = 'http://purl.obolibrary.org/obo/hp.owl';

  it('accepts a payload that passes provenance, v2 contract, reference, and active-code checks', async () => {
    const db = createFakeDb({
      participants: [{ participantId: PARTICIPANT_ID }],
      terminologyConcepts: [{ systemUri: HPO_SYSTEM, code: 'HP:0001250', conceptStatus: 'active', referenceDatasetReleaseId: 'rel-1' }],
      referenceDatasetReleases: [{ referenceDatasetReleaseId: 'rel-1', releaseStatus: 'active' }],
      ingestionQuarantineRecords: [],
    });

    const outcome = await ingestRecord({
      db,
      entityType: 'Specimen',
      payload: validSpecimen(),
      provenance: validProvenance(),
      references: [{ collection: 'participants', field: 'participantId', value: PARTICIPANT_ID, label: 'participantId' }],
      referenceCodes: [{ systemUri: HPO_SYSTEM, code: 'HP:0001250', label: 'sampleTypeCode' }],
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
  });

  it('quarantines a contract-invalid record and missing provenance without silently correcting it', async () => {
    const db = createFakeDb({ ingestionQuarantineRecords: [] });
    const outcome = await ingestRecord({
      db,
      entityType: 'Specimen',
      payload: { specimenId: SPECIMEN_ID },
      provenance: {},
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v) => v.code === 'PROVENANCE_FIELD_MISSING')).toBe(true);
    expect(outcome.violations.some((v) => v.code === 'CONTRACT_VIOLATION')).toBe(true);
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(1);
    expect(db.collections.ingestionQuarantineRecords.docs[0]).toMatchObject({ entityType: 'Specimen', resolutionStatus: 'open' });
  });

  it('quarantines on a nonexistent reference', async () => {
    const db = createFakeDb({ participants: [], ingestionQuarantineRecords: [] });
    const outcome = await ingestRecord({
      db,
      entityType: 'Specimen',
      payload: validSpecimen({ participantId: 'Participant/missing' }),
      provenance: validProvenance(),
      references: [{ collection: 'participants', field: 'participantId', value: 'Participant/missing', label: 'participantId' }],
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v) => v.code === 'REFERENCE_NOT_FOUND')).toBe(true);
  });

  it('quarantines on an inactive/unknown reference code', async () => {
    const db = createFakeDb({ terminologyConcepts: [], referenceDatasetReleases: [], ingestionQuarantineRecords: [] });
    const outcome = await ingestRecord({
      db,
      entityType: 'Specimen',
      payload: validSpecimen(),
      provenance: validProvenance(),
      referenceCodes: [{ systemUri: 'http://purl.obolibrary.org/obo/hp.owl', code: 'UNKNOWN', label: 'sampleTypeCode' }],
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v) => v.code === 'INACTIVE_OR_UNKNOWN_CODE')).toBe(true);
  });

  describe('idempotency', () => {
    it('replays the first outcome on a repeated idempotencyKey instead of re-validating', async () => {
      const db = createFakeDb({ ingestionQuarantineRecords: [] });
      const first = await ingestRecord({
        db,
        entityType: 'Specimen',
        payload: {},
        provenance: {},
        idempotencyKey: 'key-1',
      });
      expect(first.status).toBe('quarantined');
      expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(1);

      const second = await ingestRecord({
        db,
        entityType: 'Specimen',
        payload: validSpecimen(),
        provenance: validProvenance(),
        idempotencyKey: 'key-1',
      });

      expect(second.status).toBe('idempotent_replay');
      expect(second.resultRef).toBe(first.quarantineRecord.ingestionQuarantineRecordId);
      expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(1);
    });

    it('records a null resultRef for an accepted outcome before entity persistence is composed', async () => {
      const db = createFakeDb({ ingestionIdempotencyKeys: [] });
      const outcome = await ingestRecord({
        db,
        entityType: 'Specimen',
        payload: validSpecimen(),
        provenance: validProvenance(),
        idempotencyKey: 'key-2',
      });

      expect(outcome.status).toBe('accepted');
      const keyDoc = db.collections.ingestionIdempotencyKeys.docs.find((d) => d.idempotencyKey === 'key-2');
      expect(keyDoc.status).toBe('completed');
      expect(keyDoc.resultRef).toBeNull();
    });

    it('scopes idempotency by entityType', async () => {
      const db = createFakeDb({ ingestionQuarantineRecords: [] });
      const first = await ingestRecord({ db, entityType: 'Specimen', payload: {}, provenance: {}, idempotencyKey: 'shared-key' });
      const second = await ingestRecord({ db, entityType: 'Consent', payload: {}, provenance: {}, idempotencyKey: 'shared-key' });

      expect(first.status).toBe('quarantined');
      expect(second.status).toBe('quarantined');
      expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(2);
    });
  });
});
