import { describe, expect, it } from 'vitest';

const importLgpdService = require('../../src/services/import-lgpd.service');

describe('ImportLGPDService quality import hardening', () => {
  it('preserva quality_score/category externos como sugestão não canônica', () => {
    const parsed = importLgpdService.parseSampleRow({
      patientID: '12345678',
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'TUBE_EDTA',
      quality: 'GOOD',
      quality_score: '100',
      quality_category: 'A',
      sprec_matrix_type: 'fluid',
      sprec_sample_type: 'BLD',
      sprec_primary_container: 'A',
      sprec_pre_centrifugation: 'X',
      sprec_centrifugation: 'A',
      sprec_second_centrifugation: 'A',
      sprec_post_centrifugation_delay: 'A',
      sprec_long_term_storage: 'cryogenic_or_ultralow_workflow_appropriate',
    });

    expect(parsed.quality_score).toBeNull();
    expect(parsed.quality_category).toBe('C');
    expect(parsed.release_status).toBe('QUARANTINE');
    expect(parsed.external_quality_assessment).toMatchObject({
      score: 100,
      category: 'A',
      source: 'external-lgpd-import',
      canonical: false,
    });
  });
});
