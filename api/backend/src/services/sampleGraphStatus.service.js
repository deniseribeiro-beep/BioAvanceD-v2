const env = require('../config/env');
const { currentRequestId, neo4jTxConfig } = require('../utils/requestContext');

// #1559: the projected status of a sample's :Sample node (RF019 cold-chain
// compromise), keyed by the Mongo _id as a string. A READ session: the
// projector is the only graph writer, and the server refuses a write here.
const SAMPLE_GRAPH_STATUS = `
  MATCH (sample:Sample {id: $sampleId})
  RETURN sample.status AS status,
         toString(sample.compromisedAt) AS compromisedAt,
         sample.compromiseFreezerKey AS compromiseFreezerKey,
         sample.compromiseBreachedSince AS compromiseBreachedSince
`;

async function readSampleGraphStatus(driver, sampleId) {
  const session = driver.session({ database: env.NEO4J_DATABASE || 'neo4j', defaultAccessMode: 'READ' });
  try {
    const result = await session.run(
      SAMPLE_GRAPH_STATUS,
      { sampleId: String(sampleId) },
      neo4jTxConfig(currentRequestId())
    );
    const record = result.records[0];
    if (!record) {
      return {
        sampleId,
        projected: false,
        status: null,
        compromisedAt: null,
        compromiseFreezerKey: null,
        compromiseBreachedSince: null,
      };
    }
    return {
      sampleId,
      projected: true,
      status: record.get('status') ?? null,
      compromisedAt: record.get('compromisedAt') ?? null,
      compromiseFreezerKey: record.get('compromiseFreezerKey') ?? null,
      compromiseBreachedSince: record.get('compromiseBreachedSince') ?? null,
    };
  } finally {
    await session.close();
  }
}

module.exports = { readSampleGraphStatus };
