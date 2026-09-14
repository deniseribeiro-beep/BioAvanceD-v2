// node:test-only by contract. #1026 permanent regression gate.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(BACKEND_ROOT, relativePath), 'utf8');
}

test('#1026 rebuild uses the v2 projector and canonical projection service', () => {
  const rebuild = read('scripts/neo4j-canonical-rebuild.js');
  assert.match(rebuild, /Neo4jCanonicalProjectionV2Service/);
  assert.match(rebuild, /new GraphProjectionService/);
  assert.match(rebuild, /appendConsentEvent/);
  assert.match(rebuild, /appendSpecimenEvent/);
  assert.doesNotMatch(rebuild, /new Neo4jCanonicalProjectionService\s*\(/);
});

test('#1026 rebuild cannot synthesize consent from a sample/specimen', () => {
  const rebuild = read('scripts/neo4j-canonical-rebuild.js');
  assert.doesNotMatch(rebuild, /aggregateType\s*:\s*['"]Sample['"][\s\S]{0,500}CONSENT_UPSERTED/);
  assert.doesNotMatch(rebuild, /CONSENT_UPSERTED[\s\S]{0,500}aggregateType\s*:\s*['"]Sample['"]/);
  assert.match(rebuild, /currentStateDerived/);
});

test('#1026 consent outbox contract has no specimenId authority and requires explicit status', () => {
  const projection = read('src/services/graphProjection.service.js');
  const consentMethod = projection.slice(
    projection.indexOf('async appendConsentEvent'),
    projection.indexOf('async appendSpecimenEvent')
  );
  assert.match(consentMethod, /normalizeConsentStatus\(payload\.status\)/);
  assert.match(consentMethod, /aggregateType:\s*['"]EthicalConsent['"]/);
  assert.doesNotMatch(consentMethod, /specimenId\s*:/);
});

test('#1026 legacy compatibility projector never falls back consent aggregateId to specimenId', () => {
  const projector = read('src/services/neo4jCanonicalProjection.service.js');
  const method = projector.slice(
    projector.indexOf('async applyConsentProjection'),
    projector.indexOf('async applyLineageProjection')
  );
  assert.match(method, /const specimenId = normalizeText\(payload\.specimenId\)/);
  assert.doesNotMatch(method, /payload\.specimenId\s*\|\|\s*event\.aggregateId/);
});
