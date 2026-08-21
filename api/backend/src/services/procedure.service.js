const { getCollection } = require('../utils/collectionResolver');
const ProcedureModel = require('../models/Procedure');

/** Persists one Procedure (dict-02 ELM-0242..0245, #692). */
async function createProcedure(db, data) {
  const collection = await getCollection(db, 'procedures');
  const procedure = ProcedureModel.create(data);
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
