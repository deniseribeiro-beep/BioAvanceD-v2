import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ConditionModel = require('../../../src/models/Condition');

const ICD11_CODING = { systemUri: 'http://id.who.int/icd/release/11/mms', code: 'ICD11:1A00', version: '2026-01' };

describe('ConditionModel', () => {
  describe('create', () => {
    it('requires participantId and a non-empty conditionCoding', () => {
      expect(() => ConditionModel.create({})).toThrow(
        'participantId é obrigatório para Condition, conditionCoding é obrigatório para Condition (1..*, cada item precisa de systemUri e code)'
      );
    });

    it('drops conditionCoding entries missing systemUri or code, and fails if none remain', () => {
      expect(() =>
        ConditionModel.create({ participantId: 'PART-1', conditionCoding: [{ code: 'no-system' }, { systemUri: 'no-code' }] })
      ).toThrow('conditionCoding é obrigatório');
    });

    it('builds a full condition document with a generated conditionId', () => {
      const doc = ConditionModel.create({ participantId: 'PART-1', conditionCoding: [ICD11_CODING] });

      expect(doc.conditionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.participantId).toBe('PART-1');
      expect(doc.conditionCoding).toEqual([ICD11_CODING]);
      expect(doc.clinicalStatus).toBeNull();
      expect(doc.diagnosisEvidence).toEqual([]);
      expect(doc.createdAt).toBeInstanceOf(Date);
    });

    it('accepts multiple codings (ORPHA + ICD-11, preserving each source)', () => {
      const orpha = { systemUri: 'http://www.orpha.net', code: 'ORPHA:558' };
      const doc = ConditionModel.create({ participantId: 'PART-1', conditionCoding: [ICD11_CODING, orpha] });

      expect(doc.conditionCoding).toEqual([ICD11_CODING, orpha]);
    });

    it('carries clinicalStatus/verificationStatus/severity/stage/recordedDate when given', () => {
      const doc = ConditionModel.create({
        participantId: 'PART-1',
        conditionCoding: [ICD11_CODING],
        clinicalStatus: 'active',
        verificationStatus: 'confirmed',
        severity: { code: 'severe' },
        stage: { summary: 'Stage III', system: 'AJCC' },
        recordedDate: '2026-01-01',
        diagnosisEvidence: ['DiagnosticReport/dr-1'],
      });

      expect(doc.clinicalStatus).toBe('active');
      expect(doc.verificationStatus).toBe('confirmed');
      expect(doc.severity).toEqual({ code: 'severe' });
      expect(doc.stage).toEqual({ summary: 'Stage III', system: 'AJCC' });
      expect(doc.recordedDate).toBeInstanceOf(Date);
      expect(doc.diagnosisEvidence).toEqual(['DiagnosticReport/dr-1']);
    });
  });
});
