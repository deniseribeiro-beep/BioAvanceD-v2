import { test, expect } from 'vitest';

const { getManifest } = require('../../src/reference-data/essential');
const miabis = require('../../src/reference-data/miabis.min.json');
const sprec = require('../../src/reference-data/sprec.min.json');
const rcsReferenceData = require('../../src/services/rcs-reference-data');

test('essential manifest loads without large datasets', () => {
  const manifest = getManifest();
  expect(Array.isArray(manifest)).toBe(true);
  expect(manifest.map((entry) => entry.key).sort()).toEqual(
    ['miabis-minimal', 'rcs-gov-1.0', 'sprec-minimal'].sort()
  );
  for (const entry of manifest) {
    expect(entry.required).toBeTruthy();
    expect(entry.loader).toBeTruthy();
    expect(entry.source).toBeTruthy();
    expect(entry.uniqueKeys.length > 0).toBe(true);
  }
});

test('miabis minimal reference data exposes expected structures', () => {
  expect(Array.isArray(miabis.sampleTypes)).toBe(true);
  expect(Array.isArray(miabis.sampleOrigins)).toBe(true);
  expect(Array.isArray(miabis.extractionProtocols)).toBe(true);
  expect(Array.isArray(miabis.qualityDescriptions)).toBe(true);
});

test('sprec minimal reference data exposes axes', () => {
  expect(sprec.sistema).toBe('SPREC');
  expect(sprec.fonte).toBeTruthy();
  expect(Array.isArray(sprec.axes)).toBe(true);
  expect(sprec.axes.length > 0).toBe(true);
});

test('rcs reference data exposes all governance structures', () => {
  expect(Array.isArray(rcsReferenceData.catalogs.fluid)).toBe(true);
  expect(Array.isArray(rcsReferenceData.catalogs.solid)).toBe(true);
  expect(Array.isArray(rcsReferenceData.severityMappings)).toBe(true);
  expect(Array.isArray(rcsReferenceData.weights)).toBe(true);
  expect(Array.isArray(rcsReferenceData.thresholds)).toBe(true);
  expect(Array.isArray(rcsReferenceData.governanceRules)).toBe(true);
});
