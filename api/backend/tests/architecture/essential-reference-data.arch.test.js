const assert = require('node:assert/strict');
const test = require('node:test');

const { getManifest } = require('../../src/reference-data/essential');
const miabis = require('../../src/reference-data/miabis.min.json');
const sprec = require('../../src/reference-data/sprec.min.json');
const rcsReferenceData = require('../../src/services/rcs-reference-data');

test('essential manifest loads without large datasets', () => {
  const manifest = getManifest();
  assert.ok(Array.isArray(manifest));
  assert.deepEqual(
    manifest.map((entry) => entry.key).sort(),
    ['miabis-minimal', 'rcs-gov-1.0', 'sprec-minimal'].sort()
  );
  for (const entry of manifest) {
    assert.ok(entry.required);
    assert.ok(entry.loader);
    assert.ok(entry.source);
    assert.ok(entry.uniqueKeys.length > 0);
  }
});

test('miabis minimal reference data exposes expected structures', () => {
  assert.ok(Array.isArray(miabis.sampleTypes));
  assert.ok(Array.isArray(miabis.sampleOrigins));
  assert.ok(Array.isArray(miabis.extractionProtocols));
  assert.ok(Array.isArray(miabis.qualityDescriptions));
});

test('sprec minimal reference data exposes axes', () => {
  assert.equal(sprec.sistema, 'SPREC');
  assert.ok(sprec.fonte);
  assert.ok(Array.isArray(sprec.axes));
  assert.ok(sprec.axes.length > 0);
});

test('rcs reference data exposes all governance structures', () => {
  assert.ok(Array.isArray(rcsReferenceData.catalogs.fluid));
  assert.ok(Array.isArray(rcsReferenceData.catalogs.solid));
  assert.ok(Array.isArray(rcsReferenceData.severityMappings));
  assert.ok(Array.isArray(rcsReferenceData.weights));
  assert.ok(Array.isArray(rcsReferenceData.thresholds));
  assert.ok(Array.isArray(rcsReferenceData.governanceRules));
});
