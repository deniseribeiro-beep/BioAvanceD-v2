const path = require('path');
const { fetchJson, fetchText, sha256Hex } = require('./fetchLiveRelease');
const LIVE_SOURCES = require('./liveVerifySources');

// #555/#556 (RF028/#550): reports whether a source's real upstream release
// and license are reachable and match what its fixture-based source config
// (src/reference-data/reference-imports/sources/<code>.js) already declares.
// Verification-only — never writes to Mongo, never touches the operational
// fixture-based import pipeline. Run via `npm run reference:live-verify:<code>`
// or the reference-data-live-verify.yml workflow_dispatch job.

async function verify(datasetCode) {
  const entry = LIVE_SOURCES[datasetCode];
  if (!entry) {
    throw new Error(
      `No live-verify entry for "${datasetCode}" yet (see #557 for the remaining sources). Known: ${Object.keys(LIVE_SOURCES).join(', ')}`,
    );
  }

  const fixtureSource = require(
    path.join('..', '..', '..', 'src', 'reference-data', 'reference-imports', 'sources', datasetCode.toLowerCase()),
  );

  const release = await fetchJson(entry.releaseApiUrl);
  const assetNames = Array.isArray(release.assets) ? release.assets.map((asset) => asset.name) : [];
  const assetPresent = assetNames.includes(entry.expectedAssetName);

  const licenseText = await fetchText(entry.licenseUrl);
  const licenseChecksum = sha256Hex(licenseText);
  const licensePointerPresent = licenseText.includes(entry.expectedLicensePointer);

  const verifiedAt = new Date().toISOString();
  const status = assetPresent && licensePointerPresent ? 'verified' : 'mismatch';

  return {
    datasetCode,
    verifiedAt,
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
    fixtureSource: {
      systemUri: fixtureSource.systemUri,
      license: fixtureSource.license,
      licenseUri: fixtureSource.licenseUri,
    },
  };
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
