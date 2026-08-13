const path = require('path');
const { fetchJson, fetchText, fetchHead, fetchRedirectTarget, sha256Hex } = require('./fetchLiveRelease');
const LIVE_SOURCES = require('./liveVerifySources');

// #555/#556 (RF028/#550): reports whether a source's real upstream release
// and license are reachable and match what its fixture-based source config
// (src/reference-data/reference-imports/sources/<code>.js) already declares.
// Verification-only — never writes to Mongo, never touches the operational
// fixture-based import pipeline. Run via `npm run reference:live-verify:<code>`
// or the reference-data-live-verify.yml workflow_dispatch job.

function loadFixtureSource(datasetCode) {
  const fixtureSource = require(
    path.join('..', '..', '..', 'src', 'reference-data', 'reference-imports', 'sources', datasetCode.toLowerCase()),
  );
  return {
    systemUri: fixtureSource.systemUri,
    license: fixtureSource.license,
    licenseUri: fixtureSource.licenseUri,
  };
}

// HPO/MONDO shape: upstream is a GitHub repo with a releases API and a
// LICENSE file/page reachable by URL.
async function verifyGithubRelease(datasetCode, entry, fixtureSource) {
  const release = await fetchJson(entry.releaseApiUrl);
  const assetNames = Array.isArray(release.assets) ? release.assets.map((asset) => asset.name) : [];
  const assetPresent = assetNames.includes(entry.expectedAssetName);

  const licenseText = await fetchText(entry.licenseUrl);
  const licenseChecksum = sha256Hex(licenseText);
  const licensePointerPresent = licenseText.includes(entry.expectedLicensePointer);

  const status = assetPresent && licensePointerPresent ? 'verified' : 'mismatch';

  return {
    datasetCode,
    verifiedAt: new Date().toISOString(),
    status,
    live: {
      repo: entry.repo,
      releaseTag: release.tag_name,
      releasePublishedAt: release.published_at,
      expectedAssetName: entry.expectedAssetName,
      assetPresent,
      licenseUrl: entry.licenseUrl,
      licenseChecksum,
      licensePointerPresent,
    },
    fixtureSource,
  };
}

// ORPHA shape (#557): upstream has no GitHub releases API — the Orphanet
// Nomenclature Pack is a direct file download at a stable (unversioned)
// URL, and the license is stated on the pack's landing page rather than a
// separate LICENSE file. "Release" here is proven by the download actually
// resolving (HEAD 200), with the Last-Modified header standing in for a
// GitHub release's tag/published_at since no such field exists upstream.
async function verifyDirectDownload(datasetCode, entry, fixtureSource) {
  const head = await fetchHead(entry.assetUrl);

  const licenseText = await fetchText(entry.licenseUrl);
  const licenseChecksum = sha256Hex(licenseText);
  const licensePointerPresent = licenseText.includes(entry.expectedLicensePointer);

  const status = head.ok && licensePointerPresent ? 'verified' : 'mismatch';

  return {
    datasetCode,
    verifiedAt: new Date().toISOString(),
    status,
    live: {
      assetUrl: entry.assetUrl,
      assetPresent: head.ok,
      assetLastModified: head.headers.get('last-modified'),
      licenseUrl: entry.licenseUrl,
      licenseChecksum,
      licensePointerPresent,
    },
    fixtureSource,
  };
}

// ICD-11 shape (#557): the WHO ICD API itself is OAuth/API-key gated per
// dict-01_FONTES.md's SRC_ICD11 row, but the public browser at icd.who.int
// isn't — `/browse/latest-release/mms/en` is a stable, unauthenticated URL
// that 302s to the current release's own path (e.g. `/browse/2026-01/mms/
// en`), so the release identifier is the redirect target itself rather than
// a releases-API field or a Last-Modified header. License is a WHO-hosted
// PDF (`ICD11-license.pdf`, linked from icd.who.int/en as "ICD-11 License")
// rather than a LICENSE file or landing-page link — confirmed live 2026-08-13
// that fetchText()'s UTF-8 decode still surfaces plain-ASCII pointer text
// (e.g. "World Health Organization") from the PDF's uncompressed metadata,
// so the same substring-match approach the other two shapes use still works
// here without a PDF parser.
async function verifyRedirectVersion(datasetCode, entry, fixtureSource) {
  const redirect = await fetchRedirectTarget(entry.releaseUrl);
  const versionMatch = redirect.url.match(entry.versionPattern);
  const releaseVersion = versionMatch ? versionMatch[1] : null;

  const licenseText = await fetchText(entry.licenseUrl);
  const licenseChecksum = sha256Hex(licenseText);
  const licensePointerPresent = licenseText.includes(entry.expectedLicensePointer);

  const status = redirect.ok && releaseVersion && licensePointerPresent ? 'verified' : 'mismatch';

  return {
    datasetCode,
    verifiedAt: new Date().toISOString(),
    status,
    live: {
      releaseUrl: entry.releaseUrl,
      redirectedTo: redirect.url,
      releaseVersion,
      licenseUrl: entry.licenseUrl,
      licenseChecksum,
      licensePointerPresent,
    },
    fixtureSource,
  };
}

