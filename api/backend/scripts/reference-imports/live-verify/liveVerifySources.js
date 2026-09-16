// #555/#556 (RF028/#550): live-source registry for the workflow_dispatch-only
// verify job. Deliberately separate from src/reference-data/reference-imports
// /sources/*.js — those stay pointed at the bundled fixture only, per
// reference-import-boundary.arch.test.js. HPO (#556, the pilot), MONDO,
// ORPHA, ICD-10/ICD-11, OMIM, HGNC, LOINC, UCUM, DCB, ATC, DUO, UBERON,
// NCBITAX, CL, and EDAM (#557) — all 16 Fase 2 sources are now populated,
// closing out RF028's live-verify build-loop (per docs-7-31-2026/3-
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
// verifyRestInfo's comment), or 'github-release-file' (DUO's shape: a real
// GitHub release exists via the releases API, but the release carries no
// attached assets — the ontology file lives checked into the repo tree
// itself, so asset presence is a HEAD check against its raw.githubusercontent
// .com URL instead of scanning release.assets; see
// verifyGithubReleaseFile's comment), or 'rest-version' (NCBI Taxonomy's
// shape: a genuinely public, continuously-updated REST API like HGNC's
// rest-info, but the live signal is a dedicated version endpoint returning
// an API-version string rather than a lastModified timestamp field; see
// verifyRestVersion's comment). Not every remaining source will fit one of
// these eight as-is — confirm live shape before assuming one of them covers
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
  // lesson) — ucum.org's is a plain
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
  // #557: confirmed live on 2026-08-13, first source of §7.4 step 7 ("Importar
  // DCB e ATC/DDD"). dict-01_FONTES.md's SRC_DCB "URL oficial"
  // (gov.br/anvisa/.../farmacopeia/dcb) 200s directly under Node's own
  // fetch() and its own page body embeds the current updating Instrução
  // Normativa inline ("Instrução Normativa – IN nº 342, de 20 de dezembro de
  // 2024"), so this is a third 'fixed-edition' entry — the IN number stands
  // in for ICD-10/UCUM's edition/version string. The page also links out to
  // the Anvisa Digital Library (bibliotecadigital.anvisa.gov.br) for the
  // actual consolidated-list download, which repeats LOINC's curl-vs-fetch()
  // split exactly (curl with a full browser User-Agent gets a clean 200;
  // Node's own fetch() 403s with a Cloudflare "Attention Required!"
  // challenge) — but that split doesn't block verification here, since the
  // release signal this entry checks lives entirely on the reachable
  // gov.br page, not the blocked library one. No DCB-specific license URL
  // exists (dict-01's SRC_DCB row: "Termos do portal oficial", no dedicated
  // link), so this reuses gov.br's own sitewide Terms of Use page
  // (gov.br/pt-br/termos-de-uso) — its footer carries a durable CC BY-ND 3.0
  // licence link, confirmed live to contain
  // "creativecommons.org/licenses/by-nd/3.0" — same "reuse the sitewide
  // terms page when no source-specific one exists" precedent ICD-10
  // established for WHO's Terms of Use page.
  DCB: {
    datasetCode: 'DCB',
    kind: 'fixed-edition',
    pageUrl: 'https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb',
    // [^\d,]+ (not \w+) for the month name — accented Portuguese month
    // names like "março" aren't matched by \w without the unicode flag.
    editionPattern: /IN nº (\d+), de \d+ de [^\d,]+ de \d{4}/,
    expectedEdition: '342',
    licenseUrl: 'https://www.gov.br/pt-br/termos-de-uso',
    expectedLicensePointer: 'creativecommons.org/licenses/by-nd/3.0',
  },
  // #557: confirmed live on 2026-08-13, closing out §7.4 step 7's "DCB e
  // ATC/DDD" pair. dict-01_FONTES.md's SRC_ATC "URL oficial"
  // (whocc.no/atc_ddd_index/) 301-redirects to the WHO Collaborating
  // Centre's actual current host (atcddd.fhi.no — the Centre moved to the
  // Norwegian Institute of Public Health) — Node's own fetch() follows the
  // redirect transparently, so this is a fifth 'fixed-edition' entry rather
  // than needing a new 'redirect-*' kind: fetchText() just returns the
  // final page's body, which carries a clean `<h1>ATC/DDD Index 2026</h1>`
  // heading, matching dict-01's own "Índice anual vigente" wording. License
  // is a dedicated Copyright/Disclaimer page (also redirected to
  // atcddd.fhi.no) with a durable plain-text attribution pointer ("WHO
  // Collaborating Centre for Drug Statistics Methodology, Oslo, Norway") —
  // avoiding the page's own mangled copyright-symbol glyph (an iso-8859-1
  // page decoded as UTF-8) as the match target, same "match a clean
  // adjacent phrase, not encoding-fragile punctuation" reasoning as every
  // prior license-pointer choice in this file. robots.txt (checked first,
  // both whocc.no's own and the redirected atcddd.fhi.no's) carries only a
  // generic `Crawl-Delay: 10`, no AI-crawler-specific disallow.
  ATC: {
    datasetCode: 'ATC',
    kind: 'fixed-edition',
    pageUrl: 'https://www.whocc.no/atc_ddd_index/',
    editionPattern: /ATC\/DDD Index (\d{4})/,
    expectedEdition: '2026',
    licenseUrl: 'https://www.whocc.no/copyright_disclaimer/',
    expectedLicensePointer: 'WHO Collaborating Centre for Drug Statistics Methodology, Oslo, Norway',
  },
  // #557: confirmed live on 2026-08-13, first source of §7.4 step 8
  // ("Importar DUO, Uberon, NCBI Taxonomy, Cell Ontology e EDAM"). Unlike
  // HPO/MONDO, EBISPOT/DUO's latest GitHub release (v2021-02-23, confirmed
  // via `gh api repos/EBISPOT/DUO/releases/latest`) carries no attached
  // release assets — duo.owl lives checked into the repo tree itself
  // (confirmed via the Contents API), not as a release download. A new
  // 'github-release-file' kind covers this: it still proves a release
  // exists via the releases API (same tag_name/published_at fields
  // github-release checks), but proves the ontology file's presence via a
  // HEAD check against its raw.githubusercontent.com URL instead of
  // scanning release.assets. License is LICENSE.md at the repo root
  // (spdx_id "NOASSERTION" like HPO, so verified by pointer text): "Creative
  // Commons Attribution 4.0 International", matched on the durable
  // creativecommons.org/licenses/by/4.0/ URL fragment.
  DUO: {
    datasetCode: 'DUO',
    kind: 'github-release-file',
    repo: 'EBISPOT/DUO',
    releaseApiUrl: 'https://api.github.com/repos/EBISPOT/DUO/releases/latest',
    fileUrl: 'https://raw.githubusercontent.com/EBISPOT/DUO/master/duo.owl',
    licenseUrl: 'https://raw.githubusercontent.com/EBISPOT/DUO/master/LICENSE.md',
    expectedLicensePointer: 'creativecommons.org/licenses/by/4.0',
  },
  // #557: confirmed live on 2026-08-13, second source of §7.4 step 8. Back
  // to the plain 'github-release' shape (unlike its sibling DUO):
  // obophenotype/uberon's latest release does carry an asset matching
  // systemUri's basename (uberon.owl, confirmed via `gh api
  // repos/obophenotype/uberon/releases/latest`). GitHub reports this repo's
  // license as spdx_id "NOASSERTION" (same as HPO), but unlike HPO's
  // LICENSE.md (an external redirect pointer), this repo's LICENSE file
  // carries the full plain-text CC BY 3.0 Unported legal code directly —
  // same "full legal text in the file itself" shape MONDO's LICENSE had,
  // just an older CC version (3.0 Unported vs. MONDO's 4.0 International).
  UBERON: {
    datasetCode: 'UBERON',
    repo: 'obophenotype/uberon',
    releaseApiUrl: 'https://api.github.com/repos/obophenotype/uberon/releases/latest',
    licenseUrl: 'https://raw.githubusercontent.com/obophenotype/uberon/master/LICENSE',
    expectedLicensePointer: 'Attribution 3.0 Unported',
    expectedAssetName: 'uberon.owl', // matches sources/uberon.js's systemUri basename
  },
  // #557: confirmed live on 2026-08-13, third source of §7.4 step 8.
  // dict-01_FONTES.md's SRC_NCBITAX row states auth "Não" and "Atualização:
  // Frequente" — genuinely public, no GitHub involved, and continuously
  // updated (no discrete releases/tags), similar in spirit to HGNC's
  // 'rest-info' shape but different enough in concrete signal to need its
  // own kind: the row's own "URL de download/API" (NCBI Datasets v2 REST
  // API) exposes a dedicated `/datasets/v2/version` endpoint returning a
  // live API-version string rather than a lastModified timestamp field.
  // Checked robots.txt first (ncbi.nlm.nih.gov) — only specific interactive
  // query endpoints (/Taxonomy/Selector, /Taxonomy/CommonTree, the ?term=
  // search form) are disallowed, no AI-crawler-specific block, and none of
  // those disallowed paths are touched by this entry. No NCBITAX-specific
  // license URL exists (dict-01's row: "Termos NCBI", no dedicated link),
  // so this reuses NCBI's own sitewide policies page — its "Copyright
  // Status of Webpages" section states US-government content on the site
  // is public domain — same "reuse the sitewide policy page when no
  // source-specific one exists" precedent ICD-10/DCB established.
  NCBITAX: {
    datasetCode: 'NCBITAX',
    kind: 'rest-version',
    versionUrl: 'https://api.ncbi.nlm.nih.gov/datasets/v2/version',
    licenseUrl: 'https://www.ncbi.nlm.nih.gov/home/about/policies/',
    expectedLicensePointer: 'created by or for the US government on this site is within the public domain',
  },
  // #557: confirmed live on 2026-08-13, fourth source of §7.4 step 8. Back
  // to the plain 'github-release' shape (same as UBERON, its OBO Foundry
  // sibling): obophenotype/cell-ontology's latest release carries an asset
  // matching systemUri's basename (cl.owl, confirmed via `gh api
  // repos/obophenotype/cell-ontology/releases/latest`). Unlike HPO/UBERON,
  // GitHub auto-detects this repo's license (spdx_id "CC-BY-4.0"), and the
  // LICENSE file itself carries the full plain-text CC BY 4.0 legal code
  // directly — same "full legal text in the file, matched on 'Attribution
  // 4.0 International'" shape MONDO's LICENSE had.
  CL: {
    datasetCode: 'CL',
    repo: 'obophenotype/cell-ontology',
    releaseApiUrl: 'https://api.github.com/repos/obophenotype/cell-ontology/releases/latest',
    licenseUrl: 'https://raw.githubusercontent.com/obophenotype/cell-ontology/master/LICENSE',
    expectedLicensePointer: 'Attribution 4.0 International',
    expectedAssetName: 'cl.owl', // matches sources/cl.js's systemUri basename
  },
  // #557: confirmed live on 2026-08-13, fifth and final source of §7.4 step
  // 8, closing out RF028's Fase 2 live-verify pattern entirely. Another
  // plain 'github-release' entry (same shape as MONDO/CL):
  // edamontology/edamontology's latest release (tag 1.25.20260626T1230Z, a
  // dated-and-timestamped tag rather than the obophenotype family's
  // v-prefixed date) carries an asset matching systemUri's basename
  // (EDAM.owl, confirmed via `gh api
  // repos/edamontology/edamontology/releases/latest`). GitHub auto-detects
  // this repo's license as CC-BY-SA-4.0 (the "ShareAlike" variant, unlike
  // every other CC BY source in this loop), and the LICENSE file carries
  // the full plain-text legal code directly, matched on
  // "Attribution-ShareAlike 4.0 International".
  EDAM: {
    datasetCode: 'EDAM',
    repo: 'edamontology/edamontology',
    releaseApiUrl: 'https://api.github.com/repos/edamontology/edamontology/releases/latest',
    licenseUrl: 'https://raw.githubusercontent.com/edamontology/edamontology/main/LICENSE',
    expectedLicensePointer: 'Attribution-ShareAlike 4.0 International',
    expectedAssetName: 'EDAM.owl', // matches sources/edam.js's systemUri basename
  },
};
