import { describe, expect, it } from 'vitest';

const importLgpdService = require('../../src/services/import-lgpd.service');

describe('ImportLGPDService quality import hardening', () => {
  it('preserva rcsScore/scoreBasedGrade externos como sugestão não canônica', () => {
    const parsed = importLgpdService.parseSampleRow({
      participantId: '12345678',
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'TUBE_EDTA',
      quality: 'GOOD',
      rcsScore: '100',
      scoreBasedGrade: 'A',
      sprec_matrix_type: 'fluid',
      sprec_sample_type: 'BLD',
      sprec_primary_container: 'PED',
      sprec_pre_centrifugation: 'X',
      sprec_centrifugation: 'A',
      sprec_second_centrifugation: 'A',
      sprec_post_centrifugation_delay: 'A',
      sprec_long_term_storage: 'C',
    });

    // rcsScore/scoreBasedGrade are folded into externalQualityAssessment as a
    // non-canonical suggestion, not written back as top-level fields.
    expect(parsed.rcsScore).toBeUndefined();
    expect(parsed.scoreBasedGrade).toBeUndefined();
    expect(parsed.releaseStatus).toBe('QUARANTINE');
    expect(parsed.external_quality_assessment).toBeUndefined();
    expect(parsed.externalQualityAssessment).toMatchObject({
      score: 100,
      category: 'A',
      source: 'external-lgpd-import',
      canonical: false,
    });
  });
});
