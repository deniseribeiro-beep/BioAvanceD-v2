const { getCollection } = require('../utils/collectionResolver');
const ProcedureModel = require('../models/Procedure');
const { validateActiveCodes } = require('../ingestion/activeCodeValidator');

/**
 * Persists one Procedure (dict-02 ELM-0242..0245, #692).
 * #714: procedureCoding must pass the same RF005 AC#4 active-release gate
 * (institutional local URI / SNOMED are on the expanded allow-list).
 */
async function createProcedure(db, data) {
  const procedure = ProcedureModel.create(data);

  const codeCheck = await validateActiveCodes(
    db,
    procedure.procedureCoding.map((coding) => ({
      systemUri: coding.systemUri,
      code: coding.code,
      version: coding.version || null,
      label: `procedureCoding[${coding.systemUri}|${coding.code}]`,
    }))
  );
  if (!codeCheck.valid) {
    throw new Error(codeCheck.violations.map((v) => v.message).join(', '));
  }

  procedure.procedureCoding.forEach((coding, index) => {
    if (!coding.version) {
      const resolvedVersion = codeCheck.results[index]?.concept?.version;
      if (resolvedVersion) {
        coding.version = resolvedVersion;
      }
    }
  });

  const collection = await getCollection(db, 'procedures');
  await collection.insertOne(procedure);
  return procedure;
}

/** One procedure record by its own procedureId (not Mongo's _id). */
async function getProcedureById(db, procedureId) {
  if (!procedureId) return null;
  const collection = await getCollection(db, 'procedures');
  return collection.findOne({ procedureId: String(procedureId) });
}

module.exports = {
  createProcedure,
  getProcedureById,
};
