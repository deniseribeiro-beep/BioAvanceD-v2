const fs = require('fs');
const path = require('path');
const { checksumFile } = require('./parseJsonLines');
const fullLabSources = require('./lab/fullLabSources');
const { convertHpoFile } = require('./lab/convertHpoToJsonl');
const { convertIcd10CmOrderFile } = require('./lab/convertIcd10CmOrderToJsonl');
const { convertAtcCsvFile } = require('./lab/convertAtcCsvToJsonl');
const { convertLoincCsvFile } = require('./lab/convertLoincCsvToJsonl');
const { convertDcbXlsxFile } = require('./lab/convertDcbXlsxToJsonl');
const { convertOrphaPackFile } = require('./lab/convertOrphaPackToJsonl');

/**
 * Resolves which on-disk artifact the RF028 pipeline should Acquire.
 *
 * Default / REFERENCE_IMPORT_PROFILE unset|fixture → bundled source.fixturePath
 *   (e2e-gate / CI unchanged).
 *
 * REFERENCE_IMPORT_PROFILE=full-lab → preplaced dump under
 *   REFERENCE_FULL_ASSET_DIR/<DATASET>/, optionally converted into
 *   REFERENCE_FULL_CACHE_DIR/<DATASET>/data.jsonl.
 *
 * No network I/O here — open download stays in future lab/download* helpers.
 * ATC and other gated codes are preplaced-only (operator SCP).
 */

function findFirstExisting(dir, names) {
  if (!dir || !fs.existsSync(dir)) return null;
  for (const name of names || []) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

async function ensureConverter(entry, rawPath, cacheJsonlPath) {
  if (entry.convert === 'hpo-json') {
    if (!rawPath.toLowerCase().endsWith('.json')) {
      throw new Error(
        `Full-lab HPO: conversor atual só aceita hp.json (OBO Graphs JSON); recebido ${path.basename(rawPath)}.`,
      );
    }
    return convertHpoFile({ inputPath: rawPath, outputPath: cacheJsonlPath });
  }
  if (entry.convert === 'icd10-cm-order') {
    return convertIcd10CmOrderFile({ inputPath: rawPath, outputPath: cacheJsonlPath });
  }
  if (entry.convert === 'atc-csv') {
    return convertAtcCsvFile({ inputPath: rawPath, outputPath: cacheJsonlPath });
  }
  if (entry.convert === 'loinc-csv') {
    return convertLoincCsvFile({ inputPath: rawPath, outputPath: cacheJsonlPath });
  }
  if (entry.convert === 'dcb-xlsx') {
    return convertDcbXlsxFile({ inputPath: rawPath, outputPath: cacheJsonlPath });
  }
  if (entry.convert === 'orpha-pack') {
    const intakePath = path.join(path.dirname(cacheJsonlPath), 'intake-records.jsonl');
    return convertOrphaPackFile({
      inputPath: rawPath,
      outputPath: cacheJsonlPath,
      intakeOutputPath: intakePath,
    });
  }
  throw new Error(
    `Full-lab ${entry.datasetCode}: conversor '${entry.convert || 'none'}' ainda não implementado. `
      + `Coloque um JSONL pronto em REFERENCE_FULL_ASSET_DIR/${entry.datasetCode}/data.jsonl `
      + `ou REFERENCE_FULL_CACHE_DIR/${entry.datasetCode}/data.jsonl.`,
  );
}

/**
 * @param {object} source — sources/*.js module
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{
 *   path: string,
 *   expectedChecksum: string,
 *   retrievalUri: string,
 *   datasetVersion: string,
 *   accessMethod: string,
 *   profile: 'fixture'|'full-lab',
 * }>}
 */
async function resolveSourceAsset(source, env = process.env) {
  const profileRaw = (env.REFERENCE_IMPORT_PROFILE || 'fixture').trim().toLowerCase();
  const profile = profileRaw === 'full-lab' ? 'full-lab' : 'fixture';

  if (profile === 'fixture') {
    return {
      path: source.fixturePath,
      expectedChecksum: source.expectedChecksum,
      retrievalUri: source.retrievalUri,
      datasetVersion: source.datasetVersion,
      accessMethod: source.accessMethod,
      profile,
    };
  }

  const entry = fullLabSources[source.datasetCode];
  if (!entry) {
    throw new Error(
      `Full-lab: dataset ${source.datasetCode} não está no registry lab/fullLabSources.js.`,
    );
  }

  const assetDir = env.REFERENCE_FULL_ASSET_DIR
    ? path.join(env.REFERENCE_FULL_ASSET_DIR, source.datasetCode)
    : null;
  const cacheDir = env.REFERENCE_FULL_CACHE_DIR
    ? path.join(env.REFERENCE_FULL_CACHE_DIR, source.datasetCode)
    : null;
  const cacheJsonlPath = cacheDir ? path.join(cacheDir, 'data.jsonl') : null;

  let jsonlPath = findFirstExisting(cacheDir, ['data.jsonl']);
  if (!jsonlPath) jsonlPath = findFirstExisting(assetDir, entry.jsonlCandidates);

  if (!jsonlPath) {
    const rawPath = findFirstExisting(assetDir, entry.rawCandidates);
    if (!rawPath) {
      const hint = entry.note
        || `Coloque o dump em REFERENCE_FULL_ASSET_DIR/${source.datasetCode}/ `
          + `(candidatos: ${(entry.jsonlCandidates || []).concat(entry.rawCandidates || []).join(', ')}).`;
      throw new Error(`Full-lab ${source.datasetCode}: asset ausente. ${hint}`);
    }
    if (!cacheJsonlPath) {
      throw new Error(
        `Full-lab ${source.datasetCode}: REFERENCE_FULL_CACHE_DIR é obrigatório para converter ${path.basename(rawPath)}.`,
      );
    }
    await ensureConverter(entry, rawPath, cacheJsonlPath);
    jsonlPath = cacheJsonlPath;
  }

  const { checksum } = await checksumFile(jsonlPath);
  const fileUri = `file://${jsonlPath.replace(/\\/g, '/')}`;

  return {
    path: jsonlPath,
    expectedChecksum: checksum,
    retrievalUri: fileUri,
    datasetVersion: `full-lab:${checksum.slice(0, 12)}`,
    accessMethod: 'manual_upload',
    profile,
  };
}

module.exports = { resolveSourceAsset, findFirstExisting };
