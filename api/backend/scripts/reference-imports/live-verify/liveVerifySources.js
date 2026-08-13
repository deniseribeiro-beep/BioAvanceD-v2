// #555/#556 (RF028/#550): live-source registry for the workflow_dispatch-only
// verify job. Deliberately separate from src/reference-data/reference-imports
// /sources/*.js — those stay pointed at the bundled fixture only, per
// reference-import-boundary.arch.test.js. HPO (#556, the pilot), MONDO,
// ORPHA, ICD-10/ICD-11, and OMIM (#557) are populated so far; 10 sources
// remain, added here one entry at a time (per docs-7-31-2026/3-Plano_
// Integrado_Foundation_Data_Pipeline.md §7.4 "Ordem recomendada da Fase 2").
//
// Each entry carries a `kind` deciding which verification shape
// verify-live-release.js runs: 'github-release' (default, omittable — HPO/
// MONDO's shape: GitHub releases API + a LICENSE file/page reachable by
// URL), 'direct-download' (ORPHA's shape: a stable direct file URL with no
// releases API, license stated on the download's own landing page — see
// verifyDirectDownload's comment in verify-live-release.js), 'redirect-
// version' (ICD-11's shape: the actual WHO ICD API is OAuth/API-key gated,
// but its public browser exposes the release via a redirect target instead
// of a releases API — see verifyRedirectVersion's comment), 'fixed-
// edition' (ICD-10's shape: also WHO-hosted, but the "URL oficial" is a
// fixed-edition browse page rather than a "latest" redirect — the edition is
// read out of the page body itself, and no source-specific license document
// was found live, so it reuses WHO's sitewide Terms of Use page instead —
// see verifyFixedEdition's comment), or 'not-live-verifiable' (OMIM's shape:
// unlike ICD-11/ICD-10, the entire public web domain is behind an
// interactive Cloudflare bot challenge and its own robots.txt disallows
// crawling — no automated request should even be attempted; see
// verifyNotLiveVerifiable's comment). Not every remaining source will fit
// one of these five as-is — confirm live shape before assuming one of them
// covers it.
//
// releaseApiUrl/licenseUrl/expectedAssetName (or assetUrl/pageUrl for
// direct-download/fixed-edition entries) confirmed live against the real
// upstream before being added — never assumed from training-data recall.
// HPO/MONDO: 2026-08-12/13 via `gh api repos/<org>/<repo>` + `.../releases/
// latest`. ORPHA: 2026-08-13 via curl against orphacode.org (no GitHub
// involved) — same verification discipline EDAM's #549 slice established.
// ICD-10: 2026-08-13 via curl against icd.who.int/browse10 and
// who.int/about/policies/terms-of-use. OMIM: 2026-08-13 via curl and
// WebFetch against omim.org/www.omim.org (all 403, `Cf-Mitigated:
// challenge`) and its robots.txt (200, explicit crawl disallow + auto-block
// warning) — a negative result, not a positive one, but confirmed live
// rather than assumed from the dict-01 row's "Chave/API/licença" auth note
// alone.
module.exports = {
  HPO: {
    datasetCode: 'HPO',
    repo: 'obophenotype/human-phenotype-ontology',
    releaseApiUrl: 'https://api.github.com/repos/obophenotype/human-phenotype-ontology/releases/latest',
    licenseUrl: 'https://raw.githubusercontent.com/obophenotype/human-phenotype-ontology/master/LICENSE.md',
    // GitHub reports license.spdx_id "NOASSERTION" for this repo — LICENSE.md
    // itself points at https://hpo.jax.org/app/license for the real terms,
    // so verification here checks the pointer text is present, not an SPDX id.
    expectedLicensePointer: 'hpo.jax.org/app/license',
    expectedAssetName: 'hp.owl', // matches sources/hpo.js's systemUri basename
  },
  // #557: confirmed live against GitHub on 2026-08-13 (gh api
  // repos/monarch-initiative/mondo and .../releases/latest). Unlike HPO,
  // GitHub auto-detects this repo's license (spdx_id "CC-BY-4.0", matching
  // sources/mondo.js's 'CC BY 4.0' fixture license exactly), so the LICENSE
  // file's full legal text is the pointer target rather than a redirect page.
  MONDO: {
    datasetCode: 'MONDO',
    repo: 'monarch-initiative/mondo',
    releaseApiUrl: 'https://api.github.com/repos/monarch-initiative/mondo/releases/latest',
    licenseUrl: 'https://raw.githubusercontent.com/monarch-initiative/mondo/master/LICENSE',
    expectedLicensePointer: 'Attribution 4.0 International',
    expectedAssetName: 'mondo.owl', // matches sources/mondo.js's systemUri basename
  },
  // #557: confirmed live on 2026-08-13 against orphacode.org directly (curl
  // -I on the pack URL, curl on the pack-nomenclature landing page). No
  // GitHub involved and no version in the pack's filename (SRC_ORPHA in
  // dict-01_FONTES.md: "Download/API", pack updated annually in place) — the
  // HEAD request's Last-Modified header (currently 2026-07-02, this year's
  // pack) is the only release-date signal available, so this is the
  // 'direct-download' kind rather than 'github-release'.
  ORPHA: {
    datasetCode: 'ORPHA',
    kind: 'direct-download',
    assetUrl: 'https://www.orphacode.org/data/packs/Orphanet_Nomenclature_Pack_EN.zip',
    licenseUrl: 'https://www.orphacode.org/pack-nomenclature/',
    // The landing page links CC BY 4.0 as "CC BY 4.0 licence" pointing at
    // creativecommons.org/licenses/by/4.0 — matching sources/orpha.js's
    // 'CC BY 4.0' fixture license. Matching the URL fragment rather than the
    // surrounding marketing prose, same durability reasoning as HPO's
    // pointer choice.
    expectedLicensePointer: 'creativecommons.org/licenses/by/4.0',
  },
  // #557: confirmed live on 2026-08-13. The WHO ICD API itself
  // (icd.who.int/icdapi) requires OAuth2 client-credentials per
  // dict-01_FONTES.md's SRC_ICD11 row, but the public browser is
  // unauthenticated: `GET /browse/latest-release/mms/en` 302s to the
  // current release's own path (curl -sD- -L confirmed `Location:
  // /browse/2026-01/mms/en`; HEAD isn't usable, that path 405s on HEAD).
  // License is a WHO-hosted PDF linked from icd.who.int/en as "ICD-11
  // License" rather than a LICENSE file/landing-page link; its raw bytes
  // decode (via fetchText's UTF-8 .text()) with "World Health Organization"
  // intact as plain ASCII in the PDF's uncompressed outline metadata.
  ICD11: {
    datasetCode: 'ICD11',
    kind: 'redirect-version',
    releaseUrl: 'https://icd.who.int/browse/latest-release/mms/en',
    versionPattern: /\/browse\/([^/]+)\/mms/,
    licenseUrl: 'https://icd.who.int/en/docs/ICD11-license.pdf',
    expectedLicensePointer: 'World Health Organization',
  },
  // #557: confirmed live on 2026-08-13. Unlike ICD-11's "latest" redirect,
  // dict-01_FONTES.md's SRC_ICD10 "URL oficial" is a fixed-edition browse
  // page (https://icd.who.int/browse10/2019/en) — it 200s directly, and the
  // edition ("2019") is embedded in the page body itself (`<title>ICD-10
  // Version:2019</title>`), not a redirect target. No ICD-10-specific
  // license document was found live: the browse page carries no license
  // text, and the one PDF it links (the Instruction Manual) is compressed,
  // so fetchText()'s plain UTF-8 decode doesn't surface readable pointer
  // text from it the way it did for ICD-11's uncompressed license PDF.
  // SRC_ICD10's own Licenciamento value is the generic "Termos WHO/edição
  // nacional" with no source-specific URL given (unlike SRC_ICD11's
  // dedicated PDF), so this reuses WHO's sitewide Terms of Use page as the
  // license-bearing surface — confirmed live to contain "Copyright World
  // Health Organization (WHO)" in actual prose.
  ICD10: {
    datasetCode: 'ICD10',
    kind: 'fixed-edition',
    pageUrl: 'https://icd.who.int/browse10/2019/en',
    editionPattern: /ICD-10 Version:(\d{4})/,
    expectedEdition: '2019',
    licenseUrl: 'https://www.who.int/about/policies/terms-of-use',
    expectedLicensePointer: 'Copyright World Health Organization (WHO)',
  },
  // #557: confirmed live on 2026-08-13, closing out the "ORPHA, CID-11,
  // CID-10 e OMIM" group. Unlike ICD-11/ICD-10 (an OAuth/API-key-gated API
  // with a still-public browse surface), omim.org's entire public web
  // domain 403s with an interactive Cloudflare bot challenge
  // (`Cf-Mitigated: challenge`) on every path tried — `/`, `/help/api`,
  // `/downloads`, `/about`, both `omim.org` and `www.omim.org`, with a
  // browser User-Agent — and the domain's own robots.txt (itself not
  // challenge-gated, 200 OK) explicitly disallows crawling and warns it
  // auto-blocks IPs that request pages. dict-01_FONTES.md's SRC_OMIM row's
  // "Chave/API/licença" auth note predicted the *API* needs credentials,
  // same as ICD-11's OAuth note did before its public browse surface turned
  // out to be open — but here the whole domain, not just the API, is
  // walled, and its own crawl policy says not to try. This is the first
  // Fase 2 source genuinely needing the "not live-verifiable without
  // credentials" carve-out anticipated since ICD-11/ICD-10 (see
  // verifyNotLiveVerifiable's comment in verify-live-release.js) — no
  // fetch() is attempted for this entry at all.
  OMIM: {
    datasetCode: 'OMIM',
    kind: 'not-live-verifiable',
    reason:
      'omim.org (both apex and www) returns HTTP 403 with a Cloudflare interactive bot challenge ' +
      '(Cf-Mitigated: challenge) on every page tried (/, /help/api, /downloads, /about), and its own ' +
      'robots.txt explicitly disallows crawling and warns of automatic IP blocking. Confirmed live 2026-08-13.',
  },
};
