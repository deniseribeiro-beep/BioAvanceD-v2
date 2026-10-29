const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { checksumFile } = require('./parseJsonLines');

// RF028 AC2 / RNF032 C2: the object-storage area a reference release's source
// asset is preserved under, as `objstore://reference-releases/...`.
const REFERENCE_ASSET_AREA = 'reference-releases';

const DATASET_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The object is content-addressed by the release's own datasetCode and
 * sourceChecksum, so neither the release nor the run needs a field to find it.
 */
function referenceAssetUri({ datasetCode, checksum }) {
  return `objstore://${REFERENCE_ASSET_AREA}/${datasetCode}/sha256/${checksum}`;
}

function referenceAssetPath(storageRoot, datasetCode, checksum) {
  return path.join(storageRoot, REFERENCE_ASSET_AREA, datasetCode, 'sha256', checksum);
}

function removeQuietly(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_error) {
    // Already gone; nothing is left behind either way.
  }
}

async function verifyExisting({ finalPath, assetUri, checksum }) {
  const stat = fs.lstatSync(finalPath);
  if (!stat.isFile()) {
    return { preserved: false, assetUri, reason: `${assetUri} existe e não é um arquivo regular.` };
  }
  const stored = (await checksumFile(finalPath)).checksum;
  if (stored !== checksum) {
    // The stored object is never overwritten or deleted.
    return {
      preserved: false,
      assetUri,
      reason: `${assetUri} já guarda outro conteúdo (sha256 ${stored}, esperado ${checksum}).`,
    };
  }
  return { preserved: true, assetUri, assetPath: finalPath, reused: true };
}

/**
 * RF028 AC2 "preservar o asset no Object Storage" / RNF032 C2: copies the
 * checksum-verified source artifact to its content-addressed object, or
 * reuses the object already there when its bytes hash to the same checksum.
 * Never overwrites an object and never throws: any failure is returned as
 * `{ preserved: false, assetUri, reason }`.
 *
 * INFERENCE, not a citation: the object is stored as plaintext. A reference
 * release is published, licensed external data, not the scientific files or
 * consent evidence that RNF029/#566 classify encrypted at rest, and
 * assertFileEncryptionConfigured would fail every import on a keyless
 * deployment.
 */
async function preserveReferenceAsset({ sourcePath, datasetCode, checksum, storageRoot }) {
  const assetUri = referenceAssetUri({ datasetCode, checksum });
  if (typeof datasetCode !== 'string' || !DATASET_CODE_PATTERN.test(datasetCode)) {
    return { preserved: false, assetUri, reason: `datasetCode inválido para o Object Storage: ${datasetCode}.` };
  }
  if (typeof checksum !== 'string' || !SHA256_PATTERN.test(checksum)) {
    return { preserved: false, assetUri, reason: `checksum SHA-256 inválido para o Object Storage: ${checksum}.` };
  }
  if (typeof storageRoot !== 'string' || storageRoot.length === 0) {
    return { preserved: false, assetUri, reason: `raiz do Object Storage inválida: ${storageRoot}.` };
  }

  const finalPath = referenceAssetPath(storageRoot, datasetCode, checksum);
  let tmpPath = null;
  try {
    if (fs.existsSync(finalPath)) {
      return await verifyExisting({ finalPath, assetUri, checksum });
    }

    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    tmpPath = `${finalPath}.tmp-${crypto.randomUUID()}`;
    fs.copyFileSync(sourcePath, tmpPath, fs.constants.COPYFILE_EXCL);
    const copied = (await checksumFile(tmpPath)).checksum;
    if (copied !== checksum) {
      return {
        preserved: false,
        assetUri,
        reason: `A fonte mudou após a verificação de integridade: a cópia tem sha256 ${copied}, esperado ${checksum}.`,
      };
    }
    try {
      // linkSync fails if the object appeared meanwhile, so nothing is ever
      // overwritten.
      fs.linkSync(tmpPath, finalPath);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      removeQuietly(tmpPath);
      tmpPath = null;
      return await verifyExisting({ finalPath, assetUri, checksum });
    }
    return { preserved: true, assetUri, assetPath: finalPath, reused: false };
  } catch (error) {
    return { preserved: false, assetUri, reason: `Falha ao preservar ${assetUri}: ${error.message}` };
  } finally {
    if (tmpPath) removeQuietly(tmpPath);
  }
}

module.exports = {
  REFERENCE_ASSET_AREA,
  referenceAssetUri,
  referenceAssetPath,
  preserveReferenceAsset,
};
