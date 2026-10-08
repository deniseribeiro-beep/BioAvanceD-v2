/**
 * RF022 AC4/AC9, RNF014 C7, RNF031 C5/C6: what the Foundation job promises
 * and what the API and workers check before they start.
 *
 * The job writes a ReadinessReport per apply or verify run; `assertReadiness`
 * reads the newest one for the environment and refuses anything but a
 * `ready` report on the release this build expects.
 */
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { DICTIONARY_VERSION } = require('../reference-data/canonical-dictionary/v2');

// V2E-0459/V2E-0461 carry the dictionary's example forms. The id is derived
// from the dictionary version this build validates against, and the
// Foundation job registers the CanonicalModelRelease under it
// (src/governance/registry.js).
const CANONICAL_MODEL_RELEASE_ID = `release-${DICTIONARY_VERSION}`;
const MIGRATION_PLAN_ID = `migration-1.3.0-to-${DICTIONARY_VERSION}`;

// The Foundation plan's readiness gates (plano §9) that later phases build.
// Each is reported as `not_evaluated` with the phase that brings it, so
// p0Coverage stays honest about what this Foundation checks.
const DEFERRED_P0_GATES = [
  { gate: 'biobank-biorepository', phase: 'W6 · governance regime' },
  { gate: 'consent', phase: 'W6 · consent v4' },
  { gate: 'specimen', phase: 'W8 · specimen state model' },
  { gate: 'rcs', phase: 'W10 · RCS v4' },
  { gate: 'identification', phase: 'W5 · PII hygiene' },
  { gate: 'persistence', phase: 'W7 · outbox v2' },
  { gate: 'fhir', phase: 'W10 · interoperability' },
  { gate: 'ai-ready', phase: 'later phase' },
];

class FoundationNotReadyError extends Error {
  constructor(message, report = null) {
    super(message);
    this.name = 'FoundationNotReadyError';
    this.report = report;
  }
}

async function latestReadinessReport(db, environment) {
  return db.collection(CANONICAL_COLLECTIONS.readinessReports)
    .find({ environment })
    .sort({ generatedAt: -1 })
    .limit(1)
    .next();
}

/**
 * Throws FoundationNotReadyError unless the newest ReadinessReport for
 * `environment` is `ready` and names this build's release. Returns it.
 */
async function assertReadiness(db, { environment, canonicalModelReleaseId = CANONICAL_MODEL_RELEASE_ID } = {}) {
  const report = await latestReadinessReport(db, environment);
  if (!report) {
    throw new FoundationNotReadyError(`Nenhum ReadinessReport para o ambiente ${environment}: execute o Foundation Data Pipeline antes da API.`);
  }
  if (report.status !== 'ready') {
    throw new FoundationNotReadyError(`ReadinessReport ${report.readinessReportId} está ${report.status}: ${(report.blockers || []).join(', ')}`, report);
  }
  if (report.canonicalModelReleaseId !== canonicalModelReleaseId) {
    throw new FoundationNotReadyError(`ReadinessReport ${report.readinessReportId} é da release ${report.canonicalModelReleaseId}, esta build espera ${canonicalModelReleaseId}.`, report);
  }
  return report;
}

module.exports = {
  CANONICAL_MODEL_RELEASE_ID,
  MIGRATION_PLAN_ID,
  DEFERRED_P0_GATES,
  FoundationNotReadyError,
  latestReadinessReport,
  assertReadiness,
};
