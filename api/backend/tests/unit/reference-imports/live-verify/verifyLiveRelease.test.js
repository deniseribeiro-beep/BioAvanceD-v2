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

// #557 ICD11: a 'redirect-version' entry — the WHO ICD API itself is
// OAuth-gated, so there's no releases API or direct-download asset to check;
// instead a stable "latest" URL 302s to the current release's own path, and
// the release identifier is read off the redirect target (response.url)
// rather than any JSON field or header. License is a WHO-hosted PDF, so the
// mock's "license" branch returns raw-ish text the way fetchText()'s UTF-8
// decode of the real PDF's bytes still surfaces the plain-ASCII pointer
// phrase live (confirmed 2026-08-13).
function mockRedirectVersionFetchResponses({ redirectOk = true, redirectedUrl = 'https://icd.who.int/browse/2026-01/mms/en', licenseText }) {
  global.fetch = vi.fn(async (url) => {
    if (url.includes('/browse/latest-release/')) {
      return { ok: redirectOk, status: redirectOk ? 200 : 404, url: redirectedUrl };
    }
    if (url.includes('ICD11-license.pdf')) {
      return { ok: true, status: 200, text: async () => licenseText };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe('verify-live-release.verify — ICD11 (redirect-version)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the redirect resolves to a release path and the license pointer is live', async () => {
    mockRedirectVersionFetchResponses({
      licenseText: 'International Classification of Diseases, Eleventh Revision (ICD-11), World Health Organization (WHO) 2019',
    });

    const report = await verify('ICD11');

    expect(report.status).toBe('verified');
    expect(report.live.releaseVersion).toBe('2026-01');
    expect(report.live.redirectedTo).toBe('https://icd.who.int/browse/2026-01/mms/en');
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.fixtureSource.systemUri).toBe('http://id.who.int/icd/release/11/mms');
  });

  it('reports status "mismatch" when the redirect target no longer carries a recognizable release path', async () => {
    mockRedirectVersionFetchResponses({
      redirectedUrl: 'https://icd.who.int/en/maintenance',
      licenseText: 'World Health Organization',
    });

    const report = await verify('ICD11');

    expect(report.status).toBe('mismatch');
    expect(report.live.releaseVersion).toBe(null);
  });

  it('reports status "mismatch" when the license PDF no longer contains the expected pointer text', async () => {
    mockRedirectVersionFetchResponses({
      licenseText: 'This document has moved.',
    });

    const report = await verify('ICD11');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });
});

// #557 ICD10: a 'fixed-edition' entry — unlike ICD-11's "latest" redirect,
// ICD-10's WHO browse page (icd.who.int/browse10/2019/en) is a fixed-edition
// URL that 200s directly with the edition embedded in the page body itself
// (`<title>ICD-10 Version:2019</title>`), and no ICD-10-specific license
// document was found live, so it reuses WHO's sitewide Terms of Use page as
// the license-bearing surface instead.
function mockFixedEditionFetchResponses({ pageText = '<title>ICD-10 Version:2019 </title>', licenseText }) {
  global.fetch = vi.fn(async (url) => {
    if (url.includes('browse10')) {
      return { ok: true, status: 200, text: async () => pageText };
    }
    if (url.includes('terms-of-use')) {
      return { ok: true, status: 200, text: async () => licenseText };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe('verify-live-release.verify — ICD10 (fixed-edition)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the live page still carries the expected edition and the license pointer is live', async () => {
    mockFixedEditionFetchResponses({
      licenseText: '<p>&copy; Copyright World Health Organization (WHO), 2021. All Rights Reserved.</p>',
    });

    const report = await verify('ICD10');

    expect(report.status).toBe('verified');
    expect(report.live.liveEdition).toBe('2019');
    expect(report.live.editionMatchesExpected).toBe(true);
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.fixtureSource.systemUri).toBe('http://hl7.org/fhir/sid/icd-10');
  });

  it('reports status "mismatch" when the live page no longer carries the expected edition', async () => {
    mockFixedEditionFetchResponses({
      pageText: '<title>ICD-10 Version:2022 </title>',
      licenseText: '<p>&copy; Copyright World Health Organization (WHO), 2021. All Rights Reserved.</p>',
    });

    const report = await verify('ICD10');

    expect(report.status).toBe('mismatch');
    expect(report.live.liveEdition).toBe('2022');
    expect(report.live.editionMatchesExpected).toBe(false);
  });

  it('reports status "mismatch" when the WHO terms-of-use page no longer contains the expected pointer text', async () => {
    mockFixedEditionFetchResponses({
      licenseText: 'These terms have moved, see our new legal page.',
    });

    const report = await verify('ICD10');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });
});

// #557 OMIM: a 'not-live-verifiable' entry — unlike ICD-11/ICD-10 (API
// gated, but a public unauthenticated page still exposes a release/license
// signal), omim.org's entire public web domain sits behind an interactive
// Cloudflare bot challenge on every path (confirmed live 2026-08-13: `/`,
// `/help/api`, `/downloads`, `/about` on both `omim.org` and `www.omim.org`
// all 403 with a `Cf-Mitigated: challenge` header, regardless of
// User-Agent), and the domain's own robots.txt explicitly disallows
// crawling and warns it auto-blocks IPs that request pages. No automated
// client — this script, the workflow_dispatch job, or any future scheduled
// job — can pass that challenge or should be attempting to per the site's
// own terms, so this entry must never call fetch() at all: attempting one
// would only reproduce the 403, not produce a meaningful mismatch signal,
// and would violate the robots.txt disallow.
function mockFetchThrowsIfCalled() {
  global.fetch = vi.fn(async (url) => {
    throw new Error(`verify-live-release must not fetch OMIM (not-live-verifiable): ${url}`);
  });
}

describe('verify-live-release.verify — OMIM (not-live-verifiable)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "not-verifiable" with a reason, never calling fetch()', async () => {
    mockFetchThrowsIfCalled();

    const report = await verify('OMIM');

    expect(report.status).toBe('not-verifiable');
    expect(report.live.reason).toMatch(/Cloudflare/);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(report.fixtureSource.systemUri).toBe('https://www.omim.org');
  });
});

