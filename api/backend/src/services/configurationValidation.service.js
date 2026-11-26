/**
 * RF014 AC3/AC4/AC6/AC7, RNF018 C3, RNF023 C7, RNF028 C5, CFG-005, CFG-008,
 * RULE-015: a candidate configuration is validated before it is activated.
 *
 * Every candidate gets a ConfigurationValidationRun over the structural,
 * semantic, dependency and security gates and one result per governance
 * invariant (src/governance/invariants.js).
 *
 * - **Passed** (`activateValidated`): the candidate is proposed, approved and
 *   activated under the id the run names. Until approval is its own step,
 *   the administrator who saves is the approver.
 * - **Failed** (`recordRefusal`): the candidate is kept as a `draft`
 *   release that was never activated, the run names every broken rule, and
 *   the request is refused: 422 when an invariant was broken, 400
 *   otherwise. A broken invariant also appends a `violation_attempted`
 *   ConfigurationChangeEvent, so no administrative call gets past an
 *   invariant silently (CFG-008).
 */
const crypto = require('crypto');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const ConfigurationValidationRunModel = require('../models/ConfigurationValidationRun');
const ConfigurationChangeEventModel = require('../models/ConfigurationChangeEvent');
const InvariantViolationModel = require('../models/InvariantViolation');
const configurationReleaseService = require('./configurationRelease.service');
const { INVARIANTS } = require('../governance/invariants');
const { ensureConfigurationValidationRunIndexes } = require('../utils/governanceRegistryIndexes');

// The component an InvariantViolation names as its detector.
const SOURCE_COMPONENT = 'configurationValidation';

class ConfigurationValidationError extends Error {
  constructor(message, statusCode, { validationRun, violatedInvariants, violations = [] }) {
    super(message);
    this.name = 'ConfigurationValidationError';
    this.statusCode = statusCode;
    this.validationRun = validationRun;
    this.violatedInvariants = violatedInvariants;
    // RNF018 AC2: one { invariantId, fieldPath } per refused path.
    this.violations = violations;
  }
}

/**
 * One result per catalogued invariant. An invariant with configuration paths
 * fails when the candidate tried to change one of them (`fixedAttempts`);
 * INV-SCOPE-001, which has none, fails on a key outside the profile's
 * catalog (`unknownPaths`).
 */
function invariantResultsFor({ fixedAttempts = [], unknownPaths = [] }) {
  return INVARIANTS.map((invariant) => {
    const paths = invariant.configurationPaths.length
      ? fixedAttempts.filter((attempt) => invariant.configurationPaths.includes(attempt.path)).map((attempt) => attempt.path)
      : unknownPaths;
    return { invariantId: invariant.invariantId, result: paths.length ? 'fail' : 'pass', paths };
  });
}

function refusalMessage(findings, fixedAttempts, violated) {
  const messages = [
    ...findings.structural, ...findings.semantic, ...findings.dependency, ...findings.security,
    ...fixedAttempts.map(({ path, invariantId }) => `${path} é fixo${invariantId ? ` pelo invariante ${invariantId}` : ''} e não pode ser alterado`),
  ];
  const invariants = violated.length ? ` [invariantes violados: ${violated.join(', ')}]` : '';
  return `Configurações inválidas: ${messages.join(', ')}${invariants}`;
}

/**
 * Runs the gates over a candidate, writing nothing. `findings` is
 * `{ structural, semantic, dependency, security, unknownPaths }`;
 * `fixedAttempts` is `[{ path, invariantId }]`. Returns the run, the
 * violated invariant ids, and the error to throw when the run failed.
 */
function evaluate({ findings, fixedAttempts = [], now = new Date() }) {
  const invariantResults = invariantResultsFor({ fixedAttempts, unknownPaths: findings.unknownPaths || [] });
  const { unknownPaths: _unknown, ...gateFindings } = findings;
  const run = ConfigurationValidationRunModel.createExecuted({
    releaseId: crypto.randomUUID(),
    findings: { ...gateFindings, fixedAttempts },
    invariantResults,
    now,
  });
  const failed = invariantResults.filter((entry) => entry.result === 'fail');
  const violated = failed.map((entry) => entry.invariantId);
  const violations = failed.flatMap((entry) => entry.paths.map((fieldPath) => ({ invariantId: entry.invariantId, fieldPath })));
  const error = run.status === 'failed'
    ? new ConfigurationValidationError(refusalMessage(findings, fixedAttempts, violated), violated.length ? 422 : 400, { validationRun: run, violatedInvariants: violated, violations })
    : null;
  return { run, violated, error };
}

