import { describe, it, expect } from 'vitest';
const { ingestRecord } = require('../../../src/ingestion/ingestionGateway');
const { createFakeDb } = require('./testHelpers');

function validProvenance() {
  return {
    sourceSystem: 'urn:system:test',
    createdBy: 'Actor/tech-1',
    retrievedAt: new Date().toISOString(),
    purpose: 'operational_registration',
  };
}

describe('ingestion/ingestionGateway (RF029 slice 1/6, #669)', () => {
  it('accepts a payload that passes provenance, contract, reference, and active-code checks', async () => {
    const db = createFakeDb({
      participants: [{ participantId: 'P-1' }],
      terminologyConcepts: [{ systemUri: 'sys:x', code: 'C1', conceptStatus: 'active', referenceDatasetReleaseId: 'rel-1' }],
      referenceDatasetReleases: [{ referenceDatasetReleaseId: 'rel-1', releaseStatus: 'active' }],
      ingestionQuarantineRecords: [],
    });

    const outcome = await ingestRecord({
      db,
      entityType: 'Specimen',
      schemaId: 'canonical.v1.specimen',
      payload: { specimenId: 'S-1', participantId: 'P-1' },
      provenance: validProvenance(),
      references: [{ collection: 'participants', field: 'participantId', value: 'P-1', label: 'participantId' }],
      referenceCodes: [{ systemUri: 'sys:x', code: 'C1', label: 'sampleTypeCode' }],
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
  });

  it('quarantines on a missing provenance envelope, recording the violations on the persisted record', async () => {
    const db = createFakeDb({ ingestionQuarantineRecords: [] });
    const outcome = await ingestRecord({
      db,
      entityType: 'Specimen',
      payload: { specimenId: 'S-1' },
      provenance: {},
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v) => v.code === 'PROVENANCE_FIELD_MISSING')).toBe(true);
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(1);
    expect(db.collections.ingestionQuarantineRecords.docs[0]).toMatchObject({ entityType: 'Specimen', resolutionStatus: 'open' });
  });

  it('quarantines on a nonexistent reference', async () => {
    const db = createFakeDb({ participants: [], ingestionQuarantineRecords: [] });
    const outcome = await ingestRecord({
      db,
      entityType: 'Specimen',
      payload: { specimenId: 'S-1', participantId: 'P-missing' },
      provenance: validProvenance(),
      references: [{ collection: 'participants', field: 'participantId', value: 'P-missing', label: 'participantId' }],
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v) => v.code === 'REFERENCE_NOT_FOUND')).toBe(true);
  });

  it('quarantines on an inactive/unknown reference code', async () => {
    const db = createFakeDb({ terminologyConcepts: [], referenceDatasetReleases: [], ingestionQuarantineRecords: [] });
    const outcome = await ingestRecord({
      db,
      entityType: 'Specimen',
      payload: { specimenId: 'S-1' },
      provenance: validProvenance(),
      referenceCodes: [{ systemUri: 'sys:x', code: 'UNKNOWN', label: 'sampleTypeCode' }],
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v) => v.code === 'INACTIVE_OR_UNKNOWN_CODE')).toBe(true);
  });

  describe('idempotency (AC 5, composed with quarantine/accept)', () => {
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
        payload: { anything: 'different' },
        provenance: validProvenance(),
        idempotencyKey: 'key-1',
      });

      expect(second.status).toBe('idempotent_replay');
      expect(second.resultRef).toBe(first.quarantineRecord.ingestionQuarantineRecordId);
      expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(1);
    });

    it('records a null resultRef for an accepted outcome — no entity is persisted by this foundation slice', async () => {
      const db = createFakeDb({ ingestionIdempotencyKeys: [] });
      const outcome = await ingestRecord({
        db,
        entityType: 'Specimen',
        payload: {},
        provenance: validProvenance(),
        idempotencyKey: 'key-2',
      });

      expect(outcome.status).toBe('accepted');
      const keyDoc = db.collections.ingestionIdempotencyKeys.docs.find((d) => d.idempotencyKey === 'key-2');
      expect(keyDoc.status).toBe('completed');
      expect(keyDoc.resultRef).toBeNull();
    });

    it('scopes idempotency by entityType — the same key under a different entityType is a fresh claim', async () => {
      const db = createFakeDb({ ingestionQuarantineRecords: [] });
      const first = await ingestRecord({ db, entityType: 'Specimen', payload: {}, provenance: {}, idempotencyKey: 'shared-key' });
      const second = await ingestRecord({ db, entityType: 'Consent', payload: {}, provenance: {}, idempotencyKey: 'shared-key' });

      expect(first.status).toBe('quarantined');
      expect(second.status).toBe('quarantined');
      expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(2);
    });
  });
});
