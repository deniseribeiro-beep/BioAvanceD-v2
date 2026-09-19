import { describe, expect, it } from 'vitest';

const rcs = require('../../src/services/rcs-certification.service');
const referenceData = require('../../src/services/rcs-reference-data');

function governanceEvidence(overrides = {}) {
  return Object.fromEntries(
    referenceData.governanceEvidenceCategories.map(({ key }) => [
      key,
      Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : 'satisfied',
    ])
  );
}

function fluidSprec(overrides = {}) {
  return {
    matrixType: 'fluid',
    sampleType: 'BLD',
    primaryContainer: 'SST',
    preCentrifugation: 'A',
    centrifugation: 'A',
    secondCentrifugation: 'A',
    postCentrifugationDelay: 'A',
    longTermStorage: 'C',
    ...overrides,
  };
}

function solidSprec(overrides = {}) {
  return {
    matrixType: 'solid',
    sampleType: 'TIS',
    collectionType: 'SRG',
    warmIschemia: 'A',
    coldIschemia: 'A',
    fixationType: 'SNP',
    fixationTime: 'B',
    longTermStorage: 'C',
    ...overrides,
  };
}

function certify(sprec, extra = {}) {
  return rcs.certify({
    matrixType: sprec.matrixType,
    sprec,
    governanceEvidence: governanceEvidence(),
    ...extra,
  });
}

describe('RCS-GOV 1.0 scientific-contract invariants', () => {
  it('1/8 governance override is non-compensable', () => {
    const result = certify(fluidSprec(), {
      governanceEvidence: governanceEvidence({ traceability: 'failed' }),
      governanceOutcome: 'failed',
    });

    expect(result).toMatchObject({
      input_status: 'valid',
      governance_status: 0,
      governance_outcome: 'failed',
      p_bio: null,
      rcs_score: null,
      final_grade: 'E',
      grade_route: 'Governance failure',
    });
  });

  it('2/8 preserves the identity RCS = 100 - Pbio', () => {
    const result = certify(fluidSprec({ preCentrifugation: 'C', longTermStorage: 'A' }));

    expect(result.governance_status).toBe(1);
    expect(result.rcs_score).toBe(100 - result.p_bio);
  });

  it('3/8 keeps the accumulated penalty bounded by the 0-100 matrix weight sum', () => {
    const profiles = [
      certify(fluidSprec()),
      certify(fluidSprec({
        preCentrifugation: 'M',
        centrifugation: 'I',
        secondCentrifugation: 'I',
        postCentrifugationDelay: 'I',
        longTermStorage: 'B',
      })),
      certify(solidSprec()),
      certify(solidSprec({
        warmIschemia: 'F',
        coldIschemia: 'F',
        fixationType: 'FOR',
        fixationTime: 'G',
        longTermStorage: 'B',
      })),
    ];

    for (const result of profiles) {
      expect(result.governance_status).toBe(1);
      expect(result.p_bio).toBeGreaterThanOrEqual(0);
      expect(result.p_bio).toBeLessThanOrEqual(100);
    }
  });

  it('4/8 preserves monotonic penalty behavior when an axis severity increases', () => {
    const low = certify(fluidSprec({ preCentrifugation: 'A' }));
    const mid = certify(fluidSprec({ preCentrifugation: 'G' }));
    const high = certify(fluidSprec({ preCentrifugation: 'M' }));

    expect(low.p_bio).toBeLessThanOrEqual(mid.p_bio);
    expect(mid.p_bio).toBeLessThanOrEqual(high.p_bio);
    expect(low.rcs_score).toBeGreaterThanOrEqual(mid.rcs_score);
    expect(mid.rcs_score).toBeGreaterThanOrEqual(high.rcs_score);
  });

  it('5/8 is deterministically reproducible for identical explicit inputs', () => {
    const payload = {
      matrixType: 'solid',
      sprec: solidSprec({ warmIschemia: 'C', coldIschemia: 'D', fixationTime: 'E' }),
      governanceEvidence: governanceEvidence(),
    };

    expect(rcs.certify(payload)).toEqual(rcs.certify(payload));
  });

  it('6/8 keeps matrix-specific axis definitions separated', () => {
    const fluid = certify(fluidSprec());
    const solid = certify(solidSprec());

    expect(fluid.axis_penalties.map((item) => item.axis_code)).toEqual([
      'Ppre', 'Pcent1', 'Pcent2', 'Ppost', 'Pstore',
    ]);
    expect(solid.axis_penalties.map((item) => item.axis_code)).toEqual([
      'Pwarm', 'Pcold', 'Pfix', 'PfixTime', 'Pstore',
    ]);
  });

  it('7/8 rejects missing governance evidence instead of promoting it to admissible', () => {
    const result = rcs.certify({
      matrixType: 'fluid',
      sprec: fluidSprec(),
    });

    expect(result).toMatchObject({
      input_status: 'invalid',
      governance_status: null,
      final_grade: null,
      grade_route: 'Invalid input',
    });
    expect(result.input_errors).toContain('Explicit governance evidence is required');
  });

  it('8/8 treats non-scoreable SPREC/context conditions as governance failure, never zero severity', () => {
    const result = certify(fluidSprec({ secondCentrifugation: 'N' }));

    expect(result).toMatchObject({
      input_status: 'valid',
      governance_status: 0,
      p_bio: null,
      rcs_score: null,
      final_grade: 'E',
      grade_route: 'Governance failure',
    });
    expect(result.governance_failure_reasons).toContain('Missing analytical workflow context');
    expect(result.axis_penalties).toEqual([]);
  });
});