// ICD-10 shape (#557): unlike ICD-11's "latest" URL, ICD-10's dict-01_FONTES.md
// "URL oficial" (https://icd.who.int/browse10/2019/en) is a fixed-edition
// browse page — it 200s directly with no redirect, and the edition ("2019")
// is baked into the URL/page body rather than exposed by a redirects target,
// releases API, or Last-Modified header. Confirmed live 2026-08-13: the page
// is a client-rendered SPA shell with the edition present twice in static
// markup (`<title>ICD-10 Version:2019</title>` and `oInfo.ontologyKey =
// "2019"`), so `editionPattern` extracts it the same substring-match way
// redirect-version reads a release off a redirect target. No ICD-10-specific
// license document was found live (the page itself carries no license text,
// and the only PDF linked from it — the Instruction Manual — is compressed,
// so fetchText()'s naive UTF-8 decode doesn't surface plain-ASCII pointer
// text from it the way it did for ICD-11's uncompressed license PDF).
// dict-01_FONTES.md's own Licenciamento value for SRC_ICD10 is the generic
// "Termos WHO/edição nacional" (no source-specific URL given, unlike
// SRC_ICD11's dedicated license PDF), so this reuses WHO's sitewide Terms of
// Use page (who.int/about/policies/terms-of-use) as the license-bearing
// surface — confirmed live to contain the plain-text pointer "Copyright
// World Health Organization (WHO)" in actual prose, not just page metadata.
async function verifyFixedEdition(datasetCode, entry, fixtureSource) {
  const pageText = await fetchText(entry.pageUrl);
  const editionMatch = pageText.match(entry.editionPattern);
  const liveEdition = editionMatch ? editionMatch[1] : null;
  const editionMatchesExpected = liveEdition === entry.expectedEdition;

  const licenseText = await fetchText(entry.licenseUrl);
  const licenseChecksum = sha256Hex(licenseText);
  const licensePointerPresent = licenseText.includes(entry.expectedLicensePointer);

  const status = editionMatchesExpected && licensePointerPresent ? 'verified' : 'mismatch';

  return {
    datasetCode,
    verifiedAt: new Date().toISOString(),
    status,
    live: {
      pageUrl: entry.pageUrl,
      liveEdition,
      expectedEdition: entry.expectedEdition,
      editionMatchesExpected,
      licenseUrl: entry.licenseUrl,
      licenseChecksum,
      licensePointerPresent,
    },
    fixtureSource,
  };
}

// OMIM shape (#557): unlike ICD-11/ICD-10 (the WHO ICD API is gated, but a
// public unauthenticated page still exposes a release/license signal),
// omim.org's entire public web domain sits behind an interactive
// Cloudflare bot challenge on every path tried — root, /help/api,
// /downloads, /about, on both omim.org and www.omim.org — returning HTTP
// 403 with a `Cf-Mitigated: challenge` header regardless of User-Agent
// (confirmed live 2026-08-13). The domain's own robots.txt (which itself
// isn't challenge-gated) explicitly disallows crawling and warns it will
// auto-block IPs that request pages. No JS-executing client is available
// to this script (or the workflow_dispatch job that runs it), and
// attempting one would violate the site's own robots.txt disallow for no
// benefit — every request would just reproduce the 403, not produce a
// meaningful mismatch signal. This is a genuine "not live-verifiable
// without solving an interactive bot challenge" case, not an OAuth/
// API-key gate resolvable via a redirect-version/fixed-edition-style
// public surface like ICD-11/ICD-10's. Reports 'not-verifiable' directly,
// without calling fetch() at all.
async function verifyNotLiveVerifiable(datasetCode, entry, fixtureSource) {
  return {
    datasetCode,
    verifiedAt: new Date().toISOString(),
    status: 'not-verifiable',
    live: {
      reason: entry.reason,
    },
    fixtureSource,
  };
}

