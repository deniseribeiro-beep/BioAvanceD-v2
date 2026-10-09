import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { computeCharlsonScore, ALGORITHM_VERSION, SCORE_TYPE } = require('../../../src/services/charlsonComorbidityIndex');

// #713 (RF005 clinical-UI slice 6/6): the original-1987 Charlson Comorbidity
// Index, scored only from the wizard checklist slugs that genuinely map to a
// real Charlson category -- see the module's own file-level comment for why
// the wizard's other checklist items (hypertension, smoking, etc.) never
// contribute.
describe('charlsonComorbidityIndex', () => {
  it('exposes CCI-original as the algorithm version, matching dict-02 ELM-0257\'s own example value', () => {
    expect(ALGORITHM_VERSION).toBe('CCI-original');
  });

  it('exposes a scoreType CodeableConcept for Charlson Comorbidity Index', () => {
    expect(SCORE_TYPE).toEqual({ code: 'cci', display: 'Charlson Comorbidity Index' });
  });

  it('scores a single real Charlson category (copd) as weight 1', () => {
    const result = computeCharlsonScore(['copd']);
    expect(result.scoreValue).toBe(1);
    expect(result.scoreComponents).toEqual([
      { condition: { code: 'chronicPulmonaryDisease', display: 'Doença pulmonar crônica' }, weight: 1, sourceSlugs: ['copd'] },
    ]);
  });

  it('scores ckd (moderate/severe renal disease) as weight 2', () => {
    const result = computeCharlsonScore(['ckd']);
    expect(result.scoreValue).toBe(2);
    expect(result.scoreComponents).toEqual([
      { condition: { code: 'renalDisease', display: 'Doença renal moderada/grave' }, weight: 2, sourceSlugs: ['ckd'] },
    ]);
  });

  it('sums distinct categories: copd + ckd = 3', () => {
    const result = computeCharlsonScore(['copd', 'ckd']);
    expect(result.scoreValue).toBe(3);
    expect(result.scoreComponents).toHaveLength(2);
  });

  it('collapses diabetesType1 and diabetesType2 into a single "diabetes" component (weight 1, not 2)', () => {
    const result = computeCharlsonScore(['diabetesType1', 'diabetesType2']);
    expect(result.scoreValue).toBe(1);
    expect(result.scoreComponents).toEqual([
      { condition: { code: 'diabetes', display: 'Diabetes (sem lesão de órgão-alvo)' }, weight: 1, sourceSlugs: ['diabetesType1', 'diabetesType2'] },
    ]);
  });

  it('scores diabetesType1 alone the same as both types checked (weight 1)', () => {
    const result = computeCharlsonScore(['diabetesType1']);
    expect(result.scoreValue).toBe(1);
    expect(result.scoreComponents[0].sourceSlugs).toEqual(['diabetesType1']);
  });

  it('ignores checklist items outside the original Charlson category set (hypertension, obesity, smoking, alcohol/antibiotic/insulin/antiviral use, asthma)', () => {
    const result = computeCharlsonScore([
      'hypertension', 'obesity', 'asthma', 'smoking', 'alcoholUse', 'antibioticUse', 'insulinUse', 'antiviralUse',
    ]);
    expect(result.scoreValue).toBeNull();
    expect(result.scoreComponents).toEqual([]);
  });

  it('mixes real and non-Charlson items -- only the real ones score', () => {
    const result = computeCharlsonScore(['hypertension', 'copd', 'smoking']);
    expect(result.scoreValue).toBe(1);
    expect(result.scoreComponents).toEqual([
      { condition: { code: 'chronicPulmonaryDisease', display: 'Doença pulmonar crônica' }, weight: 1, sourceSlugs: ['copd'] },
    ]);
  });

  it('returns null scoreValue and empty scoreComponents for an empty or missing input', () => {
    expect(computeCharlsonScore([])).toEqual({ scoreValue: null, scoreComponents: [] });
    expect(computeCharlsonScore(undefined)).toEqual({ scoreValue: null, scoreComponents: [] });
    expect(computeCharlsonScore(null)).toEqual({ scoreValue: null, scoreComponents: [] });
  });

  it('all three scored categories together produce the full 4-point total', () => {
    const result = computeCharlsonScore(['diabetesType1', 'copd', 'ckd']);
    expect(result.scoreValue).toBe(4);
    expect(result.scoreComponents).toHaveLength(3);
  });

  // #715: every one of the original index's 19 categories is now reachable.
  it('scores each of the 19 categories at its 1987 weight', () => {
    const expected = {
      myocardialInfarction: 1, congestiveHeartFailure: 1, peripheralVascularDisease: 1, cerebrovascularDisease: 1,
      dementia: 1, copd: 1, connectiveTissueDisease: 1, pepticUlcerDisease: 1, mildLiverDisease: 1, diabetesType1: 1,
      hemiplegia: 2, ckd: 2, diabetesWithEndOrganDamage: 2, solidTumor: 2, leukemia: 2, lymphoma: 2,
      moderateSevereLiverDisease: 3, metastaticSolidTumor: 6, aids: 6,
    };
    for (const [slug, weight] of Object.entries(expected)) {
      expect(computeCharlsonScore([slug]).scoreValue, slug).toBe(weight);
    }
    expect(Object.keys(expected)).toHaveLength(19);
  });

  it('scores a severity pair once, at the severer weight, keeping both slugs on that component', () => {
    expect(computeCharlsonScore(['diabetesType2', 'diabetesWithEndOrganDamage'])).toEqual({
      scoreValue: 2,
      scoreComponents: [
        {
          condition: { code: 'diabetesWithEndOrganDamage', display: 'Diabetes com lesão de órgão-alvo' },
          weight: 2,
          sourceSlugs: ['diabetesWithEndOrganDamage', 'diabetesType2'],
        },
      ],
    });
    expect(computeCharlsonScore(['mildLiverDisease', 'moderateSevereLiverDisease']).scoreValue).toBe(3);
    expect(computeCharlsonScore(['solidTumor', 'metastaticSolidTumor']).scoreValue).toBe(6);
  });

  it('leukemia and lymphoma are their own categories, not superseded by a metastatic tumor', () => {
    expect(computeCharlsonScore(['metastaticSolidTumor', 'leukemia', 'lymphoma']).scoreValue).toBe(10);
  });

  it("the index's maximum, every category with each pair at its severer grade, is 33", () => {
    const all = [
      'myocardialInfarction', 'congestiveHeartFailure', 'peripheralVascularDisease', 'cerebrovascularDisease', 'dementia',
      'copd', 'connectiveTissueDisease', 'pepticUlcerDisease', 'mildLiverDisease', 'diabetesType1', 'hemiplegia', 'ckd',
      'diabetesWithEndOrganDamage', 'solidTumor', 'leukemia', 'lymphoma', 'moderateSevereLiverDisease',
      'metastaticSolidTumor', 'aids',
    ];
    expect(computeCharlsonScore(all).scoreValue).toBe(33);
  });
});
