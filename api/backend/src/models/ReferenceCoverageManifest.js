/**
 * RF028 AC6, RNF032 C7 (#1319): ReferenceCoverageManifest, V2E-0261..0269.
 * One manifest records, for one ReferenceDatasetRelease, the assets read,
 * the count expected and obtained, the justified exclusions and the gate's
 * result, sealed by a checksum. Shape of DataQualityAssessment.js.
 *
 * INFERENCE, not a citation: the coverageResult vocabulary extends the
 * dictionary's one example, `complete`, as
 * docs/decisions/2026-10-23-reference-release-coverage-manifest.md records.
 */
const crypto = require('crypto');

const COVERAGE_RESULTS = ['complete', 'justified', 'incomplete'];
const CHECKSUM_PATTERN = /^sha256:[0-9a-f]{64}$/;

const REQUIRED_FIELDS = [
  'referenceCoverageManifestId',
  'referenceDatasetReleaseId',
  'assets',
  'expectedCount',
  'obtainedCount',
  'coverageResult',
  'generatedAt',
  'checksum',
];

const isMissing = (value) => value === undefined || value === null || value === '';
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isCount = (value) => Number.isInteger(value) && value >= 0;

class ReferenceCoverageManifestModel {
  /** The nine canonical fields (V2E-0261..0269), and nothing else. */
  static fieldsOf(data = {}) {
    return {
      referenceCoverageManifestId: data.referenceCoverageManifestId || crypto.randomUUID(),
      referenceDatasetReleaseId: data.referenceDatasetReleaseId ?? null,
      assets: Array.isArray(data.assets) ? [...data.assets] : [],
      expectedCount: data.expectedCount ?? null,
      obtainedCount: data.obtainedCount ?? null,
      exclusions: Array.isArray(data.exclusions) ? [...data.exclusions] : [],
      coverageResult: data.coverageResult ?? null,
      generatedAt: data.generatedAt ? new Date(data.generatedAt) : new Date(),
      checksum: data.checksum ?? null,
    };
  }

  /**
   * `complete` when every expected record was obtained; `justified` when the
   * gap is exactly the exclusions; anything else, an empty source included,
   * is `incomplete`.
   */
  static coverageResultOf({ expectedCount, obtainedCount, exclusions } = {}) {
    if (!isCount(expectedCount) || !isCount(obtainedCount) || !Array.isArray(exclusions)) return 'incomplete';
    if (expectedCount === 0) return 'incomplete';
    if (obtainedCount === expectedCount) return 'complete';
    if (obtainedCount < expectedCount && obtainedCount + exclusions.length === expectedCount) return 'justified';
    return 'incomplete';
  }

  /** V2E-0269: the SHA-256 of the manifest's content, never of its id, time or checksum. */
  static checksumOf(fields = {}) {
    const content = JSON.stringify({
      referenceDatasetReleaseId: fields.referenceDatasetReleaseId,
      assets: fields.assets,
      expectedCount: fields.expectedCount,
      obtainedCount: fields.obtainedCount,
      exclusions: fields.exclusions,
      coverageResult: fields.coverageResult,
    });
    return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
  }

  static validate(data = {}) {
    const errors = [];

    for (const field of REQUIRED_FIELDS) {
      if (isMissing(data[field])) errors.push(`${field} é obrigatório (1..1)`);
    }
    if (!Array.isArray(data.assets) || data.assets.length === 0 || !data.assets.every(isNonEmptyString)) {
      errors.push('assets deve ser um array não vazio de URIs (1..*)');
    }
    for (const field of ['expectedCount', 'obtainedCount']) {
      if (!isMissing(data[field]) && !isCount(data[field])) errors.push(`${field} deve ser um inteiro não negativo`);
    }
    if (!Array.isArray(data.exclusions)) {
      errors.push('exclusions deve ser um array');
    } else if (!data.exclusions.every((e) => e && isNonEmptyString(e.reason) && isNonEmptyString(e.justification))) {
      errors.push('cada exclusão deve ter reason e justification');
    }
    if (!isMissing(data.coverageResult)) {
      if (!COVERAGE_RESULTS.includes(data.coverageResult)) {
        errors.push(`coverageResult deve ser um de: ${COVERAGE_RESULTS.join('|')}`);
      } else if (data.coverageResult !== this.coverageResultOf(data)) {
        errors.push('coverageResult não corresponde às contagens e exclusões');
      }
    }
    if (!isMissing(data.generatedAt) && !(data.generatedAt instanceof Date && !Number.isNaN(data.generatedAt.getTime()))) {
      errors.push('generatedAt deve ser uma data válida');
    }
    if (!isMissing(data.checksum) && !(typeof data.checksum === 'string' && CHECKSUM_PATTERN.test(data.checksum))) {
      errors.push('checksum deve ter a forma sha256:<64 hex>');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (isMissing(fields.coverageResult)) fields.coverageResult = this.coverageResultOf(fields);
    if (isMissing(fields.checksum)) fields.checksum = this.checksumOf(fields);
    return {
      ...fields,
      datasetCode: data.datasetCode ?? null,
      referenceImportRunId: data.referenceImportRunId ?? null,
    };
  }
}

module.exports = ReferenceCoverageManifestModel;
module.exports.COVERAGE_RESULTS = COVERAGE_RESULTS;
