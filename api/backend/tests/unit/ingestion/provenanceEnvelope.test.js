import { describe, it, expect } from 'vitest';
const { buildProvenanceEnvelope, validateProvenanceEnvelope } = require('../../../src/ingestion/provenanceEnvelope');

describe('ingestion/provenanceEnvelope (RF029 AC 3)', () => {
  const validRaw = {
    sourceSystem: 'urn:system:intake-wizard',
    createdBy: 'Actor/tech-1',
    retrievedAt: '2026-08-20T12:00:00.000Z',
    purpose: 'operational_registration',
  };

  describe('buildProvenanceEnvelope', () => {
    it('normalizes a valid raw envelope', () => {
      const envelope = buildProvenanceEnvelope(validRaw);
      expect(envelope.sourceSystem).toBe('urn:system:intake-wizard');
      expect(envelope.createdBy).toBe('Actor/tech-1');
      expect(envelope.retrievedAt).toBeInstanceOf(Date);
      expect(envelope.purpose).toBe('operational_registration');
    });

    it('defaults every field to null on an empty/missing raw envelope', () => {
      const envelope = buildProvenanceEnvelope();
      expect(envelope.sourceSystem).toBeNull();
      expect(envelope.createdBy).toBeNull();
      expect(envelope.retrievedAt).toBeNull();
      expect(envelope.purpose).toBeNull();
      expect(envelope.sourceRecordId).toBeNull();
    });

    it('ignores a non-object raw envelope rather than throwing', () => {
      expect(() => buildProvenanceEnvelope('not-an-object')).not.toThrow();
      expect(buildProvenanceEnvelope('not-an-object').sourceSystem).toBeNull();
    });
  });

  describe('validateProvenanceEnvelope', () => {
    it('accepts a fully populated envelope', () => {
      const result = validateProvenanceEnvelope(validRaw);
      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it('reports one violation per missing required field', () => {
      const result = validateProvenanceEnvelope({});
      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(4);
      expect(result.violations.map((v) => v.field)).toEqual([
        'provenance.sourceSystem',
        'provenance.createdBy',
        'provenance.retrievedAt',
        'provenance.purpose',
      ]);
      expect(result.violations.every((v) => v.code === 'PROVENANCE_FIELD_MISSING')).toBe(true);
    });

    it('rejects an unparseable retrievedAt as missing, not a silent default', () => {
      const result = validateProvenanceEnvelope({ ...validRaw, retrievedAt: 'not-a-date' });
      expect(result.valid).toBe(false);
      expect(result.violations.map((v) => v.field)).toContain('provenance.retrievedAt');
    });

    it('accepts a Date instance directly for retrievedAt', () => {
      const result = validateProvenanceEnvelope({ ...validRaw, retrievedAt: new Date() });
      expect(result.valid).toBe(true);
    });
  });

  // RF029 AC2 (#1523): ELM-0022 accessPolicyId, optional, 0..*.
  describe('accessPolicyId (RF029 AC2, ELM-0022)', () => {
    it('normalizes an array with a duplicate and padding to the trimmed unique ids', () => {
      const result = validateProvenanceEnvelope({ ...validRaw, accessPolicyId: [' pol-a ', 'pol-b', 'pol-a'] });
      expect(result.envelope.accessPolicyId).toEqual(['pol-a', 'pol-b']);
      expect(result.violations).toEqual([]);
    });

    it('absent or null gives [] and no violation', () => {
      for (const raw of [validRaw, { ...validRaw, accessPolicyId: null }]) {
        const result = validateProvenanceEnvelope(raw);
        expect(result.envelope.accessPolicyId).toEqual([]);
        expect(result.violations).toEqual([]);
        expect(result.valid).toBe(true);
      }
    });

    it("a bare string, [1] and ['  '] each give exactly one PROVENANCE_FIELD_INVALID", () => {
      for (const accessPolicyId of ['pol-a', [1], ['  ']]) {
        const result = validateProvenanceEnvelope({ ...validRaw, accessPolicyId });
        expect(result.valid).toBe(false);
        expect(result.violations).toEqual([
          expect.objectContaining({ code: 'PROVENANCE_FIELD_INVALID', field: 'provenance.accessPolicyId' }),
        ]);
        expect(result.envelope.accessPolicyId).toEqual([]);
      }
    });
  });
});
