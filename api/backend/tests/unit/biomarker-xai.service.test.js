import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const biomarkerXai = require('../../src/services/biomarker-xai.service');

const { highMax, mediumMax } = biomarkerXai.governance.thresholds.alphaGal;
const { mediumMin, highMin } = biomarkerXai.governance.thresholds.lysoGb3;

describe('BiomarkerXaiService.verifyXaiThreshold', () => {
  it('returns null for unknown biomarker name', () => {
    expect(biomarkerXai.verifyXaiThreshold('unknownMarker', 5)).toBeNull();
  });

  it('returns null for empty/missing biomarker string', () => {
    expect(biomarkerXai.verifyXaiThreshold('', 5)).toBeNull();
    expect(biomarkerXai.verifyXaiThreshold(undefined, 5)).toBeNull();
  });

  it('returns null for non-finite/NaN value', () => {
    expect(biomarkerXai.verifyXaiThreshold('alphaGal', NaN)).toBeNull();
    expect(biomarkerXai.verifyXaiThreshold('alphaGal', Infinity)).toBeNull();
    expect(biomarkerXai.verifyXaiThreshold('alphaGal', 'not-a-number')).toBeNull();
  });

  it('alphaGal: value below highMax is severity high', () => {
    const result = biomarkerXai.verifyXaiThreshold('alphaGal', highMax - 0.1);
    expect(result).not.toBeNull();
    expect(result.severity).toBe('high');
  });

  it('alphaGal: value in [highMax, mediumMax) is severity medium', () => {
    const result = biomarkerXai.verifyXaiThreshold('alphaGal', highMax);
    expect(result).not.toBeNull();
    expect(result.severity).toBe('medium');

    const midResult = biomarkerXai.verifyXaiThreshold('alphaGal', (highMax + mediumMax) / 2);
    expect(midResult.severity).toBe('medium');
  });

  it('alphaGal: value >= mediumMax has no active rule and returns null', () => {
    expect(biomarkerXai.verifyXaiThreshold('alphaGal', mediumMax)).toBeNull();
    expect(biomarkerXai.verifyXaiThreshold('alphaGal', mediumMax + 10)).toBeNull();
  });

  it('lysoGb3: value above highMin is severity high', () => {
    const result = biomarkerXai.verifyXaiThreshold('lysoGb3', highMin + 0.1);
    expect(result).not.toBeNull();
    expect(result.severity).toBe('high');
  });

  it('lysoGb3: value in [mediumMin, highMin) is severity medium', () => {
    const result = biomarkerXai.verifyXaiThreshold('lysoGb3', mediumMin);
    expect(result).not.toBeNull();
    expect(result.severity).toBe('medium');

    const midResult = biomarkerXai.verifyXaiThreshold('lysoGb3', (mediumMin + highMin) / 2);
    expect(midResult.severity).toBe('medium');
  });

  it('lysoGb3: value below mediumMin has no active rule and returns null', () => {
    expect(biomarkerXai.verifyXaiThreshold('lysoGb3', mediumMin - 0.1)).toBeNull();
    expect(biomarkerXai.verifyXaiThreshold('lysoGb3', 0)).toBeNull();
  });
});

describe('BiomarkerXaiService.evaluateAlphaGal', () => {
  it('returns null when input is null', () => {
    expect(biomarkerXai.evaluateAlphaGal(null)).toBeNull();
  });

  it('returns below_reference evidence with xaiAlert when severity is high', () => {
    const evidence = biomarkerXai.evaluateAlphaGal(highMax - 0.1);
    expect(evidence.direction).toBe('below_reference');
    expect(evidence.severity).toBe('high');
    expect(evidence.xaiAlert).toBeTruthy();
    expect(evidence.xaiAlert.severity).toBe('high');
  });

  it('returns borderline_low evidence with xaiAlert when severity is medium', () => {
    const evidence = biomarkerXai.evaluateAlphaGal(highMax);
    expect(evidence.direction).toBe('borderline_low');
    expect(evidence.severity).toBe('medium');
    expect(evidence.xaiAlert).toBeTruthy();
  });

  it('returns within_reference/low shape when no rule matches', () => {
    const evidence = biomarkerXai.evaluateAlphaGal(mediumMax + 5);
    expect(evidence.direction).toBe('within_reference');
    expect(evidence.severity).toBe('low');
    expect(evidence.xaiAlert).toBeUndefined();
  });
});

