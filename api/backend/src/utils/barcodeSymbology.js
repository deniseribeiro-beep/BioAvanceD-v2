const crypto = require('crypto');
const bwipjs = require('bwip-js');

function normalizeBarcodeText(value) {
  return String(value || '').trim();
}

function inferScannerSymbology(rawValue) {
  const value = String(rawValue || '');

  // #646 Wave 3 (RF016 AC#2): ]d2 and ]Q3 are the real, distinct AIM
  // symbology identifiers for DataMatrix and QR Code respectively -- they
  // were both folded into 'DataMatrix' before QR rendering existed at all.
  // Real QR support means this mapping has to be accurate too, not just
  // the rendering side.
  if (value.startsWith(']d2')) {
    return 'DataMatrix';
  }

  if (value.startsWith(']Q3')) {
    return 'QR';
  }

  if (value.startsWith(']C1')) {
    return 'Code128';
  }

  return 'UNKNOWN';
}

function stripScannerPrefix(rawValue) {
  const value = String(rawValue || '').trim();

  if (value.startsWith(']d2') || value.startsWith(']Q3') || value.startsWith(']C1')) {
    return value.slice(3).trim();
  }

  return value;
}

function parseScannedBarcode(rawValue) {
  const scannerSymbology = inferScannerSymbology(rawValue);
  const normalizedValue = stripScannerPrefix(rawValue);

  return {
    rawValue: String(rawValue || ''),
    scannerSymbology,
    normalizedValue,
    isValid: normalizedValue.length > 0
  };
}

function generateBarcodeSymbologies(barcodeValue) {
  const normalized = normalizeBarcodeText(barcodeValue);
  if (!normalized) {
    throw new Error('barcodeValue é obrigatório para gerar simbologias');
  }

  const digest = crypto.createHash('sha256').update(normalized).digest('hex');

  return {
    canonicalValue: normalized,
    code128: {
      payload: normalized,
      scannerPrefix: ']C1',
      checksumHint: digest.slice(0, 8)
    },
    dataMatrix: {
      payload: normalized,
      scannerPrefix: ']d2',
      checksumHint: digest.slice(8, 16)
    },
    qr: {
      payload: normalized,
      scannerPrefix: ']Q3',
      checksumHint: digest.slice(16, 24)
    },
    generatedAt: new Date()
  };
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildBwipRenderOptions(symbology, payload, overrides = {}) {
  if (symbology === 'Code128') {
    return {
      bcid: 'code128',
      text: payload,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: 'center',
      paddingwidth: 8,
      paddingheight: 8,
      ...overrides
    };
  }

  if (symbology === 'DataMatrix') {
    return {
      bcid: 'datamatrix',
      text: payload,
      scale: 5,
      paddingwidth: 8,
      paddingheight: 8,
      ...overrides
    };
  }

  if (symbology === 'QR') {
    return {
      bcid: 'qrcode',
      text: payload,
      scale: 5,
      paddingwidth: 8,
      paddingheight: 8,
      ...overrides
    };
  }

  throw new Error(`Simbologia não suportada para renderização industrial: ${symbology}`);
}

async function renderBarcodePngAsset(symbology, payload, options = {}) {
  const renderOptions = buildBwipRenderOptions(symbology, payload, options);
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
      height: renderOptions.height || null,
      includetext: Boolean(renderOptions.includetext),
      textxalign: renderOptions.textxalign || null,
      paddingwidth: renderOptions.paddingwidth || 0,
      paddingheight: renderOptions.paddingheight || 0
    }
  };
}

async function generateIndustrialBarcodeArtifacts(barcodeValue, options = {}) {
  const normalized = normalizeBarcodeText(barcodeValue);
  if (!normalized) {
    throw new Error('barcodeValue é obrigatório para gerar artefatos industriais');
  }

  const digest = crypto.createHash('sha256').update(normalized).digest('hex');

  const [code128Png, dataMatrixPng, qrPng] = await Promise.all([
    renderBarcodePngAsset('Code128', normalized, {
      ...(options.code128 || {}),
      includePayload: options.includePayload
    }),
    renderBarcodePngAsset('DataMatrix', normalized, {
      ...(options.dataMatrix || {}),
      includePayload: options.includePayload
    }),
    renderBarcodePngAsset('QR', normalized, {
      ...(options.qr || {}),
      includePayload: options.includePayload
    })
  ]);

  return {
    canonicalValue: normalized,
    code128: {
      payload: normalized,
      scannerPrefix: ']C1',
      checksumHint: digest.slice(0, 8),
      renderer: 'bwip-js',
      imagePng: code128Png
    },
    dataMatrix: {
      payload: normalized,
      scannerPrefix: ']d2',
      checksumHint: digest.slice(8, 16),
      renderer: 'bwip-js',
      imagePng: dataMatrixPng
    },
    qr: {
      payload: normalized,
      scannerPrefix: ']Q3',
      checksumHint: digest.slice(16, 24),
      renderer: 'bwip-js',
      imagePng: qrPng
    },
    generatedAt: new Date()
  };
}

module.exports = {
  parseScannedBarcode,
  generateBarcodeSymbologies,
  generateIndustrialBarcodeArtifacts,
  stripScannerPrefix,
  normalizeBarcodeText
};