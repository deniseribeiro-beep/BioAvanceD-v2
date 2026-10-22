/**
 * RF028 AC6/AC7, RNF032 C7 (#1319): the ReferenceCoverageManifest and the
 * DataQualityAssessment of one reference release, kept pure and DB-free.
 * `pipeline.js` validates and inserts what these return.
 *
 * INFERENCE, not a citation: the counts, the exclusions, the three
 * dimensions and their minimums are this slice's, versioned by
 * ASSESSMENT_VERSION
 * (docs/decisions/2026-10-23-reference-release-coverage-manifest.md).
 */
const ReferenceCoverageManifestModel = require('../../models/ReferenceCoverageManifest');
const DataQualityAssessmentModel = require('../../models/DataQualityAssessment');

const ASSESSMENT_VERSION = '1.0.0';

const DIMENSIONS = ['completeness', 'validity', 'provenance'];

// The release fields that name where its content came from and how it was read.
const PROVENANCE_FIELDS = ['sourceId', 'datasetVersion', 'retrievalUri', 'license', 'sourceChecksum', 'parserVersion', 'mappingVersion'];

const METRICS = Object.freeze([
  { metric: 'completeness', definition: 'registros obtidos mais exclusões justificadas sobre registros lidos do asset; 0 sem registro lido', denominator: 'records read' },
  { metric: 'validity', definition: '0 com issue fatal; senão 1 menos a taxa de rejeição', denominator: null },
  { metric: 'provenance', definition: 'campos de origem da release presentes', denominator: 'release provenance fields' },
]);

/**
 * expectedCount is the rows read from the preserved asset, obtainedCount the
 * concepts staged. Each row-level issue consumed a row and staged nothing,
 * so it is an exclusion; a rejected relation consumed no row.
 */
function buildCoverageManifest({ releaseId, runId, datasetCode, assetUri, recordsRead, obtainedCount, issues = [], generatedAt = new Date() }) {
  const exclusions = issues
    .filter((issue) => issue.entityType === 'TerminologyConcept')
    .map((issue) => ({
      rowNumber: issue.rowNumber ?? null,
      sourceRecordId: issue.sourceRecordId ?? null,
      reason: issue.errorCode,
      justification: issue.errorMessage,
    }));
  return ReferenceCoverageManifestModel.create({
    referenceDatasetReleaseId: releaseId,
    assets: [assetUri],
    expectedCount: recordsRead,
    obtainedCount,
    exclusions,
    generatedAt,
    datasetCode,
    referenceImportRunId: runId,
  });
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

/** Pure: the create()d assessment of a release, scored on its manifest and its run's issues. */
function assessRelease({ release, manifest, fatalCount, rejectionRate, maxRejectionRate, actorId, assessedAt = new Date() }) {
  const covered = manifest.obtainedCount + manifest.exclusions.length;
  const present = PROVENANCE_FIELDS.filter((field) => isPresent(release[field])).length;

  const byMetric = {
    // An empty source fails closed: nothing read is never complete.
    completeness: {
      metric: 'completeness',
      value: manifest.expectedCount > 0 ? covered / manifest.expectedCount : 0,
      numerator: covered,
      denominator: manifest.expectedCount,
    },
    validity: {
      metric: 'validity',
      value: fatalCount > 0 ? 0 : 1 - rejectionRate,
      numerator: null,
      denominator: null,
      fatalCount,
      rejectionRate,
    },
    provenance: { metric: 'provenance', value: present / PROVENANCE_FIELDS.length, numerator: present, denominator: PROVENANCE_FIELDS.length },
  };
  const minimums = { completeness: 1, validity: 1 - maxRejectionRate, provenance: 1 };
  const thresholds = DIMENSIONS.map((metric) => ({ metric, minimum: minimums[metric] }));
  const results = DIMENSIONS.map((metric) => byMetric[metric]);
  const passed = results.every((result, index) => typeof result.value === 'number'
    && !Number.isNaN(result.value)
    && result.value >= thresholds[index].minimum);

  return DataQualityAssessmentModel.create({
    scopeType: 'dataset_release',
    scopeId: release.referenceDatasetReleaseId,
    dimensions: [...DIMENSIONS],
    metrics: METRICS.map((metric) => ({ ...metric })),
    thresholds,
    results,
    assessmentVersion: ASSESSMENT_VERSION,
    status: passed ? 'passed' : 'failed',
    assessedAt,
    entityType: 'ReferenceDatasetRelease',
    createdBy: actorId ?? null,
  });
}

module.exports = {
  ASSESSMENT_VERSION,
  buildCoverageManifest,
  assessRelease,
};
