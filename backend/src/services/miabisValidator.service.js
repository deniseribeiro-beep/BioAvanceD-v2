// backend/src/services/miabisValidator.service.js
const { connectNeo4j } = require('../infrastructure/database/neo4j/connection');
const Sample = require('../models/Sample');

/**
 * MIABIS Compliance Validator
 * @param {string} sampleId
 * @returns {Promise<{isCompliant: boolean, missingFields: string[], consentStatus: string, canBeShared: boolean}>}
 */
async function validateMiabisCompliance(sampleId) {
  // 1. MongoDB: Check required fields
  const sample = await Sample.findById(sampleId).lean();
  const missingFields = [];
  if (!sample) {
    return { isCompliant: false, missingFields: ['sampleNotFound'], consentStatus: 'not_found', canBeShared: false };
  }
  if (!sample.sampleType) missingFields.push('sampleType');
  if (!sample.anatomicalSite) missingFields.push('anatomicalSite');
  if (!sample.storageTemperature) missingFields.push('storageTemperature');
  if (!sample.diagnosisCode) missingFields.push('diagnosisCode');

  // 2. Neo4j: Check consent
  const cypher = `
    MATCH (p:Patient)-[r:AGREED_TO]->(t:TCLE)-[:COVERS]->(s:Sample {id: $sampleId})
    RETURN r.status AS status, r.isPublic AS isPublic
    LIMIT 1
  `;
  let consentStatus = 'not_found';
  let canBeShared = false;
  try {
    const neo4jDriver = await connectNeo4j();
    const session = neo4jDriver.session();
    const neoResult = await session.run(cypher, { sampleId });
    if (neoResult.records.length > 0) {
      const record = neoResult.records[0].toObject();
      consentStatus = record.status || 'unknown';
      canBeShared = !!record.isPublic;
    }
    await session.close();
  } catch (err) {
    // Log error or handle as needed
    consentStatus = 'error';
    canBeShared = false;
  }

  const isCompliant = missingFields.length === 0 && consentStatus === 'valid';
  return { isCompliant, missingFields, consentStatus, canBeShared };
}

module.exports = { validateMiabisCompliance };
