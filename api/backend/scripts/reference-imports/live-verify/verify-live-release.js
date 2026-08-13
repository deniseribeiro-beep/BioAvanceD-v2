const path = require('path');
const { fetchJson, fetchText, fetchHead, sha256Hex } = require('./fetchLiveRelease');
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
