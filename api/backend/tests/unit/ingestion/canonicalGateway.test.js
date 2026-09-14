import { describe, it, expect } from 'vitest';
const { collectAliasViolations, validateIngestionPayload, assertReferencesExist } = require('../../../src/ingestion/canonicalGateway');
const { createFakeDb } = require('./testHelpers');

const VALID_PARTICIPANT = {
  participantId: '550e8400-e29b-41d4-a716-446655440000',
  pseudonymId: [{ system: 'urn:bioadvanced:test', value: 'SYN-001' }],
};

describe('ingestion/canonicalGateway (RF029 AC 1/2; canonical v2.0.0)', () => {
  describe('collectAliasViolations', () => {
    const aliasMap = { participantId: ['patientID', 'patientId'] };

    it('flags a replaced alias key present on the payload', () => {
      expect(collectAliasViolations({ patientID: '123' }, aliasMap)).toEqual(['patientID']);
    });

    it('does not flag the canonical key itself', () => {
      expect(collectAliasViolations({ participantId: '123' }, aliasMap)).toEqual([]);
    });

    it('returns no hits for a non-object payload', () => {
      expect(collectAliasViolations(null, aliasMap)).toEqual([]);
      expect(collectAliasViolations(['array'], aliasMap)).toEqual([]);
    });

    it('de-duplicates repeated alias hits', () => {
      expect(collectAliasViolations(
        { patientID: '1' },
        { participantId: ['patientID'], other: ['patientID'] },
      )).toEqual(['patientID']);
    });
  });

  describe('validateIngestionPayload', () => {
    it('passes a payload matching the approved Participant v2 contract', async () => {
      const result = await validateIngestionPayload({ entityType: 'Participant', payload: VALID_PARTICIPANT });
      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it('rejects a field that the approved Participant entity does not declare', async () => {
      const result = await validateIngestionPayload({
        entityType: 'Participant',
        payload: { ...VALID_PARTICIPANT, unknownField: 'x' },
      });
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.code === 'CONTRACT_VIOLATION' && v.field === 'unknownField')).toBe(true);
    });

    it('enforces required cardinality from the v2 dictionary', async () => {
      const result = await validateIngestionPayload({
        entityType: 'Participant',
        payload: { participantId: VALID_PARTICIPANT.participantId },
      });
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.field === 'pseudonymId')).toBe(true);
    });

    it('combines alias and v2 contract violations', async () => {
      const result = await validateIngestionPayload({
        entityType: 'Participant',
        payload: { patientID: VALID_PARTICIPANT.participantId },
        aliasMap: { participantId: ['patientID'] },
      });
      expect(result.valid).toBe(false);
      const codes = result.violations.map((v) => v.code);
      expect(codes).toContain('NON_CANONICAL_FIELD');
      expect(codes).toContain('CONTRACT_VIOLATION');
    });

    it('requires an entity registered by the approved v2 dictionary', async () => {
      await expect(validateIngestionPayload({ entityType: 'NotCanonical', payload: {} }))
        .rejects.toThrow(/not registered/);
    });
  });

  describe('assertReferencesExist', () => {
    it('passes when every referenced document exists', async () => {
      const db = createFakeDb({ participants: [{ participantId: 'P-1' }] });
      const result = await assertReferencesExist(db, [
        { collection: 'participants', field: 'participantId', value: 'P-1', label: 'participantId' },
      ]);
      expect(result.valid).toBe(true);
    });

    it('reports REFERENCE_NOT_FOUND for a reference that does not resolve', async () => {
      const db = createFakeDb({ participants: [] });
      const result = await assertReferencesExist(db, [
        { collection: 'participants', field: 'participantId', value: 'P-missing', label: 'participantId' },
      ]);
      expect(result.valid).toBe(false);
      expect(result.violations).toEqual([
        {
          code: 'REFERENCE_NOT_FOUND',
          field: 'participantId',
          message: 'Referência inexistente: participantId="P-missing" não encontrado em participants',
        },
      ]);
    });

    it('skips a reference whose value is absent', async () => {
      const db = createFakeDb({ participants: [] });
      const result = await assertReferencesExist(db, [
        { collection: 'participants', field: 'participantId', value: null, label: 'participantId' },
      ]);
      expect(result.valid).toBe(true);
    });

    it('throws when a reference entry is missing collection/field', async () => {
      const db = createFakeDb({});
      await expect(assertReferencesExist(db, [{ value: 'x' }])).rejects.toThrow(/collection e field/);
    });
  });
});
