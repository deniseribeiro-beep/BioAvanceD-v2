const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveSourceAsset } = require('../../../src/reference-data/reference-imports/resolveSourceAsset');
const hpoSource = require('../../../src/reference-data/reference-imports/sources/hpo');
const atcSource = require('../../../src/reference-data/reference-imports/sources/atc');

describe('resolveSourceAsset', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-resolve-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('defaults to the bundled fixture when profile is unset', async () => {
    const resolved = await resolveSourceAsset(hpoSource, {});
    expect(resolved.profile).toBe('fixture');
    expect(resolved.path).toBe(hpoSource.fixturePath);
    expect(resolved.expectedChecksum).toBe(hpoSource.expectedChecksum);
    expect(resolved.datasetVersion).toBe(hpoSource.datasetVersion);
  });

  it('defaults to fixture when profile is explicitly fixture', async () => {
    const resolved = await resolveSourceAsset(hpoSource, { REFERENCE_IMPORT_PROFILE: 'fixture' });
    expect(resolved.profile).toBe('fixture');
    expect(resolved.path).toBe(hpoSource.fixturePath);
  });

  it('full-lab HPO converts preplaced hp.json into cache JSONL', async () => {
    const assetDir = path.join(tmpRoot, 'ref-full', 'HPO');
    const cacheDir = path.join(tmpRoot, 'ref-cache');
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, 'hp.json'), JSON.stringify({
      graphs: [{
        nodes: [
          { id: 'http://purl.obolibrary.org/obo/HP_0000001', lbl: 'All', type: 'CLASS' },
          { id: 'http://purl.obolibrary.org/obo/HP_0000118', lbl: 'Phenotypic abnormality', type: 'CLASS' },
        ],
        edges: [
          {
            sub: 'http://purl.obolibrary.org/obo/HP_0000118',
            pred: 'is_a',
            obj: 'http://purl.obolibrary.org/obo/HP_0000001',
          },
        ],
      }],
    }));

    const resolved = await resolveSourceAsset(hpoSource, {
      REFERENCE_IMPORT_PROFILE: 'full-lab',
      REFERENCE_FULL_ASSET_DIR: path.join(tmpRoot, 'ref-full'),
      REFERENCE_FULL_CACHE_DIR: cacheDir,
    });

    expect(resolved.profile).toBe('full-lab');
    expect(resolved.path).toBe(path.join(cacheDir, 'HPO', 'data.jsonl'));
    expect(fs.existsSync(resolved.path)).toBe(true);
    expect(resolved.datasetVersion.startsWith('full-lab:')).toBe(true);
    expect(resolved.expectedChecksum).toMatch(/^[a-f0-9]{64}$/);

    const lines = fs.readFileSync(resolved.path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines.find((r) => r.id === 'HP:0000118').is_a).toEqual(['HP:0000001']);
  });

  it('full-lab ATC without dump fails with preplaced hint (no silent fixture fallback)', async () => {
    await expect(resolveSourceAsset(atcSource, {
      REFERENCE_IMPORT_PROFILE: 'full-lab',
      REFERENCE_FULL_ASSET_DIR: path.join(tmpRoot, 'ref-full'),
      REFERENCE_FULL_CACHE_DIR: path.join(tmpRoot, 'ref-cache'),
    })).rejects.toThrow(/ATC/);
  });

  it('full-lab uses a preplaced JSONL without converting', async () => {
    const assetDir = path.join(tmpRoot, 'ref-full', 'HPO');
    fs.mkdirSync(assetDir, { recursive: true });
    const jsonl = path.join(assetDir, 'data.jsonl');
    fs.writeFileSync(jsonl, `${JSON.stringify({ id: 'HP:1', lbl: 'One', is_a: [], synonyms: [], obsolete: false })}\n`);

    const resolved = await resolveSourceAsset(hpoSource, {
      REFERENCE_IMPORT_PROFILE: 'full-lab',
      REFERENCE_FULL_ASSET_DIR: path.join(tmpRoot, 'ref-full'),
      REFERENCE_FULL_CACHE_DIR: path.join(tmpRoot, 'ref-cache'),
    });

    expect(resolved.path).toBe(jsonl);
  });
});
