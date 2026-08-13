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
