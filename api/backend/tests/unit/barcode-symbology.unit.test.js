import { describe, it, expect } from 'vitest';
const {
  normalizeBarcodeText,
  stripScannerPrefix,
  parseScannedBarcode,
  generateBarcodeSymbologies,
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

  it('identifies DataMatrix from ]Q3 prefix', () => {
    const result = parseScannedBarcode(']Q3SMP-003');
    expect(result.scannerSymbology).toBe('DataMatrix');
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

  it('includes checksumHint strings', () => {
    const result = generateBarcodeSymbologies('SMP-001');
    expect(typeof result.code128.checksumHint).toBe('string');
    expect(typeof result.dataMatrix.checksumHint).toBe('string');
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
