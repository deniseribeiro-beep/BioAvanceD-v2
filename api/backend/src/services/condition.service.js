const { getCollection } = require('../utils/collectionResolver');
const ConditionModel = require('../models/Condition');
const { validateActiveCodes } = require('../ingestion/activeCodeValidator');
const { assertReferencesExist } = require('../ingestion/canonicalGateway');
const { diagnosticReportReferenceChecks } = require('./diagnostic-report.service');

/**
 * Persists one Condition (dict-02 ELM-0200..0210, #690) referenced by
 * participantId. RF005 AC#4 ("permitir codificação... somente quando
 * houver ReferenceDatasetRelease ativa e validada") -- reuses
 * activeCodeValidator.validateActiveCodes (RF029 AC#4's own machinery,
 * #669) rather than re-implementing the TerminologyConcept/
 * ReferenceDatasetRelease lookup. Unlike ingestionGateway.js's generic
 * envelope (RF029, #670-673's own scope), this only borrows the code
 * check -- no idempotency/quarantine/provenance wiring, which is a
 * distinct, broader concern this slice doesn't own.
 *
 * AC#4 reads "somente" (only) -- no controlled-review escape hatch here,
 * unlike ingestionGateway's `allowControlledReview` (that's RF029's own
 * AC, not RF005's).
 *
 * #706 confirmed this all-or-nothing gate is the intended reading of
 * AC#4 for a multi-coding Condition -- not a bug, and not a case for
 * per-coding gating -- per canonical-data-contract-v1.md's own #690
 * landing note, written before either #698 or #706 existed.
 */
async function createCondition(db, data) {
  const condition = ConditionModel.create(data);

  const codeCheck = await validateActiveCodes(
    db,
    condition.conditionCoding.map((coding) => ({
      systemUri: coding.systemUri,
      code: coding.code,
      version: coding.version || null,
      label: `conditionCoding[${coding.systemUri}|${coding.code}]`,
    }))
  );
  if (!codeCheck.valid) {
    throw new Error(codeCheck.violations.map((v) => v.message).join(', '));
  }

  // RF005 AC#5 ("preservar código, sistema, versão e descrição da
  // terminologia"): the active-release check above already resolved each
  // matched TerminologyConcept's own `version` -- it used to be computed
  // and discarded (#866). Stamp it onto each conditionCoding entry when the
  // caller didn't supply one already; never overwrite an explicitly-given
  // version, and leave the field absent (not null) if the validator
  // couldn't resolve one for that entry. codeCheck.results is built in the
  // same order as condition.conditionCoding above, so index-aligning is safe.
  // Cutoff (#879): codings written before 1d6d10b2 (2026-08-28) carry no
  // version and are deliberately not back-filled, so an absent version on an
  // older row means "written before the cutoff", not "unversioned".
  condition.conditionCoding.forEach((coding, index) => {
    if (!coding.version) {
      const resolvedVersion = codeCheck.results[index]?.concept?.version;
      if (resolvedVersion) {
        coding.version = resolvedVersion;
      }
    }
  });

  // ELM-0209: only an entry typed `DiagnosticReport/<id>` must resolve to a
  // real DiagnosticReport (#695); an untyped entry is stored unchecked.
  const evidenceCheck = diagnosticReportReferenceChecks(condition.diagnosisEvidence, 'diagnosisEvidence', { typedOnly: true });
  const evidenceReferences = await assertReferencesExist(db, evidenceCheck.references);
  if (evidenceCheck.malformed.length || !evidenceReferences.valid) {
    throw new Error([...evidenceCheck.malformed, ...evidenceReferences.violations.map((v) => v.message)].join(', '));
  }

  const collection = await getCollection(db, 'conditions');
  await collection.insertOne(condition);
  return condition;
}

/** All conditions for a participant. */
async function getConditionsForParticipant(db, participantId) {
  const collection = await getCollection(db, 'conditions');
  return collection.find({ participantId: String(participantId) }).toArray();
}

/** One condition by its own conditionId (not Mongo's _id). */
async function getConditionById(db, conditionId) {
  if (!conditionId) return null;
  const collection = await getCollection(db, 'conditions');
  return collection.findOne({ conditionId: String(conditionId) });
}

module.exports = {
  createCondition,
  getConditionsForParticipant,
  getConditionById,
};
