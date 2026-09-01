const { getCollection } = require('../utils/collectionResolver');
const FamilyHistoryModel = require('../models/FamilyHistory');
const { validateActiveCodes } = require('../ingestion/activeCodeValidator');

/**
 * Persists one FamilyHistory (dict-02 ELM-0249..0251, #692). RF005 AC#4
 * ("permitir codificação... somente quando houver ReferenceDatasetRelease
 * ativa e validada") -- reuses activeCodeValidator.validateActiveCodes the
 * same way condition.service.js's createCondition does (#714's
 * FamilyHistory half; AllergyIntolerance/MedicationExposure/Procedure stay
 * unguarded, blocked on a requirements decision outside this slice).
 *
 * familyCondition entries carry an uncoded free-text branch (the intake
 * wizard's own display-only path, no `condition.systemUri`/`condition.code`)
 * alongside coded ones -- validateActiveCodes already skips any entry
 * missing systemUri/code, so those pass through ungated without a special
 * case here.
 */
async function createFamilyHistory(db, data) {
  const familyHistory = FamilyHistoryModel.create(data);

  const codeCheck = await validateActiveCodes(
    db,
    familyHistory.familyCondition.map((entry) => ({
      systemUri: entry.condition?.systemUri,
      code: entry.condition?.code,
      version: entry.condition?.version || null,
      label: `familyCondition[${entry.condition?.systemUri}|${entry.condition?.code}]`,
    }))
  );
  if (!codeCheck.valid) {
    throw new Error(codeCheck.violations.map((v) => v.message).join(', '));
  }

  // RF005 AC#5 ("preservar código, sistema, versão e descrição da
  // terminologia"): stamp the resolved TerminologyConcept version onto each
  // coded entry when the caller didn't supply one, same treatment as
  // condition.service.js's createCondition. Unlike conditionCoding (always
  // coded), familyCondition mixes coded and uncoded entries, so
  // validateActiveCodes's own `continue` on a missing systemUri/code leaves
  // codeCheck.results *not* index-aligned with familyCondition -- match by
  // systemUri+code instead of position.
  const resolvedBySystemAndCode = new Map(
    codeCheck.results.map((r) => [`${r.systemUri}|${r.code}`, r])
  );
  familyHistory.familyCondition.forEach((entry) => {
    if (!entry.condition || entry.condition.version) return;
    const resolved = resolvedBySystemAndCode.get(`${entry.condition.systemUri}|${entry.condition.code}`);
    const resolvedVersion = resolved?.concept?.version;
    if (resolvedVersion) {
      entry.condition.version = resolvedVersion;
    }
  });

  const collection = await getCollection(db, 'familyHistories');
  await collection.insertOne(familyHistory);
  return familyHistory;
}

/** One family history record by its own familyHistoryId (not Mongo's _id). */
async function getFamilyHistoryById(db, familyHistoryId) {
  if (!familyHistoryId) return null;
  const collection = await getCollection(db, 'familyHistories');
  return collection.findOne({ familyHistoryId: String(familyHistoryId) });
}

module.exports = {
  createFamilyHistory,
  getFamilyHistoryById,
};
