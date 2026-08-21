const { getCollection } = require('../utils/collectionResolver');
const ConditionModel = require('../models/Condition');
const { validateActiveCodes } = require('../ingestion/activeCodeValidator');

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

  const collection = await getCollection(db, 'conditions');
  await collection.insertOne(condition);
  return condition;
}

/** All conditions for a participant. */
async function getConditionsForParticipant(db, participantId) {
  const collection = await getCollection(db, 'conditions');
  const cursor = await collection.find({ participantId: String(participantId) });
  return cursor.toArray();
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
