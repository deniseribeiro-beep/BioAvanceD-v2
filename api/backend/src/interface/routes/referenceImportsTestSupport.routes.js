const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const router = express.Router();
const { STORAGE_BASE } = require('../../config/uploadConfig');
const { testSupportRoutesEnabled, requireTestSupportSecret } = require('../../utils/testSupportGate');

// Test-support only, RF028/RNF032 (#1476): reference imports run only in the
// stack's one-shot bootstrap jobs, so no HTTP call can create a fresh
// `approved` release for pipeline-continuity.spec.ts to promote and roll
// back, and promoting or rolling back a bootstrapped dataset (HPO) on
// persistent volumes would break every test that relies on it. Same answer
// as the RF029 ingestion probe (#669, #675) and the telemetry monitor (#307):
// a route gated by testSupportRoutesEnabled() and requireTestSupportSecret
// that calls the real runImport() (real Mongo writes, the real preserved
// asset) on demand. It only ever imports into an `E2E_` datasetCode, under
// its own systemUri, so no real dataset's releases or concepts are touched.
// The importer is required inside each handler, never at the top: server
// startup must not load it, and only a test-support request does.
const E2E_DATASET_CODE = /^E2E_[A-Za-z0-9_-]{1,60}$/;
const DATASET_VERSION = /^[A-Za-z0-9._-]{1,40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

if (testSupportRoutesEnabled()) {
  router.post('/run', requireTestSupportSecret, async (req, res) => {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível.' });
    }

    const { datasetCode, datasetVersion, records } = req.body || {};
    if (typeof datasetCode !== 'string' || !E2E_DATASET_CODE.test(datasetCode)) {
      return res.status(400).json({ success: false, error: 'invalid_dataset_code' });
    }
    if (typeof datasetVersion !== 'string' || !DATASET_VERSION.test(datasetVersion)) {
      return res.status(400).json({ success: false, error: 'invalid_dataset_version' });
    }
    if (!Array.isArray(records) || records.length < 1 || records.length > 1000 || !records.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))) {
      return res.status(400).json({ success: false, error: 'invalid_records' });
    }

    const pipeline = require('../../reference-data/reference-imports/pipeline');
    const hpoSource = require('../../reference-data/reference-imports/sources/hpo');
    const { normalizeRecord } = require('../../reference-data/reference-imports/normalizeHpo');
    const { checksumFile } = require('../../reference-data/reference-imports/parseJsonLines');

    let result;
    try {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reference-import-e2e-'));
      try {
        const file = path.join(dir, 'records.jsonl');
        await fs.promises.writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
        const { checksum } = await checksumFile(file);
        // HPO's registered sourceId, license, format, parser and mapping
        // versions, under the E2E_ dataset's own code and systemUri.
        const source = {
          ...hpoSource,
          datasetCode,
          datasetName: `E2E ${datasetCode}`,
          systemUri: `urn:bioavanced:e2e:${datasetCode}`,
          datasetVersion,
          fixturePath: file,
          retrievalUri: `file://${file.split(path.sep).join('/')}`,
          expectedChecksum: checksum,
        };
        // A full run parses the preserved copy, so the temp file is not
        // needed once the call returns.
        result = await pipeline.runImport({ db, source, normalizeRecord, initiatedBy: 'system:e2e-test-support' });
      } finally {
        await fs.promises.rm(dir, { recursive: true, force: true });
      }
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.status(200).json({
      success: true,
      data: {
        run: result.run,
        releaseId: result.releaseId ?? null,
        approved: Boolean(result.approved),
        idempotent: Boolean(result.idempotent),
        assetUri: result.assetUri ?? null,
      },
    });
  });

  router.post('/asset', requireTestSupportSecret, async (req, res) => {
    const { datasetCode, checksum } = req.body || {};
    if (typeof datasetCode !== 'string' || !E2E_DATASET_CODE.test(datasetCode)) {
      return res.status(400).json({ success: false, error: 'invalid_dataset_code' });
    }
    if (typeof checksum !== 'string' || !SHA256_HEX.test(checksum)) {
      return res.status(400).json({ success: false, error: 'invalid_checksum' });
    }

    const { checksumFile } = require('../../reference-data/reference-imports/parseJsonLines');
    const { referenceAssetPath, referenceAssetUri } = require('../../reference-data/reference-imports/preserveAsset');

    const assetUri = referenceAssetUri({ datasetCode, checksum });
    const assetPath = referenceAssetPath(STORAGE_BASE, datasetCode, checksum);
    try {
      let stat = null;
      try {
        stat = await fs.promises.lstat(assetPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!stat || !stat.isFile()) {
        return res.status(200).json({ success: true, data: { assetUri, exists: false, sha256: null } });
      }
      const sha256 = (await checksumFile(assetPath)).checksum;
      return res.status(200).json({ success: true, data: { assetUri, exists: true, sha256 } });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = router;
