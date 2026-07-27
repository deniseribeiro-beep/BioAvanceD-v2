import { afterEach, describe, expect, it, vi } from 'vitest';

const { migrateRcsGovernanceIndexes } = await import(
  '../../src/scripts/migrate-rcs-governance-indexes.js'
);

function fakeDb() {
  const createIndex = vi.fn().mockResolvedValue(undefined);
  const collections = {};
  const collection = vi.fn((name) => {
    if (!collections[name]) {
      collections[name] = { collectionName: name, createIndex };
    }
    return collections[name];
  });
  return { collection, createIndex };
}

describe('scripts/migrate-rcs-governance-indexes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ensures every RCS governance index with the expected keys and options', async () => {
    const { collection, createIndex } = fakeDb();

    await migrateRcsGovernanceIndexes({ collection });

    expect(collection).toHaveBeenCalledWith('rcs_model_versions');
    expect(collection).toHaveBeenCalledWith('rcs_sprec_catalog');
    expect(collection).toHaveBeenCalledWith('rcs_severity_mappings');
    expect(collection).toHaveBeenCalledWith('rcs_axis_weights');
    expect(collection).toHaveBeenCalledWith('rcs_grade_thresholds');
    expect(collection).toHaveBeenCalledWith('rcs_governance_rules');
    expect(collection).toHaveBeenCalledWith('rcs_evaluations');
    expect(createIndex).toHaveBeenCalledTimes(7);

    expect(createIndex).toHaveBeenNthCalledWith(
      1,
      { model_code: 1 },
      { unique: true, name: 'uq_rcs_model_versions_model_code' },
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      2,
      { model_code: 1, sprec_version: 1, matrix_type: 1, axis_code: 1, sprec_code: 1 },
      { unique: true, name: 'uq_rcs_sprec_catalog_axis_code' },
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      3,
      {
        model_code: 1,
        sprec_version: 1,
        matrix_type: 1,
        axis_code: 1,
        sprec_codes: 1,
        condition_description: 1,
      },
      { unique: true, name: 'uq_rcs_severity_mapping_condition' },
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      4,
      { model_code: 1, sprec_version: 1, matrix_type: 1, axis_code: 1 },
      { unique: true, name: 'uq_rcs_axis_weights_axis' },
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      5,
      { model_code: 1, sprec_version: 1, grade: 1 },
      { unique: true, name: 'uq_rcs_grade_thresholds_grade' },
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      6,
      { model_code: 1, sprec_version: 1, rule_code: 1 },
      { unique: true, name: 'uq_rcs_governance_rules_rule' },
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      7,
      { sample_id: 1, model_version: 1, evaluated_at: -1 },
      { name: 'idx_rcs_evaluations_sample_model_time' },
    );
  });

  it('propagates a createIndex failure without swallowing it', async () => {
    const failure = new Error('index build failed');
    const collection = vi.fn(() => ({
      collectionName: 'rcs_model_versions',
      createIndex: vi.fn().mockRejectedValue(failure),
    }));

    await expect(migrateRcsGovernanceIndexes({ collection })).rejects.toThrow(
      'index build failed',
    );
  });
});
