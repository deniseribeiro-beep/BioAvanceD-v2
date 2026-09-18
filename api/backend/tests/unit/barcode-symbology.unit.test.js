import { describe, it, expect } from 'vitest';
const {
  normalizeBarcodeText,
  stripScannerPrefix,
  parseScannedBarcode,
  generateBarcodeSymbologies,
  generateIndustrialBarcodeArtifacts,
} = require('../../src/utils/barcodeSymbology');

describe('normalizeBarcodeText', () => {
  it('trims whitespace', () => {
    expect(normalizeBarcodeText('  SMP-001  ')).toBe('SMP-001');
  });

  it('returns empty string for null', () => {
    expect(normalizeBarcodeText(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeBarcodeText(undefined)).toBe('');
  });

  it('coerces numbers to string', () => {
    expect(normalizeBarcodeText(123)).toBe('123');
  });

  it('returns plain string unchanged', () => {
    expect(normalizeBarcodeText('SMP-001')).toBe('SMP-001');
  });
});

describe('stripScannerPrefix', () => {
  it('strips ]d2 prefix', () => {
    expect(stripScannerPrefix(']d2SMP-001')).toBe('SMP-001');
  });

  it('strips ]Q3 prefix', () => {
    expect(stripScannerPrefix(']Q3SMP-001')).toBe('SMP-001');
  });

  it('strips ]C1 prefix', () => {
    expect(stripScannerPrefix(']C1SMP-001')).toBe('SMP-001');
  });

  it('returns value unchanged if no prefix', () => {
    expect(stripScannerPrefix('SMP-001')).toBe('SMP-001');
  });

  it('returns empty string for null', () => {
    expect(stripScannerPrefix(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(stripScannerPrefix(undefined)).toBe('');
  });
});

describe('parseScannedBarcode', () => {
  it('identifies Code128 from ]C1 prefix', () => {
    const result = parseScannedBarcode(']C1SMP-001');
    expect(result.scannerSymbology).toBe('Code128');
    expect(result.normalizedValue).toBe('SMP-001');
    expect(result.rawValue).toBe(']C1SMP-001');
    expect(result.isValid).toBe(true);
  });

  it('identifies DataMatrix from ]d2 prefix', () => {
    const result = parseScannedBarcode(']d2SMP-002');
    expect(result.scannerSymbology).toBe('DataMatrix');
    expect(result.normalizedValue).toBe('SMP-002');
    expect(result.isValid).toBe(true);
  });

  // #646 Wave 3 (RF016 AC#2): ]Q3 is QR's own AIM symbology identifier,
  // distinct from ]d2 (DataMatrix) -- previously folded into 'DataMatrix'
  // because QR rendering didn't exist yet at all. Now that it does
  // (generateBarcodeSymbologies/generateIndustrialBarcodeArtifacts below),
  // the scanner-side identification has to be accurate too.
  it('identifies QR from ]Q3 prefix', () => {
    const result = parseScannedBarcode(']Q3SMP-003');
    expect(result.scannerSymbology).toBe('QR');
    expect(result.normalizedValue).toBe('SMP-003');
    expect(result.isValid).toBe(true);
  });

  it('marks UNKNOWN for plain barcode', () => {
    const result = parseScannedBarcode('SMP-003');
    expect(result.scannerSymbology).toBe('UNKNOWN');
    expect(result.normalizedValue).toBe('SMP-003');
    expect(result.isValid).toBe(true);
  });

  it('marks invalid when normalized value is empty after prefix strip', () => {
    const result = parseScannedBarcode(']C1');
    expect(result.isValid).toBe(false);
  });

  it('handles null gracefully — isValid false, UNKNOWN symbology', () => {
    const result = parseScannedBarcode(null);
    expect(result.isValid).toBe(false);
    expect(result.scannerSymbology).toBe('UNKNOWN');
  });

  it('handles empty string gracefully', () => {
    const result = parseScannedBarcode('');
    expect(result.isValid).toBe(false);
  });

  it('rawValue is preserved for known-prefix inputs', () => {
    const result = parseScannedBarcode(']d2SMP-X');
    expect(result.rawValue).toBe(']d2SMP-X');
  });
});

describe('generateBarcodeSymbologies', () => {
  it('throws when barcodeValue is empty', () => {
    expect(() => generateBarcodeSymbologies('')).toThrow('obrigatório');
  });

  it('throws when barcodeValue is null', () => {
    expect(() => generateBarcodeSymbologies(null)).toThrow('obrigatório');
  });

  it('throws when barcodeValue is only whitespace', () => {
    expect(() => generateBarcodeSymbologies('   ')).toThrow('obrigatório');
  });

  it('returns canonicalValue equal to trimmed input', () => {
    const result = generateBarcodeSymbologies('  SMP-001  ');
    expect(result.canonicalValue).toBe('SMP-001');
  });

  it('returns code128 with correct payload and scannerPrefix', () => {
    const result = generateBarcodeSymbologies('SMP-001');
    expect(result.code128.payload).toBe('SMP-001');
    expect(result.code128.scannerPrefix).toBe(']C1');
  });

  it('returns dataMatrix with correct payload and scannerPrefix', () => {
    const result = generateBarcodeSymbologies('SMP-001');
    expect(result.dataMatrix.payload).toBe('SMP-001');
    expect(result.dataMatrix.scannerPrefix).toBe(']d2');
  });

  it('returns qr with correct payload and scannerPrefix', () => {
    const result = generateBarcodeSymbologies('SMP-001');
    expect(result.qr.payload).toBe('SMP-001');
    expect(result.qr.scannerPrefix).toBe(']Q3');
  });

  it('includes checksumHint strings', () => {
    const result = generateBarcodeSymbologies('SMP-001');
    expect(typeof result.code128.checksumHint).toBe('string');
    expect(typeof result.dataMatrix.checksumHint).toBe('string');
    expect(typeof result.qr.checksumHint).toBe('string');
  });

  it('includes generatedAt Date', () => {
    const result = generateBarcodeSymbologies('SMP-001');
    expect(result.generatedAt).toBeInstanceOf(Date);
  });

  it('is deterministic — same checksums for same input', () => {
    const r1 = generateBarcodeSymbologies('SMP-X');
    const r2 = generateBarcodeSymbologies('SMP-X');
    expect(r1.code128.checksumHint).toBe(r2.code128.checksumHint);
    expect(r1.dataMatrix.checksumHint).toBe(r2.dataMatrix.checksumHint);
  });

  it('produces different checksums for different inputs', () => {
    const r1 = generateBarcodeSymbologies('SMP-001');
    const r2 = generateBarcodeSymbologies('SMP-002');
    expect(r1.code128.checksumHint).not.toBe(r2.code128.checksumHint);
  });
});


describe('generateIndustrialBarcodeArtifacts item 8 branches', () => {
  it('renders Code128, DataMatrix and QR with default render options', async () => {
    const result = await generateIndustrialBarcodeArtifacts('  SMP-IND-001  ');

    expect(result.canonicalValue).toBe('SMP-IND-001');
    for (const key of ['code128', 'dataMatrix', 'qr']) {
      expect(result[key].renderer).toBe('bwip-js');
      expect(result[key].imagePng.mimeType).toBe('image/png');
      expect(result[key].imagePng.bytes).toBeGreaterThan(0);
      expect(result[key].imagePng.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result[key].imagePng.base64).toEqual(expect.any(String));
    }
    expect(result.code128.imagePng.renderOptions.height).toBe(12);
    expect(result.code128.imagePng.renderOptions.textxalign).toBe('center');
    expect(result.dataMatrix.imagePng.renderOptions.height).toBeNull();
    expect(result.qr.imagePng.renderOptions.textxalign).toBeNull();
  });

  it('supports payload suppression and per-symbology overrides', async () => {
    const result = await generateIndustrialBarcodeArtifacts('SMP-IND-002', {
      includePayload: false,
      code128: { scale: 2, paddingwidth: 3, paddingheight: 4 },
      dataMatrix: { scale: 4, paddingwidth: 2 },
      qr: { scale: 6, paddingheight: 2 },
    });

    expect(result.code128.imagePng.base64).toBeNull();
    expect(result.dataMatrix.imagePng.base64).toBeNull();
    expect(result.qr.imagePng.base64).toBeNull();
    expect(result.code128.imagePng.renderOptions.scale).toBe(2);
    expect(result.code128.imagePng.renderOptions.paddingwidth).toBe(3);
    expect(result.dataMatrix.imagePng.renderOptions.scale).toBe(4);
    expect(result.qr.imagePng.renderOptions.scale).toBe(6);
  });

  it('rejects an empty industrial barcode value', async () => {
    await expect(generateIndustrialBarcodeArtifacts('   ')).rejects.toThrow(
      'barcodeValue é obrigatório para gerar artefatos industriais'
    );
  });
});