// #557 HGNC: a 'rest-info' entry — genenames.org's REST API is genuinely
// public (dict-01_FONTES.md's SRC_HGNC row: "Não ou conforme endpoint" for
// auth), but unlike every other source in this group HGNC has no discrete
// release/tag/edition at all — it's a continuously-updated dataset, so the
// "release" signal is a live `lastModified` timestamp from a JSON info
// endpoint instead. Confirmed live 2026-08-13 that the endpoint only
// returns JSON when the request sends an explicit `Accept: application/json`
// header (without one it silently 200s with XML instead), so the mock
// asserts that header is actually sent, not just that some fetch happened.
function mockRestInfoFetchResponses({ lastModified = '2026-08-11T11:45:27.655Z', numDoc = 46832, licenseText }) {
  global.fetch = vi.fn(async (url, options = {}) => {
    if (url.includes('rest.genenames.org/info')) {
      expect(options.headers).toEqual({ Accept: 'application/json' });
      return { ok: true, status: 200, json: async () => ({ lastModified, numDoc }) };
    }
    if (url.includes('genenames.org/about')) {
      return { ok: true, status: 200, text: async () => licenseText };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe('verify-live-release.verify — HGNC (rest-info)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the info endpoint reports a lastModified timestamp and the license pointer is live', async () => {
    mockRestInfoFetchResponses({
      licenseText: 'No restrictions are imposed on access to, or use of, the data provided by the HGNC, which are provided to enhance knowledge.',
    });

    const report = await verify('HGNC');

    expect(report.status).toBe('verified');
    expect(report.live.lastModified).toBe('2026-08-11T11:45:27.655Z');
    expect(report.live.numDoc).toBe(46832);
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.fixtureSource.systemUri).toBe('https://www.genenames.org');
  });

  it('reports status "mismatch" when the info endpoint no longer reports a lastModified timestamp', async () => {
    mockRestInfoFetchResponses({
      lastModified: null,
      licenseText: 'No restrictions are imposed on access to, or use of, the data provided by the HGNC.',
    });

    const report = await verify('HGNC');

    expect(report.status).toBe('mismatch');
    expect(report.live.lastModified).toBeNull();
  });

  it('reports status "mismatch" when the About page no longer contains the expected license pointer', async () => {
    mockRestInfoFetchResponses({
      licenseText: 'Our data release policy has moved, see our new legal page.',
    });

    const report = await verify('HGNC');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });
});

// #557 LOINC: a 'not-live-verifiable' entry — unlike HGNC (whose auth note
// turned out to be a red herring, the REST API is genuinely open) LOINC's
// registration note holds, but not for the "registration wall" reason
// dict-01_FONTES.md's row implies: loinc.org's /downloads, /license, and
// /kb/versioning pages themselves are unauthenticated and carry the
// version/license text in plain view (confirmed live via curl with a
// browser User-Agent), but every one of them 403s under Node's own
// fetch() with a genuine interactive Cloudflare challenge, confirmed even
// with a full realistic browser header set — not the simple default-UA
// rejection HGNC/ICD-11 hit. Independently, loinc.org's robots.txt
// explicitly disallows `ClaudeBot` (Disallow: /) by name alongside other
// named AI crawlers, while generic browsers stay Allow: / — so even if a
// technique existed to pass the challenge, this script should not attempt
// it. Same fetch()-never-called contract as OMIM's test.
function mockFetchThrowsIfCalledForLoinc() {
  global.fetch = vi.fn(async (url) => {
    throw new Error(`verify-live-release must not fetch LOINC (not-live-verifiable): ${url}`);
  });
}

describe('verify-live-release.verify — LOINC (not-live-verifiable)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "not-verifiable" with a reason, never calling fetch()', async () => {
    mockFetchThrowsIfCalledForLoinc();

    const report = await verify('LOINC');

    expect(report.status).toBe('not-verifiable');
    expect(report.live.reason).toMatch(/Cloudflare/);
    expect(report.live.reason).toMatch(/ClaudeBot/);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(report.fixtureSource.systemUri).toBe('http://loinc.org');
  });
});
