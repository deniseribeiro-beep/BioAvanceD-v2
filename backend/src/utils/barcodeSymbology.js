const crypto = require('crypto');

function normalizeBarcodeText(value) {
  return String(value || '').trim();
}

function inferScannerSymbology(rawValue) {
  const value = String(rawValue || '');

  if (value.startsWith(']d2') || value.startsWith(']Q3')) {
    return 'DataMatrix';
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
    generatedAt: new Date()
  };
}

module.exports = {
  parseScannedBarcode,
  generateBarcodeSymbologies,
  stripScannerPrefix,
  normalizeBarcodeText
};