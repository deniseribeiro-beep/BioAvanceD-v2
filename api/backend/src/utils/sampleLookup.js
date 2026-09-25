const { ObjectId } = require('mongodb');

/**
 * #1216: one resolver for every route that names a specimen in its URL or
 * body. A caller may hold the Mongo _id or the canonical specimenId (the id
 * the create response, every report, ledger row and export carries), so a
 * 24-hex _id is tried first and anything else is matched as a specimenId.
 */
async function findSampleByAnyId(samplesCollection, id) {
  if (id === undefined || id === null || id === '') return null;
  if (id instanceof ObjectId || (typeof id === 'string' && ObjectId.isValid(id) && String(id).length === 24)) {
    const sample = await samplesCollection.findOne({ _id: new ObjectId(id) });
    if (sample) return sample;
  }
  return samplesCollection.findOne({ specimenId: String(id) });
}

module.exports = { findSampleByAnyId };
