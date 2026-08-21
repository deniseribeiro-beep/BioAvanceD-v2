import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const DerivedScoreModel = require('../../../src/models/DerivedScore');

const CHARLSON_COMPONENTS = [{ condition: 'diabetes', weight: 1 }, { condition: 'renal_disease', weight: 2 }];

describe('DerivedScoreModel', () => {
  describe('create', () => {
    it('requires scoreType, scoreValue, algorithmVersion, and a non-empty scoreComponents', () => {
      expect(() => DerivedScoreModel.create({})).toThrow(
        'scoreType é obrigatório para DerivedScore, scoreValue é obrigatório para DerivedScore e deve ser numérico, algorithmVersion é obrigatório para DerivedScore, scoreComponents é obrigatório para DerivedScore (1..*, nunca armazenar somente o escore final)'
      );
    });

    it('rejects an empty scoreComponents array even when every other field is present (dict-02: nunca armazenar somente o escore final)', () => {
      expect(() =>
        DerivedScoreModel.create({
          scoreType: { code: 'CCI' },
          scoreValue: 4,
          algorithmVersion: 'CCI-original',
          scoreComponents: [],
        })
      ).toThrow('scoreComponents é obrigatório');
    });

    it('rejects a non-numeric scoreValue', () => {
      expect(() =>
        DerivedScoreModel.create({
          scoreType: { code: 'CCI' },
          scoreValue: 'four',
          algorithmVersion: 'CCI-original',
          scoreComponents: CHARLSON_COMPONENTS,
        })
      ).toThrow('scoreValue é obrigatório para DerivedScore e deve ser numérico');
    });

    it('builds a full score document with a generated derivedScoreId', () => {
      const doc = DerivedScoreModel.create({
        scoreType: { code: 'CCI', display: 'Charlson Comorbidity Index' },
        scoreValue: 4,
        algorithmVersion: 'CCI-original',
        scoreComponents: CHARLSON_COMPONENTS,
      });

      expect(doc.derivedScoreId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.scoreValue).toBe(4);
      expect(doc.algorithmVersion).toBe('CCI-original');
      expect(doc.scoreComponents).toEqual(CHARLSON_COMPONENTS);
      expect(doc.lookbackPeriod).toBeNull();
    });
  });
});