/** Records a failed run, its draft candidate and the refusal's events. */
async function recordRefusal(db, { run, violated, profileId, settings, actorId, now = new Date() }) {
  const runs = db.collection(CANONICAL_COLLECTIONS.configurationValidationRuns);
  const events = db.collection(CANONICAL_COLLECTIONS.configurationChangeEvents);
  await ensureConfigurationValidationRunIndexes(runs);
  await configurationReleaseService.recordDraft(db, { configurationReleaseId: run.releaseId, profileId, settings, now });
  await runs.insertOne(run);
  await events.insertOne(ConfigurationChangeEventModel.create({
    releaseId: run.releaseId, changeType: 'proposed', actorId,
    impactSummary: `Proposta recusada pela ConfigurationValidationRun ${run.configurationValidationRunId}.`,
    occurredAt: now,
  }));
  if (violated.length) {
    const paths = run.invariantResults.filter((entry) => entry.result === 'fail').flatMap((entry) => entry.paths);
    await events.insertOne(ConfigurationChangeEventModel.create({
      releaseId: run.releaseId, changeType: 'violation_attempted', actorId,
      impactSummary: `Tentativa de alterar ${paths.join(', ')} bloqueada: ${violated.join(', ')}.`,
      occurredAt: now,
    }));
    // RF019 AC1/AC4 (#1315): one InvariantViolation per broken invariant,
    // correlated with the refused candidate and evidenced by its run.
    const violations = db.collection(CANONICAL_COLLECTIONS.invariantViolations);
    for (const invariantId of violated) {
      await violations.insertOne(InvariantViolationModel.create({
        invariantId,
        detectedAt: now,
        sourceComponent: SOURCE_COMPONENT,
        outcome: INVARIANTS.find((invariant) => invariant.invariantId === invariantId)?.violationOutcome,
        evidenceUri: run.reportUri,
        correlationId: run.releaseId,
      }));
    }
  }
}

/**
 * Activates a candidate whose run passed: `proposed` and `approved` events,
 * then `activate(releaseId)`, then the run itself. Returns the release.
 */
async function activateValidated(db, { run, actorId, activate, now = new Date() }) {
  if (run.status !== 'passed') throw new Error(`ConfigurationValidationRun ${run.configurationValidationRunId} não passou`);
  const runs = db.collection(CANONICAL_COLLECTIONS.configurationValidationRuns);
  const events = db.collection(CANONICAL_COLLECTIONS.configurationChangeEvents);
  await ensureConfigurationValidationRunIndexes(runs);
  await events.insertOne(ConfigurationChangeEventModel.create({
    releaseId: run.releaseId, changeType: 'proposed', actorId,
    impactSummary: `Proposta validada pela ConfigurationValidationRun ${run.configurationValidationRunId}.`,
    occurredAt: now,
  }));
  await events.insertOne(ConfigurationChangeEventModel.create({
    releaseId: run.releaseId, changeType: 'approved', actorId,
    impactSummary: 'Aprovada por quem salvou; a aprovação ainda não é um passo separado.',
    occurredAt: now,
  }));
  const release = await activate(run.releaseId);
  await runs.insertOne(run);
  return release;
}

/** The newest validation run of a release, or null. */
async function latestRunOf(db, releaseId) {
  return db.collection(CANONICAL_COLLECTIONS.configurationValidationRuns)
    .find({ releaseId }).sort({ executedAt: -1 }).limit(1).next();
}

module.exports = {
  ConfigurationValidationError,
  invariantResultsFor,
  evaluate,
  recordRefusal,
  activateValidated,
  latestRunOf,
};
