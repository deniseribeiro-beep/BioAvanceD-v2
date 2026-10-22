const crypto = require('crypto');

// Canonical Data Model v2.0.0 DatasetPartition (V2E-0322..0329), RF029 AC8
// and RNF030 C4 (#1318): one train, validation or test partition of a
// DatasetSnapshot, with its strategy, seed, groupingUnit and leakage check.
//
// Inactive structure: modelled and catalog-conformant, written by no flow.
// RF029 AC8 permits it only in authorized and versioned scientific use, and
// no such flow exists yet. inactive-analytical-structures.arch.test.js pins
// that; the flow that activates it brings the gate and removes it there (see
// docs/decisions/2026-10-22-inactive-analytical-preparation-structures.md).

// INFERENCE, not a citation: V2E-0324's vocabulary cell reads `train` and its
// example `test`; V2E-0329's reads `pass`. The sets extend each one-value
// cell to the closed set it names. strategy and groupingUnit stay open codes.
const PARTITION_TYPES = ['train', 'validation', 'test'];
const LEAKAGE_CHECK_RESULTS = ['pass', 'fail'];

const REQUIRED_STRINGS = [
  'datasetPartitionId', 'snapshotId', 'partitionType', 'strategy',
  'groupingUnit', 'memberManifestUri', 'leakageCheckResult',
];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

class DatasetPartitionModel {
  static fieldsOf(data = {}) {
    return {
      datasetPartitionId: data.datasetPartitionId || crypto.randomUUID(),
      snapshotId: data.snapshotId ?? null,
      partitionType: data.partitionType ?? null,
      strategy: data.strategy ?? null,
      seed: data.seed ?? null,
      groupingUnit: data.groupingUnit ?? null,
      memberManifestUri: data.memberManifestUri ?? null,
      leakageCheckResult: data.leakageCheckResult ?? null,
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para DatasetPartition (1..1)`);
    }
    if (!Number.isInteger(fields.seed)) errors.push('seed é obrigatório para DatasetPartition (1..1, integer)');
    if (isNonEmptyString(fields.partitionType) && !PARTITION_TYPES.includes(fields.partitionType)) {
      errors.push(`partitionType inválido: ${fields.partitionType}`);
    }
    if (isNonEmptyString(fields.leakageCheckResult) && !LEAKAGE_CHECK_RESULTS.includes(fields.leakageCheckResult)) {
      errors.push(`leakageCheckResult inválido: ${fields.leakageCheckResult}`);
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const { isValid, errors } = this.validate(fields);
    if (!isValid) throw new Error(errors.join('; '));
    return fields;
  }
}

module.exports = DatasetPartitionModel;
module.exports.PARTITION_TYPES = PARTITION_TYPES;
module.exports.LEAKAGE_CHECK_RESULTS = LEAKAGE_CHECK_RESULTS;
