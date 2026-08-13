import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { verify } = require('../../../../scripts/reference-imports/live-verify/verify-live-release');

// #556 (RF028/#550 HPO pilot): fetch is fully mocked here — this test never
// touches the real network. `node scripts/reference-imports/live-verify
// /verify-live-release.js HPO` (run manually, and in reference-data-live
// -verify.yml) is what exercises the real obophenotype/human-phenotype
// -ontology GitHub API and LICENSE.md live.

function mockFetchResponses({ releaseAssets, licenseText, tagName = 'v2026-06-23' }) {
  global.fetch = vi.fn(async (url) => {
    if (url.includes('/releases/latest')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: tagName,
          published_at: '2026-06-23T12:08:40Z',
          assets: releaseAssets.map((name) => ({ name })),
        }),
      };
    }
    if (url.includes('LICENSE')) {
      return { ok: true, status: 200, text: async () => licenseText };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe('verify-live-release.verify', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the expected asset and license pointer are both live', async () => {
    mockFetchResponses({
      releaseAssets: ['hp.owl', 'hp.json'],
      licenseText: 'Please read the license explanation at https://hpo.jax.org/app/license',
    });

    const report = await verify('HPO');

    expect(report.status).toBe('verified');
    expect(report.live.assetPresent).toBe(true);
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.live.releaseTag).toBe('v2026-06-23');
    expect(report.fixtureSource.systemUri).toBe('http://purl.obolibrary.org/obo/hp.owl');
  });

  it('reports status "mismatch" when the expected release asset is missing', async () => {
    mockFetchResponses({
      releaseAssets: ['hp.json'],
      licenseText: 'Please read the license explanation at https://hpo.jax.org/app/license',
    });

    const report = await verify('HPO');

    expect(report.status).toBe('mismatch');
    expect(report.live.assetPresent).toBe(false);
  });

  it('reports status "mismatch" when the license text no longer points at the expected page', async () => {
    mockFetchResponses({
      releaseAssets: ['hp.owl'],
      licenseText: 'License terms have moved, see our new legal page.',
    });

    const report = await verify('HPO');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });

  it('reports status "verified" for MONDO when the expected asset and license pointer are both live', async () => {
    mockFetchResponses({
      releaseAssets: ['mondo.owl', 'mondo.json'],
      licenseText: 'Attribution 4.0 International\n\n===...',
      tagName: 'v2026-08-04',
    });

    const report = await verify('MONDO');

    expect(report.status).toBe('verified');
    expect(report.live.assetPresent).toBe(true);
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.live.releaseTag).toBe('v2026-08-04');
    expect(report.fixtureSource.systemUri).toBe('http://purl.obolibrary.org/obo/mondo.owl');
  });

  it('reports status "mismatch" for MONDO when the expected release asset is missing', async () => {
    mockFetchResponses({
      releaseAssets: ['mondo.json'],
      licenseText: 'Attribution 4.0 International',
    });

    const report = await verify('MONDO');

    expect(report.status).toBe('mismatch');
    expect(report.live.assetPresent).toBe(false);
  });

  it('rejects an unknown dataset code rather than silently skipping verification', async () => {
    await expect(verify('NOT_A_REAL_SOURCE')).rejects.toThrow(/No live-verify entry for/);
  });
});

// #557 ORPHA: a 'direct-download' entry — no releases API, asset presence is
// a HEAD 200 on a stable file URL, license lives on the pack's own landing
// page. Exercises verify-live-release.js's second verification path, kept
// separate from the 'github-release' mocks above since it hits fetch() with
// a different URL/response shape (HEAD + Headers.get, not releases-API JSON).
function mockDirectDownloadFetchResponses({ assetOk = true, lastModified = 'Thu, 02 Jul 2026 07:06:46 GMT', licenseText }) {
  global.fetch = vi.fn(async (url, options = {}) => {
    if (url.includes('.zip')) {
      expect(options.method).toBe('HEAD');
      return {
        ok: assetOk,
        status: assetOk ? 200 : 404,
        headers: { get: (name) => (name === 'last-modified' ? lastModified : null) },
      };
    }
    if (url.includes('pack-nomenclature')) {
      return { ok: true, status: 200, text: async () => licenseText };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe('verify-live-release.verify — ORPHA (direct-download)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the pack download and license pointer are both live', async () => {
    mockDirectDownloadFetchResponses({
      licenseText: '<a href="https://creativecommons.org/licenses/by/4.0">CC BY 4.0 licence</a>',
    });

    const report = await verify('ORPHA');

    expect(report.status).toBe('verified');
    expect(report.live.assetPresent).toBe(true);
    expect(report.live.assetLastModified).toBe('Thu, 02 Jul 2026 07:06:46 GMT');
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.fixtureSource.systemUri).toBe('http://www.orpha.net');
  });

  it('reports status "mismatch" when the pack download is unreachable', async () => {
    mockDirectDownloadFetchResponses({
      assetOk: false,
      licenseText: '<a href="https://creativecommons.org/licenses/by/4.0">CC BY 4.0 licence</a>',
    });

    const report = await verify('ORPHA');

    expect(report.status).toBe('mismatch');
    expect(report.live.assetPresent).toBe(false);
  });

  it('reports status "mismatch" when the license page no longer links CC BY 4.0', async () => {
    mockDirectDownloadFetchResponses({
      licenseText: 'License terms have moved, see our new legal page.',
    });

    const report = await verify('ORPHA');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });
});
