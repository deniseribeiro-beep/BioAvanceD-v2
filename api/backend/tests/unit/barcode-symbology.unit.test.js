import { describe, it, expect } from 'vitest';

const {
  normalizeBarcodeText,
  stripScannerPrefix,
  parseScannedBarcode,
  generateDataMatrixDescriptor,
  generateIndustrialBarcodeArtifacts,
} = require('../../src/utils/barcodeSymbology');

describe('normalizeBarcodeText', () => {
  it('trims canonical string values', () => {
    expect(normalizeBarcodeText('  SMP-001  ')).toBe('SMP-001');
  });

  it('rejects null, undefined and numeric legacy identifiers', () => {
    expect(normalizeBarcodeText(null)).toBe('');
    expect(normalizeBarcodeText(undefined)).toBe('');
    expect(normalizeBarcodeText(123)).toBe('');
  });
});

describe('stripScannerPrefix', () => {
  it('strips only the AIM Data Matrix prefix', () => {
    expect(stripScannerPrefix(']d2SMP-001')).toBe('SMP-001');
  });

  it('does not normalize retired QR or Code128 prefixes', () => {
    expect(stripScannerPrefix(']Q3SMP-001')).toBe(']Q3SMP-001');
    expect(stripScannerPrefix(']C1SMP-001')).toBe(']C1SMP-001');
  });

  it('returns a plain encoded value unchanged', () => {
    expect(stripScannerPrefix('SMP-001')).toBe('SMP-001');
  });
});

describe('parseScannedBarcode', () => {
  it('accepts AIM Data Matrix input', () => {
    const result = parseScannedBarcode(']d2SMP-002');
    expect(result).toMatchObject({
      scannerSymbology: 'DataMatrix',
      normalizedValue: 'SMP-002',
      isValid: true,
    });
  });

  it('accepts a plain encodedValue because some scanners suppress the AIM prefix', () => {
    const result = parseScannedBarcode('SMP-003');
    expect(result).toMatchObject({
      scannerSymbology: 'UNKNOWN',
      normalizedValue: 'SMP-003',
      isValid: true,
    });
  });

  it('rejects retired QR and Code128 scanner inputs', () => {
    expect(parseScannedBarcode(']Q3SMP-003').isValid).toBe(false);
    expect(parseScannedBarcode(']C1SMP-003').isValid).toBe(false);
  });

  it('rejects empty Data Matrix payloads', () => {
    expect(parseScannedBarcode(']d2').isValid).toBe(false);
    expect(parseScannedBarcode('').isValid).toBe(false);
  });
});

describe('generateDataMatrixDescriptor', () => {
  it('requires a canonical encodedValue string', () => {
    expect(() => generateDataMatrixDescriptor('')).toThrow('encodedValue é obrigatório');
    expect(() => generateDataMatrixDescriptor(123)).toThrow('encodedValue é obrigatório');
  });

  it('returns the canonical Data Matrix descriptor only', () => {
    const result = generateDataMatrixDescriptor('  SMP-001  ');
    expect(result).toEqual({
      encodedValue: 'SMP-001',
      symbology: 'data_matrix',
      scannerPrefix: ']d2',
      checksumHint: expect.stringMatching(/^[a-f0-9]{8}$/),
    });
  });

  it('is deterministic for the same encodedValue', () => {
    const a = generateDataMatrixDescriptor('SMP-X');
    const b = generateDataMatrixDescriptor('SMP-X');
    expect(a.checksumHint).toBe(b.checksumHint);
  });
});

describe('generateIndustrialBarcodeArtifacts', () => {
  it('renders one Data Matrix PNG using the canonical encodedValue', async () => {
    const result = await generateIndustrialBarcodeArtifacts('  SMP-IND-001  ');

    expect(result.encodedValue).toBe('SMP-IND-001');
    expect(result.symbology).toBe('data_matrix');
    expect(result.dataMatrix.renderer).toBe('bwip-js');
    expect(result.dataMatrix.scannerPrefix).toBe(']d2');
    expect(result.dataMatrix.imagePng.mimeType).toBe('image/png');
    expect(result.dataMatrix.imagePng.bytes).toBeGreaterThan(0);
    expect(result.dataMatrix.imagePng.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.dataMatrix.imagePng.base64).toEqual(expect.any(String));
    expect(result.dataMatrix.imagePng.renderOptions.bcid).toBe('datamatrix');
  });

  it('supports payload suppression and Data Matrix rendering overrides', async () => {
    const result = await generateIndustrialBarcodeArtifacts('SMP-IND-002', {
      includePayload: false,
      dataMatrix: { scale: 4, paddingwidth: 2, paddingheight: 3 },
    });

    expect(result.dataMatrix.imagePng.base64).toBeNull();
    expect(result.dataMatrix.imagePng.renderOptions.scale).toBe(4);
    expect(result.dataMatrix.imagePng.renderOptions.paddingwidth).toBe(2);
    expect(result.dataMatrix.imagePng.renderOptions.paddingheight).toBe(3);
  });

  it('rejects an empty or numeric encodedValue', async () => {
    await expect(generateIndustrialBarcodeArtifacts('   ')).rejects.toThrow('encodedValue é obrigatório');
    await expect(generateIndustrialBarcodeArtifacts(123)).rejects.toThrow('encodedValue é obrigatório');
  });
});
