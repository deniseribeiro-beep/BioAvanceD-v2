import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  preserveReferenceAsset,
  referenceAssetPath,
  referenceAssetUri,
} = require('../../../src/reference-data/reference-imports/preserveAsset');
const hpoSource = require('../../../src/reference-data/reference-imports/sources/hpo');

describe('preserveReferenceAsset (RF028 AC2, RNF032 C2)', () => {
  let storageRoot;
  beforeEach(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-assets-'));
  });
  afterEach(() => {
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const preserve = (overrides = {}) => preserveReferenceAsset({
    sourcePath: hpoSource.fixturePath,
    datasetCode: hpoSource.datasetCode,
    checksum: hpoSource.expectedChecksum,
    storageRoot,
    ...overrides,
  });
  const finalPath = () => referenceAssetPath(storageRoot, hpoSource.datasetCode, hpoSource.expectedChecksum);

  it.each([
    ['a datasetCode of ../x', { datasetCode: '../x' }],
    ['a non-hex checksum', { checksum: 'z'.repeat(64) }],
  ])('refuses %s and writes nothing under the root', async (_label, overrides) => {
    const result = await preserve(overrides);

    expect(result.preserved).toBe(false);
    expect(result.reason).toBeTruthy();
    // ../x would resolve to <root>/x, so an empty root shows nothing escaped.
    expect(fs.readdirSync(storageRoot)).toEqual([]);
  });

  it('refuses a null storage root without throwing', async () => {
    const result = await preserve({ storageRoot: null });

    expect(result.preserved).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('refuses a directory at the final path', async () => {
    fs.mkdirSync(finalPath(), { recursive: true });

    const result = await preserve();

    expect(result.preserved).toBe(false);
    expect(fs.lstatSync(finalPath()).isDirectory()).toBe(true);
  });

  it('refuses an existing object with other bytes and leaves its bytes unchanged', async () => {
    fs.mkdirSync(path.dirname(finalPath()), { recursive: true });
    fs.writeFileSync(finalPath(), 'other bytes');

    const result = await preserve();

    expect(result.preserved).toBe(false);
    expect(result.reason).toContain(referenceAssetUri({ datasetCode: hpoSource.datasetCode, checksum: hpoSource.expectedChecksum }));
    expect(result.reason).toContain(hpoSource.expectedChecksum);
    expect(fs.readFileSync(finalPath(), 'utf8')).toBe('other bytes');
    expect(fs.readdirSync(path.dirname(finalPath()))).toEqual([hpoSource.expectedChecksum]);
  });

  it('preserves a fresh object, then reuses it on a second preserve', async () => {
    const first = await preserve();
    const second = await preserve();

    expect(first).toMatchObject({ preserved: true, reused: false, assetPath: finalPath() });
    expect(first.assetUri).toBe(`objstore://reference-releases/HPO/sha256/${hpoSource.expectedChecksum}`);
    expect(second).toMatchObject({ preserved: true, reused: true, assetPath: finalPath(), assetUri: first.assetUri });
    expect(fs.readFileSync(finalPath()).equals(fs.readFileSync(hpoSource.fixturePath))).toBe(true);
    expect(fs.readdirSync(path.dirname(finalPath()))).toEqual([hpoSource.expectedChecksum]);
  });
});
