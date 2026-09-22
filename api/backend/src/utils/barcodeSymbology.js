const crypto = require('crypto');
const bwipjs = require('bwip-js');

function normalizeBarcodeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function inferScannerSymbology(rawValue) {
  const value = String(rawValue || '');

  if (value.startsWith(']d2')) {
    return 'DataMatrix';
  }

  // Any other AIM prefix is outside the canonical v2 tube-identification
  // contract. It is rejected generically rather than preserved as a
  // compatibility path for retired symbologies.
  if (value.startsWith(']')) {
    return 'UNSUPPORTED';
  }

  return 'UNKNOWN';
}

function stripScannerPrefix(rawValue) {
  const value = String(rawValue || '').trim();

  // Canonical v2 accepts the AIM Data Matrix identifier only.
  if (value.startsWith(']d2')) {
    return value.slice(3).trim();
  }

  return value;
}

function parseScannedBarcode(rawValue) {
  const scannerSymbology = inferScannerSymbology(rawValue);
  const normalizedValue = stripScannerPrefix(rawValue);
  const supportedSymbology = scannerSymbology !== 'UNSUPPORTED';

  return {
    rawValue: String(rawValue || ''),
    scannerSymbology,
    normalizedValue,
    isValid: supportedSymbology && normalizedValue.length > 0
  };
}

function generateDataMatrixDescriptor(encodedValue) {
  const normalized = normalizeBarcodeText(encodedValue);
  if (!normalized) {
    throw new Error('encodedValue é obrigatório para gerar Data Matrix');
  }

  const digest = crypto.createHash('sha256').update(normalized).digest('hex');

  return {
    encodedValue: normalized,
    symbology: 'data_matrix',
    scannerPrefix: ']d2',
    checksumHint: digest.slice(0, 8)
  };
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildDataMatrixRenderOptions(payload, overrides = {}) {
  return {
    bcid: 'datamatrix',
    text: payload,
    scale: 5,
    paddingwidth: 8,
    paddingheight: 8,
    ...overrides
  };
}

async function renderDataMatrixPngAsset(payload, options = {}) {
  const renderOptions = buildDataMatrixRenderOptions(payload, options);
  const pngBuffer = await bwipjs.toBuffer(renderOptions);
  const includePayload = options.includePayload !== false;

  return {
    mimeType: 'image/png',
    bytes: pngBuffer.length,
    sha256: hashBuffer(pngBuffer),
    base64: includePayload ? pngBuffer.toString('base64') : null,
    renderOptions: {
      bcid: renderOptions.bcid,
      scale: renderOptions.scale,
      paddingwidth: renderOptions.paddingwidth || 0,
      paddingheight: renderOptions.paddingheight || 0
    }
  };
}

async function generateIndustrialBarcodeArtifacts(encodedValue, options = {}) {
  const descriptor = generateDataMatrixDescriptor(encodedValue);
  const dataMatrixPng = await renderDataMatrixPngAsset(descriptor.encodedValue, {
    ...(options.dataMatrix || {}),
    includePayload: options.includePayload
  });

  return {
    encodedValue: descriptor.encodedValue,
    symbology: descriptor.symbology,
    dataMatrix: {
      encodedValue: descriptor.encodedValue,
      scannerPrefix: descriptor.scannerPrefix,
      checksumHint: descriptor.checksumHint,
      renderer: 'bwip-js',
      imagePng: dataMatrixPng
    }
  };
}

module.exports = {
  parseScannedBarcode,
  generateDataMatrixDescriptor,
  generateIndustrialBarcodeArtifacts,
  stripScannerPrefix,
  normalizeBarcodeText
};