describe('BiomarkerXaiService.evaluateLysoGb3', () => {
  it('returns null when input is null', () => {
    expect(biomarkerXai.evaluateLysoGb3(null)).toBeNull();
  });

  it('returns above_reference evidence with xaiAlert when severity is high', () => {
    const evidence = biomarkerXai.evaluateLysoGb3(highMin + 0.1);
    expect(evidence.direction).toBe('above_reference');
    expect(evidence.severity).toBe('high');
    expect(evidence.xaiAlert).toBeTruthy();
  });

  it('returns borderline_high evidence with xaiAlert when severity is medium', () => {
    const evidence = biomarkerXai.evaluateLysoGb3(mediumMin);
    expect(evidence.direction).toBe('borderline_high');
    expect(evidence.severity).toBe('medium');
    expect(evidence.xaiAlert).toBeTruthy();
  });

  it('returns within_reference/low shape when no rule matches', () => {
    const evidence = biomarkerXai.evaluateLysoGb3(mediumMin - 0.5 >= 0 ? mediumMin - 0.5 : 0);
    expect(evidence.direction).toBe('within_reference');
    expect(evidence.severity).toBe('low');
    expect(evidence.xaiAlert).toBeUndefined();
  });
});

describe('BiomarkerXaiService helper functions', () => {
  it('toNumberOrDefault: returns parsed finite number, else fallback', () => {
    expect(biomarkerXai.toNumberOrDefault('3.5', 1)).toBe(3.5);
    expect(biomarkerXai.toNumberOrDefault('not-a-number', 7)).toBe(7);
    expect(biomarkerXai.toNumberOrDefault(undefined, 9)).toBe(9);
  });

  it('toPositiveInteger: rejects <=0 and non-finite, rounds valid values', () => {
    expect(biomarkerXai.toPositiveInteger('4.6', 90)).toBe(5);
    expect(biomarkerXai.toPositiveInteger(0, 90)).toBe(90);
    expect(biomarkerXai.toPositiveInteger(-3, 90)).toBe(90);
    expect(biomarkerXai.toPositiveInteger(NaN, 90)).toBe(90);
    expect(biomarkerXai.toPositiveInteger('10', 90)).toBe(10);
  });

  it('toDateOrNull: invalid date string returns null, falsy input returns null', () => {
    expect(biomarkerXai.toDateOrNull('not-a-date')).toBeNull();
    expect(biomarkerXai.toDateOrNull(null)).toBeNull();
    expect(biomarkerXai.toDateOrNull('')).toBeNull();
  });

  it('toDateOrNull: valid date string returns a Date', () => {
    const result = biomarkerXai.toDateOrNull('2024-01-01T00:00:00.000Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCFullYear()).toBe(2024);
  });

  it('toNumeric: empty string/null/undefined return null', () => {
    expect(biomarkerXai.toNumeric('')).toBeNull();
    expect(biomarkerXai.toNumeric(null)).toBeNull();
    expect(biomarkerXai.toNumeric(undefined)).toBeNull();
  });

  it('toNumeric: coerces valid numeric-ish values, returns null for non-numeric strings', () => {
    expect(biomarkerXai.toNumeric('2.5')).toBe(2.5);
    expect(biomarkerXai.toNumeric(3)).toBe(3);
    expect(biomarkerXai.toNumeric('abc')).toBeNull();
  });
});

describe('BiomarkerXaiService.buildSummary', () => {
  it('returns default no-signal message for empty evidence list', () => {
    expect(biomarkerXai.buildSummary([])).toMatch(/Sem sinais laboratoriais críticos/);
  });

  it('returns medium-tier message when only medium severity present', () => {
    expect(biomarkerXai.buildSummary([{ severity: 'medium' }])).toMatch(/limítrofe/);
  });

  it('returns high-tier message when high severity present', () => {
    expect(biomarkerXai.buildSummary([{ severity: 'high' }])).toMatch(/maior criticidade/);
  });

  it('prefers high-tier message when both medium and high severities are present', () => {
    const summary = biomarkerXai.buildSummary([{ severity: 'medium' }, { severity: 'high' }]);
    expect(summary).toMatch(/maior criticidade/);
  });
});

describe('BiomarkerXaiService.buildRecommendation', () => {
  it('returns default recommendation for empty evidence list', () => {
    expect(biomarkerXai.buildRecommendation([])).toMatch(/rotina de monitoramento/);
  });

  it('returns medium-tier recommendation when only medium severity present', () => {
    expect(biomarkerXai.buildRecommendation([{ severity: 'medium' }])).toMatch(/acompanhamento seriado/);
  });

  it('returns high-tier recommendation when high severity present', () => {
    expect(biomarkerXai.buildRecommendation([{ severity: 'high' }])).toMatch(/Priorizar reavaliação/);
  });

  it('prefers high-tier recommendation when both medium and high severities are present', () => {
    const rec = biomarkerXai.buildRecommendation([{ severity: 'medium' }, { severity: 'high' }]);
    expect(rec).toMatch(/Priorizar reavaliação/);
  });
});

describe('BiomarkerXaiService.evaluate', () => {
  it('returns null when both alphaGal and lysoGb3 are non-numeric/absent', () => {
    expect(biomarkerXai.evaluate({})).toBeNull();
    expect(biomarkerXai.evaluate({ alphaGal: 'n/a', lysoGb3: null })).toBeNull();
    expect(biomarkerXai.evaluate()).toBeNull();
  });

  it('returns confidence 0.75 and single-entry evidence when only one biomarker is provided', () => {
    const result = biomarkerXai.evaluate({ alphaGal: highMax - 0.1 });
    expect(result).not.toBeNull();
    expect(result.confidence).toBe(0.75);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].feature).toBe('alphaGal');
  });

  it('returns confidence 0.9 and two-entry evidence when both biomarkers are provided', () => {
    const result = biomarkerXai.evaluate({ alphaGal: highMax - 0.1, lysoGb3: highMin + 0.1 });
    expect(result.confidence).toBe(0.9);
    expect(result.evidence).toHaveLength(2);
  });

  it('isClinicalDiagnosis is always false', () => {
    const result = biomarkerXai.evaluate({ alphaGal: 5 });
    expect(result.isClinicalDiagnosis).toBe(false);
  });

  it('evidence array only contains non-null entries (within_reference values still produce evidence)', () => {
    const result = biomarkerXai.evaluate({ alphaGal: mediumMax + 5, lysoGb3: mediumMin - 0.1 >= 0 ? mediumMin - 0.1 : 0 });
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.every((item) => item !== null)).toBe(true);
  });

  it('nextReviewDueAt is reviewCadenceDays days after lastApprovedAt or generatedAt when lastApprovedAt is null', () => {
    const result = biomarkerXai.evaluate({ alphaGal: 5 });
    const baseDate = biomarkerXai.governance.lastApprovedAt || result.generatedAt;
    const expectedDeltaMs = biomarkerXai.governance.reviewCadenceDays * 24 * 60 * 60 * 1000;
    const actualDeltaMs = result.governance.nextReviewDueAt.getTime() - new Date(baseDate).getTime();
    expect(actualDeltaMs).toBe(expectedDeltaMs);
  });
});