// HGNC shape (#557): dict-01_FONTES.md's SRC_HGNC row lists auth as "Não ou
// conforme endpoint" (no auth, or per-endpoint) — genenames.org's REST API
// (rest.genenames.org/info) turns out to be a genuinely public,
// unauthenticated JSON endpoint. Unlike HPO/MONDO/ORPHA/ICD-11/ICD-10, HGNC
// has no discrete releases/tags/editions at all — dict-01's own
// "Atualização" value for this row is "Contínua" (continuous), matching
// what the endpoint actually reports: a live `lastModified` timestamp and
// `numDoc` record count rather than a version string. Confirmed live
// 2026-08-13 that the endpoint 200s with valid JSON *only* when the request
// sends an explicit `Accept: application/json` header — without one (or
// with GitHub's `application/vnd.github+json`, fetchJson's existing
// default), it silently 200s with XML instead, which would break
// response.json() the same way an HTTP error would, just less obviously.
// License is on genenames.org's own "About" page, in a "Data release
// policy" section — no separate LICENSE file/PDF/CC badge — stating "No
// restrictions are imposed on access to, or use of, the data provided by
// the HGNC".
async function verifyRestInfo(datasetCode, entry, fixtureSource) {
  const info = await fetchJson(entry.infoUrl, { Accept: 'application/json' });

  const licenseText = await fetchText(entry.licenseUrl);
  const licenseChecksum = sha256Hex(licenseText);
  const licensePointerPresent = licenseText.includes(entry.expectedLicensePointer);

  const status = Boolean(info.lastModified) && licensePointerPresent ? 'verified' : 'mismatch';

  return {
    datasetCode,
    verifiedAt: new Date().toISOString(),
    status,
    live: {
      infoUrl: entry.infoUrl,
      lastModified: info.lastModified,
      numDoc: info.numDoc,
      licenseUrl: entry.licenseUrl,
      licenseChecksum,
      licensePointerPresent,
    },
    fixtureSource,
  };
}

// DUO shape (#557): the GitHub releases API confirms a real release exists
// (tag_name/published_at, same fields github-release checks), but unlike
// HPO/MONDO the latest release carries no attached assets at all — the
// ontology file (duo.owl) lives checked into the repo tree itself rather
// than as a release download. So the "asset present" proof is a HEAD check
// against the file's raw.githubusercontent.com URL (direct-download's
// technique) instead of scanning release.assets for an expected name
// (github-release's technique) — this kind combines both rather than
// reusing either alone.
async function verifyGithubReleaseFile(datasetCode, entry, fixtureSource) {
  const release = await fetchJson(entry.releaseApiUrl);

  const fileHead = await fetchHead(entry.fileUrl);

  const licenseText = await fetchText(entry.licenseUrl);
  const licenseChecksum = sha256Hex(licenseText);
  const licensePointerPresent = licenseText.includes(entry.expectedLicensePointer);

  const status = fileHead.ok && licensePointerPresent ? 'verified' : 'mismatch';

  return {
    datasetCode,
    verifiedAt: new Date().toISOString(),
    status,
    live: {
      repo: entry.repo,
      releaseTag: release.tag_name,
      releasePublishedAt: release.published_at,
      fileUrl: entry.fileUrl,
      filePresent: fileHead.ok,
      licenseUrl: entry.licenseUrl,
      licenseChecksum,
      licensePointerPresent,
    },
    fixtureSource,
  };
}

async function verify(datasetCode) {
  const entry = LIVE_SOURCES[datasetCode];
  if (!entry) {
    throw new Error(
      `No live-verify entry for "${datasetCode}" yet (see #557 for the remaining sources). Known: ${Object.keys(LIVE_SOURCES).join(', ')}`,
    );
  }

  const fixtureSource = loadFixtureSource(datasetCode);

  if (entry.kind === 'direct-download') {
    return verifyDirectDownload(datasetCode, entry, fixtureSource);
  }
  if (entry.kind === 'redirect-version') {
    return verifyRedirectVersion(datasetCode, entry, fixtureSource);
  }
  if (entry.kind === 'fixed-edition') {
    return verifyFixedEdition(datasetCode, entry, fixtureSource);
  }
  if (entry.kind === 'not-live-verifiable') {
    return verifyNotLiveVerifiable(datasetCode, entry, fixtureSource);
  }
  if (entry.kind === 'rest-info') {
    return verifyRestInfo(datasetCode, entry, fixtureSource);
  }
  if (entry.kind === 'github-release-file') {
    return verifyGithubReleaseFile(datasetCode, entry, fixtureSource);
  }
  return verifyGithubRelease(datasetCode, entry, fixtureSource);
}

async function main() {
  const datasetCode = (process.argv[2] || '').toUpperCase();
  if (!datasetCode) {
    console.error('Usage: node verify-live-release.js <DATASET_CODE>');
    process.exit(1);
  }

  const report = await verify(datasetCode);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'verified') {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { verify };
