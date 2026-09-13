// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getManifest } = require('../../src/reference-data/essential');
const miabis = require('../../src/reference-data/miabis.min.json');
const sprec = require('../../src/reference-data/sprec.min.json');
const rcsReferenceData = require('../../src/services/rcs-reference-data');

test('essential manifest loads without large datasets', () => {
  const manifest = getManifest();
  assert.strictEqual(Array.isArray(manifest), true);
  assert.deepStrictEqual(
    manifest.map((entry) => entry.key).sort(),
    ['miabis-minimal', 'rcs-gov-1.0', 'sprec-minimal'].sort()
  );
  for (const entry of manifest) {
    assert.ok(entry.required);
    assert.ok(entry.loader);
    assert.ok(entry.source);
    assert.strictEqual(entry.uniqueKeys.length > 0, true);
  }
});

test('miabis minimal reference data exposes expected structures', () => {
  assert.strictEqual(Array.isArray(miabis.sampleTypes), true);
  assert.strictEqual(Array.isArray(miabis.sampleOrigins), true);
  assert.strictEqual(Array.isArray(miabis.extractionProtocols), true);
  assert.strictEqual(Array.isArray(miabis.qualityDescriptions), true);
});

test('sprec minimal reference data exposes axes', () => {
  assert.strictEqual(sprec.sistema, 'SPREC');
  assert.ok(sprec.fonte);
  assert.strictEqual(Array.isArray(sprec.axes), true);
  assert.strictEqual(sprec.axes.length > 0, true);
});

test('rcs reference data exposes all governance structures', () => {
  assert.strictEqual(Array.isArray(rcsReferenceData.catalogs.fluid), true);
  assert.strictEqual(Array.isArray(rcsReferenceData.catalogs.solid), true);
  assert.strictEqual(Array.isArray(rcsReferenceData.severityMappings), true);
  assert.strictEqual(Array.isArray(rcsReferenceData.weights), true);
  assert.strictEqual(Array.isArray(rcsReferenceData.thresholds), true);
  assert.strictEqual(Array.isArray(rcsReferenceData.governanceRules), true);
});
