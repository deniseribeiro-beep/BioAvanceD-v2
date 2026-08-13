// #555/#556 (RF028/#550): live-source registry for the workflow_dispatch-only
// verify job. Deliberately separate from src/reference-data/reference-imports
// /sources/*.js — those stay pointed at the bundled fixture only, per
// reference-import-boundary.arch.test.js. HPO (#556, the pilot), MONDO,
// ORPHA, ICD-10/ICD-11, OMIM, HGNC, LOINC, and UCUM (#557) are populated so
// far; 7 sources remain, added here one entry at a time (per docs-7-31-2026/3-
// Plano_Integrado_Foundation_Data_Pipeline.md §7.4 "Ordem recomendada da
// Fase 2").
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
// see verifyFixedEdition's comment), 'not-live-verifiable' (OMIM's shape:
// unlike ICD-11/ICD-10, the entire public web domain is behind an
// interactive Cloudflare bot challenge and its own robots.txt disallows
// crawling — no automated request should even be attempted; see
// verifyNotLiveVerifiable's comment; LOINC reuses this same kind for a
// different pair of reasons — a Node-fetch()-specific Cloudflare challenge
// plus a robots.txt disallow directed at AI crawlers by name, not a
// domain-wide client-agnostic block), or 'rest-info' (HGNC's shape: a
// genuinely public, unauthenticated REST API with no discrete
// releases/tags/editions at all — the "release" signal is a live
// `lastModified` timestamp from a JSON info endpoint instead; see
// verifyRestInfo's comment). Not every remaining source will fit one of
// these six as-is — confirm live shape before assuming one of them covers
// it.
//
// releaseApiUrl/licenseUrl/expectedAssetName (or assetUrl/pageUrl/infoUrl
// for direct-download/fixed-edition/rest-info entries) confirmed live
// against the real upstream before being added — never assumed from
// training-data recall. HPO/MONDO: 2026-08-12/13 via `gh api repos/<org>/
// <repo>` + `.../releases/latest`. ORPHA: 2026-08-13 via curl against
// orphacode.org (no GitHub involved) — same verification discipline EDAM's
// #549 slice established. ICD-10: 2026-08-13 via curl against
// icd.who.int/browse10 and who.int/about/policies/terms-of-use. OMIM:
// 2026-08-13 via curl and WebFetch against omim.org/www.omim.org (all 403,
// `Cf-Mitigated: challenge`) and its robots.txt (200, explicit crawl
// disallow + auto-block warning) — a negative result, not a positive one,
// but confirmed live rather than assumed from the dict-01 row's
// "Chave/API/licença" auth note alone. HGNC: 2026-08-13 via curl against
// rest.genenames.org/info (with and without an explicit `Accept:
// application/json` header — it silently 200s with XML unless that header
// is sent) and www.genenames.org/about/ (its "Data release policy"
// section). LOINC: 2026-08-13 via curl and Node's own fetch() against
// loinc.org's /downloads, /license, /kb/versioning pages (curl 200s all
// three with a browser User-Agent; Node fetch() 403s all three with a
// Cloudflare interactive challenge even given a full browser header set)
// and its robots.txt (200, explicit `Disallow: /` for `ClaudeBot` and other
// named AI crawlers specifically, `Allow: /` for generic User-agent: *) —
// a negative result for the sanctioned fetchText/fetchJson client, same as
// OMIM, but for reasons specific to this source rather than assumed from
// OMIM's precedent. UCUM: 2026-08-13 via curl (robots.txt, checked first
// per LOINC's own lesson) and Node's fetch() against ucum.org/ucum (200,
// no Cloudflare challenge, unlike its sibling loinc.org) and
// ucum.org/license.
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
  // #557: confirmed live on 2026-08-13. dict-01_FONTES.md's SRC_HGNC row
  // states "Não ou conforme endpoint" for auth — genenames.org's REST API
  // (rest.genenames.org) is genuinely public with no key/token anywhere.
  // Unlike every prior source in this group, HGNC has no discrete
  // releases/tags/editions to check at all: the row's own "Atualização"
  // value is "Contínua" (continuous), and `GET rest.genenames.org/info`
  // confirms this directly — it returns a live `lastModified` timestamp
  // (currently 2026-08-11) and a `numDoc` record count (currently 46832)
  // rather than any versioned identifier. That request only returns valid
  // JSON when it sends an explicit `Accept: application/json` header
  // (confirmed via curl both with and without one — without it, or with
  // GitHub's `application/vnd.github+json`, the endpoint silently 200s with
  // an XML body instead). License is on genenames.org's own "About" page
  // (https://www.genenames.org/about/), in a "Data release policy" section
  // reading "No restrictions are imposed on access to, or use of, the data
  // provided by the HGNC" — no separate LICENSE file, PDF, or CC-style badge
  // the way HPO/MONDO/ORPHA have.
  HGNC: {
    datasetCode: 'HGNC',
    kind: 'rest-info',
    infoUrl: 'https://rest.genenames.org/info',
    licenseUrl: 'https://www.genenames.org/about/',
    expectedLicensePointer: 'No restrictions are imposed on access to, or use of, the data provided by the HGNC',
  },
  // #557: confirmed live on 2026-08-13, first source of §7.4 step 6 ("Importar
  // LOINC e UCUM"). dict-01_FONTES.md's SRC_LOINC row lists auth as "Cadastro/
  // chave conforme acesso" (registration/key per access) — and unlike HGNC's
  // identically-worded-sounding row, that note is accurate here: loinc.org's
  // /downloads, /license, /kb/versioning pages themselves carry the version
  // table and license text unauthenticated (a browser-UA'd curl 200s all
  // three), but every one of them 403s under Node's own `fetch()` with a
  // genuine interactive Cloudflare "Just a moment..." challenge
  // (`Cf-Mitigated: challenge`), confirmed with a full realistic browser
  // header set (User-Agent, Accept, Accept-Language, Sec-Fetch-*) — not a
  // simple User-Agent string check the way bare-curl's default UA failure
  // was for HGNC/ICD-11. Separately and more fundamentally, loinc.org's own
  // robots.txt explicitly disallows `ClaudeBot` (alongside GPTBot,
  // Google-Extended, CCBot, Bytespider, Applebot-Extended, meta-externalagent,
  // Amazonbot) site-wide via `Disallow: /`, while `User-agent: *` stays
  // `Allow: /` — a directed opt-out of AI-crawler access specifically, not
  // the generic "no automated access at all" shape OMIM's robots.txt had.
  // Both facts independently rule out a real fetch() attempt here: the
  // sanctioned client (fetchText/fetchJson, which only wrap global fetch)
  // cannot pass the challenge regardless of headers, and even if it could,
  // continuing to request the site would run against its explicit
  // ClaudeBot disallow. Same 'not-live-verifiable' shape as OMIM — no
  // fetch() attempted for this entry at all — for a different pair of
  // reasons than OMIM's domain-wide, client-agnostic block.
  LOINC: {
    datasetCode: 'LOINC',
    kind: 'not-live-verifiable',
    reason:
      "loinc.org's /downloads, /license, and /kb/versioning pages 403 under Node's fetch() with a genuine " +
      'interactive Cloudflare challenge (Cf-Mitigated: challenge) even with a full realistic browser header set, ' +
      "and the site's own robots.txt explicitly disallows ClaudeBot (Disallow: /) alongside other AI crawlers " +
      '(GPTBot, Google-Extended, CCBot, and others), while generic User-agent: * stays Allow: /. Confirmed live 2026-08-13.',
  },
  // #557: confirmed live on 2026-08-13, closing out §7.4 step 6's "LOINC e
  // UCUM" pair. Checked robots.txt first this time (per LOINC's own
  // lesson, filed as dyeallpies-skills-pack#269) — ucum.org's is a plain
  // `Disallow: /wp/wp-admin/` only, no AI-crawler-specific block, and
  // Node's own fetch() 200s the spec page directly with no Cloudflare
  // challenge (unlike loinc.org, despite sharing the same steward —
  // ucum.org's copyright footer names Regenstrief Institute, Inc. too, and
  // its own nav links to loinc.org/ucum.org/regenstrief.org as sibling
  // sites — so the two domains evidently run different bot-protection
  // configs). dict-01_FONTES.md's SRC_UCUM row states auth as "Não" (no
  // auth) — accurate, and the simplest of this group's auth notes so far.
  // The spec page (https://ucum.org/ucum) is a 'fixed-edition' shape like
  // ICD-10: it 200s directly and carries a clean `<p>Version: 2.2</p>` in
  // its own header block (no releases API, no redirect). License is a
  // dedicated page (https://ucum.org/license, linked from the spec page's
  // own site nav and its in-page license section) with the copyright
  // notice "1999-2024, Regenstrief Institute, Inc." as a durable,
  // contiguous plain-text pointer.
  UCUM: {
    datasetCode: 'UCUM',
    kind: 'fixed-edition',
    pageUrl: 'https://ucum.org/ucum',
    editionPattern: /<p>Version: ([^<]+)<\/p>/,
    expectedEdition: '2.2',
    licenseUrl: 'https://ucum.org/license',
    expectedLicensePointer: '1999-2024, Regenstrief Institute, Inc.',
  },
};
