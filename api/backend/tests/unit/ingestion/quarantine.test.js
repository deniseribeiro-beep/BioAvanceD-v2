import { describe, it, expect } from 'vitest';
const { quarantineRecord, resolveQuarantineRecord } = require('../../../src/ingestion/quarantine');
const { createFakeDb } = require('./testHelpers');

const violations = [{ code: 'NON_CANONICAL_FIELD', field: 'patientID', message: 'Campo não canônico: patientID' }];

describe('ingestion/quarantine (RF029 AC 6)', () => {
  describe('quarantineRecord', () => {
    it('persists a rejected record with its violations, defaulting severity/resolutionStatus', async () => {
      const db = createFakeDb({ ingestionQuarantineRecords: [] });
      const record = await quarantineRecord(db, { entityType: 'Specimen', payload: { patientID: '1' }, violations });

      expect(record.ingestionQuarantineRecordId).toMatch(/^[0-9a-f-]{36}$/);
      expect(record.severity).toBe('error');
      expect(record.resolutionStatus).toBe('open');
      expect(record.violations).toEqual(violations);
      expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(1);
    });

    it('rejects a record with no violations (nothing to quarantine for)', async () => {
      const db = createFakeDb({ ingestionQuarantineRecords: [] });
      await expect(quarantineRecord(db, { entityType: 'Specimen', payload: {}, violations: [] })).rejects.toThrow(/violations/);
    });

    it('rejects a record with no entityType', async () => {
      const db = createFakeDb({ ingestionQuarantineRecords: [] });
      await expect(quarantineRecord(db, { payload: {}, violations })).rejects.toThrow(/entityType/);
    });
  });

  describe('resolveQuarantineRecord', () => {
    const openRecord = () => ({
      ingestionQuarantineRecordId: 'iqr-1',
      entityType: 'Specimen',
      violations,
      severity: 'error',
      resolutionStatus: 'open',
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
    });

    it('transitions an open record to a terminal status, recording who/when/why', async () => {
      const db = createFakeDb({ ingestionQuarantineRecords: [openRecord()] });
      const resolved = await resolveQuarantineRecord({
        db,
        ingestionQuarantineRecordId: 'iqr-1',
        resolutionStatus: 'corrected',
        resolvedBy: 'Actor/curator-1',
        resolutionNotes: 'Corrigido manualmente.',
      });

      expect(resolved.resolutionStatus).toBe('corrected');
      expect(resolved.resolvedBy).toBe('Actor/curator-1');
      expect(db.collections.ingestionQuarantineRecords.docs[0].resolutionStatus).toBe('corrected');
    });

    it('rejects resolving back to open', async () => {
      const db = createFakeDb({ ingestionQuarantineRecords: [openRecord()] });
      await expect(
        resolveQuarantineRecord({ db, ingestionQuarantineRecordId: 'iqr-1', resolutionStatus: 'open', resolvedBy: 'Actor/curator-1' }),
      ).rejects.toThrow(/resolutionStatus/);
    });

    it('rejects a record that does not exist', async () => {
      const db = createFakeDb({ ingestionQuarantineRecords: [] });
      await expect(
        resolveQuarantineRecord({ db, ingestionQuarantineRecordId: 'missing', resolutionStatus: 'closed', resolvedBy: 'Actor/curator-1' }),
      ).rejects.toThrow(/não encontrado/);
    });

    it('rejects double-resolving an already-resolved record', async () => {
      const db = createFakeDb({
        ingestionQuarantineRecords: [{ ...openRecord(), resolutionStatus: 'accepted', resolvedBy: 'Actor/prior' }],
      });
      await expect(
        resolveQuarantineRecord({ db, ingestionQuarantineRecordId: 'iqr-1', resolutionStatus: 'closed', resolvedBy: 'Actor/curator-1' }),
      ).rejects.toThrow(/já foi resolvido/);
    });

    it('requires resolvedBy', async () => {
      const db = createFakeDb({ ingestionQuarantineRecords: [openRecord()] });
      await expect(
        resolveQuarantineRecord({ db, ingestionQuarantineRecordId: 'iqr-1', resolutionStatus: 'closed' }),
      ).rejects.toThrow(/resolvedBy/);
    });
  });
});
