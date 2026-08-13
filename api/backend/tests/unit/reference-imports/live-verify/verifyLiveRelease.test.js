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

// #557 UCUM: another 'fixed-edition' entry — unlike LOINC, ucum.org (same
// steward, Regenstrief Institute, but a different domain/bot-protection
// config) is genuinely open to Node's own fetch(), no Cloudflare challenge
// and no AI-crawler-specific robots.txt disallow. The spec page
// (ucum.org/ucum) carries a clean `<p>Version: 2.2</p>` in its own header
// block, and the dedicated license page (ucum.org/license) carries the
// copyright notice as a durable plain-text pointer.
function mockUcumFixedEditionFetchResponses({ pageText = '<p>Version: 2.2</p>', licenseText }) {
  global.fetch = vi.fn(async (url) => {
    if (url.includes('ucum.org/ucum')) {
      return { ok: true, status: 200, text: async () => pageText };
    }
    if (url.includes('ucum.org/license')) {
      return { ok: true, status: 200, text: async () => licenseText };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe('verify-live-release.verify — UCUM (fixed-edition)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the live spec page still carries the expected version and the license pointer is live', async () => {
    mockUcumFixedEditionFetchResponses({
      licenseText: '<p>...is copyright &#169;1999-2024, Regenstrief Institute, Inc. All rights reserved.</p>',
    });

    const report = await verify('UCUM');

    expect(report.status).toBe('verified');
    expect(report.live.liveEdition).toBe('2.2');
    expect(report.live.editionMatchesExpected).toBe(true);
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.fixtureSource.systemUri).toBe('http://unitsofmeasure.org');
  });

  it('reports status "mismatch" when the live spec page no longer carries the expected version', async () => {
    mockUcumFixedEditionFetchResponses({
      pageText: '<p>Version: 2.3</p>',
      licenseText: '<p>...is copyright &#169;1999-2024, Regenstrief Institute, Inc. All rights reserved.</p>',
    });

    const report = await verify('UCUM');

    expect(report.status).toBe('mismatch');
    expect(report.live.liveEdition).toBe('2.3');
    expect(report.live.editionMatchesExpected).toBe(false);
  });

  it('reports status "mismatch" when the license page no longer contains the expected copyright pointer', async () => {
    mockUcumFixedEditionFetchResponses({
      licenseText: 'This license has moved, see our new legal page.',
    });

    const report = await verify('UCUM');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });
});

// #557 DCB: a third 'fixed-edition' entry — dict-01_FONTES.md's SRC_DCB row
// ("URL oficial" https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb)
// 200s directly under Node's own fetch() (unlike the Anvisa Digital Library
// page it links out to for the actual XLSX download, which 403s under
// fetch() with a Cloudflare challenge even though curl with a full browser
// User-Agent gets a clean 200 — the same curl-vs-fetch() split LOINC's slice
// established, but here it doesn't block verification because the release
// signal itself lives on the reachable page, not the blocked one). The DCB
// page's own body embeds the current updating Instrução Normativa inline
// ("Instrução Normativa – IN nº 342, de 20 de dezembro de 2024"), so the
// edition read out is the IN number rather than a year. No DCB-specific
// license URL exists (dict-01's SRC_DCB row: "Termos do portal oficial",
// no dedicated link), so this reuses gov.br's own sitewide Terms of Use
// page (gov.br/pt-br/termos-de-uso), whose footer carries a durable CC
// BY-ND 3.0 licence link — same "reuse the sitewide terms page" precedent
// ICD-10 established for WHO.
function mockDcbFixedEditionFetchResponses({
  pageText = 'Instrução Normativa – IN nº 342, de 20 de dezembro de 2024',
  licenseText,
}) {
  global.fetch = vi.fn(async (url) => {
    if (url.includes('farmacopeia/dcb')) {
      return { ok: true, status: 200, text: async () => pageText };
    }
    if (url.includes('termos-de-uso')) {
      return { ok: true, status: 200, text: async () => licenseText };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe('verify-live-release.verify — DCB (fixed-edition)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the live page still carries the expected updating IN and the license pointer is live', async () => {
    mockDcbFixedEditionFetchResponses({
      licenseText:
        'Todo o conteúdo deste site está publicado sob a licença <a rel="license" href="https://creativecommons.org/licenses/by-nd/3.0/deed.pt_BR">Creative Commons Atribuição-SemDerivações 3.0 Não Adaptada</a>.',
    });

    const report = await verify('DCB');

    expect(report.status).toBe('verified');
    expect(report.live.liveEdition).toBe('342');
    expect(report.live.editionMatchesExpected).toBe(true);
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.fixtureSource.systemUri).toBe('https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb');
  });

  it('reports status "mismatch" when the live page no longer carries the expected updating IN', async () => {
    mockDcbFixedEditionFetchResponses({
      pageText: 'Instrução Normativa – IN nº 399, de 5 de março de 2027',
      licenseText:
        'Todo o conteúdo deste site está publicado sob a licença <a rel="license" href="https://creativecommons.org/licenses/by-nd/3.0/deed.pt_BR">Creative Commons Atribuição-SemDerivações 3.0 Não Adaptada</a>.',
    });

    const report = await verify('DCB');

    expect(report.status).toBe('mismatch');
    expect(report.live.liveEdition).toBe('399');
    expect(report.live.editionMatchesExpected).toBe(false);
  });

  it('reports status "mismatch" when the gov.br terms-of-use page no longer contains the expected licence pointer', async () => {
    mockDcbFixedEditionFetchResponses({
      licenseText: 'These terms have moved, see our new legal page.',
    });

    const report = await verify('DCB');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });
});

// #557 ATC: a fourth 'fixed-edition' entry, closing out §7.4 step 7's "DCB e
// ATC/DDD" pair. dict-01_FONTES.md's SRC_ATC "URL oficial"
// (whocc.no/atc_ddd_index/) 301-redirects to the WHO Collaborating Centre's
// actual current domain (atcddd.fhi.no — the Centre moved host to the
// Norwegian Institute of Public Health), which Node's own fetch() follows
// transparently (fetch() follows redirects by default; response.ok stays
// true). The redirected page's own body carries a clean `<h1>ATC/DDD Index
// 2026</h1>` heading — the annual index year stands in for ICD-10/UCUM/DCB's
// edition/version string, matching dict-01's own "Índice anual vigente"
// wording. No releases API or download-asset URL is involved (WHOCC
// distributes the full index via a licensed portal/file per dict-01's
// "Cadastro/aquisição possível" auth note, out of scope for what this
// verification checks — it only proves the same free public index page and
// license terms dict-01 already cites are still live). License is on a
// dedicated Copyright/Disclaimer page (whocc.no/copyright_disclaimer/,
// itself redirected to atcddd.fhi.no) with a durable plain-text attribution
// pointer ("WHO Collaborating Centre for Drug Statistics Methodology, Oslo,
// Norway").
function mockAtcFixedEditionFetchResponses({ pageText = '<h1>ATC/DDD Index 2026</h1>', licenseText }) {
  global.fetch = vi.fn(async (url) => {
    if (url.includes('atc_ddd_index')) {
      return { ok: true, status: 200, text: async () => pageText };
    }
    if (url.includes('copyright_disclaimer')) {
      return { ok: true, status: 200, text: async () => licenseText };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe('verify-live-release.verify — ATC (fixed-edition)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the live page still carries the expected annual index year and the license pointer is live', async () => {
    mockAtcFixedEditionFetchResponses({
      licenseText:
        'WHO Collaborating Centre for Drug Statistics Methodology, Oslo, Norway. Use of all or parts of the material requires reference to the WHO Collaborating Centre for Drug Statistics Methodology.',
    });

    const report = await verify('ATC');

    expect(report.status).toBe('verified');
    expect(report.live.liveEdition).toBe('2026');
    expect(report.live.editionMatchesExpected).toBe(true);
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.fixtureSource.systemUri).toBe('http://www.whocc.no/atc');
  });

  it('reports status "mismatch" when the live page no longer carries the expected annual index year', async () => {
    mockAtcFixedEditionFetchResponses({
      pageText: '<h1>ATC/DDD Index 2027</h1>',
      licenseText:
        'WHO Collaborating Centre for Drug Statistics Methodology, Oslo, Norway. Use of all or parts of the material requires reference to the WHO Collaborating Centre for Drug Statistics Methodology.',
    });

    const report = await verify('ATC');

    expect(report.status).toBe('mismatch');
    expect(report.live.liveEdition).toBe('2027');
    expect(report.live.editionMatchesExpected).toBe(false);
  });

  it('reports status "mismatch" when the Copyright/Disclaimer page no longer contains the expected attribution pointer', async () => {
    mockAtcFixedEditionFetchResponses({
      licenseText: 'This page has moved, see our new legal page.',
    });

    const report = await verify('ATC');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });
});

// #557 DUO: a new 'github-release-file' entry, first source of §7.4 step 8
// ("Importar DUO, Uberon, NCBI Taxonomy, Cell Ontology e EDAM"). Unlike
// HPO/MONDO, EBISPOT/DUO's latest GitHub release (tag v2021-02-23) carries
// no attached release assets at all (`"assets":[]`, confirmed live via
// `gh api repos/EBISPOT/DUO/releases/latest`) — duo.owl lives checked into
// the repo tree itself (root-level, confirmed via the Contents API), not as
// a release download. So this still proves a release exists (tag_name/
// published_at from the releases API, same as HPO/MONDO), but proves the
// ontology file's presence via a HEAD check against its raw.githubusercontent
// .com URL instead of scanning `release.assets` for an expected name —
// combining github-release's release-metadata check with direct-download's
// HEAD-based asset check, neither existing kind alone. License is LICENSE.md
// at the repo root (spdx_id "NOASSERTION" like HPO, so verified by pointer
// text rather than SPDX id): "Creative Commons Attribution 4.0
// International", pointing at creativecommons.org/licenses/by/4.0/ — same
// durable URL-fragment pointer choice as ORPHA/MONDO.
function mockGithubReleaseFileFetchResponses({ tagName = 'v2021-02-23', fileOk = true, licenseText }) {
  global.fetch = vi.fn(async (url, options = {}) => {
    if (url.includes('/releases/latest')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ tag_name: tagName, published_at: '2021-02-23T19:26:13Z' }),
      };
    }
    if (url.includes('duo.owl')) {
      expect(options.method).toBe('HEAD');
      return { ok: fileOk, status: fileOk ? 200 : 404 };
    }
    if (url.includes('LICENSE.md')) {
      return { ok: true, status: 200, text: async () => licenseText };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe('verify-live-release.verify — DUO (github-release-file)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the release, repo-tracked file, and license pointer are all live', async () => {
    mockGithubReleaseFileFetchResponses({
      licenseText: 'Creative Commons Attribution 4.0 International License, http://creativecommons.org/licenses/by/4.0/',
    });

    const report = await verify('DUO');

    expect(report.status).toBe('verified');
    expect(report.live.releaseTag).toBe('v2021-02-23');
    expect(report.live.filePresent).toBe(true);
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.fixtureSource.systemUri).toBe('http://purl.obolibrary.org/obo/duo.owl');
  });

  it('reports status "mismatch" when the repo-tracked ontology file is no longer reachable', async () => {
    mockGithubReleaseFileFetchResponses({
      fileOk: false,
      licenseText: 'Creative Commons Attribution 4.0 International License, http://creativecommons.org/licenses/by/4.0/',
    });

    const report = await verify('DUO');

    expect(report.status).toBe('mismatch');
    expect(report.live.filePresent).toBe(false);
  });

  it('reports status "mismatch" when LICENSE.md no longer contains the expected CC BY 4.0 pointer', async () => {
    mockGithubReleaseFileFetchResponses({
      licenseText: 'License terms have moved, see our new legal page.',
    });

    const report = await verify('DUO');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });
});

// #557 UBERON: second source of §7.4 step 8. Back to the plain
// 'github-release' shape HPO/MONDO established — unlike DUO's sibling repo,
// obophenotype/uberon's latest release does carry an asset matching
// systemUri's basename (uberon.owl, confirmed live via `gh api
// repos/obophenotype/uberon/releases/latest`). GitHub reports this repo's
// license as spdx_id "NOASSERTION" too (same as HPO), but unlike HPO's
// LICENSE.md (a redirect pointer to an external page), this repo's LICENSE
// file carries the full plain-text CC BY 3.0 legal code directly — same
// "full legal text, not a redirect" shape MONDO's LICENSE file had, just a
// different (older, 3.0 Unported vs. 4.0 International) CC version.
function mockUberonFetchResponses({ releaseAssets = ['uberon.owl', 'uberon.json'], licenseText, tagName = 'v2026-06-23' }) {
  global.fetch = vi.fn(async (url) => {
    if (url.includes('/releases/latest')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: tagName,
          published_at: '2026-06-23T16:30:42Z',
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

describe('verify-live-release.verify — UBERON (github-release)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the expected asset and license pointer are both live', async () => {
    mockUberonFetchResponses({
      licenseText: 'Creative Commons Legal Code\n\nAttribution 3.0 Unported\n\n...',
    });

    const report = await verify('UBERON');

    expect(report.status).toBe('verified');
    expect(report.live.assetPresent).toBe(true);
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.live.releaseTag).toBe('v2026-06-23');
    expect(report.fixtureSource.systemUri).toBe('http://purl.obolibrary.org/obo/uberon.owl');
  });

  it('reports status "mismatch" when the expected release asset is missing', async () => {
    mockUberonFetchResponses({
      releaseAssets: ['uberon.json'],
      licenseText: 'Attribution 3.0 Unported',
    });

    const report = await verify('UBERON');

    expect(report.status).toBe('mismatch');
    expect(report.live.assetPresent).toBe(false);
  });

  it('reports status "mismatch" when the license text no longer contains the expected pointer', async () => {
    mockUberonFetchResponses({
      licenseText: 'License terms have moved, see our new legal page.',
    });

    const report = await verify('UBERON');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });
});

// #557 NCBITAX: a new 'rest-version' entry, third source of §7.4 step 8.
// dict-01_FONTES.md's SRC_NCBITAX row states auth "Não" (no auth) and
// "Atualização: Frequente" — genuinely public and continuously updated,
// similar in spirit to HGNC's 'rest-info' shape (no discrete releases/tags
// either), but the concrete live signal is different enough to need its own
// kind rather than reusing 'rest-info' as-is: the NCBI Datasets v2 REST API
// (the row's own "URL de download/API") exposes a dedicated
// `/datasets/v2/version` endpoint returning `{"version":"18.35.0",
// "major_ver":18,"minor_ver":35}` — a clean live API-version signal, a
// different field name/shape than HGNC's `lastModified` timestamp. License
// is NCBI's own sitewide "Copyright Status of Webpages" section (on
// ncbi.nlm.nih.gov/home/about/policies/), stating US-government content on
// the site is public domain — reused the same "sitewide policy page when no
// source-specific license URL exists" precedent ICD-10/DCB established.
function mockRestVersionFetchResponses({ version = '18.35.0', licenseText }) {
  global.fetch = vi.fn(async (url) => {
    if (url.includes('/datasets/v2/version')) {
      return { ok: true, status: 200, json: async () => ({ version, major_ver: 18, minor_ver: 35 }) };
    }
    if (url.includes('policies')) {
      return { ok: true, status: 200, text: async () => licenseText };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe('verify-live-release.verify — NCBITAX (rest-version)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the API reports a version and the license pointer is live', async () => {
    mockRestVersionFetchResponses({
      licenseText:
        'Information that is created by or for the US government on this site is within the public domain.',
    });

    const report = await verify('NCBITAX');

    expect(report.status).toBe('verified');
    expect(report.live.apiVersion).toBe('18.35.0');
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.fixtureSource.systemUri).toBe('http://purl.obolibrary.org/obo/ncbitaxon.owl');
  });

  it('reports status "mismatch" when the API no longer reports a version', async () => {
    mockRestVersionFetchResponses({
      version: null,
      licenseText:
        'Information that is created by or for the US government on this site is within the public domain.',
    });

    const report = await verify('NCBITAX');

    expect(report.status).toBe('mismatch');
    expect(report.live.apiVersion).toBeNull();
  });

  it('reports status "mismatch" when the policies page no longer contains the expected public-domain pointer', async () => {
    mockRestVersionFetchResponses({
      licenseText: 'Our policies have moved, see our new legal page.',
    });

    const report = await verify('NCBITAX');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });
});

// #557 CL: fourth source of §7.4 step 8, back to the plain 'github-release'
// shape (same as UBERON, its OBO Foundry sibling). obophenotype/cell-ontology
// 's latest release carries an asset matching systemUri's basename (cl.owl,
// confirmed via `gh api repos/obophenotype/cell-ontology/releases/latest`).
// Unlike HPO/UBERON, GitHub auto-detects this repo's license (spdx_id
// "CC-BY-4.0", matching sources/cl.js's 'Licença indicada no OBO Foundry'
// fixture note), and the LICENSE file itself carries the full plain-text CC
// BY 4.0 legal code directly — same "full legal text in the file, matched
// on 'Attribution 4.0 International'" shape MONDO's LICENSE had.
function mockClFetchResponses({ releaseAssets = ['cl.owl', 'cl.json'], licenseText, tagName = 'v2026-06-08' }) {
  global.fetch = vi.fn(async (url) => {
    if (url.includes('/releases/latest')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: tagName,
          published_at: '2026-06-08T14:53:12Z',
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

describe('verify-live-release.verify — CL (github-release)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the expected asset and license pointer are both live', async () => {
    mockClFetchResponses({
      licenseText: 'Attribution 4.0 International\n\n===...',
    });

    const report = await verify('CL');

    expect(report.status).toBe('verified');
    expect(report.live.assetPresent).toBe(true);
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.live.releaseTag).toBe('v2026-06-08');
    expect(report.fixtureSource.systemUri).toBe('http://purl.obolibrary.org/obo/cl.owl');
  });

  it('reports status "mismatch" when the expected release asset is missing', async () => {
    mockClFetchResponses({
      releaseAssets: ['cl.json'],
      licenseText: 'Attribution 4.0 International',
    });

    const report = await verify('CL');

    expect(report.status).toBe('mismatch');
    expect(report.live.assetPresent).toBe(false);
  });

  it('reports status "mismatch" when the license text no longer contains the expected pointer', async () => {
    mockClFetchResponses({
      licenseText: 'License terms have moved, see our new legal page.',
    });

    const report = await verify('CL');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });
});

// #557 EDAM: fifth and final source of §7.4 step 8, closing out RF028's
// Fase 2 live-verify pattern entirely. Another plain 'github-release' entry
// (same shape as MONDO/CL): edamontology/edamontology's latest release
// (tag 1.25.20260626T1230Z, a dated-and-timestamped tag rather than the
// obophenotype family's v-prefixed date, confirmed via `gh api
// repos/edamontology/edamontology/releases/latest`) carries an asset
// matching systemUri's basename (EDAM.owl). GitHub auto-detects this repo's
// license as CC-BY-SA-4.0 (the "ShareAlike" variant, unlike every other CC
// BY source in this loop), and the LICENSE file carries the full plain-text
// legal code directly, matched on "Attribution-ShareAlike 4.0
// International" — same "full legal text in the file" shape MONDO/CL had,
// just the SA variant's own distinct pointer phrase.
function mockEdamFetchResponses({ releaseAssets = ['EDAM.owl', 'changelog.md'], licenseText, tagName = '1.25.20260626T1230Z' }) {
  global.fetch = vi.fn(async (url) => {
    if (url.includes('/releases/latest')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: tagName,
          published_at: '2026-06-27T23:50:57Z',
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

describe('verify-live-release.verify — EDAM (github-release)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports status "verified" when the expected asset and license pointer are both live', async () => {
    mockEdamFetchResponses({
      licenseText: 'Attribution-ShareAlike 4.0 International\n\n===...',
    });

    const report = await verify('EDAM');

    expect(report.status).toBe('verified');
    expect(report.live.assetPresent).toBe(true);
    expect(report.live.licensePointerPresent).toBe(true);
    expect(report.live.releaseTag).toBe('1.25.20260626T1230Z');
    expect(report.fixtureSource.systemUri).toBe('http://edamontology.org/EDAM.owl');
  });

  it('reports status "mismatch" when the expected release asset is missing', async () => {
    mockEdamFetchResponses({
      releaseAssets: ['changelog.md'],
      licenseText: 'Attribution-ShareAlike 4.0 International',
    });

    const report = await verify('EDAM');

    expect(report.status).toBe('mismatch');
    expect(report.live.assetPresent).toBe(false);
  });

  it('reports status "mismatch" when the license text no longer contains the expected pointer', async () => {
    mockEdamFetchResponses({
      licenseText: 'License terms have moved, see our new legal page.',
    });

    const report = await verify('EDAM');

    expect(report.status).toBe('mismatch');
    expect(report.live.licensePointerPresent).toBe(false);
  });
});
