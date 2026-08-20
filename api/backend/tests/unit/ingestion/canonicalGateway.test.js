import { describe, it, expect } from 'vitest';
const { collectAliasViolations, validateIngestionPayload, assertReferencesExist } = require('../../../src/ingestion/canonicalGateway');
const { createFakeDb } = require('./testHelpers');

describe('ingestion/canonicalGateway (RF029 AC 1/2)', () => {
  describe('collectAliasViolations', () => {
    const aliasMap = { participantId: ['patientID', 'patientId'] };

    it('flags a legacy alias key present on the payload', () => {
      const hits = collectAliasViolations({ patientID: '123' }, aliasMap);
      expect(hits).toEqual(['patientID']);
    });

    it('does not flag the canonical key itself', () => {
      const hits = collectAliasViolations({ participantId: '123' }, aliasMap);
      expect(hits).toEqual([]);
    });

    it('returns no hits for a non-object payload', () => {
      expect(collectAliasViolations(null, aliasMap)).toEqual([]);
      expect(collectAliasViolations(['array'], aliasMap)).toEqual([]);
    });

    it('de-duplicates repeated alias hits', () => {
      const hits = collectAliasViolations(
        { patientID: '1' },
        { participantId: ['patientID'], other: ['patientID'] },
      );
      expect(hits).toEqual(['patientID']);
    });
  });

  describe('validateIngestionPayload', () => {
    it('passes a payload that matches a registered canonical schema exactly', () => {
      const result = validateIngestionPayload({
        schemaId: 'canonical.v1.participant',
        payload: { participantId: 'P-1' },
      });
      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it('rejects an unknown field the schema does not declare (additionalProperties: false)', () => {
      const result = validateIngestionPayload({
        schemaId: 'canonical.v1.participant',
        payload: { participantId: 'P-1', unknownField: 'x' },
      });
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.code === 'CONTRACT_VIOLATION')).toBe(true);
    });

    it('rejects a missing required field', () => {
      const result = validateIngestionPayload({ schemaId: 'canonical.v1.participant', payload: {} });
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.field === 'participantId')).toBe(true);
    });

    it('combines alias violations with contract violations in one list', () => {
      // patientID trips the alias check (present) AND the contract check
      // twice over: it's an undeclared field (additionalProperties: false)
      // *and* its presence doesn't satisfy participantId's own
      // requiredness — Ajv's allErrors:true reports both.
      const result = validateIngestionPayload({
        schemaId: 'canonical.v1.participant',
        payload: { patientID: 'P-1' },
        aliasMap: { participantId: ['patientID'] },
      });
      expect(result.valid).toBe(false);
      const codes = result.violations.map((v) => v.code);
      expect(codes).toContain('NON_CANONICAL_FIELD');
      expect(codes).toContain('CONTRACT_VIOLATION');
    });

    it('skips contract validation entirely when no schemaId is given', () => {
      const result = validateIngestionPayload({ payload: { anything: true } });
      expect(result.valid).toBe(true);
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

    it('skips a reference whose value is absent (a presence concern, not this function\'s)', async () => {
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
